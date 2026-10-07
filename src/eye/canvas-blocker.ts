/**
 * Detect / dismiss canvas overlays that sit on top of the idle HUD.
 *
 * Package 1 draws these as pixels inside &lt;canvas&gt; — Playwright getByText cannot
 * see "You have an ongoing free spin round…" or the green Continue CTA. Colour
 * signatures are the reliable channel; host-text Eye stays as a secondary path.
 */

import type { Page } from 'playwright';

import type { GameManifest } from '../core/models/index.js';
import type { PlaywrightGameDriver } from '../driver/playwright-game-driver.js';
import { decodePng } from '../verification/reel/image-match.js';
import {
  listPhaserInteractive,
  listPhaserTexts,
  pickPhaserControl,
  type PhaserHit,
  type PhaserTextHit,
} from '../runtime/phaser-locate.js';
import { hudLabelPattern, loadSurfaceProfileById, visionSignature } from '../surfaces/load-surface-profile.js';
import type { SurfaceProfile } from '../surfaces/types.js';
import {
  findControlInPng,
  findIdleSpinInPng,
  type ControlSignature,
  type DetectedControl,
} from './canvas-vision.js';

/** A blocker we cannot describe is a config bug, not something to guess around. */
function requireSignature(profile: SurfaceProfile, name: string): ControlSignature {
  const signature = visionSignature(profile, name);
  if (signature === undefined) {
    throw new Error(
      `Surface profile "${profile.id}" has no vision signature for "${name}". ` +
        `Add it under blockers or controls in config/surfaces/${profile.id}.json.`,
    );
  }
  return signature;
}

/**
 * Mid-screen YES / OK / session Continue. Shape comes from the surface profile
 * (`blockers.sessionContinue`); callers that have no profile get the base one.
 */
export const SESSION_CONTINUE_SIGNATURE: ControlSignature = requireSignature(
  loadSurfaceProfileById('base'),
  'sessionContinue',
);

export type CanvasBlockerKind =
  | 'none'
  | 'session-continue'
  | 'buy-confirm'
  | 'splash-play'
  | 'press-anywhere';

/** Blockers a dismiss tap clears; buy-confirm is excluded (the buy flow owns it). */
export function isDismissableBlocker(kind: CanvasBlockerKind): boolean {
  return kind === 'session-continue' || kind === 'splash-play' || kind === 'press-anywhere';
}

export interface CanvasBlocker {
  readonly kind: CanvasBlockerKind;
  readonly detail: string;
  /** Canvas action ratio to tap when kind !== 'none'. */
  readonly center?: { readonly x: number; readonly y: number };
  readonly areaRatio?: number;
}

function meanLuminance(
  png: Buffer,
  band: { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number },
): number | undefined {
  try {
    const image = decodePng(png);
    const x0 = Math.floor(band.x0 * image.width);
    const x1 = Math.floor(band.x1 * image.width);
    const y0 = Math.floor(band.y0 * image.height);
    const y1 = Math.floor(band.y1 * image.height);
    let sum = 0;
    let count = 0;
    for (let y = y0; y < y1; y += 4) {
      for (let x = x0; x < x1; x += 4) {
        const i = (y * image.width + x) * 4;
        sum += (image.data[i]! + image.data[i + 1]! + image.data[i + 2]!) / 3;
        count += 1;
      }
    }
    return count === 0 ? undefined : sum / count;
  } catch {
    return undefined;
  }
}

/**
 * Classify whether something is covering the idle HUD inside the game canvas.
 * Does not tap — callers decide dismiss vs. assert-fail.
 */
/**
 * The Buy Feature confirm is a full-width solid pill (fill ≈0.6+). The splash Play
 * (same green, y≈0.77) is a round button about a quarter of the canvas wide, and on
 * splashes with green scenery it merges into a wide but sparse blob (fill ≈0.3).
 * Thresholds come from `buyConfirmPill` in the surface profile.
 */
export function isBuyConfirmPill(
  control: DetectedControl | undefined,
  profile: SurfaceProfile = loadSurfaceProfileById('base'),
): control is DetectedControl {
  const { minWidthRatio, minFill } = profile.buyConfirmPill;
  return (
    control !== undefined &&
    control.box.x1 - control.box.x0 >= minWidthRatio &&
    control.fill >= minFill
  );
}

/**
 * A splash whose Play button merges with same-hue scenery reads as a dark
 * "press anywhere" panel to the colour classifier. The scene graph still knows the
 * button: a round interactive object in the attract band while no HUD spin exists
 * (so a HUD control under a win overlay is never mistaken for Play).
 */
