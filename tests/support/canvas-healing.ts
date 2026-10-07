/**
 * Graded recovery for a canvas action that did not take effect.
 *
 * Ordered cheapest-first:
 *   1. orientation — rotate blocker ate the tap.
 *   2. vision      — locate the control by colour and remember the ratio.
 *
 * Locate does not tap. The caller re-arms /bet waiters and clicks so a recovery
 * tap cannot complete a later assertion. Remembered ratios are per-process.
 */
import type { Page } from 'playwright';
import type { GameManifest } from '../../src/core/models/index.js';
import {
  clearCanvasBlockers,
  detectCanvasBlocker,
  findSessionContinueInPng,
  isBuyConfirmPill,
  isDismissableBlocker,
} from '../../src/eye/canvas-blocker.js';
import { visionSignature } from '../../src/surfaces/load-surface-profile.js';
import { findControlInPng, type ControlSignature, type DetectedControl } from '../../src/eye/canvas-vision.js';
import { decodePng } from '../../src/verification/reel/image-match.js';
import {
  forgetHealedRatio,
  recallHealedRatio,
  rememberHealedRatio,
} from '../../src/eye/learned-ratios.js';
import type { PlaywrightGameDriver } from '../../src/driver/playwright-game-driver.js';
import { locateControlByPhaser } from '../../src/runtime/phaser-locate.js';
import { drainLeftoverFeatureSpins } from '../../src/platform/index.js';
import { describeRound, roundTrackerFor } from '../../src/network/round-tracker.js';
import { observationFor } from '../../src/observability/index.js';
import {
  describeOrientation,
  healPortraitOrientation,
  isBlockedByRotation,
  readOrientation,
} from '../../src/platform/portrait-guard.js';

export type HealStage = 'orientation' | 'vision' | 'phaser' | 'none';

export interface HealOutcome {
  readonly stage: HealStage;
  readonly healed: boolean;
  readonly detail: string;
  /** When spin/action is covered, vision may return the dialogue confirm ratio. */
  readonly blockerCenter?: { readonly x: number; readonly y: number };
}

/**
 * Every colour signature now comes from `config/surfaces/<profile>.json` via the
 * driver, so a new game is a config change. `signatureFor` returns undefined when
 * the profile does not describe that control — callers must treat that as "cannot
 * locate", never as licence to tap a guess.
 */
function signatureFor(driver: PlaywrightGameDriver, name: string): ControlSignature | undefined {
  return visionSignature(driver.surface, name);
}

/**
 * Splash Play: a solid round button. Tried in the high band first, then the low
 * band, where it is accepted only if it is roughly square and solid — a wide HUD
 * pill in the same place is not a Play button.
 */
function findSplashPlayIn(driver: PlaywrightGameDriver): (png: Buffer) => DetectedControl | undefined {
  const high = signatureFor(driver, 'splashPlay');
  const low = signatureFor(driver, 'splashPlayLow');
  return (png: Buffer): DetectedControl | undefined => {
    const hit = high === undefined ? undefined : findControlInPng(png, high);
    if (hit !== undefined) {
      return hit;
    }
    const lower = low === undefined ? undefined : findControlInPng(png, low);
    if (lower === undefined || lower.fill < SPLASH_PLAY_MIN_FILL) {
      return undefined;
    }
    const { width, height } = decodePng(png);
    const aspect =
      ((lower.box.x1 - lower.box.x0) * width) / ((lower.box.y1 - lower.box.y0) * height);
    return aspect > SPLASH_PLAY_MIN_ASPECT && aspect < SPLASH_PLAY_MAX_ASPECT ? lower : undefined;
  };
}

const SPLASH_PLAY_MIN_FILL = 0.55;
const SPLASH_PLAY_MIN_ASPECT = 0.75;
const SPLASH_PLAY_MAX_ASPECT = 1.33;

const healCounts = new Map<string, number>();

