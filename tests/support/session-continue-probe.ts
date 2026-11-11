/**
 * Classify the leftover Continue modal vs splash / loading that sit in front of it.
 *
 * Fruit Attack (and other DiJoker titles) reload through paint → splash Play →
 * then either idle HUD or "ongoing free spin … Continue". A mid-screen green splat
 * on the paint used to win as session-continue; splash Play was missed because it
 * sits on a bright attract screen. Always dump a still of the scene we classified.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Page, TestInfo } from '@playwright/test';

import type { GameManifest } from '../../src/core/models/index.js';
import type { PlaywrightGameDriver } from '../../src/driver/playwright-game-driver.js';
import { clickDialogButton, detectCanvasBlocker, dismissCanvasBlocker } from '../../src/eye/index.js';
import { matchesBetUrl } from '../../src/network/bet-url.js';
import { listPhaserTexts, type PhaserTextHit } from '../../src/runtime/index.js';

export const ONGOING_FS_TEXT =
  /ongoing (free )?spin|ongoing (bonus|hold)|unfinished round|you have an ongoing|from the last session|continue this round/iu;
const GAME_ERROR_TEXT =
  /something went wrong|an error occurred|try again|request failed|internal error|failed to/iu;
const CONTINUE_BUTTON = /^(CONTINUE|RESUME)$/iu;
const HUD_IDLE_TEXT = /^(Turbo|Autoplay|Menu|BALANCE|BET)$/u;
const ATTRACT_TEXT = /win up to|play loud|tap to (play|start)|press play/iu;

export type ContinueProbeSource = 'leftover-launch' | 'reload-mid-feature';
export type ContinueProbeVerdict = 'game-ok' | 'game-error' | 'automation' | 'no-dialog';
export type CanvasSceneKind = 'loading' | 'splash' | 'continue' | 'idle' | 'press-anywhere' | 'unknown';

export interface ContinueProbeResult {
  readonly verdict: ContinueProbeVerdict;
  readonly source: ContinueProbeSource;
  readonly detail: string;
  readonly texts: readonly string[];
}

export interface CanvasScene {
  readonly kind: CanvasSceneKind;
  readonly blocker?: string;
  readonly texts: readonly string[];
  readonly detail: string;
}

function labels(hits: readonly PhaserTextHit[]): string[] {
  return hits
    .map((hit) => hit.text.trim())
    .filter((text) => text.length > 0 && text.length < 80)
    .slice(0, 40);
}

async function readTexts(page: Page, driver: PlaywrightGameDriver): Promise<readonly PhaserTextHit[]> {
  return listPhaserTexts(page, driver.iframeSelector).catch(() => []);
}

export async function readCanvasScene(
  page: Page,
  driver: PlaywrightGameDriver,
): Promise<CanvasScene> {
  const texts = await readTexts(page, driver);
  const named = labels(texts);
  const blocker = await detectCanvasBlocker(driver).catch(() => undefined);
  const joined = named.join(' | ');

  if (
    blocker?.kind === 'session-continue' ||
    texts.some((hit) => ONGOING_FS_TEXT.test(hit.text) || CONTINUE_BUTTON.test(hit.text.trim()))
  ) {
    return {
      kind: 'continue',
      blocker: blocker?.kind,
      texts: named,
      detail: blocker?.detail ?? `Phaser Continue — ${joined}`,
    };
  }
  if (blocker?.kind === 'splash-play') {
    return {
      kind: 'splash',
      blocker: blocker.kind,
      texts: named,
      detail: blocker.detail,
    };
  }
  if (blocker?.kind === 'press-anywhere') {
    return {
      kind: 'press-anywhere',
      blocker: blocker.kind,
      texts: named,
      detail: blocker.detail,
    };
  }
  if (named.some((text) => HUD_IDLE_TEXT.test(text))) {
    return {
      kind: 'idle',
      blocker: blocker?.kind ?? 'none',
      texts: named,
      detail: `idle HUD — ${joined}`,
    };
  }
  if (ATTRACT_TEXT.test(joined) || named.length <= 8) {
    return {
      kind: 'loading',
      blocker: blocker?.kind ?? 'none',
      texts: named,
      detail: `loading/attract — ${joined}`,
    };
  }
  return {
    kind: 'unknown',
    blocker: blocker?.kind ?? 'none',
    texts: named,
    detail: `unclassified — ${joined}`,
  };
}

async function dumpStill(
  caseId: string,
  source: ContinueProbeSource | 'hunt',
  tag: string,
  driver: PlaywrightGameDriver,
  testInfo: TestInfo,
): Promise<void> {
  const still = await driver
    .gameCanvas()
    .screenshot({ type: 'jpeg', quality: 70 })
    .catch(() => undefined);
  if (still === undefined) {
    return;
  }
  await testInfo.attach(`${source}-${tag}.jpg`, { body: still, contentType: 'image/jpeg' });
  const dir = path.join(process.cwd(), 'test-results', 'capture-hunt', 'modals');
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  await writeFile(path.join(dir, `${caseId}-${source}-${tag}-${stamp}.jpg`), still);
}

async function dismissSplashOrPrompt(
  page: Page,
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
): Promise<void> {
  const blocker = await detectCanvasBlocker(driver).catch(() => undefined);
  if (blocker?.kind === 'splash-play' && blocker.center !== undefined) {
    await driver
      .clickCanvasAt(blocker.center, {
        timeoutMs: 8_000,
        singleInput: true,
        label: 'splash-play',
        strategy: 'phaser',
        detail: blocker.detail,
      })
      .catch(() => undefined);
    return;
  }
  if (blocker !== undefined && (blocker.kind === 'press-anywhere' || blocker.kind === 'session-continue')) {
    await dismissCanvasBlocker(driver, manifest, blocker).catch(() => undefined);
  }
}

/** Wait through paint/splash. Return once idle, Continue, or the budget expires. */
export async function healInterferingScene(options: {
  readonly caseId: string;
  readonly page: Page;
  readonly driver: PlaywrightGameDriver;
  readonly testInfo: TestInfo;
  readonly manifest: GameManifest;
  readonly source?: ContinueProbeSource | 'hunt';
  readonly waitMs?: number;
}): Promise<CanvasScene> {
  const { caseId, page, driver, testInfo, manifest } = options;
  const source = options.source ?? 'hunt';
  const waitUntil = Date.now() + (options.waitMs ?? 20_000);
  let scene = await readCanvasScene(page, driver);
  let lastKind = scene.kind;

  while (Date.now() < waitUntil) {
    if (scene.kind !== lastKind) {
      console.log(
        `[${caseId}] canvas scene=${scene.kind} blocker=${scene.blocker ?? 'none'} ${scene.detail}`,
      );
      await dumpStill(caseId, source, `scene-${scene.kind}`, driver, testInfo);
      lastKind = scene.kind;
    }
    if (scene.kind === 'idle' || scene.kind === 'continue') {
      return scene;
    }
    if (scene.kind === 'splash' || scene.kind === 'press-anywhere') {
      await dismissSplashOrPrompt(page, driver, manifest);
    }
    await page.waitForTimeout(400);
    scene = await readCanvasScene(page, driver);
  }

  console.log(
    `[${caseId}] canvas scene still ${scene.kind} after wait blocker=${scene.blocker ?? 'none'} ${scene.detail}`,
  );
  await dumpStill(caseId, source, `stuck-${scene.kind}`, driver, testInfo);
  return scene;
}