async function findSplashPlayByPhaser(driver: PlaywrightGameDriver): Promise<PhaserHit | undefined> {
  const shape = driver.surface.splashPlayShape;
  if (shape === undefined) {
    return undefined;
  }
  const hits = await listPhaserInteractive(driver.getPage(), driver.iframeSelector).catch(
    () => [] as readonly PhaserHit[],
  );
  if (hits.length === 0 || pickPhaserControl(hits, 'spin', driver.surface) !== undefined) {
    return undefined;
  }
  const play = pickPhaserControl(hits, 'attractPlay', driver.surface);
  if (play === undefined) {
    return undefined;
  }
  const aspect = play.width / Math.max(1, play.height);
  return aspect >= shape.minAspect && aspect <= shape.maxAspect ? play : undefined;
}

export function classifyCanvasPng(
  png: Buffer,
  profile: SurfaceProfile = loadSurfaceProfileById('base'),
): CanvasBlocker {
  const buyConfirm = findControlInPng(png, requireSignature(profile, 'buyFeatureConfirm'));
  if (isBuyConfirmPill(buyConfirm, profile)) {
    return {
      kind: 'buy-confirm',
      detail: `BUY FEATURE confirm at ${buyConfirm.center.x.toFixed(3)},${buyConfirm.center.y.toFixed(3)}`,
      center: buyConfirm.center,
      areaRatio: buyConfirm.areaRatio,
    };
  }

  const continueBtn = findControlInPng(png, requireSignature(profile, 'sessionContinue'));
  const idleSpin = findIdleSpinInPng(png, profile);

  if (continueBtn !== undefined && idleSpin === undefined) {
    return {
      kind: 'session-continue',
      detail:
        `session Continue at ${continueBtn.center.x.toFixed(3)},${continueBtn.center.y.toFixed(3)} ` +
        `area=${(continueBtn.areaRatio * 100).toFixed(2)}%`,
      center: continueBtn.center,
      areaRatio: continueBtn.areaRatio,
    };
  }

  // "Press anywhere to continue" / YOU WON intro — dark mid panel, no green CTA, no spin.
  const pressAnywhere = profile.pressAnywhere;
  if (idleSpin === undefined && continueBtn === undefined && pressAnywhere !== undefined) {
    const luma = meanLuminance(png, pressAnywhere.band);
    if (luma !== undefined && luma < pressAnywhere.maxLuma) {
      return {
        kind: 'press-anywhere',
        detail: `dark mid-panel (luma=${luma.toFixed(0)}) with no idle spin — press-anywhere`,
        center: pressAnywhere.center,
      };
    }
  }

  return { kind: 'none', detail: 'no canvas blocker detected' };
}

export async function detectCanvasBlocker(
  driver: PlaywrightGameDriver,
): Promise<CanvasBlocker> {
  const capture = await driver.captureCanvasForVision().catch(() => undefined);
  if (capture === undefined) {
    return { kind: 'none', detail: 'could not capture game canvas' };
  }
  const raw = classifyCanvasPng(capture.png, driver.surface);
  if (raw.kind === 'none') {
    const prompt = await findPressAnywhereText(driver);
    const center = driver.surface.pressAnywhere?.center;
    if (prompt !== undefined && center !== undefined) {
      return {
        kind: 'press-anywhere',
        detail: `Phaser text "${prompt.text}" — press-anywhere over a bright panel`,
        center: capture.toActionRatio(center),
      };
    }
  }
  if (raw.kind === 'press-anywhere') {
    const play = await findSplashPlayByPhaser(driver);
    if (play !== undefined) {
      return {
        kind: 'splash-play',
        detail:
          `Phaser splash Play at ${play.xRatio.toFixed(3)},${play.yRatio.toFixed(3)} ` +
          `${play.width}x${play.height} (${play.type}) — not press-anywhere`,
        center: { x: play.xRatio, y: play.yRatio },
      };
    }
  }
  if (raw.center === undefined) {
    return raw;
  }
  return {
    ...raw,
    center: capture.toActionRatio(raw.center),
  };
}

/**
 * A "press anywhere" prompt painted as scene-graph text (`hudLabels.pressAnywhere`).
 * Award intros with a bright glow fail the dark-panel luminance test.
 */
async function findPressAnywhereText(
  driver: PlaywrightGameDriver,
): Promise<PhaserTextHit | undefined> {
  const pattern = hudLabelPattern(driver.surface, 'pressAnywhere');
  if (pattern === undefined) {
    return undefined;
  }
  const texts = await listPhaserTexts(driver.getPage(), driver.iframeSelector).catch(
    () => [] as readonly PhaserTextHit[],
  );
  return texts.find((hit) => pattern.test(hit.text));
}

