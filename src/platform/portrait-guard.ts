/**
 * Keep the game iframe portrait, and put it back when it slips.
 *
 * The DiJoker shell gates on `innerWidth > innerHeight` and paints a
 * "Rotate to portrait" blocker over the whole canvas. The blocker swallows every
 * tap, so a spin that lands on it fails with a timeout that looks like a missed
 * click. `prepareGameView` sizes the iframe correctly at setup, but it does so
 * with inline styles — any host re-render (live-history panel, socket update,
 * balance refresh) drops them and the game flips to landscape mid-test.
 *
 * Two parts:
 *  - Detection is geometric, never textual. The blocker's caption is painted into
 *    the canvas, so `getByText(/rotate to portrait/)` never matches it; reading
 *    the frame's own innerWidth/innerHeight is what the game itself gates on.
 *  - The lock is a stylesheet rule rather than inline styles. Host re-renders
 *    reset the `style` attribute but do not touch an injected stylesheet, and a
 *    selector-based rule keeps applying even if the iframe node is replaced.
 */

import type { Frame, Page } from 'playwright';

import type { GameManifest } from '../core/models/index.js';
import { fitPortraitSize, portraitAspectFor } from './game-view-layout.js';

export interface OrientationState {
  readonly frameFound: boolean;
  /** False when the size probe timed out — "unknown", which is not the same as landscape. */
  readonly readable: boolean;
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly portrait: boolean;
}

/** True only when the frame was actually measured and came back wider than tall. */
export function isBlockedByRotation(state: OrientationState): boolean {
  return state.frameFound && state.readable && !state.portrait;
}

export type PortraitHealOutcome =
  | 'already-portrait'
  | 'healed-by-lock'
  | 'healed-by-viewport'
  | 'frame-missing'
  | 'still-landscape';

export interface PortraitHealResult {
  readonly outcome: PortraitHealOutcome;
  readonly before: OrientationState;
  readonly after: OrientationState;
  readonly healed: boolean;
}

const LOCK_POLL_INTERVAL_MS = 250;
const LOCK_POLL_TIMEOUT_MS = 3_000;
const ORIENTATION_PROBE_TIMEOUT_MS = 2_000;

function gameFrameKey(manifest: GameManifest): string {
  const key = manifest.metadata?.launcherGameKey ?? manifest.gameId.replace(/-/gu, '_');
  return key.toLowerCase();
}

export function findGameFrame(page: Page, manifest: GameManifest): Frame | undefined {
  const key = gameFrameKey(manifest);
  return page.frames().find((frame) => frame.url().toLowerCase().includes(key));
}

export async function readOrientation(
  page: Page,
  manifest: GameManifest,
): Promise<OrientationState> {
  const frame = findGameFrame(page, manifest);
  if (frame === undefined) {
    return { frameFound: false, readable: false, innerWidth: 0, innerHeight: 0, portrait: false };
  }

  // `frame.evaluate` waits indefinitely while the frame navigates or blocks on a
  // busy render loop; this probe runs on a recovery path and must never be the
  // thing that hangs it.
  const probe = frame
    .evaluate(() => {
      const view = globalThis as unknown as { innerWidth: number; innerHeight: number };
      return { width: view.innerWidth, height: view.innerHeight };
    })
    .catch(() => undefined);
  const size = await Promise.race([
    probe,
    new Promise<undefined>((resolve) => {
      setTimeout(() => resolve(undefined), ORIENTATION_PROBE_TIMEOUT_MS);
    }),
  ]);

  if (size === undefined) {
    return { frameFound: true, readable: false, innerWidth: 0, innerHeight: 0, portrait: false };
  }

  const state = {
    frameFound: true,
    readable: true,
    innerWidth: size.width,
    innerHeight: size.height,
    portrait: size.height > size.width,
  };
  if (process.env.SGAP_IFRAME_TRACE === '1') {
    console.log(`[sgap-surface] phase=readOrientation ${describeOrientation(state)}`);
  }
  return state;
}

/** Minimal shape of the pieces of `document` the lock touches; this project builds without the DOM lib. */
interface StyleHostNode {
  id: string;
  textContent: string;
  remove(): void;
}