function countHeal(stage: HealStage): void {
  healCounts.set(stage, (healCounts.get(stage) ?? 0) + 1);
}

/** Per-worker tally for the end-of-run summary. */

export function healingSummary(): string {
  if (healCounts.size === 0) {
    return 'no canvas heals were needed';
  }
  return [...healCounts.entries()]
    .map(([stage, count]) => `${stage}=${count}`)
    .join(' ');
}

/**
 * Put the game back in portrait. Cheap enough (one frame evaluate) to call before
 * an action as a guard, not only after a failure.
 */

export async function ensurePortrait(
  page: Page,
  manifest: GameManifest,
  iframeSelector: string,
): Promise<HealOutcome> {
  const result = await healPortraitOrientation(page, manifest, iframeSelector);
  if (result.outcome === 'already-portrait') {
    return { stage: 'none', healed: true, detail: 'portrait' };
  }
  if (result.healed) {
    countHeal('orientation');
    return {
      stage: 'orientation',
      healed: true,
      detail:
        `rotate blocker cleared (${result.outcome}): ` +
        `${describeOrientation(result.before)} → ${describeOrientation(result.after)}`,
    };
  }
  return {
    stage: 'orientation',
    healed: false,
    detail: `still landscape after re-locking: ${describeOrientation(result.after)}`,
  };
}

/**
 * Find `action` by colour. Does not tap. Pass `remember: true` only after a miss
 * so the next click can use that ratio once.
 */

export async function locateControlByVision(
  page: Page,
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
  action: string,
  options?: { readonly remember?: boolean },
): Promise<HealOutcome> {
  const signature = signatureFor(driver, action);
  if (signature === undefined) {
    return {
      stage: 'vision',
      healed: false,
      detail:
        `no colour signature for "${action}" in surface profile "${driver.surface.id}" — ` +
        'add one under controls in config/surfaces',
    };
  }
  const orientation = await readOrientation(page, manifest);
  if (isBlockedByRotation(orientation)) {
    return {
      stage: 'vision',
      healed: false,
      detail: `skipped — game is ${describeOrientation(orientation)}, no controls drawn`,
    };
  }
  forgetHealedRatio(manifest.gameId, action);
  const capture = await driver.captureCanvasForVision();
  if (capture === undefined) {
    return { stage: 'vision', healed: false, detail: 'could not capture the game canvas' };
  }
  const found = findControlInPng(capture.png, signature);
  if (found === undefined) {
    const blocker =
      findSessionContinueInPng(capture.png, driver.surface);
    if (blocker === undefined) {
      return {
        stage: 'vision',
        healed: false,
        detail: `no ${signature.hue} control in the search band, and no dialogue over it`,
      };
    }
    return {
      stage: 'vision',
      healed: false,
      detail: `${action} was covered by a dialogue — Eye must dismiss before a payload click`,
      blockerCenter: capture.toActionRatio(blocker.center),
    };
  }
  const target = capture.toActionRatio(found.center);
  if (options?.remember === true) {
    rememberHealedRatio(manifest.gameId, action, target);
  }
  countHeal('vision');
  const manifestPoint = manifest.canvasActions?.actions[action];
  const drift =
    manifestPoint === undefined
      ? ''
      : ` (manifest ${manifestPoint.x.toFixed(3)},${manifestPoint.y.toFixed(3)})`;
  return {
    stage: 'vision',
    healed: true,
    detail:
      `located ${action} at ${target.x.toFixed(3)},${target.y.toFixed(3)}${drift} ` +
      `area=${(found.areaRatio * 100).toFixed(2)}%`,
  };
}

/**
 * Poll until the control is visible (idle spin circle, bet +/−, …).
 * Forgets a stale learned ratio first so a previous miss cannot keep tapping scenery.
 */

