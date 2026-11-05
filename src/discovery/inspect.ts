/**
 * Read-only runtime inspection of a game page (discovery levels 2 and 3).
 *
 * Nothing here clicks, types or calls into game code. The only globals read are the
 * Phaser game handles (`phaserGame`, `Phaser.GAMES`) and the presence of engine globals;
 * configuration globals (which can hold keys) are never read.
 *
 * // @ts-nocheck — evaluate() bodies run in the browser; Node build has no DOM lib.
 */
// @ts-nocheck

import type { Frame, Page } from 'playwright';

import { redactUrl } from '../observability/redact.js';

export interface SceneObject {
  readonly scene: string;
  readonly type: string;
  readonly name: string;
  readonly key: string;
  readonly frame: string;
  /** Centre and size as fractions of the game (canvas) size. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly interactive: boolean;
  readonly cursor: string;
}

export interface SceneText {
  readonly scene: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface DomControl {
  readonly tag: string;
  readonly label: string;
  /** Centre as fractions of the frame viewport. */
  readonly x: number;
  readonly y: number;
}

export interface RuntimeSnapshot {
  readonly title: string;
  readonly frameUrl: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly devicePixelRatio: number;
  readonly canvases: ReadonlyArray<{ width: number; height: number; cssWidth: number; cssHeight: number }>;
  readonly engine: {
    readonly phaserVersion?: string;
    /** Phaser renderer: 1 canvas, 2 WebGL. */
    readonly phaserRenderer?: string;
    readonly gameSize?: { readonly width: number; readonly height: number };
    readonly spine: boolean;
    readonly pixi: boolean;
    readonly webgl: boolean;
  };
  readonly scenes: { readonly active: readonly string[]; readonly all: readonly string[] };
  readonly loaderProgress?: number;
  readonly domLoading: boolean;
  readonly orientationGate: boolean;
  readonly objects: readonly SceneObject[];
  readonly texts: readonly SceneText[];
  readonly dom: readonly DomControl[];
}

export interface FrameNode {
  readonly url: string;
  readonly name: string;
  readonly depth: number;
  readonly canvas: boolean;
}

function depthOf(frame: Frame): number {
  let depth = 0;
  for (let parent = frame.parentFrame(); parent !== null; parent = parent.parentFrame()) depth += 1;
  return depth;
}

/** Every frame with a redacted URL and whether it holds a canvas. */
export async function frameTree(page: Page): Promise<FrameNode[]> {
  const nodes: FrameNode[] = [];
  for (const frame of page.frames()) {
    const canvas = await frame.evaluate(() => document.querySelector('canvas') !== null).catch(() => false);
    nodes.push({ url: redactUrl(frame.url()), name: frame.name(), depth: depthOf(frame), canvas });
  }
  return nodes;
}

/** The frame that renders the game: the deepest frame with a canvas, else the main frame. */
export async function renderFrame(page: Page): Promise<Frame> {
  let best: Frame | undefined;
  let bestDepth = -1;
  for (const frame of page.frames()) {
    const canvas = await frame.evaluate(() => document.querySelector('canvas') !== null).catch(() => false);
    if (canvas && depthOf(frame) > bestDepth) {
      best = frame;
      bestDepth = depthOf(frame);
    }
  }
  return best ?? page.mainFrame();
}