interface StyleHostDocument {
  getElementById(id: string): StyleHostNode | null;
  createElement(tag: string): StyleHostNode;
  head: { appendChild(node: StyleHostNode): void } | null;
  documentElement: { appendChild(node: StyleHostNode): void };
}

/**
 * Pin the iframe to `size` with a stylesheet rule that survives host re-renders.
 * Re-appends the sheet to the end of `head` so a later launcher rule cannot
 * win on equal specificity. Extra layout props stop flex/absolute stretch
 * from ignoring width/height after splash dismiss.
 */
export async function installPortraitLock(
  page: Page,
  iframeSelector: string,
  size: { readonly width: number; readonly height: number },
): Promise<void> {
  await page
    .evaluate(
      ({ selector, width, height }) => {
        const STYLE_ID = 'sgap-portrait-lock';
        const doc = (globalThis as unknown as { document: StyleHostDocument }).document;
        let style = doc.getElementById(STYLE_ID);
        if (style === null) {
          style = doc.createElement('style');
          style.id = STYLE_ID;
        }
        const host = doc.head ?? doc.documentElement;
        host.appendChild(style);
        const dimensions = [
          `width:${width}px !important`,
          `height:${height}px !important`,
          `min-width:${width}px !important`,
          `min-height:${height}px !important`,
          `max-width:${width}px !important`,
          `max-height:${height}px !important`,
          'display:block !important',
          'border:0 !important',
          'position:relative !important',
          'inset:auto !important',
          'left:auto !important',
          'right:auto !important',
          'top:auto !important',
          'bottom:auto !important',
          'flex:0 0 auto !important',
          'align-self:center !important',
          'box-sizing:border-box !important',
        ].join(';');
        style.textContent = `html body ${selector}{${dimensions}}`;
        const docWithQuery = globalThis as unknown as {
          document: StyleHostDocument & {
            querySelector(sel: string): {
              setAttribute: (name: string, value: string) => void;
              parentElement: {
                style: { setProperty: (k: string, v: string, p?: string) => void };
                tagName: string;
                parentElement: unknown;
              } | null;
            } | null;
          };
        };
        const iframeNode = docWithQuery.document.querySelector(selector);
        iframeNode?.setAttribute('data-sgap-lock', `${width}x${height}`);
        let node = iframeNode?.parentElement ?? null;
        while (node !== null && node.tagName !== 'BODY' && node.tagName !== 'HTML') {
          node.style.setProperty('max-width', 'none', 'important');
          node.style.setProperty('max-height', 'none', 'important');
          node.style.setProperty('overflow', 'visible', 'important');
          node = node.parentElement as typeof node;
        }
      },
      { selector: iframeSelector, width: size.width, height: size.height },
    )
    .catch(() => undefined);
}

/**
 * Splash Play (and the DiJoker shell) can request fullscreen on the game
 * iframe. UA fullscreen styles force the element to the layout viewport and
 * ignore author width/height, even inline `!important`. Exit once; do not poll.
 */
export async function exitDocumentFullscreen(page: Page, manifest?: GameManifest): Promise<boolean> {
  const exitInDocument = async (): Promise<boolean> => {
    const doc = globalThis as unknown as {
      document: {
        fullscreenElement: { tagName: string } | null;
        webkitFullscreenElement?: { tagName: string } | null;
        exitFullscreen?: () => Promise<void>;
        webkitExitFullscreen?: () => Promise<void>;
      };
    };
    const host = doc.document;
    if (host.fullscreenElement === null && (host.webkitFullscreenElement ?? null) === null) {
      return false;
    }
    const exit = host.exitFullscreen ?? host.webkitExitFullscreen;
    if (exit === undefined) {
      return false;
    }
    await exit.call(host);
    return true;
  };

  const hostExited = await page.evaluate(exitInDocument).catch(() => false);
  const frame = manifest === undefined ? undefined : findGameFrame(page, manifest);
  const frameExited =
    frame === undefined ? false : await frame.evaluate(exitInDocument).catch(() => false);
  if (hostExited === true || frameExited === true) {
    console.log('[sgap-surface] exited-fullscreen');
  }
  return hostExited === true || frameExited === true;
}

export async function removePortraitLock(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      const doc = (globalThis as unknown as { document: StyleHostDocument }).document;
      doc.getElementById('sgap-portrait-lock')?.remove();
    })
    .catch(() => undefined);
}

