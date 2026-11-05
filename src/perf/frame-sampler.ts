/**
 * In-frame sampler for PAD runs. Installed into the game iframe with `frame.evaluate`; it
 * only reads (a requestAnimationFrame callback, a Phaser `postrender` listener, a long-task
 * observer, and Phaser fields) and never changes game state. Node drains the buffer every
 * ~500 ms.
 *
 * rAF ticks are browser frames; a game with `fps.limit` skips rendering on most of them, so
 * `postrender` timestamps are the rendered frames PAD scores (FPS Phase 0 validated them
 * against Chrome trace frames).
 *
 * Timestamps are epoch ms (`performance.timeOrigin + t`) so they line up with Node-side
 * events (`Date.now()`) recorded by the session.
 */

import type { Frame } from 'playwright';

/** The game's configured frame-rate settings (Phaser `fps` config). */
export interface FpsCap {
  readonly target?: number;
  /** Set only when the game enables `fps.limit`. */
  readonly limit?: number;
}

export interface SamplerDrain {
  /** Browser frames (rAF ticks). */
  readonly frames: readonly number[];
  /** Rendered frames (Phaser `postrender`); absent until a Phaser game is found. */
  readonly rendered?: readonly number[];
  readonly fpsCap?: FpsCap;
  readonly longTasks: readonly { readonly at: number; readonly ms: number }[];
  readonly now: number;
  readonly heapBytes?: number;
  readonly phaserFps?: number;
  readonly activity?: SceneActivity;
  /** `document.visibilityState` changes inside the game frame since the last drain. */
  readonly visibility?: readonly { readonly at: number; readonly hidden: boolean }[];
}

/** Largest on-screen size seen for one texture frame, in device pixels. */
export interface TextureUse {
  readonly key: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly shownWidth: number;
  readonly shownHeight: number;
}

/** Spine animations a skeleton offers vs. the ones seen playing during the run. */
export interface SpineUse {
  readonly skeleton: string;
  readonly available: readonly string[];
  readonly played: readonly string[];
}

export interface SceneActivity {
  /** Running tweens across active scenes. */
  readonly tweens: number;
  /** Pending timer events across active scenes. */
  readonly timers: number;
  /** Top-level display objects across active scenes. */
  readonly objects: number;
  /** Live particles across top-level emitters. */
  readonly particles: number;
  readonly scenes: number;
  /** Visible Spine objects with a running animation (top level and one container deep). */
  readonly spines?: number;
}

export interface TextureInfo {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly frames: number;
  /** Sum of frame areas (px²); compared with width × height it shows how full an atlas is. */
  readonly usedArea?: number;
}

export interface GameRenderInfo {
  readonly phaserVersion?: string;
  readonly renderer?: 'webgl' | 'canvas' | 'unknown';
  readonly canvasWidth?: number;
  readonly canvasHeight?: number;
  readonly devicePixelRatio: number;
  readonly textures: readonly TextureInfo[];
  readonly userAgent: string;
}

/**
 * Runs inside the game frame. Kept free of closures over Node scope: Playwright serialises it.
 * Returns true when the sampler is (now) running.
 */
