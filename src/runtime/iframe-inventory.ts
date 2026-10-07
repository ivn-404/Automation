/**
 * Plain inventory of what Playwright can reach inside the game iframe.
 * Used by PROBE-002 / GameRuntime.inspect to decide DOM vs canvas vs Phaser strategy.
 *
 * // @ts-nocheck — evaluate() bodies run in the browser; Node build has no DOM lib.
 */
// @ts-nocheck

import type { Frame, Page } from 'playwright';

import type { GameManifest } from '../core/models/index.js';

export type IframeTestSurface = 'canvas-only' | 'mixed' | 'dom-rich' | 'phaser-named';

export interface IframeCanvasInfo {
  readonly index: number;
  readonly width: number;
  readonly height: number;
  readonly visible: boolean;
}

export interface IframeDomSample {
  readonly tag: string;
  readonly id: string;
  readonly className: string;
  readonly role: string;
  readonly text: string;
  readonly testId: string;
}

export interface PhaserControlSample {
  readonly name: string;
  readonly type: string;
  readonly scene: string;
  readonly xRatio: number;
  readonly yRatio: number;
  readonly width: number;
  readonly height: number;
  readonly visible: boolean;
  readonly inputEnabled: boolean;
}

export interface IframeInventoryReport {
  readonly gameId: string;
  readonly hostUrl: string;
  readonly iframeSelector: string;
  readonly iframeFound: boolean;
  readonly frameUrl: string;
  readonly frameName: string;
  readonly sameOriginReadable: boolean;
  readonly readError?: string;
  readonly canvasCount: number;
  readonly canvases: readonly IframeCanvasInfo[];
  readonly buttonCount: number;
  readonly inputCount: number;
  readonly linkCount: number;
  readonly roleButtonCount: number;
  readonly elementsWithTestId: number;
  readonly sampleInteractive: readonly IframeDomSample[];
  readonly phaser: {
    readonly games: number;
    readonly scenes: readonly string[];
    readonly interactiveCount: number;
    readonly namedInteractiveCount: number;
    readonly samples: readonly PhaserControlSample[];
    readonly discoveryKeys: readonly string[];
    readonly discoveryNote: string;
  };
  readonly globals: {
    readonly hasPhaser: boolean;
    readonly hasPixi: boolean;
    readonly hasWebGL: boolean;
    readonly bodyChildTags: readonly string[];
  };
  readonly surface: IframeTestSurface;
  readonly summary: string;
  readonly recommendation: string;
}

function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (/token|auth|jwt|session|key|secret/i.test(key)) {
        url.searchParams.set(key, '[redacted]');
      }
    }
    return url.toString();
  } catch {
    return raw.replace(/(token|refresh_token|auth)=[^&]+/giu, '$1=[redacted]');
  }
}

function emptyPhaser(): IframeInventoryReport['phaser'] {
  return {
    games: 0,
    scenes: [],
    interactiveCount: 0,
    namedInteractiveCount: 0,
    samples: [],
    discoveryKeys: [],
    discoveryNote: '',
  };
}

function emptyReport(
  partial: Omit<
    IframeInventoryReport,
    | 'canvasCount'
    | 'canvases'
    | 'buttonCount'
    | 'inputCount'
    | 'linkCount'
    | 'roleButtonCount'
    | 'elementsWithTestId'
    | 'sampleInteractive'
    | 'phaser'
    | 'globals'
  > & { readonly globals?: IframeInventoryReport['globals'] },
): IframeInventoryReport {
  return {
    ...partial,
    canvasCount: 0,
    canvases: [],
    buttonCount: 0,
    inputCount: 0,
    linkCount: 0,
    roleButtonCount: 0,
    elementsWithTestId: 0,
    sampleInteractive: [],
    phaser: emptyPhaser(),
    globals: partial.globals ?? {
      hasPhaser: false,
      hasPixi: false,
      hasWebGL: false,
      bodyChildTags: [],
    },
  };
}