function portraitTargetFor(
  page: Page,
  manifest: GameManifest,
): { readonly width: number; readonly height: number } {
  const preferred = portraitAspectFor(manifest);
  const viewport = page.viewportSize() ?? { width: 1400, height: 900 };
  return fitPortraitSize(viewport, preferred);
}

interface RoomBox {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
}

interface RoomNode {
  getBoundingClientRect(): RoomBox;
  readonly parentElement: RoomNode | null;
}

/**
 * Room the host actually shows for the iframe: from its top-left corner to the
 * nearest clipping ancestor (launcher modal body) or the viewport edge.
 * `overflowY` > 0 means the bottom of the game is cut off.
 */
export async function measureIframeRoom(
  page: Page,
  iframeSelector: string,
): Promise<{ readonly width: number; readonly height: number; readonly overflowY: number } | undefined> {
  return page
    .locator(iframeSelector)
    .first()
    .evaluate((el) => {
      const g = globalThis as unknown as {
        innerWidth: number;
        innerHeight: number;
        getComputedStyle(node: RoomNode): {
          overflow: string;
          overflowX: string;
          overflowY: string;
          paddingBottom: string;
          paddingRight: string;
        };
      };
      const self = el as unknown as RoomNode;
      const box = self.getBoundingClientRect();
      let bottom = g.innerHeight;
      let right = g.innerWidth;
      for (let node = self.parentElement; node !== null; node = node.parentElement) {
        const cs = g.getComputedStyle(node);
        const nodeBox = node.getBoundingClientRect();
        if (/hidden|auto|scroll|clip/u.test(`${cs.overflowY} ${cs.overflow}`)) {
          bottom = Math.min(bottom, nodeBox.bottom - (Number.parseFloat(cs.paddingBottom) || 0));
        }
        if (/hidden|auto|scroll|clip/u.test(`${cs.overflowX} ${cs.overflow}`)) {
          right = Math.min(right, nodeBox.right - (Number.parseFloat(cs.paddingRight) || 0));
        }
      }
      return {
        width: Math.floor(right - box.left),
        height: Math.floor(bottom - box.top),
        overflowY: Math.ceil(box.bottom - bottom),
      };
    })
    .catch(() => undefined);
}

/**
 * Shrink an already-locked portrait iframe until its bottom HUD row is inside the
 * host's visible area. Launcher chrome (modal header, live-history panel) can
 * leave less room than the viewport, which hides Spin/Menu below the fold.
 */
export async function shrinkIframeToVisibleRoom(
  page: Page,
  iframeSelector: string,
  locked: { readonly width: number; readonly height: number },
  preferred: { readonly width: number; readonly height: number },
  lock: (size: { readonly width: number; readonly height: number }) => Promise<void>,
): Promise<{ readonly width: number; readonly height: number }> {
  let current = locked;
  for (let pass = 0; pass < 3; pass += 1) {
    const room = await measureIframeRoom(page, iframeSelector);
    if (room === undefined || room.overflowY <= 1) {
      break;
    }
    const next = fitPortraitSize(
      { width: Math.max(1, room.width), height: Math.max(1, current.height - room.overflowY) },
      preferred,
    );
    if (next.height >= current.height) {
      break;
    }
    current = next;
    await lock(current);
  }
  return current;
}

async function waitForPortrait(
  page: Page,
  manifest: GameManifest,
): Promise<OrientationState> {
  const deadline = Date.now() + LOCK_POLL_TIMEOUT_MS;
  let state = await readOrientation(page, manifest);
  while (!state.portrait && Date.now() < deadline) {
    await page.waitForTimeout(LOCK_POLL_INTERVAL_MS);
    state = await readOrientation(page, manifest);
  }
  return state;
}

/**
 * Restore portrait without reloading, cheapest remedy first: re-pin the iframe,
 * then shrink the layout viewport. The game clears its own blocker on resize, so
 * neither step costs the round in progress. Callers escalate to a frame reload
 * only when this returns `still-landscape`.
 */