function installInFrame(): boolean {
  const w = window as unknown as Record<string, any>;
  if (w.__sgapPerf !== undefined) {
    w.__sgapPerf.resume();
    return true;
  }
  const origin = performance.timeOrigin;
  let frames: number[] = [];
  let rendered: number[] = [];
  let running = true;
  const longTasks: { at: number; ms: number }[] = [];
  const MAX_FRAMES = 20_000;
  const game = (): any => w.phaserGame ?? (Array.isArray(w.Phaser?.GAMES) ? w.Phaser.GAMES[0] : undefined);
  let hooked: any;
  // Stamped with the tick's rAF time (`loop.now`), not when postrender fires: update/render
  // work varies per frame and would otherwise show up as frame-time jitter that never reached
  // the screen.
  const onPostRender = (): void => {
    if (running && rendered.length < MAX_FRAMES) {
      const tickAt = Number(hooked?.loop?.now);
      rendered.push(origin + (Number.isFinite(tickAt) && tickAt > 0 ? tickAt : performance.now()));
    }
  };
  const hook = (): void => {
    const g = game();
    if (g === undefined || g === hooked || typeof g.events?.on !== 'function') {
      return;
    }
    hooked?.events?.off?.('postrender', onPostRender);
    g.events.on('postrender', onPostRender);
    hooked = g;
  };
  const tick = (t: number): void => {
    if (!running) {
      return;
    }
    if (frames.length < MAX_FRAMES) {
      frames.push(origin + t);
    }
    hook();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks.push({ at: origin + entry.startTime, ms: entry.duration });
      }
    }).observe({ type: 'longtask', buffered: false });
  } catch {
    // Long tasks are optional (not every engine exposes them).
  }
  const visibility: { at: number; hidden: boolean }[] = [];
  document.addEventListener('visibilitychange', () => {
    visibility.push({ at: origin + performance.now(), hidden: document.visibilityState === 'hidden' });
  });
  const textureUse = new Map<string, { key: string; frameWidth: number; frameHeight: number; shownWidth: number; shownHeight: number }>();
  const spineUse = new Map<string, { available: Set<string>; played: Set<string> }>();
  const isSpine = (obj: any): boolean => obj?.skeleton !== undefined && (obj?.animationState !== undefined || obj?.state !== undefined);
  const spinePlaying = (obj: any): string[] => {
    const tracks: any[] = obj?.animationState?.tracks ?? obj?.state?.tracks ?? [];
    return tracks.map((track) => track?.animation?.name).filter((name): name is string => typeof name === 'string');
  };
  const track = (): void => {
    const g = game();
    const canvas: HTMLCanvasElement | undefined = g?.canvas;
    if (canvas === undefined) {
      return;
    }
    const gameWidth = Number(g?.scale?.width ?? canvas.width) || canvas.width;
    const toDevice = (canvas.getBoundingClientRect().width / gameWidth) * window.devicePixelRatio;
    const visit = (list: any[], depth: number): void => {
      for (const obj of list) {
        if (obj === undefined || obj === null || obj.visible === false) continue;
        if (isSpine(obj)) {
          const data = obj.skeleton?.data ?? obj.skeletonData;
          const name = String(data?.name || obj.dataKey || obj.skeletonDataKey || 'spine');
          const entry = spineUse.get(name) ?? { available: new Set<string>(), played: new Set<string>() };
          for (const animation of data?.animations ?? []) {
            if (typeof animation?.name === 'string') entry.available.add(animation.name);
          }
          for (const playing of spinePlaying(obj)) entry.played.add(playing);
          spineUse.set(name, entry);
        }
        const frame = obj.frame;
        const key = obj.texture?.key;
        if (typeof key === 'string' && !key.startsWith('__') && frame !== undefined) {
          const matrix = typeof obj.getWorldTransformMatrix === 'function' ? obj.getWorldTransformMatrix() : undefined;
          const sx = Math.abs(Number(matrix?.scaleX ?? obj.scaleX ?? 1));
          const sy = Math.abs(Number(matrix?.scaleY ?? obj.scaleY ?? 1));
          const fw = Number(frame.realWidth ?? frame.width ?? 0);
          const fh = Number(frame.realHeight ?? frame.height ?? 0);
          const id = `${key}#${frame.name}`;
          const shownWidth = fw * sx * toDevice;
          const shownHeight = fh * sy * toDevice;
          const prev = textureUse.get(id);
          if (prev === undefined || shownWidth * shownHeight > prev.shownWidth * prev.shownHeight) {
            textureUse.set(id, { key: id, frameWidth: fw, frameHeight: fh, shownWidth, shownHeight });
          }
        }
        if (depth < 5 && Array.isArray(obj.list)) visit(obj.list, depth + 1);
      }
    };
    for (const scene of g?.scene?.scenes ?? []) {
      const sys = scene?.sys;
      if (sys === undefined || (typeof sys.isActive === 'function' && !sys.isActive())) continue;
      visit(scene.children?.list ?? [], 0);
    }
  };
  const activity = (): unknown => {
    const g = game();
    const scenes: any[] = g?.scene?.scenes ?? [];
    let tweens = 0;
    let timers = 0;
    let objects = 0;
    let particles = 0;
    let spines = 0;
    let active = 0;
    for (const scene of scenes) {
      const sys = scene?.sys;
      if (sys === undefined || (typeof sys.isActive === 'function' && !sys.isActive())) {
        continue;
      }
      active += 1;
      const tm = scene.tweens;
      if (Array.isArray(tm?.tweens)) tweens += tm.tweens.length;
      else if (Array.isArray(tm?._active)) tweens += tm._active.length;
      const clock = scene.time;
      if (Array.isArray(clock?._active)) timers += clock._active.length;
      const list: any[] = scene.children?.list ?? [];
      objects += list.length;
      for (const child of list) {
        const nested: any[] = Array.isArray(child?.list) ? child.list : [];
        for (const obj of [child, ...nested]) {
          if (obj?.visible !== false && isSpine(obj) && spinePlaying(obj).length > 0) spines += 1;
        }
        if (child?.type === 'ParticleEmitter') {
          particles += typeof child.getAliveParticleCount === 'function' ? child.getAliveParticleCount() : child.alive?.length ?? 0;
        } else if (child?.type === 'ParticleEmitterManager' && Array.isArray(child.emitters?.list)) {
          for (const emitter of child.emitters.list) {
            particles += typeof emitter.getAliveParticleCount === 'function' ? emitter.getAliveParticleCount() : emitter.alive?.length ?? 0;
          }
        }
      }
    }
    return g === undefined ? undefined : { tweens, timers, objects, particles, scenes: active, spines };
  };
  w.__sgapPerf = {
    drain(): unknown {
      try {
        track();
      } catch {
        // Display-list walk is best effort; frame sampling must keep going.
      }
      const loop = hooked?.loop;
      const out = {
        frames,
        ...(hooked !== undefined ? { rendered } : {}),
        ...(loop !== undefined
          ? {
              fpsCap: {
                ...(Number(loop.targetFps) > 0 ? { target: Number(loop.targetFps) } : {}),
                ...(loop.hasFpsLimit === true && Number(loop.fpsLimit) > 0 ? { limit: Number(loop.fpsLimit) } : {}),
              },
            }
          : {}),
        longTasks: longTasks.splice(0),
        now: origin + performance.now(),
        heapBytes: (performance as any).memory?.usedJSHeapSize,
        phaserFps: game()?.loop?.actualFps,
        activity: activity(),
        visibility: visibility.splice(0),
      };
      frames = [];
      rendered = [];
      return out;
    },
    usage(): unknown {
      return {
        textures: [...textureUse.values()],
        spines: [...spineUse.entries()].map(([skeleton, entry]) => ({
          skeleton,
          available: [...entry.available],
          played: [...entry.played],
        })),
      };
    },
    pause(): void {
      running = false;
      frames = [];
      rendered = [];
    },
    resume(): void {
      if (!running) {
        running = true;
        requestAnimationFrame(tick);
      }
    },
    activity,
  };
  return true;
}