export async function waitForControlByVision(
  page: Page,
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
  action: string,
  timeoutMs = 12_000,
): Promise<HealOutcome> {
  forgetHealedRatio(manifest.gameId, action);
  const deadline = Date.now() + timeoutMs;
  let last: HealOutcome = {
    stage: 'vision',
    healed: false,
    detail: `timed out waiting for ${action}`,
  };
  while (Date.now() < deadline) {
    last = await locateControlByVision(page, driver, manifest, action);
    if (last.healed) {
      return last;
    }
    await page.waitForTimeout(400);
  }
  return last;
}

/** Resolve once /bet and /buy have been silent for `quietMs` (or `overallMs` elapses). */

export async function waitForBetQuiet(page: Page, quietMs: number, overallMs = 8_000): Promise<void> {
  const deadline = Date.now() + overallMs;
  while (Date.now() < deadline) {
    const sawTraffic = await page
      .waitForResponse(
        (entry) =>
          entry.ok() &&
          (matchesBetUrl(entry.url()) || matchesBuyUrl(entry.url())),
        { timeout: quietMs },
      )
      .then(() => true)
      .catch(() => false);
    if (!sawTraffic) {
      return;
    }
  }
}

/**
 * Advance free-spin / win overlays so the idle spin circle can redraw.
 * Only called when vision already failed to find idle spin — never on a live HUD
 * (enter/acknowledge on Package 1 idle sit on Buy Feature).
 */

async function advanceFeatureOrWinOverlay(
  page: Page,
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
  last?: HealOutcome,
  allowEnterFallback = false,
): Promise<void> {
  let dismissed = false;
  if (last?.blockerCenter !== undefined) {
    await driver
      .clickCanvasAt(last.blockerCenter, {
        timeoutMs: 6_000,
        singleInput: true,
        label: 'dialogConfirm',
        strategy: 'vision',
      })
      .catch(() => undefined);
    console.log(
      `[sgap-heal] idle: tapped dialogue at ` +
        `${last.blockerCenter.x.toFixed(3)},${last.blockerCenter.y.toFixed(3)}`,
    );
    dismissed = true;
  } else {
    const dialog = await dismissDialogConfirm(page, driver, manifest);
    if (dialog.healed) {
      console.log(`[sgap-heal] idle: ${dialog.detail}`);
      dismissed = true;
    }
  }
  const splash = await dismissSplashPlay(page, driver, manifest);
  if (splash.healed) {
    console.log(`[sgap-heal] idle: ${splash.detail}`);
    dismissed = true;
  }
  const win = await dismissWinBanner(page, driver, manifest);
  if (win.healed) {
    console.log(`[sgap-heal] idle: ${win.detail}`);
    dismissed = true;
  }
  // Sugar attract ("Win up to …x") Play sits ~y=0.82 — outside the splash band
  // (kept ≤0.76 so idle never taps the pink BUY pill). Fall back to enter once
  // per waitForIdleHud — spam enter every 1.5s burns the budget and hits HUD.
  if (!dismissed && allowEnterFallback) {
    const enter =
      manifest.canvasActions?.actions.enter ?? { x: 0.5, y: 0.82 };
    await driver
      .clickCanvasAt(enter, {
        timeoutMs: 5_000,
        singleInput: false,
        label: 'enter',
        fallback: true,
        detail: 'no overlay blob found — enter fallback',
      })
      .catch(() => undefined);
    console.log(
      `[sgap-heal] idle: tapped enter at ${enter.x.toFixed(3)},${enter.y.toFixed(3)} (no overlay blob)`,
    );
  } else if (dismissed) {
    // Only spray skip/errorOk when a real overlay blob was seen — on idle HUD
    // those points can land on Buy Feature / mid-panel.
    await driver.clickCanvas('skip', { timeoutMs: 4_000, singleInput: true }).catch(() => undefined);
    await driver
      .clickCanvas('errorOk', { timeoutMs: 4_000, singleInput: true })
      .catch(() => undefined);
  }
  // Let a mid-round /bet finish so a shrinking spin blob is not mistaken forever.
  await waitForBetQuiet(page, 800, 3_000);
}

