/**
 * Locate HUD controls from Phaser interactive objects inside the game iframe.
 *
 * Package 1 titles paint buttons on canvas (no DOM). Sugar/Beelze expose a live
 * `window.phaserGame` with interactive Images — usually unnamed, but positions
 * are stable enough to heal missed clicks without colour vision.
 *
 * // @ts-nocheck — evaluate() bodies run in the browser; Node build has no DOM lib.
 */
// @ts-nocheck

import type { Frame, Page } from 'playwright';

import type { GameManifest } from '../core/models/index.js';
import { rememberHealedRatio } from '../eye/learned-ratios.js';
import { loadSurfaceProfile, loadSurfaceProfileById, phaserBand } from '../surfaces/load-surface-profile.js';
import type { PhaserBandConfig, SurfaceProfile } from '../surfaces/types.js';

export interface PhaserHit {
  readonly name: string;
  readonly type: string;
  readonly xRatio: number;
  readonly yRatio: number;
  readonly width: number;
  readonly height: number;
  readonly area: number;
}

export interface PhaserLocateResult {
  readonly found: boolean;
  readonly detail: string;
  readonly hit?: PhaserHit;
}

/**
 * Bands come from the game's surface profile in `config/surfaces`. A caller with
 * no profile to hand falls back to `base`, which is the Package 1 portrait HUD.
 */
function bandFor(actionName: string, profile?: SurfaceProfile): PhaserBandConfig | undefined {
  return phaserBand(profile ?? loadSurfaceProfileById('base'), actionName);
}

async function resolveGameFrame(page: Page, iframeSelector: string): Promise<Frame | null> {
  const iframe = page.locator(iframeSelector).first();
  if ((await iframe.count()) === 0) {
    return null;
  }
  const handle = await iframe.elementHandle();
  if (handle === null) {
    return null;
  }
  return handle.contentFrame();
}

export async function listPhaserInteractive(
  page: Page,
  iframeSelector: string,
): Promise<readonly PhaserHit[]> {
  const frame = await resolveGameFrame(page, iframeSelector);
  if (frame === null) {
    return [];
  }

  return frame.evaluate(() => {
    const win = window as Window & Record<string, unknown> & {
      Phaser?: { GAMES?: unknown[] };
      phaserGame?: unknown;
    };

    const games: unknown[] = [];
    const push = (value: unknown): void => {
      if (value !== null && typeof value === 'object' && !games.includes(value)) {
        games.push(value);
      }
    };
    push(win.phaserGame);
    if (Array.isArray(win.Phaser?.GAMES)) {
      for (const game of win.Phaser!.GAMES!) {
        push(game);
      }
    }

    const hits: Array<{
      name: string;
      type: string;
      xRatio: number;
      yRatio: number;
      width: number;
      height: number;
      area: number;
    }> = [];

    const walk = (node: unknown, canvasW: number, canvasH: number): void => {
      if (node === null || typeof node !== 'object') {
        return;
      }
      const obj = node as {
        name?: unknown;
        type?: unknown;
        visible?: unknown;
        input?: { enabled?: unknown } | null;
        list?: unknown[];
        children?: { list?: unknown[] };
        getBounds?: () => { x: number; y: number; width: number; height: number };
        displayWidth?: number;
        displayHeight?: number;
        width?: number;
        height?: number;
      };

      if (obj.input?.enabled === true && obj.visible !== false) {
        let x = 0;
        let y = 0;
        let width = typeof obj.displayWidth === 'number' ? obj.displayWidth : (obj.width ?? 0);
        let height = typeof obj.displayHeight === 'number' ? obj.displayHeight : (obj.height ?? 0);
        try {
          const bounds = obj.getBounds?.();
          if (bounds !== undefined) {
            x = bounds.x + bounds.width / 2;
            y = bounds.y + bounds.height / 2;
            width = bounds.width;
            height = bounds.height;
          }
        } catch {
          // ignore
        }
        if (canvasW > 0 && canvasH > 0 && width >= 8 && height >= 8) {
          hits.push({
            name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : '(unnamed)',
            type:
              typeof obj.type === 'string'
                ? obj.type
                : typeof obj.type === 'number'
                  ? String(obj.type)
                  : '',
            xRatio: Math.max(0, Math.min(1, x / canvasW)),
            yRatio: Math.max(0, Math.min(1, y / canvasH)),
            width: Math.round(width),
            height: Math.round(height),
            area: Math.round(width * height),
          });
        }
      }

      const kids =
        (Array.isArray(obj.list) ? obj.list : undefined) ??
        (Array.isArray(obj.children?.list) ? obj.children!.list : undefined) ??
        [];
      for (const child of kids) {
        walk(child, canvasW, canvasH);
      }
    };

    for (const game of games) {
      const g = game as {
        canvas?: HTMLCanvasElement;
        scale?: { width?: number; height?: number };
        scene?: {
          scenes?: unknown[];
          getScenes?: (activeOnly?: boolean) => unknown[];
        };
      };
      const canvasW = g.scale?.width ?? g.canvas?.width ?? 0;
      const canvasH = g.scale?.height ?? g.canvas?.height ?? 0;
      const scenes =
        (typeof g.scene?.getScenes === 'function' ? g.scene.getScenes(true) : undefined) ??
        g.scene?.scenes ??
        [];
      for (const scene of scenes) {
        if (scene === null || typeof scene !== 'object') {
          continue;
        }
        const roots = (scene as { children?: { list?: unknown[] } }).children?.list ?? [];
        for (const root of roots) {
          walk(root, canvasW, canvasH);
        }
      }
    }

    return hits;
  });
}