/**
 * For `context.addInitScript`: starts the sampler at document start in every frame, so a load
 * is measured from its first frame (PAD-043/044). Later `installSampler` calls just resume it.
 */
export const samplerInitScript: () => boolean = installInFrame;

export async function installSampler(frame: Frame): Promise<boolean> {
  return frame.evaluate(installInFrame).catch(() => false);
}

export async function drainSampler(frame: Frame): Promise<SamplerDrain | undefined> {
  return frame
    .evaluate(() => {
      const perf = (window as unknown as { __sgapPerf?: { drain(): unknown } }).__sgapPerf;
      return perf === undefined ? undefined : perf.drain();
    })
    .then((value) => value as SamplerDrain | undefined)
    .catch(() => undefined);
}

export async function pauseSampler(frame: Frame): Promise<void> {
  await frame
    .evaluate(() => {
      (window as unknown as { __sgapPerf?: { pause(): void } }).__sgapPerf?.pause();
    })
    .catch(() => undefined);
}

/** Texture display sizes and Spine animations seen since the sampler was installed. */
export async function readSamplerUsage(
  frame: Frame,
): Promise<{ readonly textures: readonly TextureUse[]; readonly spines: readonly SpineUse[] } | undefined> {
  return frame
    .evaluate(() => {
      const perf = (window as unknown as { __sgapPerf?: { usage?(): unknown } }).__sgapPerf;
      return perf?.usage === undefined ? undefined : perf.usage();
    })
    .then((value) => value as { textures: TextureUse[]; spines: SpineUse[] } | undefined)
    .catch(() => undefined);
}

/** Phaser's own measured FPS, read without the sampler's rAF loop (overhead baseline). */
export async function readPhaserFps(frame: Frame): Promise<number | undefined> {
  return frame
    .evaluate(() => {
      const w = window as unknown as Record<string, any>;
      const g = w.phaserGame ?? (Array.isArray(w.Phaser?.GAMES) ? w.Phaser.GAMES[0] : undefined);
      const fps = g?.loop?.actualFps;
      return typeof fps === 'number' ? fps : undefined;
    })
    .catch(() => undefined);
}

export async function readRenderInfo(frame: Frame): Promise<GameRenderInfo | undefined> {
  return frame
    .evaluate(() => {
      const w = window as unknown as Record<string, any>;
      const g = w.phaserGame ?? (Array.isArray(w.Phaser?.GAMES) ? w.Phaser.GAMES[0] : undefined);
      const type = g?.renderer?.type ?? g?.config?.renderType;
      const textures: { key: string; width: number; height: number; frames: number; usedArea: number }[] = [];
      const list = g?.textures?.list ?? {};
      for (const key of Object.keys(list)) {
        if (key.startsWith('__')) {
          continue;
        }
        const texture = list[key];
        const source = texture?.source?.[0];
        let usedArea = 0;
        for (const [name, frame] of Object.entries<any>(texture?.frames ?? {})) {
          if (name !== '__BASE') usedArea += Number(frame?.cutWidth ?? 0) * Number(frame?.cutHeight ?? 0);
        }
        textures.push({
          key,
          width: Number(source?.width ?? 0),
          height: Number(source?.height ?? 0),
          frames: Math.max(0, Number(texture?.frameTotal ?? 1) - 1),
          usedArea,
        });
      }
      return {
        phaserVersion: typeof w.Phaser?.VERSION === 'string' ? w.Phaser.VERSION : undefined,
        renderer: type === 2 ? 'webgl' : type === 1 ? 'canvas' : 'unknown',
        canvasWidth: g?.canvas?.width,
        canvasHeight: g?.canvas?.height,
        devicePixelRatio: window.devicePixelRatio,
        textures,
        userAgent: navigator.userAgent,
      };
    })
    .then((value) => value as GameRenderInfo)
    .catch(() => undefined);
}