/** Pink BUY pill in the base HUD band — proves idle even when spin green is clipped. */
async function findPinkBuyHud(
  driver: PlaywrightGameDriver,
): Promise<boolean> {
  const capture = await driver.captureCanvasForVision();
  if (capture === undefined) {
    return false;
  }
  return (
    findControlInPng(capture.png, {
      id: 'buyHud',
      hue: 'pink',
      // Tight HUD band only — Rules paytable pink hearts sit mid-screen
      // and must not count as the BUY pill (AT-008 false idle).
      band: { y0: 0.74, y1: 0.81, x0: 0.38, x1: 0.62 },
      minAreaRatio: 0.003,
      maxAreaRatio: 0.025,
    }) !== undefined
  );
}

/**
 * Accept idle via Phaser when colour vision misses the green spin circle.
 * Requires a second HUD signal (vision spin, pink BUY, or Phaser amplify)
 * so a menu/settings overlay that still lists a spin Image is not treated as idle.
 */
async function tryAcceptPhaserIdle(
  page: Page,
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
): Promise<HealOutcome | undefined> {
  const phaser = await locateControlByPhaser(page, manifest, driver.iframeSelector, 'spin', {
    remember: false,
  });
  if (!phaser.found || phaser.hit === undefined) {
    return undefined;
  }

  const verify = await locateControlByVision(page, driver, manifest, 'spin', {
    remember: true,
  });
  if (verify.healed) {
    countHeal('phaser');
    console.log(`[sgap-heal] spin runtime/phaser+vision: ${phaser.detail}`);
    return { ...verify, stage: 'phaser', detail: `${phaser.detail}; ${verify.detail}` };
  }

  if (await findPinkBuyHud(driver)) {
    rememberHealedRatio(
      manifest.gameId,
      'spin',
      { x: phaser.hit.xRatio, y: phaser.hit.yRatio },
      'phaser',
    );
    countHeal('phaser');
    console.log(
      `[sgap-heal] spin runtime/phaser+buyHUD: ${phaser.detail} (pink BUY visible, spin green clipped)`,
    );
    return {
      stage: 'phaser',
      healed: true,
      detail: `${phaser.detail}; buyHUD visible`,
    };
  }

  // Second Phaser HUD control (amplify coins) — present on base idle, absent under
  // most full-screen overlays. Avoids enter@0.82 when green spin is only clipped.
  const amplify = await locateControlByPhaser(
    page,
    manifest,
    driver.iframeSelector,
    'amplifyBet',
    { remember: false },
  );
  if (amplify.found) {
    rememberHealedRatio(
      manifest.gameId,
      'spin',
      { x: phaser.hit.xRatio, y: phaser.hit.yRatio },
      'phaser',
    );
    countHeal('phaser');
    console.log(
      `[sgap-heal] spin runtime/phaser+amplifyHUD: ${phaser.detail}; ${amplify.detail}`,
    );
    return {
      stage: 'phaser',
      healed: true,
      detail: `${phaser.detail}; amplifyHUD visible`,
    };
  }

  return undefined;
}

/**
 * A feature round still playing out swallows spin taps even when the spin circle
 * looks idle. Wait for the game to report it complete; the budget is separate from
 * the caller's idle timeout because progress is observable, not guessed.
 */
async function waitForOpenRound(page: Page): Promise<void> {
  const tracker = roundTrackerFor(page);
  const open = tracker?.open();
  if (tracker === undefined || open === undefined) {
    return;
  }
  const observe = observationFor(page);
  observe?.event('round-wait', `waiting for the game to finish its round (${describeRound(open)})`);
  const result = await tracker.waitForResolved();
  const seconds = (result.waitedMs / 1000).toFixed(1);
  const detail =
    result.outcome === 'resolved'
      ? `round complete after ${seconds}s`
      : `round still open after ${seconds}s (${result.outcome}; ${result.round === undefined ? '' : describeRound(result.round)})`;
  console.log(`[sgap-heal] round: ${detail}`);
  observe?.event('round-wait', detail, { severity: result.outcome === 'resolved' ? 'info' : 'warn' });
}