/**
 * The panel's close glyph as painted in the scene graph (`hudLabels.buyPanelClose`).
 * Hidden layers keep interactive objects at the same spot, so position alone picks
 * the wrong one; a visible text on the topmost layer does not.
 */
async function findBuyPanelClose(driver: PlaywrightGameDriver): Promise<PhaserTextHit | undefined> {
  const pattern = hudLabelPattern(driver.surface, 'buyPanelClose');
  if (pattern === undefined) {
    return undefined;
  }
  const hits = await listPhaserTexts(driver.getPage(), driver.iframeSelector).catch(
    () => [] as readonly PhaserTextHit[],
  );
  return hits
    .filter((hit) => pattern.test(hit.text.trim()) && hit.gameWidth > 0 && hit.gameHeight > 0)
    .sort((a, b) => (b.layer?.order ?? 0) - (a.layer?.order ?? 0))[0];
}

/**
 * Close the Buy Feature panel through its close glyph in the scene graph (the
 * manifest `buyFeatureCancel` point only as a journaled fallback), and confirm by
 * eye that it is gone. Taps nothing when no panel is showing — the cancel point
 * of one layout can be a live HUD control in another.
 */
export async function closeBuyPanel(driver: PlaywrightGameDriver, attempts = 2): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if ((await detectCanvasBlocker(driver)).kind !== 'buy-confirm') {
      return true;
    }
    const close = await findBuyPanelClose(driver);
    if (close !== undefined) {
      await driver
        .clickCanvasAt(
          { x: (close.x + close.width / 2) / close.gameWidth, y: (close.y + close.height / 2) / close.gameHeight },
          { timeoutMs: 8_000, singleInput: true, label: 'buyFeatureCancel', strategy: 'phaser', detail: `buy panel close "${close.text}"` },
        )
        .catch(() => undefined);
    } else {
      await driver
        .clickCanvas('buyFeatureCancel', {
          timeoutMs: 8_000,
          singleInput: true,
          fallbackReason: 'Phaser: no buy panel close glyph',
        })
        .catch(() => undefined);
    }
    await driver.getPage().waitForTimeout(700);
  }
  return (await detectCanvasBlocker(driver)).kind !== 'buy-confirm';
}

/**
 * Tap session Continue / press-anywhere when the canvas is blocked.
 * Skips buy-confirm (caller owns buy flow). Returns true when a dismiss tap ran.
 */
export async function dismissCanvasBlocker(
  driver: PlaywrightGameDriver,
  _manifest: GameManifest,
  blocker?: CanvasBlocker,
  options?: { readonly cancelBuyPanel?: boolean },
): Promise<CanvasBlocker & { readonly dismissed: boolean }> {
  const found = blocker ?? (await detectCanvasBlocker(driver));
  if (found.kind === 'buy-confirm' && options?.cancelBuyPanel === true) {
    const closed = await closeBuyPanel(driver);
    console.log(
      `[sgap-heal] canvas-blocker: ${closed ? 'closed stray buy panel' : 'buy panel still open after cancel'} — ${found.detail}`,
    );
    return { ...found, dismissed: closed };
  }
  if (found.kind === 'none' || found.kind === 'buy-confirm' || found.center === undefined) {
    return { ...found, dismissed: false };
  }

  await driver
    .clickCanvasAt(found.center, {
      timeoutMs: 8_000,
      singleInput: true,
      label: found.kind,
      strategy: found.kind === 'splash-play' ? 'phaser' : found.kind === 'press-anywhere' ? 'point' : 'vision',
      detail: found.detail,
    })
    .catch(() => undefined);
  console.log(
    `[sgap-heal] canvas-blocker: dismissed ${found.kind} at ` +
      `${found.center.x.toFixed(3)},${found.center.y.toFixed(3)} — ${found.detail}`,
  );
  return { ...found, dismissed: true };
}

export interface HudState {
  /** Idle spin visible and nothing classified on top of it — no overlay to clear. */
  readonly idle: boolean;
  readonly blocker: CanvasBlocker;
  readonly detail: string;
}

/**
 * One canvas capture: is the base HUD idle and unobstructed? A failed capture or an
 * unrecognised spin reads as not idle, so callers keep their dismiss behaviour.
 */