/** Same stack other games use: Phaser CONTINUE → green vision pill → acknowledge. */
async function dismissContinueModal(
  driver: PlaywrightGameDriver,
  manifest: GameManifest,
): Promise<string | undefined> {
  const phaser = await clickDialogButton(driver, CONTINUE_BUTTON, 'session-continue');
  if (phaser !== undefined) {
    return `phaser:${phaser}`;
  }
  const blocker = await detectCanvasBlocker(driver).catch(() => undefined);
  if (blocker?.kind === 'session-continue') {
    const dismissed = await dismissCanvasBlocker(driver, manifest, blocker);
    if (dismissed.dismissed) {
      return `vision:${dismissed.detail}`;
    }
  }
  if (manifest.canvasActions?.actions.acknowledge !== undefined) {
    await driver.clickCanvas('acknowledge', { timeoutMs: 5_000, singleInput: true }).catch(() => undefined);
    return 'acknowledge';
  }
  return undefined;
}

export async function probeOngoingFreeSpinContinue(options: {
  readonly caseId: string;
  readonly page: Page;
  readonly driver: PlaywrightGameDriver;
  readonly testInfo: TestInfo;
  readonly source: ContinueProbeSource;
  readonly manifest: GameManifest;
}): Promise<ContinueProbeResult> {
  const { caseId, page, driver, testInfo, source, manifest } = options;
  const waitMs = source === 'reload-mid-feature' ? 50_000 : 12_000;
  const scene = await healInterferingScene({
    caseId,
    page,
    driver,
    testInfo,
    manifest,
    source,
    waitMs,
  });

  if (scene.kind !== 'continue') {
    const result: ContinueProbeResult = {
      verdict: 'no-dialog',
      source,
      detail: `no ongoing-FS Continue dialog (${source}) scene=${scene.kind} blocker=${scene.blocker ?? 'none'} texts=${scene.texts.join(' | ')}`,
      texts: scene.texts,
    };
    console.log(`[${caseId}] ${result.detail}`);
    return result;
  }

  await dumpStill(caseId, source, 'before-continue', driver, testInfo);
  const clicked = await dismissContinueModal(driver, manifest);
  console.log(
    `[${caseId}] GAME-PATH clicked Continue via=${clicked ?? 'missed'} source=${source} scene=${scene.kind} ${scene.detail}`,
  );

  const bet = page
    .waitForResponse((response) => matchesBetUrl(response.url()), { timeout: 20_000 })
    .catch(() => undefined);

  const deadline = Date.now() + 20_000;
  let errorLabel: string | undefined;
  while (Date.now() < deadline && errorLabel === undefined) {
    const now = await readTexts(page, driver);
    errorLabel = now.find((hit) => GAME_ERROR_TEXT.test(hit.text))?.text.trim();
    if (errorLabel !== undefined) {
      break;
    }
    await page.waitForTimeout(400);
  }
  const response = await bet;

  const after = labels(await readTexts(page, driver));
  await dumpStill(caseId, source, 'after-continue', driver, testInfo);
  const afterScene = await readCanvasScene(page, driver);

  if (errorLabel !== undefined) {
    const result: ContinueProbeResult = {
      verdict: 'game-error',
      source,
      detail: `GAME: error after Continue — "${errorLabel}"`,
      texts: after,
    };
    testInfo.annotations.push({ type: 'gameDefect', description: result.detail });
    console.log(`[${caseId}] ${result.detail}`);
    return result;
  }

  if (response !== undefined && !response.ok()) {
    const result: ContinueProbeResult = {
      verdict: 'game-error',
      source,
      detail: `GAME: Continue /bet HTTP ${response.status()}`,
      texts: after,
    };
    testInfo.annotations.push({ type: 'gameDefect', description: result.detail });
    console.log(`[${caseId}] ${result.detail}`);
    return result;
  }

  if (response !== undefined && response.ok()) {
    const result: ContinueProbeResult = {
      verdict: 'game-ok',
      source,
      detail: `GAME: Continue resumed with /bet ${response.status()} via=${clicked ?? 'unknown'}`,
      texts: after,
    };
    console.log(`[${caseId}] ${result.detail}`);
    return result;
  }

  if (clicked === undefined) {
    const result: ContinueProbeResult = {
      verdict: 'automation',
      source,
      detail: 'AUTOMATION: Continue modal was on screen but the tap missed',
      texts: after,
    };
    console.log(`[${caseId}] ${result.detail}`);
    return result;
  }

  if (afterScene.kind === 'continue') {
    const result: ContinueProbeResult = {
      verdict: 'automation',
      source,
      detail: 'AUTOMATION: Continue tap did not dismiss the ongoing-FS modal',
      texts: after,
    };
    console.log(`[${caseId}] ${result.detail}`);
    return result;
  }

  const result: ContinueProbeResult = {
    verdict: 'game-error',
    source,
    detail:
      'GAME: Continue dismissed the ongoing-FS modal but free spins did not resume (no /bet, no error banner)',
    texts: after,
  };
  testInfo.annotations.push({ type: 'gameDefect', description: result.detail });
  console.log(`[${caseId}] ${result.detail}`);
  return result;
}