/**
 * One accurate HUD is ready: idle spin circle visible. Taps splash/win once
 * only when those blobs are actually on screen — no grid spray.
 * When spin stays missing (mid free-spin / win banner), advances overlays until
 * the idle circle returns or the budget expires.
 */

export async function waitForIdleHud(
  page: Page,
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
  timeoutMs = 8_000,
): Promise<HealOutcome> {
  await waitForOpenRound(page);
  const deadline = Date.now() + timeoutMs;
  // Already idle — do not tap splashPlay (y≈0.77 lands on Sugar's pink BUY pill).
  const alreadyIdle = await locateControlByVision(page, driver, manifest, 'spin');
  if (alreadyIdle.healed) {
    return alreadyIdle;
  }

  // Session Continue / press-anywhere after buy-feature or reload — must clear
  // before Phaser/splash heuristics, or spin stays covered forever.
  const blockers = await clearCanvasBlockers(page, driver, manifest, 3, { cancelBuyPanel: true });
  if (blockers.hadSessionContinue) {
    // Continue resumes leftover free spins — idle spin only returns after drain.
    console.log('[sgap-heal] session-continue: draining leftover free spins');
    await drainLeftoverFeatureSpins(page, driver, manifest, 12);
    // The resumed round only reports progress after Continue, and the spin circle
    // looks idle between free spins — so the round wait at the top saw nothing.
    await waitForOpenRound(page);
  }
  const afterBlocker = await locateControlByVision(page, driver, manifest, 'spin');
  if (afterBlocker.healed) {
    return afterBlocker;
  }

  // Phaser+HUD before splash/enter — parallel runs often clip green spin while
  // BUY/amplify stay visible; enter@0.82 then burns the budget with no /bet.
  const earlyPhaser = await tryAcceptPhaserIdle(page, driver, manifest);
  if (earlyPhaser !== undefined) {
    return earlyPhaser;
  }

  // Prefer mid-screen YES (y≈0.58) over splash Play (y≈0.77) — false splash
  // taps leave the dialogue up and spin stays covered.
  const dialog = await dismissDialogConfirm(page, driver, manifest);
  if (dialog.healed) {
    console.log(`[sgap-heal] dialog: ${dialog.detail}`);
  }
  // Re-check before splash — dialog dismiss may have revealed idle spin.
  const afterDialog = await locateControlByVision(page, driver, manifest, 'spin');
  if (afterDialog.healed) {
    return afterDialog;
  }
  const splash = await dismissSplashPlay(page, driver, manifest);
  if (splash.healed) {
    console.log(`[sgap-heal] splash: ${splash.detail}`);
  }
  const win = await dismissWinBanner(page, driver, manifest);
  if (win.healed) {
    console.log(`[sgap-heal] winBanner: ${win.detail}`);
  }
  forgetHealedRatio(manifest.gameId, 'spin');
  let last: HealOutcome = {
    stage: 'vision',
    healed: false,
    detail: 'timed out waiting for spin',
  };
  let nextAdvanceAt = Date.now() + 1_500;
  // Blind enter@0.82 is last resort (attract Play). Cap hard — spam hits BUY /
  // autoplay and is the dominant 4-worker "spin not visible" cause.
  let enterFallbackCount = 0;
  const maxEnterNoBlocker = 1;
  const maxEnterWithBlocker = 2;

  while (Date.now() < deadline) {
    last = await locateControlByVision(page, driver, manifest, 'spin');
    if (last.healed) {
      return last;
    }

    // Re-probe blockers each cycle — Continue can appear mid-wait after a buy.
    const blocker = await detectCanvasBlocker(driver);
    if (isDismissableBlocker(blocker.kind) || blocker.kind === 'buy-confirm') {
      const cleared = await clearCanvasBlockers(page, driver, manifest, 1, { cancelBuyPanel: true });
      if (cleared.hadSessionContinue) {
        console.log('[sgap-heal] session-continue (loop): draining leftover free spins');
        await drainLeftoverFeatureSpins(page, driver, manifest, 12);
      }
      await page.waitForTimeout(400);
      continue;
    }

    // Mid-screen YES (y≈0.58) covers the HUD — Phaser may still list the spin
    // Image underneath; do not treat that as idle until the dialogue is gone.
    if (last.blockerCenter !== undefined) {
      if (Date.now() >= nextAdvanceAt) {
        nextAdvanceAt = Date.now() + 1_500;
        const allowEnter = enterFallbackCount < maxEnterWithBlocker;
        await advanceFeatureOrWinOverlay(page, driver, manifest, last, allowEnter);
        if (allowEnter) {
          enterFallbackCount += 1;
        }
      }
      await page.waitForTimeout(400);
      continue;
    }

    const accepted = await tryAcceptPhaserIdle(page, driver, manifest);
    if (accepted !== undefined) {
      return accepted;
    }

    // Phaser listed spin but no second HUD signal ⇒ overlay/splash. Escape only —
    // never enter on this cycle (enter@0.82 on idle/clipped HUD is a false heal).
    const phaserProbe = await locateControlByPhaser(
      page,
      manifest,
      driver.iframeSelector,
      'spin',
      { remember: false },
    );
    let skipEnter = false;
    if (phaserProbe.found) {
      await page.keyboard.press('Escape').catch(() => undefined);
      console.log(
        `[sgap-heal] spin runtime/phaser-covered: ${phaserProbe.detail} — Escape, no enter`,
      );
      skipEnter = true;
    }

    if (Date.now() >= nextAdvanceAt) {
      nextAdvanceAt = Date.now() + 1_500;
      const allowEnter =
        !skipEnter && enterFallbackCount < maxEnterNoBlocker;
      await advanceFeatureOrWinOverlay(page, driver, manifest, last, allowEnter);
      if (allowEnter) {
        enterFallbackCount += 1;
      }
    }
    await page.waitForTimeout(400);
  }
  return last;
}