export async function inventoryGameIframe(
  page: Page,
  manifest: GameManifest,
  iframeSelector: string,
): Promise<IframeInventoryReport> {
  const hostUrl = page.url();
  const iframe = page.locator(iframeSelector).first();
  const iframeFound = (await iframe.count()) > 0;

  let frame: Frame | null = null;
  if (iframeFound) {
    const handle = await iframe.elementHandle();
    frame = handle !== null ? await handle.contentFrame() : null;
  }

  if (frame === null) {
    const candidates = page.frames().filter((entry) => entry !== page.mainFrame());
    frame =
      candidates.find((entry) => entry.url().length > 0 && !entry.url().startsWith('about:')) ??
      candidates[0] ??
      null;
  }

  if (frame === null) {
    return emptyReport({
      gameId: manifest.gameId,
      hostUrl: redactUrl(hostUrl),
      iframeSelector,
      iframeFound,
      frameUrl: '',
      frameName: '',
      sameOriginReadable: false,
      readError: 'No game frame found',
      surface: 'canvas-only',
      summary: 'Could not enter the game iframe.',
      recommendation:
        'Fix iframe attach first. Controllers stay on canvas coords until the frame is readable.',
    });
  }

  try {
    const snapshot = await frame.evaluate(() => {
      type PhaserSample = {
        name: string;
        type: string;
        scene: string;
        xRatio: number;
        yRatio: number;
        width: number;
        height: number;
        visible: boolean;
        inputEnabled: boolean;
      };

      const canvases = Array.from(document.querySelectorAll('canvas')).map((node, index) => {
        const rect = node.getBoundingClientRect();
        return {
          index,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          visible: rect.width > 0 && rect.height > 0,
        };
      });

      const textOf = (el: Element): string =>
        (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);

      const sampleFrom = (selector: string, limit = 12) =>
        Array.from(document.querySelectorAll(selector))
          .slice(0, limit)
          .map((el) => ({
            tag: el.tagName.toLowerCase(),
            id: el.id || '',
            className:
              typeof (el as HTMLElement).className === 'string'
                ? ((el as HTMLElement).className as string).slice(0, 80)
                : '',
            role: el.getAttribute('role') ?? '',
            text: textOf(el),
            testId: el.getAttribute('data-testid') ?? el.getAttribute('data-test') ?? '',
          }));

      const sampleInteractive = [
        ...sampleFrom('button'),
        ...sampleFrom('input'),
        ...sampleFrom('a[href]'),
        ...sampleFrom('[role="button"]'),
        ...sampleFrom('[data-testid], [data-test]'),
      ].slice(0, 20);

      const bodyChildren = Array.from(document.body?.children ?? []).map((el) =>
        el.tagName.toLowerCase(),
      );

      const win = window as Window & Record<string, unknown> & {
        Phaser?: {
          GAMES?: unknown[];
          Game?: unknown;
        };
        PIXI?: unknown;
      };

      const discoveryKeys = Object.getOwnPropertyNames(win)
        .filter((key) => /phaser|game|scene|slot|engine|play/i.test(key))
        .slice(0, 40);

      const candidateGames: unknown[] = [];
      const pushGame = (value: unknown): void => {
        if (value === null || typeof value !== 'object') {
          return;
        }
        const maybe = value as { scene?: unknown; canvas?: unknown; scale?: unknown };
        if (maybe.scene !== undefined || maybe.canvas !== undefined || maybe.scale !== undefined) {
          if (!candidateGames.includes(value)) {
            candidateGames.push(value);
          }
        }
      };

      if (Array.isArray(win.Phaser?.GAMES)) {
        for (const game of win.Phaser!.GAMES!) {
          pushGame(game);
        }
      }
      for (const key of ['game', 'Game', '__game', 'phaserGame', 'app', 'slotGame']) {
        pushGame(win[key]);
      }
      for (const canvas of Array.from(document.querySelectorAll('canvas'))) {
        const anyCanvas = canvas as HTMLCanvasElement & Record<string, unknown>;
        for (const key of Object.getOwnPropertyNames(anyCanvas)) {
          if (/phaser|game/i.test(key)) {
            pushGame(anyCanvas[key]);
            discoveryKeys.push(`canvas.${key}`);
          }
        }
      }

      const phaserSamples: PhaserSample[] = [];
      let interactiveCount = 0;
      let namedInteractiveCount = 0;
      const sceneNames: string[] = [];

      const walk = (node: unknown, sceneKey: string, canvasW: number, canvasH: number): void => {
        if (node === null || typeof node !== 'object') {
          return;
        }
        const obj = node as {
          name?: unknown;
          type?: unknown;
          visible?: unknown;
          input?: { enabled?: unknown } | null;
          list?: unknown[];
          children?: { list?: unknown[]; entries?: unknown[] };
          getBounds?: () => { x: number; y: number; width: number; height: number };
          x?: number;
          y?: number;
          width?: number;
          height?: number;
          displayWidth?: number;
          displayHeight?: number;
        };

        const inputEnabled = obj.input?.enabled === true;
        if (inputEnabled) {
          interactiveCount += 1;
          const name = typeof obj.name === 'string' ? obj.name.trim() : '';
          if (name.length > 0) {
            namedInteractiveCount += 1;
          }

          let x = typeof obj.x === 'number' ? obj.x : 0;
          let y = typeof obj.y === 'number' ? obj.y : 0;
          let width =
            typeof obj.displayWidth === 'number'
              ? obj.displayWidth
              : typeof obj.width === 'number'
                ? obj.width
                : 0;
          let height =
            typeof obj.displayHeight === 'number'
              ? obj.displayHeight
              : typeof obj.height === 'number'
                ? obj.height
                : 0;
          try {
            const bounds = obj.getBounds?.();
            if (bounds !== undefined) {
              x = bounds.x + bounds.width / 2;
              y = bounds.y + bounds.height / 2;
              width = bounds.width;
              height = bounds.height;
            }
          } catch {
            // Some custom objects throw on getBounds.
          }

          if (phaserSamples.length < 40 && canvasW > 0 && canvasH > 0) {
            phaserSamples.push({
              name: name || '(unnamed)',
              type:
                typeof obj.type === 'string'
                  ? obj.type
                  : typeof obj.type === 'number'
                    ? String(obj.type)
                    : '',
              scene: sceneKey,
              xRatio: Math.max(0, Math.min(1, x / canvasW)),
              yRatio: Math.max(0, Math.min(1, y / canvasH)),
              width: Math.round(width),
              height: Math.round(height),
              visible: obj.visible !== false,
              inputEnabled: true,
            });
          }
        }

        const kids =
          (Array.isArray(obj.list) ? obj.list : undefined) ??
          (Array.isArray(obj.children?.list) ? obj.children!.list : undefined) ??
          (Array.isArray(obj.children?.entries) ? obj.children!.entries : undefined) ??
          [];
        for (const child of kids) {
          walk(child, sceneKey, canvasW, canvasH);
        }
      };

      for (const game of candidateGames) {
        const g = game as {
          canvas?: HTMLCanvasElement;
          scale?: { width?: number; height?: number };
          scene?: {
            scenes?: unknown[];
            getScenes?: (activeOnly?: boolean) => unknown[];
          };
        };
        const canvasW = g.scale?.width ?? g.canvas?.width ?? canvases[0]?.width ?? 0;
        const canvasH = g.scale?.height ?? g.canvas?.height ?? canvases[0]?.height ?? 0;
        const scenes =
          (typeof g.scene?.getScenes === 'function' ? g.scene.getScenes(true) : undefined) ??
          g.scene?.scenes ??
          [];
        for (const scene of scenes) {
          if (scene === null || typeof scene !== 'object') {
            continue;
          }
          const sc = scene as {
            sys?: { settings?: { key?: string } };
            scene?: { key?: string };
            key?: string;
            children?: { list?: unknown[] };
          };
          const key =
            sc.sys?.settings?.key ?? sc.scene?.key ?? (typeof sc.key === 'string' ? sc.key : 'scene');
          sceneNames.push(key);
          const roots = Array.isArray(sc.children?.list) ? sc.children!.list! : [];
          for (const root of roots) {
            walk(root, key, canvasW, canvasH);
          }
        }
      }

      phaserSamples.sort((a, b) => {
        const aNamed = a.name !== '(unnamed)' ? 0 : 1;
        const bNamed = b.name !== '(unnamed)' ? 0 : 1;
        return aNamed - bNamed;
      });

      const discoveryNote =
        candidateGames.length > 0
          ? `Found ${candidateGames.length} game instance candidate(s)`
          : win.Phaser
            ? 'Phaser global exists but no live Game instance was found on window/canvas'
            : 'No Phaser global';

      return {
        canvasCount: canvases.length,
        canvases,
        buttonCount: document.querySelectorAll('button').length,
        inputCount: document.querySelectorAll('input').length,
        linkCount: document.querySelectorAll('a[href]').length,
        roleButtonCount: document.querySelectorAll('[role="button"]').length,
        elementsWithTestId: document.querySelectorAll('[data-testid], [data-test]').length,
        sampleInteractive,
        phaser: {
          games: candidateGames.length,
          scenes: sceneNames.slice(0, 20),
          interactiveCount,
          namedInteractiveCount,
          samples: phaserSamples.slice(0, 25),
          discoveryKeys: [...new Set(discoveryKeys)].slice(0, 40),
          discoveryNote,
        },
        globals: {
          hasPhaser: typeof win.Phaser !== 'undefined',
          hasPixi: typeof win.PIXI !== 'undefined',
          hasWebGL: !!document.querySelector('canvas'),
          bodyChildTags: bodyChildren.slice(0, 20),
        },
      };
    });

    const interactiveDom =
      snapshot.buttonCount +
      snapshot.inputCount +
      snapshot.linkCount +
      snapshot.roleButtonCount +
      snapshot.elementsWithTestId;

    let surface: IframeTestSurface = 'canvas-only';
    if (snapshot.phaser.namedInteractiveCount >= 3) {
      surface = 'phaser-named';
    } else if (snapshot.phaser.interactiveCount >= 10) {
      // Unnamed HUD images still give stable ratios (Package 1 path).
      surface = 'phaser-named';
    } else if (snapshot.canvasCount === 0 && interactiveDom >= 5) {
      surface = 'dom-rich';
    } else if (snapshot.canvasCount > 0 && interactiveDom >= 5) {
      surface = 'mixed';
    } else if (interactiveDom >= 5) {
      surface = 'mixed';
    }

    const summary =
      surface === 'phaser-named'
        ? `DOM has no HUD buttons; Phaser exposes ${snapshot.phaser.interactiveCount} interactive objects (${snapshot.phaser.namedInteractiveCount} named) — use geometry bands for controller clicks.`
        : surface === 'canvas-only'
          ? `Inside the iframe: canvas=${snapshot.canvasCount}, DOM interactive=${interactiveDom}, Phaser games=${snapshot.phaser.games}, interactive=${snapshot.phaser.interactiveCount} (named=${snapshot.phaser.namedInteractiveCount}). ${snapshot.phaser.discoveryNote}`
          : surface === 'dom-rich'
            ? `Inside the iframe we found ${interactiveDom} interactive DOM nodes and no canvas — controllers may be clickable by selector.`
            : `Inside the iframe we found both canvas (${snapshot.canvasCount}) and some DOM controls (${interactiveDom} interactive nodes).`;

    const recommendation =
      surface === 'phaser-named'
        ? 'Universal path: enter iframe → Phaser HUD locate (then vision fallback) → /bet oracle.'
        : surface === 'canvas-only'
          ? snapshot.phaser.games === 0
            ? 'Universal path stays: enter iframe → canvas click + vision heal + /bet. Live Phaser Game instance is not exposed for object crawl.'
            : 'Phaser Game exists but few interactive objects — keep canvas coords + vision heal + /bet.'
          : surface === 'dom-rich'
            ? 'Try selector-based controller clicks for accuracy; keep /bet as pass oracle.'
            : 'Use DOM selectors where they exist; keep canvas + /bet for painted HUD controls.';

    return {
      gameId: manifest.gameId,
      hostUrl: redactUrl(hostUrl),
      iframeSelector,
      iframeFound,
      frameUrl: redactUrl(frame.url()),
      frameName: frame.name(),
      sameOriginReadable: true,
      canvasCount: snapshot.canvasCount,
      canvases: snapshot.canvases,
      buttonCount: snapshot.buttonCount,
      inputCount: snapshot.inputCount,
      linkCount: snapshot.linkCount,
      roleButtonCount: snapshot.roleButtonCount,
      elementsWithTestId: snapshot.elementsWithTestId,
      sampleInteractive: snapshot.sampleInteractive,
      phaser: snapshot.phaser,
      globals: snapshot.globals,
      surface,
      summary,
      recommendation,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return emptyReport({
      gameId: manifest.gameId,
      hostUrl: redactUrl(hostUrl),
      iframeSelector,
      iframeFound,
      frameUrl: redactUrl(frame.url()),
      frameName: frame.name(),
      sameOriginReadable: false,
      readError: message,
      surface: 'canvas-only',
      summary: `Entered the iframe but could not read its DOM (${message}).`,
      recommendation:
        'Cross-origin or blocked frame — keep canvas coords and network oracles; DOM crawl is not available.',
    });
  }
}

/** Human-readable report for console / Allure. */
export function formatIframeInventory(report: IframeInventoryReport): string {
  const lines = [
    `PROBE-002 iframe inventory — ${report.gameId}`,
    `Host: ${report.hostUrl}`,
    `Iframe selector: ${report.iframeSelector} (found=${String(report.iframeFound)})`,
    `Frame URL: ${report.frameUrl || '(none)'}`,
    `Readable same-origin: ${String(report.sameOriginReadable)}`,
    report.readError ? `Read error: ${report.readError}` : undefined,
    '',
    `Surface verdict: ${report.surface}`,
    report.summary,
    `Recommendation: ${report.recommendation}`,
    '',
    `Canvas count: ${report.canvasCount}`,
    ...report.canvases.map(
      (c) => `  canvas[${c.index}] ${c.width}x${c.height} visible=${String(c.visible)}`,
    ),
    `Buttons: ${report.buttonCount}`,
    `Inputs: ${report.inputCount}`,
    `Links: ${report.linkCount}`,
    `role=button: ${report.roleButtonCount}`,
    `data-testid/data-test: ${report.elementsWithTestId}`,
    `Globals: Phaser=${String(report.globals.hasPhaser)} PIXI=${String(report.globals.hasPixi)}`,
    `Body children: ${report.globals.bodyChildTags.join(', ') || '(none)'}`,
    '',
    `Phaser games: ${report.phaser.games}`,
    `Phaser scenes: ${report.phaser.scenes.join(', ') || '(none)'}`,
    `Phaser interactive: ${report.phaser.interactiveCount} (named ${report.phaser.namedInteractiveCount})`,
    report.phaser.discoveryNote ? `Phaser discovery: ${report.phaser.discoveryNote}` : undefined,
    report.phaser.discoveryKeys.length > 0
      ? `Related window/canvas keys: ${report.phaser.discoveryKeys.join(', ')}`
      : undefined,
    'Phaser interactive samples:',
  ].filter((line): line is string => line !== undefined);

  if (report.phaser.samples.length === 0) {
    lines.push('  (none)');
  } else {
    for (const sample of report.phaser.samples) {
      lines.push(
        `  - ${sample.name} [${sample.type}] scene=${sample.scene} @ ${sample.xRatio.toFixed(3)},${sample.yRatio.toFixed(3)} ${sample.width}x${sample.height} visible=${String(sample.visible)}`,
      );
    }
  }

  lines.push('', 'Sample interactive DOM nodes (up to 20):');
  if (report.sampleInteractive.length === 0) {
    lines.push('  (none — HUD is almost certainly painted on canvas)');
  } else {
    for (const sample of report.sampleInteractive) {
      const bits = [
        sample.tag,
        sample.id ? `#${sample.id}` : '',
        sample.role ? `role=${sample.role}` : '',
        sample.testId ? `testId=${sample.testId}` : '',
        sample.text ? `"${sample.text}"` : '',
        sample.className ? `class=${sample.className}` : '',
      ].filter(Boolean);
      lines.push(`  - ${bits.join(' ')}`);
    }
  }

  return lines.join('\n');
}