export async function readHudState(driver: PlaywrightGameDriver): Promise<HudState> {
  const capture = await driver.captureCanvasForVision().catch(() => undefined);
  if (capture === undefined) {
    const blocker: CanvasBlocker = { kind: 'none', detail: 'could not capture game canvas' };
    return { idle: false, blocker, detail: blocker.detail };
  }
  const raw = classifyCanvasPng(capture.png, driver.surface);
  if (raw.kind !== 'none') {
    const blocker = raw.kind === 'press-anywhere' ? await detectCanvasBlocker(driver) : {
      ...raw,
      center: raw.center === undefined ? undefined : capture.toActionRatio(raw.center),
    };
    return { idle: false, blocker, detail: blocker.detail };
  }
  const spin = findIdleSpinInPng(capture.png, driver.surface);
  if (spin === undefined) {
    const play = await findSplashPlayByPhaser(driver);
    if (play !== undefined) {
      const blocker: CanvasBlocker = {
        kind: 'splash-play',
        detail: `Phaser splash Play at ${play.xRatio.toFixed(3)},${play.yRatio.toFixed(3)} ${play.width}x${play.height} (${play.type})`,
        center: { x: play.xRatio, y: play.yRatio },
      };
      return { idle: false, blocker, detail: blocker.detail };
    }
  }
  return {
    idle: spin !== undefined,
    blocker: raw,
    detail:
      spin === undefined
        ? 'idle spin not visible'
        : `idle spin at ${spin.center.x.toFixed(3)},${spin.center.y.toFixed(3)}`,
  };
}

/**
 * Poll the HUD for up to `windowMs` while reels / win count-ups finish. Returns as soon
 * as the HUD is idle or a confident blocker is on screen, else the last reading.
 * Press-anywhere (a dark panel with no spin) also matches mid-spin, so it must persist.
 */
export async function settleHudState(
  driver: PlaywrightGameDriver,
  windowMs: number,
  intervalMs = 400,
): Promise<HudState> {
  const deadline = Date.now() + windowMs;
  let state = await readHudState(driver);
  while (
    !state.idle &&
    (state.blocker.kind === 'none' || state.blocker.kind === 'press-anywhere') &&
    Date.now() < deadline
  ) {
    await driver.getPage().waitForTimeout(intervalMs).catch(() => undefined);
    state = await readHudState(driver);
  }
  return state;
}

/** Buttons a game dialog closes with; matched against texts the scene graph paints. */
export const DIALOG_BUTTON_TEXT = /^(OK|CLOSE|CONTINUE|RETRY|TRY AGAIN)$/iu;

/**
 * Tap a dialog's own button found by its label in the scene graph. Returns the label
 * tapped, or undefined when no such button is painted.
 */
export async function clickDialogButton(
  driver: PlaywrightGameDriver,
  pattern: RegExp = DIALOG_BUTTON_TEXT,
  action = 'errorOk',
): Promise<string | undefined> {
  const hits = await listPhaserTexts(driver.getPage(), driver.iframeSelector).catch(
    () => [] as readonly PhaserTextHit[],
  );
  const hit = hits.find((entry) => pattern.test(entry.text.trim()) && entry.gameWidth > 0 && entry.gameHeight > 0);
  if (hit === undefined) {
    return undefined;
  }
  await driver
    .clickCanvasAt(
      { x: (hit.x + hit.width / 2) / hit.gameWidth, y: (hit.y + hit.height / 2) / hit.gameHeight },
      { timeoutMs: 8_000, singleInput: true, label: action, strategy: 'phaser', detail: `dialog button "${hit.text}"` },
    )
    .catch(() => undefined);
  return hit.text;
}

/** Locate the session Continue blob without tapping (for locateControlByVision blockers). */
export function findSessionContinueInPng(
  png: Buffer,
  profile: SurfaceProfile = loadSurfaceProfileById('base'),
): DetectedControl | undefined {
  return findControlInPng(png, requireSignature(profile, 'sessionContinue'));
}

/**
 * Drain session-continue / press-anywhere overlays before base-game work.
 * Returns how many dismiss taps ran (session-continue counts for FS drain).
 * `cancelBuyPanel` closes a leftover Buy Feature panel — only for idle-seeking
 * callers, never between opening the panel and confirming a purchase.
 */
export async function clearCanvasBlockers(
  page: Page,
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
  maxPasses = 3,
  options?: { readonly cancelBuyPanel?: boolean },
): Promise<{ readonly dismissed: number; readonly hadSessionContinue: boolean }> {
  let dismissed = 0;
  let hadSessionContinue = false;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const result = await dismissCanvasBlocker(driver, manifest, undefined, options);
    if (!result.dismissed) {
      break;
    }
    dismissed += 1;
    if (result.kind === 'session-continue') {
      hadSessionContinue = true;
    }
    await page.waitForTimeout(600);
  }
  return { dismissed, hadSessionContinue };
}