/**
 * Tap a colour blob if it matches `signature`. Does not fall back to manifest
 * points — those can fire HUD spin or miss entirely.
 */

async function tapSignature(
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
  signature: ControlSignature,
  label: string,
): Promise<HealOutcome> {
  return tapDetected(driver, manifest, label, (png) => findControlInPng(png, signature));
}

async function tapDetected(
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
  label: string,
  find: (png: Buffer) => DetectedControl | undefined,
): Promise<HealOutcome> {
  const page = driver.getPage();
  const orientation = await readOrientation(page, manifest);
  if (isBlockedByRotation(orientation)) {
    return {
      stage: 'vision',
      healed: false,
      detail: `skipped ${label} — game is ${describeOrientation(orientation)}`,
    };
  }
  const capture = await driver.captureCanvasForVision();
  if (capture === undefined) {
    return { stage: 'vision', healed: false, detail: `no canvas for ${label}` };
  }
  const found = find(capture.png);
  if (found === undefined) {
    return { stage: 'vision', healed: false, detail: `no ${label} blob` };
  }
  const target = capture.toActionRatio(found.center);
  await driver
    .clickCanvasAt(target, { timeoutMs: 8_000, singleInput: true, label, strategy: 'vision' })
    .catch(() => undefined);
  countHeal('vision');
  return {
    stage: 'vision',
    healed: true,
    detail:
      `tapped ${label} at ${target.x.toFixed(3)},${target.y.toFixed(3)} ` +
      `area=${(found.areaRatio * 100).toFixed(2)}%`,
  };
}