export async function inspectRuntime(frame: Frame): Promise<RuntimeSnapshot> {
  const snapshot = await frame.evaluate(() => {
    const win = window;
    const games = [];
    const push = (value) => {
      if (value !== null && typeof value === 'object' && !games.includes(value)) games.push(value);
    };
    push(win.phaserGame);
    if (Array.isArray(win.Phaser?.GAMES)) win.Phaser.GAMES.forEach(push);
    const game = games[0];
    const gameW = game?.scale?.width ?? game?.canvas?.width ?? 0;
    const gameH = game?.scale?.height ?? game?.canvas?.height ?? 0;

    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.01;
    };

    const objects = [];
    const texts = [];
    const walk = (node, scene) => {
      if (node === null || typeof node !== 'object' || node.visible === false) return;
      if (typeof node.alpha === 'number' && node.alpha <= 0.01) return;
      let b;
      try {
        b = node.getBounds?.();
      } catch {
        b = undefined;
      }
      const ok = b && Number.isFinite(b.x) && b.width > 0 && b.height > 0 && gameW > 0 && gameH > 0;
      const type = typeof node.type === 'string' ? node.type : String(node.type ?? '');
      if (ok && (type === 'Text' || type === 'BitmapText') && typeof node.text === 'string' && node.text.trim()) {
        texts.push({
          scene,
          text: node.text.trim().replace(/\s+/g, ' ').slice(0, 60),
          x: (b.x + b.width / 2) / gameW,
          y: (b.y + b.height / 2) / gameH,
          w: b.width / gameW,
          h: b.height / gameH,
        });
      }
      const interactive = node.input?.enabled === true;
      if (ok && interactive) {
        objects.push({
          scene,
          type,
          name: typeof node.name === 'string' ? node.name : '',
          key: typeof node.texture?.key === 'string' && node.texture.key !== '__DEFAULT' ? node.texture.key : '',
          frame: node.frame?.name !== undefined && node.frame.name !== '__BASE' ? String(node.frame.name) : '',
          x: (b.x + b.width / 2) / gameW,
          y: (b.y + b.height / 2) / gameH,
          w: b.width / gameW,
          h: b.height / gameH,
          interactive,
          cursor: typeof node.input?.cursor === 'string' ? node.input.cursor : '',
        });
      }
      const kids = Array.isArray(node.list) ? node.list : Array.isArray(node.children?.list) ? node.children.list : [];
      for (const child of kids) walk(child, scene);
    };
    const active = [];
    const all = [];
    let loaderProgress;
    if (game?.scene) {
      for (const scene of game.scene.scenes ?? []) all.push(String(scene?.sys?.settings?.key ?? ''));
      const live = typeof game.scene.getScenes === 'function' ? game.scene.getScenes(true) : [];
      for (const scene of live) {
        const key = String(scene?.sys?.settings?.key ?? '');
        active.push(key);
        if (typeof scene?.load?.progress === 'number' && /preload|load|boot/i.test(key)) loaderProgress = scene.load.progress;
        for (const root of scene?.children?.list ?? []) walk(root, key);
      }
    }

    const dom = [];
    const vw = innerWidth || 1;
    const vh = innerHeight || 1;
    for (const el of document.querySelectorAll('button, [role="button"], a[href], input[type="button"], [aria-label]')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      dom.push({ tag: el.tagName.toLowerCase(), label, x: (r.x + r.width / 2) / vw, y: (r.y + r.height / 2) / vh });
      if (dom.length >= 40) break;
    }
    const loadingEl = [...document.querySelectorAll('[class*="loading"], [class*="progress"], [class*="preload"]')].find(visible);
    const gate = [...document.querySelectorAll('body *')].some(
      (el) => el.children.length === 0 && /rotate to (portrait|landscape)/i.test(el.textContent || '') && visible(el),
    );
    let webgl = false;
    try {
      webgl = typeof WebGLRenderingContext !== 'undefined' && game?.renderer?.gl !== undefined;
    } catch {
      webgl = false;
    }
    return {
      title: document.title,
      frameUrl: location.href,
      viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio: devicePixelRatio,
      canvases: [...document.querySelectorAll('canvas')].map((c) => ({
        width: c.width,
        height: c.height,
        cssWidth: Math.round(c.getBoundingClientRect().width),
        cssHeight: Math.round(c.getBoundingClientRect().height),
      })),
      engine: {
        phaserVersion: typeof win.Phaser?.VERSION === 'string' ? win.Phaser.VERSION : undefined,
        phaserRenderer: game?.renderer?.type !== undefined ? String(game.renderer.type) : undefined,
        gameSize: game ? { width: gameW, height: gameH } : undefined,
        spine: typeof win.spine === 'object' || typeof win.spine === 'function' || 'spine.SpinePlugin' in win,
        pixi: typeof win.PIXI === 'object',
        webgl,
      },
      scenes: { active, all },
      loaderProgress,
      domLoading: loadingEl !== undefined,
      orientationGate: gate,
      objects,
      texts,
      dom,
    };
  });
  return { ...snapshot, frameUrl: redactUrl(snapshot.frameUrl) };
}
