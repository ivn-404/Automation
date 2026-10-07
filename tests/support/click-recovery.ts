/**
 * After a canvas click did not produce the expected /bet (or equivalent):
 * screenshot the miss, recover blockers, locate the control once by vision.
 *
 * Does not spray nearby taps — those can fire a bet that a later waiter treats
 * as a pass. The caller re-arms waiters and clicks using the remembered ratio.
 *
 * Never uses closeOverlay (that closes Game Player).
 */

import { test } from '@playwright/test';
import type { Page } from 'playwright';

import type { GameManifest } from '../../src/core/models/index.js';
import type { PlaywrightGameDriver } from '../../src/driver/playwright-game-driver.js';
import { clearInterferingScreens, intentFromAction, isEyeEnabled } from '../../src/eye/index.js';
import { debugCapturePath, savePng } from '../../src/eye/store.js';
import type { PlaywrightPlatform } from '../../src/platform/playwright-platform.js';
import { createGameRuntime } from '../../src/runtime/index.js';
import { recallHealedRatio } from '../../src/eye/learned-ratios.js';
import { ensurePortrait, locateControlByVision } from './canvas-healing.js';
import { betTrafficFor, reportCanvasFailure } from './failure-report.js';

async function attachSafe(name: string, body: Buffer, contentType: string): Promise<void> {
  try {
    await test.info().attach(name, { body, contentType });
  } catch {
    // Not inside a Playwright test (calibration / scripts).
  }
}

export async function captureBrokenClick(
  page: Page,
  label: string,
  pageX: number,
  pageY: number,
  detail: string,
): Promise<void> {
  await page
    .evaluate(
      ({ x, y, text }) => {
        document.getElementById('sgap-broken-click')?.remove();
        const root = document.createElement('div');
        root.id = 'sgap-broken-click';
        root.setAttribute('aria-hidden', 'true');
        root.style.cssText =
          'position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
        const ring = document.createElement('div');
        ring.style.cssText = [
          'position:absolute',
          `left:${Math.round(x)}px`,
          `top:${Math.round(y)}px`,
          'width:36px',
          'height:36px',
          'margin-left:-18px',
          'margin-top:-18px',
          'border:3px solid #ff1744',
          'border-radius:50%',
          'background:rgba(255,23,68,0.25)',
          'box-shadow:0 0 0 2px #fff',
        ].join(';');
        const caption = document.createElement('div');
        caption.textContent = text;
        caption.style.cssText = [
          'position:absolute',
          `left:${Math.round(x) + 22}px`,
          `top:${Math.round(y) - 10}px`,
          'max-width:280px',
          'padding:4px 8px',
          'background:#111',
          'color:#fff',
          'font:12px/1.3 ui-monospace,monospace',
          'border:1px solid #ff1744',
        ].join(';');
        root.append(ring, caption);
        document.documentElement.appendChild(root);
      },
      { x: pageX, y: pageY, text: `${label} miss` },
    )
    .catch(() => undefined);

  const screenshot = await page.screenshot({ type: 'png' }).catch(() => undefined);
  if (screenshot !== undefined) {
    await attachSafe(`broken-click-${label}.png`, screenshot, 'image/png');
    savePng(debugCapturePath('miss', label), screenshot);
  }
  await attachSafe(`broken-click-${label}.txt`, Buffer.from(detail, 'utf8'), 'text/plain');

  await page
    .evaluate(() => {
      document.getElementById('sgap-broken-click')?.remove();
    })
    .catch(() => undefined);
}

/**
 * Diagnose a miss, dismiss named blockers, locate the control for the next armed click.
 */
export async function recoverMissedCanvasClick(
  page: Page,
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
  actionName: string,
  error: unknown,
  platform?: PlaywrightPlatform,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const hit = driver.lastCanvasHit;
  const ratioNote =
    hit === undefined ? 'no last canvas hit' : `ratio=${hit.ratio.x.toFixed(3)},${hit.ratio.y.toFixed(3)}`;
  const detail = `${actionName} did not complete\n${ratioNote}\n${message}`;

  const orientationHeal = await ensurePortrait(page, manifest, driver.iframeSelector);
  if (orientationHeal.stage === 'orientation' && orientationHeal.healed) {
    console.log(`[sgap-heal] ${actionName}: ${orientationHeal.detail}`);
    return;
  }

  await reportCanvasFailure({
    page,
    manifest,
    action: actionName,
    error,
    hit,
    driver,
    traffic: betTrafficFor(page),
  });

  if (hit !== undefined) {
    await captureBrokenClick(page, actionName, hit.pageX, hit.pageY, detail);
  } else {
    const screenshot = await page.screenshot({ type: 'png' }).catch(() => undefined);
    if (screenshot !== undefined) {
      await attachSafe(`broken-click-${actionName}-viewport.png`, screenshot, 'image/png');
      savePng(debugCapturePath('miss', actionName), screenshot);
    }
    await attachSafe(`broken-click-${actionName}.txt`, Buffer.from(detail, 'utf8'), 'text/plain');
  }

  if (isEyeEnabled()) {
    const observation = await clearInterferingScreens({
      page,
      driver,
      manifest,
      platform,
      intent: intentFromAction(actionName),
      allowTemplates: true,
    });
    console.log(
      `[sgap-eye] miss action=${actionName} ${ratioNote} → ${observation.screenId} via=${observation.via} handled=${observation.handled}`,
    );
  }

  const runtime = createGameRuntime({
    page,
    driver,
    manifest,
    visionLocate: async (action, locateOptions) => {
      const vision = await locateControlByVision(page, driver, manifest, action, locateOptions);
      const ratio =
        locateOptions?.remember === true
          ? recallHealedRatio(manifest.gameId, action)
          : undefined;
      return {
        healed: vision.healed,
        detail: vision.detail,
        ...(ratio !== undefined ? { ratio } : {}),
      };
    },
  });

  const located = await runtime.locate(actionName, {
    remember: true,
    allowManifest: false,
  });
  console.log(`[sgap-heal] ${actionName} runtime/${located.source}: ${located.detail}`);
}