/**
 * Mid-screen dialogue YES / OK (Sugar buy confirm & win continue often y≈0.58).
 * Call before splashPlay — splash band false-positives leave this modal up.
 */

export async function dismissDialogConfirm(
  _page: Page,
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
): Promise<HealOutcome> {
  const dialog = signatureFor(driver, 'sessionContinue');
  if (dialog === undefined) {
    return { stage: 'vision', healed: false, detail: 'no dialogConfirm signature in profile' };
  }
  return tapSignature(driver, manifest, dialog, 'dialogConfirm');
}

/**
 * Splash / attract Play is a large green fill around y=0.77 — not the HUD spin
 * circle. Clicking HUD spin coords on that screen never sends /bet.
 * Skips when a larger mid-screen dialogue is present (prefer dismissDialogConfirm).
 */

export async function dismissSplashPlay(
  _page: Page,
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
): Promise<HealOutcome> {
  const findSplashPlay = findSplashPlayIn(driver);
  const capture = await driver.captureCanvasForVision().catch(() => undefined);
  if (capture !== undefined) {
    const buyConfirmSig = signatureFor(driver, 'buyFeatureConfirm');
    if (buyConfirmSig !== undefined) {
      const buyConfirm = findControlInPng(capture.png, buyConfirmSig);
      if (isBuyConfirmPill(buyConfirm, driver.surface)) {
        return {
          stage: 'vision',
          healed: false,
          detail: 'skipped splashPlay — BUY FEATURE confirm present',
        };
      }
    }
    const dialog = findSessionContinueInPng(capture.png, driver.surface);
    const splash = findSplashPlay(capture.png);
    if (
      dialog !== undefined &&
      (splash === undefined || dialog.areaRatio >= splash.areaRatio)
    ) {
      return {
        stage: 'vision',
        healed: false,
        detail: 'skipped splashPlay — mid-screen dialogue present',
      };
    }
  }
  return tapDetected(driver, manifest, 'splashPlay', findSplashPlay);
}

/** Click the win continue / continue fill so the idle spin circle can redraw. */

export async function dismissWinBanner(
  _page: Page,
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
): Promise<HealOutcome> {
  const capture = await driver.captureCanvasForVision().catch(() => undefined);
  if (capture !== undefined) {
    const buyConfirmSig = signatureFor(driver, 'buyFeatureConfirm');
    if (buyConfirmSig !== undefined) {
      const buyConfirm = findControlInPng(capture.png, buyConfirmSig);
      if (buyConfirm !== undefined) {
        return {
          stage: 'vision',
          healed: false,
          detail: 'skipped winBanner — BUY FEATURE confirm present',
        };
      }
    }
  }
  const banner = signatureFor(driver, 'winBanner');
  if (banner === undefined) {
    return { stage: 'vision', healed: false, detail: 'no winBanner signature in profile' };
  }
  return tapSignature(driver, manifest, banner, 'winBanner');
}

/**
 * Locate then tap once. Use only while /bet waiters are armed.
 */

export async function healByVision(
  page: Page,
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
  action: string,
): Promise<HealOutcome> {
  const located = await locateControlByVision(page, driver, manifest, action, {
    remember: true,
  });
  if (!located.healed) {
    return located;
  }
  const target = recallHealedRatio(manifest.gameId, action);
  if (target !== undefined) {
    await driver
      .clickCanvasAt(target, {
        timeoutMs: 8_000,
        singleInput: true,
        label: action,
        strategy: target.source,
        fallback: true,
        detail: located.detail,
      })
      .catch(() => undefined);
  }
  return { ...located, detail: located.detail.replace('located ', 'tapped ') };
}

export {
  detectCanvasBlocker,
  clearCanvasBlockers,
  type CanvasBlocker,
  type CanvasBlockerKind,
} from '../../src/eye/canvas-blocker.js';
import { matchesBetUrl, matchesBuyUrl } from '../../src/network/bet-url.js';
