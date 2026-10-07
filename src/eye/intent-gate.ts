/**
 * Pre-click screen gate. Screenshots / host text name the screen only.
 * They never mark a test passed — the caller still waits on /bet or initialize.
 *
 * Unknown canvas (classified as idle because nothing matched) is allowed through:
 * Package 1 idle has no reliable golden. A *confident* blocker that is not ready
 * for the intent fails the click instead of tapping spin on a buy panel.
 */

import { loadEyeCatalog } from './catalog.js';
import { visionSignature } from '../surfaces/load-surface-profile.js';
import { findControlInPng, findIdleSpinInPng } from './canvas-vision.js';
import {
  clearInterferingScreens,
  isReadyForIntent,
  type ClearInterferingScreensOptions,
} from './eye.js';
import type { EyeIntent, EyeObservation } from './types.js';
import { listPhaserInteractive, pickPhaserControl } from '../runtime/phaser-locate.js';

export class IntentNotReadyError extends Error {
  readonly observation: EyeObservation;
  readonly intent: EyeIntent;

  constructor(observation: EyeObservation, intent: EyeIntent) {
    super(
      `Cannot click for ${intent}: screen is ${observation.screenId} via=${observation.via}` +
        `${observation.score !== undefined ? ` score=${observation.score.toFixed(2)}` : ''}` +
        ' — recover failed; not treating a screenshot as a pass',
    );
    this.name = 'IntentNotReadyError';
    this.observation = observation;
    this.intent = intent;
  }
}

export function observationAllowsIntent(
  observation: EyeObservation,
  intent: EyeIntent,
): boolean {
  const screen = loadEyeCatalog().screens.find((entry) => entry.id === observation.screenId);
  if (screen === undefined) {
    return observation.via === 'idle';
  }
  return isReadyForIntent(screen, intent);
}

/**
 * Attract goldens can still match after Play (or false-positive on idle HUD).
 * If Phaser or vision sees an idle spin button, treat the screen as ready.
 */
async function showsIdleSpin(options: ClearInterferingScreensOptions): Promise<boolean> {
  try {
    const hits = await listPhaserInteractive(options.page, options.driver.iframeSelector);
    if (pickPhaserControl(hits, 'spin', options.driver.surface) !== undefined) {
      return true;
    }
  } catch {
    // fall through to vision
  }
  try {
    const capture = await options.driver.captureCanvasForVision();
    if (capture === undefined) {
      return false;
    }
    return findIdleSpinInPng(capture.png, options.driver.surface) !== undefined;
  } catch {
    return false;
  }
}

async function dismissAttractPlay(options: ClearInterferingScreensOptions): Promise<void> {
  await options.driver
    .clickCanvas('attractPlay', { timeoutMs: 8_000, singleInput: true })
    .catch(() => undefined);

  const capture = await options.driver.captureCanvasForVision().catch(() => undefined);
  const profile = options.driver.surface;
  const dialogSignature = visionSignature(profile, 'sessionContinue');
  const splashSignature = visionSignature(profile, 'attractSplashPlay');
  if (capture !== undefined && dialogSignature !== undefined) {
    const dialog = findControlInPng(capture.png, dialogSignature);
    const splash =
      splashSignature === undefined
        ? undefined
        : findControlInPng(capture.png, splashSignature);
    if (dialog !== undefined && (splash === undefined || dialog.areaRatio >= splash.areaRatio)) {
      const target = capture.toActionRatio(dialog.center);
      await options.driver
        .clickCanvasAt(target, { timeoutMs: 8_000, singleInput: true, label: 'dialogConfirm', strategy: 'vision' })
        .catch(() => undefined);
      console.log(
        `[sgap-heal] attract: tapped dialogConfirm at ${target.x.toFixed(3)},${target.y.toFixed(3)}`,
      );
    } else if (splash !== undefined) {
      const target = capture.toActionRatio(splash.center);
      await options.driver
        .clickCanvasAt(target, { timeoutMs: 8_000, singleInput: true, label: 'splashPlay', strategy: 'vision' })
        .catch(() => undefined);
      console.log(
        `[sgap-heal] attract: tapped splashPlay at ${target.x.toFixed(3)},${target.y.toFixed(3)}`,
      );
    }
  }

  await options.driver
    .clickCanvas('enter', { timeoutMs: 5_000, singleInput: true })
    .catch(() => undefined);
  await options.page.waitForTimeout(1_000);
}

/**
 * Recover blockers, then refuse the click when Eye still sees a named screen
 * that is not ready for `intent`.
 */
export async function gateCanvasIntent(
  options: ClearInterferingScreensOptions,
): Promise<EyeObservation> {
  const intent = options.intent ?? 'idle';
  const observation = await clearInterferingScreens({
    ...options,
    allowTemplates: options.allowTemplates ?? true,
  });

  if (observationAllowsIntent(observation, intent)) {
    return observation;
  }
  if (observation.via === 'idle') {
    return observation;
  }

  // Self-heal: attract template stuck / false positive while HUD spin is live.
  if (
    observation.screenId === 'attract' &&
    (intent === 'buyFeature' ||
      intent === 'spin' ||
      intent === 'bet' ||
      intent === 'autoplay' ||
      intent === 'idle')
  ) {
    if (await showsIdleSpin(options)) {
      console.log('[sgap-heal] attract: idle spin visible — treating as base-idle');
      return {
        screenId: 'base-idle',
        policy: 'leave',
        via: 'idle',
        handled: true,
      };
    }
    await dismissAttractPlay(options);
    if (await showsIdleSpin(options)) {
      console.log('[sgap-heal] attract: dismissed Play — idle spin ready');
      return {
        screenId: 'base-idle',
        policy: 'leave',
        via: 'idle',
        handled: true,
      };
    }
    // Second pass for slow splash → HUD transitions on staging.
    await dismissAttractPlay(options);
    if (await showsIdleSpin(options)) {
      console.log('[sgap-heal] attract: second dismiss — idle spin ready');
      return {
        screenId: 'base-idle',
        policy: 'leave',
        via: 'idle',
        handled: true,
      };
    }
  }

  throw new IntentNotReadyError(observation, intent);
}