export async function healPortraitOrientation(
  page: Page,
  manifest: GameManifest,
  iframeSelector: string,
  options?: { readonly allowViewportResize?: boolean },
): Promise<PortraitHealResult> {
  await exitDocumentFullscreen(page, manifest);

  const before = await readOrientation(page, manifest);

  if (!before.frameFound) {
    return { outcome: 'frame-missing', before, after: before, healed: false };
  }
  if (!isBlockedByRotation(before)) {
    return { outcome: 'already-portrait', before, after: before, healed: true };
  }

  const target = portraitTargetFor(page, manifest);

  await installPortraitLock(page, iframeSelector, target);
  await shrinkIframeToVisibleRoom(
    page,
    iframeSelector,
    target,
    portraitAspectFor(manifest),
    (size) => installPortraitLock(page, iframeSelector, size),
  );
  let after = await waitForPortrait(page, manifest);
  if (after.portrait) {
    return { outcome: 'healed-by-lock', before, after, healed: true };
  }

  // Resizing the layout viewport re-lays out the whole host and can disturb a
  // round in flight, so it stays opt-in and the lock alone is the default remedy.
  const preferred = portraitAspectFor(manifest);
  const viewport = page.viewportSize();
  if (options?.allowViewportResize === true && viewport !== null && viewport.width > viewport.height) {
    await page.setViewportSize(fitPortraitSize(viewport, preferred)).catch(() => undefined);
    await installPortraitLock(page, iframeSelector, portraitTargetFor(page, manifest));
    after = await waitForPortrait(page, manifest);
    if (after.portrait) {
      return { outcome: 'healed-by-viewport', before, after, healed: true };
    }
  }

  return { outcome: 'still-landscape', before, after, healed: false };
}

export function describeOrientation(state: OrientationState): string {
  if (!state.frameFound) {
    return 'game frame not found';
  }
  if (!state.readable) {
    return 'size unreadable (frame busy)';
  }
  const shape = state.portrait ? 'portrait' : 'LANDSCAPE (rotate blocker)';
  return `${state.innerWidth}x${state.innerHeight} ${shape}`;
}

export interface GameSurfaceSnapshot {
  readonly phase: string;
  readonly viewport: string;
  readonly iframeCount: number;
  readonly nodeId: string | null;
  readonly title: string | null;
  readonly srcDevice: string | null;
  readonly box: string | null;
  readonly innerLocator: string | null;
  readonly innerUrlMatch: string | null;
  readonly frames: string;
  readonly computed: string | null;
  readonly attrs: string | null;
  readonly lockSheet: string | null;
  readonly lockStamp: string | null;
  readonly cascade: string | null;
  readonly portrait: boolean | null;
  readonly probeError: string | null;
}

interface SurfaceHostIframe {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  getBoundingClientRect(): { x: number; y: number; width: number; height: number };
}

interface SurfaceHostDocument {
  querySelectorAll(sel: string): { length: number; item(index: number): SurfaceHostIframe | null };
  querySelector(sel: string): SurfaceHostIframe | null;
  getElementById(id: string): { textContent: string } | null;
  defaultView: {
    getComputedStyle(node: SurfaceHostIframe): {
      width: string;
      height: string;
      maxWidth: string;
      maxHeight: string;
      transform: string;
    };
    __sgapNodeSeq?: number;
  } | null;
}

async function readFrameSize(frame: Frame | null | undefined): Promise<string | null> {
  if (frame === null || frame === undefined) {
    return null;
  }
  const size = await Promise.race([
    frame
      .evaluate(() => {
        const view = globalThis as unknown as { innerWidth: number; innerHeight: number };
        return { width: view.innerWidth, height: view.innerHeight };
      })
      .catch(() => undefined),
    new Promise<undefined>((resolve) => {
      setTimeout(() => resolve(undefined), ORIENTATION_PROBE_TIMEOUT_MS);
    }),
  ]);
  return size === undefined ? null : `${size.width}x${size.height}`;
}

function redactFrameUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const device = parsed.searchParams.get('device');
    return `${parsed.pathname}${device !== null ? `?device=${device}` : ''}`;
  } catch {
    return url.length > 0 ? 'unparseable' : 'empty';
  }
}

/**
 * Non-invasive iframe identity + size probe. Never touches `contentWindow`
 * (cross-origin throws). Stamps `data-sgap-node` once so a later snapshot can
 * tell replacement from a style overwrite. Does not resize or relock.
 */