export interface PhaserTextHit {
  readonly text: string;
  /** Top-left and size in game-space pixels. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly gameWidth: number;
  readonly gameHeight: number;
  /** Top-level display object that holds the text; `order` grows with render order. */
  readonly layer?: PhaserTextLayer;
}

export interface PhaserTextLayer {
  readonly key: string;
  readonly order: number;
  /** Bounds in game-space pixels. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Visible Text / BitmapText objects in every live Phaser game in the iframe.
 * Canvas titles paint labels (bet value, legends, win prompts) as Phaser text —
 * reading them beats OCR on the rendered pixels.
 */
export async function listPhaserTexts(
  page: Page,
  iframeSelector: string,
): Promise<readonly PhaserTextHit[]> {
  const frame = await resolveGameFrame(page, iframeSelector);
  if (frame === null) {
    return [];
  }

  return frame.evaluate(() => {
    const win = window as Window & Record<string, unknown> & {
      Phaser?: { GAMES?: unknown[] };
      phaserGame?: unknown;
    };
    const games: unknown[] = [];
    const push = (value: unknown): void => {
      if (value !== null && typeof value === 'object' && !games.includes(value)) {
        games.push(value);
      }
    };
    push(win.phaserGame);
    if (Array.isArray(win.Phaser?.GAMES)) {
      for (const game of win.Phaser!.GAMES!) {
        push(game);
      }
    }

    const hits = [];
    let layer;
    const walk = (node, gameWidth, gameHeight) => {
      if (node === null || typeof node !== 'object') {
        return;
      }
      if (node.visible === false || (typeof node.alpha === 'number' && node.alpha <= 0.01)) {
        return;
      }
      const type = typeof node.type === 'string' ? node.type : '';
      if ((type === 'Text' || type === 'BitmapText') && typeof node.text === 'string') {
        const text = node.text.trim();
        if (text.length > 0) {
          try {
            const b = node.getBounds();
            if (b.width > 0 && b.height > 0) {
              hits.push({
                text,
                x: Math.round(b.x),
                y: Math.round(b.y),
                width: Math.round(b.width),
                height: Math.round(b.height),
                gameWidth,
                gameHeight,
                layer,
              });
            }
          } catch {
            // ignore
          }
        }
      }
      const kids = Array.isArray(node.list) ? node.list : Array.isArray(node.children?.list) ? node.children.list : [];
      for (const child of kids) {
        walk(child, gameWidth, gameHeight);
      }
    };

    games.forEach((game, gameIndex) => {
      const gameWidth = game.scale?.width ?? game.canvas?.width ?? 0;
      const gameHeight = game.scale?.height ?? game.canvas?.height ?? 0;
      const scenes =
        (typeof game.scene?.getScenes === 'function' ? game.scene.getScenes(true) : undefined) ??
        game.scene?.scenes ??
        [];
      scenes.forEach((scene, sceneIndex) => {
        if (scene?.sys?.settings?.visible === false) {
          return;
        }
        (scene?.children?.list ?? []).forEach((root, rootIndex) => {
          let bounds = { x: 0, y: 0, width: 0, height: 0 };
          try {
            const b = root.getBounds();
            bounds = { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
          } catch {
            // ignore
          }
          const depth = typeof root.depth === 'number' ? root.depth : 0;
          layer = {
            key: `${gameIndex}:${sceneIndex}:${rootIndex}`,
            order: gameIndex * 1e12 + sceneIndex * 1e9 + depth * 1e3 + rootIndex,
            ...bounds,
          };
          walk(root, gameWidth, gameHeight);
        });
      });
    });
    return hits;
  });
}

export function pickPhaserControl(
  hits: readonly PhaserHit[],
  actionName: string,
  profile?: SurfaceProfile,
): PhaserHit | undefined {
  const band = bandFor(actionName, profile);
  if (band === undefined) {
    return undefined;
  }

  let inBand = hits.filter(
    (hit) =>
      hit.xRatio >= band.x0 &&
      hit.xRatio <= band.x1 &&
      hit.yRatio >= band.y0 &&
      hit.yRatio <= band.y1 &&
      hit.width >= band.minW &&
      hit.height >= band.minH &&
      (band.maxW === undefined || hit.width <= band.maxW),
  );

  if (actionName === 'spin' || actionName === 'amplifyBet') {
    inBand = inBand.filter((hit) => {
      const aspect = hit.width / Math.max(1, hit.height);
      return aspect >= 0.65 && aspect <= 1.45 && hit.width <= 160;
    });
  }

  if (inBand.length === 0) {
    return undefined;
  }

  if (band.pick === 'rightmost') {
    return [...inBand].sort((a, b) => b.xRatio - a.xRatio)[0];
  }
  if (band.pick === 'leftmost') {
    return [...inBand].sort((a, b) => a.xRatio - b.xRatio)[0];
  }
  return [...inBand].sort((a, b) => b.area - a.area)[0];
}

export function hasPhaserBand(actionName: string, profile?: SurfaceProfile): boolean {
  return bandFor(actionName, profile) !== undefined;
}

/**
 * Find a control via Phaser, optionally remember the ratio for the next armed click.
 */
export async function locateControlByPhaser(
  page: Page,
  manifest: GameManifest,
  iframeSelector: string,
  actionName: string,
  options?: { readonly remember?: boolean },
): Promise<PhaserLocateResult> {
  const profile = loadSurfaceProfile(manifest);
  if (bandFor(actionName, profile) === undefined) {
    return {
      found: false,
      detail: `no Phaser band for ${actionName} in surface profile "${profile.id}"`,
    };
  }

  try {
    const hits = await listPhaserInteractive(page, iframeSelector);
    const hit = pickPhaserControl(hits, actionName, profile);
    if (hit === undefined) {
      return {
        found: false,
        detail: `Phaser: no ${actionName} in HUD band (${hits.length} interactive)`,
      };
    }

    if (options?.remember !== false) {
      rememberHealedRatio(manifest.gameId, actionName, { x: hit.xRatio, y: hit.yRatio }, 'phaser');
    }

    return {
      found: true,
      detail: `Phaser ${actionName} at ${hit.xRatio.toFixed(3)},${hit.yRatio.toFixed(3)} ${hit.width}x${hit.height} (${hit.type})`,
      hit,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { found: false, detail: `Phaser locate failed: ${message}` };
  }
}