export async function snapshotGameSurface(
  page: Page,
  iframeSelector: string,
  phase: string,
  manifest?: GameManifest,
): Promise<GameSurfaceSnapshot> {
  const viewport = page.viewportSize();
  const locatorCount = await page.locator(iframeSelector).count().catch(() => 0);

  const host = await page
    .evaluate(
      ({ selector, trace }) => {
        const doc = (globalThis as unknown as { document: SurfaceHostDocument }).document;
        const list = doc.querySelectorAll(selector);
        const el = list.item(0);
        const view = doc.defaultView;
        const lockSheet = doc.getElementById('sgap-portrait-lock')?.textContent ?? null;
        if (el === null || view === null) {
          return {
            iframeCount: list.length,
            nodeId: null as string | null,
            title: null as string | null,
            srcDevice: null as string | null,
            box: null as string | null,
            computed: null as string | null,
            attrs: null as string | null,
            lockSheet,
            lockStamp: null as string | null,
            cascade: null as string | null,
          };
        }
        let nodeId = el.getAttribute('data-sgap-node');
        if (nodeId === null) {
          const next = (view.__sgapNodeSeq ?? 0) + 1;
          view.__sgapNodeSeq = next;
          nodeId = String(next);
          el.setAttribute('data-sgap-node', nodeId);
        }
        const box = el.getBoundingClientRect();
        const cs = view.getComputedStyle(el);
        const src = el.getAttribute('src') ?? '';
        const deviceMatch = /[?&]device=([^&]*)/iu.exec(src);
        const parent = (el as unknown as { parentElement: SurfaceHostIframe & {
          tagName: string;
          className: string;
          id: string;
        } | null }).parentElement;
        const pcs = parent !== null ? view.getComputedStyle(parent as unknown as SurfaceHostIframe) : null;
        const matched: string[] = [];
        const sheets = (globalThis as unknown as {
          document: { styleSheets: { length: number; item(i: number): { href: string | null; cssRules: { length: number; item(j: number): { selectorText?: string; style?: { cssText: string } } | null } } | null } };
        }).document.styleSheets;
        if (trace) {
        for (let i = 0; i < sheets.length; i += 1) {
          const sheet = sheets.item(i);
          if (sheet === null) {
            continue;
          }
          let rules: { length: number; item(j: number): { selectorText?: string; style?: { cssText: string } } | null };
          try {
            rules = sheet.cssRules;
          } catch {
            continue;
          }
          for (let j = 0; j < rules.length; j += 1) {
            const rule = rules.item(j);
            const selectorText = rule?.selectorText;
            if (rule === null || selectorText === undefined) {
              continue;
            }
            try {
              if ((el as unknown as { matches: (sel: string) => boolean }).matches(selectorText)) {
                const cssText = rule.style?.cssText ?? '';
                if (/width|height|max-|min-|flex|inset|position|display/i.test(cssText) || /iframe/i.test(selectorText)) {
                  matched.push(`${selectorText}{${cssText}}`);
                }
              }
            } catch {
              continue;
            }
          }
        }
        }
        const fullscreenTag = (doc as unknown as { fullscreenElement: { tagName: string } | null }).fullscreenElement?.tagName ?? null;
        return {
          iframeCount: list.length,
          nodeId,
          title: el.getAttribute('title'),
          srcDevice: deviceMatch?.[1] ?? (src.length > 0 ? 'none' : null),
          box: `${Math.round(box.width)}x${Math.round(box.height)}@${Math.round(box.x)},${Math.round(box.y)}`,
          computed: `w=${cs.width};h=${cs.height};maxW=${cs.maxWidth};maxH=${cs.maxHeight};tx=${cs.transform};pos=${cs.position};d=${(cs as unknown as { display: string }).display};flex=${(cs as unknown as { flex: string }).flex};align=${(cs as unknown as { alignSelf: string }).alignSelf};left=${(cs as unknown as { left: string }).left};right=${(cs as unknown as { right: string }).right}`,
          attrs: `width=${el.getAttribute('width') ?? ''};height=${el.getAttribute('height') ?? ''};style=${el.getAttribute('style') ?? ''}`,
          lockSheet,
          lockStamp: el.getAttribute('data-sgap-lock'),
          cascade: trace
            ? `parent=${parent === null ? 'none' : `${parent.tagName}#${parent.id}.${parent.className} ${pcs?.width ?? '?'}x${pcs?.height ?? '?'} d=${(pcs as unknown as { display?: string } | null)?.display ?? '?'}`} fs=${fullscreenTag ?? 'none'} rules=${matched.length} ${matched.slice(0, 12).join(' || ')}`
            : `fs=${fullscreenTag ?? 'none'}`,
        };
      },
      { selector: iframeSelector, trace: process.env.SGAP_IFRAME_TRACE === '1' },
    )
    .catch((error: unknown) => ({
      iframeCount: locatorCount,
      nodeId: null as string | null,
      title: null as string | null,
      srcDevice: null as string | null,
      box: null as string | null,
      computed: null as string | null,
      attrs: null as string | null,
      lockSheet: null as string | null,
      lockStamp: null as string | null,
      cascade: null as string | null,
      probeError: error instanceof Error ? error.message : String(error),
    }));

  let innerLocator: string | null = null;
  try {
    const handle = await page.locator(iframeSelector).first().elementHandle({ timeout: 1_000 });
    innerLocator = await readFrameSize(handle === null ? null : await handle.contentFrame());
  } catch {
    innerLocator = null;
  }

  const innerUrlMatch = manifest === undefined ? null : await readFrameSize(findGameFrame(page, manifest));

  const frameSizes = await Promise.all(
    page.frames().map(async (frame, index) => {
      const size = await readFrameSize(frame);
      return `${index}:${size ?? '?'}@${redactFrameUrl(frame.url())}`;
    }),
  );

  const inner = innerLocator ?? innerUrlMatch;
  const [innerW, innerH] =
    inner === null
      ? [undefined, undefined]
      : inner.split('x').map((part) => Number(part));
  const portrait =
    innerW !== undefined && innerH !== undefined && Number.isFinite(innerW) && Number.isFinite(innerH)
      ? innerH > innerW
      : null;

  return {
    phase,
    viewport: viewport === null ? 'none' : `${viewport.width}x${viewport.height}`,
    iframeCount: host.iframeCount ?? locatorCount,
    nodeId: host.nodeId,
    title: host.title,
    srcDevice: host.srcDevice,
    box: host.box,
    innerLocator,
    innerUrlMatch,
    frames: frameSizes.join('|'),
    computed: host.computed,
    attrs: host.attrs,
    lockSheet: host.lockSheet,
    lockStamp: host.lockStamp,
    cascade: 'cascade' in host ? (host.cascade as string | null) : null,
    portrait,
    probeError: 'probeError' in host ? (host.probeError as string) : null,
  };
}

export function formatGameSurface(snapshot: GameSurfaceSnapshot): string {
  const orient =
    snapshot.portrait === null ? 'n/a' : snapshot.portrait ? 'portrait' : 'LANDSCAPE';
  return [
    `phase=${snapshot.phase}`,
    `vp=${snapshot.viewport}`,
    `iframes=${snapshot.iframeCount}`,
    `node=${snapshot.nodeId ?? 'none'}`,
    `box=${snapshot.box ?? 'none'}`,
    `innerLoc=${snapshot.innerLocator ?? 'none'}`,
    `innerUrl=${snapshot.innerUrlMatch ?? 'none'}`,
    `orient=${orient}`,
    `device=${snapshot.srcDevice ?? 'none'}`,
    `lockStamp=${snapshot.lockStamp ?? 'none'}`,
    `lockSheet=${snapshot.lockSheet === null ? 'missing' : snapshot.lockSheet.length > 0 ? 'present' : 'empty'}`,
  ].join(' ');
}

export async function logGameSurface(
  page: Page,
  iframeSelector: string,
  phase: string,
  manifest?: GameManifest,
): Promise<GameSurfaceSnapshot> {
  const snapshot = await snapshotGameSurface(page, iframeSelector, phase, manifest);
  console.log(`[sgap-surface] ${formatGameSurface(snapshot)}`);
  if (process.env.SGAP_IFRAME_TRACE === '1') {
    console.log(
      `[sgap-surface-detail] phase=${snapshot.phase} computed=${snapshot.computed ?? 'none'} attrs=${snapshot.attrs ?? 'none'} title=${snapshot.title ?? 'none'} frames=${snapshot.frames} cascade=${snapshot.cascade ?? 'none'}${snapshot.probeError !== null ? ` error=${snapshot.probeError}` : ''}`,
    );
  }
  return snapshot;
}
