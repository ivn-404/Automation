/**
 * Shared CAPTURE hunt — one function, unique spec files per worker so lane
 * assignment stays unique (same game cannot share the same testMatch).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Page, Response, TestInfo } from '@playwright/test';
import { expect } from '../fixtures/index.js';
import type { SgapSession } from '../fixtures/index.js';
import type { PlaywrightGameDriver } from '../../src/driver/playwright-game-driver.js';
import { settleCanvasToBaseGame } from '../../src/platform/index.js';
import { getByPath } from '../../src/shared/json-path.js';
import { matchesBetUrl } from '../../src/network/bet-url.js';
import { redactText } from '../../src/observability/redact.js';
import { CaptureReel } from './capture-reel.js';
import { captureDir, huntComplete, markScenarioCaptured } from './capture-hunt-board.js';
import { describeSlotFlags, ScenarioWatcher, type HuntScenarioId } from './scenario-watch.js';
import { prepareAutoplayCanvas, stopAutoplayQuietly } from './autoplay-flow.js';
import { reloadAndReopenGame } from './game-reload.js';
import {
  healInterferingScene,
  probeOngoingFreeSpinContinue,
} from './session-continue-probe.js';
import {
  classifyServerPayload,
  isSessionTimedOut,
  recoverTimedOutSession,
} from './session-health.js';
import {
  STAGING_DEFAULT_BET_LIMIT,
  STAGING_DEFAULT_WALLET,
  readLauncherBalance,
  readLauncherBetRemaining,
  restoreStagingWallet,
  setLauncherBetLimit,
} from './launcher-balance.js';
import { getLauncherMode } from '../fixtures/local-launcher-html.js';
import { packageProfileFor } from '../../src/capabilities/index.js';

const RESERVE = 2_000;
/** Win banners after the last of a 1000-spin autoplay. Then start 1000 again. */
const AUTOPLAY_SETTLE_MS = 45_000;
/** Fallback if the 1000 batch never reaches its count (stuck / killed). */
const AUTOPLAY_QUIET_MS = 90_000;
/** Overnight / idle host TTL — full reopen, then leftover Continue + 1000 autoplay. */
const SESSION_RECOVER_QUIET_MS = 180_000;

function readNumberAt(body: unknown, path: string): number | undefined {
  const n = Number(getByPath(body, path));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function readInitializeMaxWin(initBody: unknown): {
  readonly amount?: number;
  readonly multiplier?: number;
} {
  const amount =
    readNumberAt(initBody, 'data.maxWin') ??
    readNumberAt(initBody, 'maxWin') ??
    readNumberAt(initBody, 'data.config.maxWin') ??
    readNumberAt(initBody, 'config.maxWin');
  const multiplier =
    readNumberAt(initBody, 'data.maxWinMultiplier') ??
    readNumberAt(initBody, 'maxWinMultiplier') ??
    readNumberAt(initBody, 'data.config.maxWinMultiplier');
  return { amount, multiplier };
}

function stakeFrom(response: Response): number | undefined {
  try {
    const body = response.request().postDataJSON() as { bet?: string | number } | null;
    const n = Number(body?.bet);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

export async function runCaptureHunt(options: {
  readonly caseId: string;
  readonly sgapSession: SgapSession;
  readonly sgapDriver: PlaywrightGameDriver;
  readonly page: Page;
  readonly testInfo: TestInfo;
}): Promise<void> {
  const { caseId, sgapSession, sgapDriver, page, testInfo } = options;
      testInfo.annotations.push(
        { type: 'manualTestId', description: caseId },
        { type: 'category', description: 'CAPTURE' },
        { type: 'gameId', description: sgapSession.manifest.gameId },
      );

      await expect(sgapDriver.isAttached()).resolves.toBe(true);
      await sgapDriver.gameCanvas().waitFor({ state: 'visible' });
      const launchHealth = classifyServerPayload(200, sgapSession.platform.getInitializeBody());
      console.log(`[${caseId}] launch ${launchHealth.detail}`);
      if (await isSessionTimedOut(page, sgapDriver) || launchHealth.kind === 'server-offline') {
        const recovered = await recoverTimedOutSession({
          caseId,
          sgapSession,
          sgapDriver,
          page,
          testInfo,
        });
        if (recovered.kind === 'server-offline') {
          testInfo.annotations.push({ type: 'serverOffline', description: recovered.detail });
        }
      }
      await settleCanvasToBaseGame(
        page,
        sgapDriver,
        sgapSession.manifest,
        sgapSession.platform.getInitializeBody(),
      );
      await prepareAutoplayCanvas(sgapSession, sgapDriver, page);
      await probeOngoingFreeSpinContinue({
        caseId,
        page,
        driver: sgapDriver,
        testInfo,
        source: 'leftover-launch',
        manifest: sgapSession.manifest,
      });

      const workerId = process.env.SGAP_WORKER_ID ?? '1';
      const profile = packageProfileFor(sgapSession.manifest);
      const initMaxWin = readInitializeMaxWin(sgapSession.platform.getInitializeBody());
      const maxWinAmount = initMaxWin.amount;
      const maxWinMultiplier =
        initMaxWin.multiplier ??
        profile?.maxWinMultiplier ??
        Number(sgapSession.manifest.metadata?.maxWinMultiplier);
      const holdBoardSize =
        profile?.reelsHint !== undefined
          ? profile.reelsHint.columns * profile.reelsHint.rows
          : undefined;
      const holdAndWinPath = sgapSession.manifest.metadata?.holdAndWinPath;
      const maxWinFlagPath = sgapSession.manifest.metadata?.maxWinFlagPath ?? 'slot.hasMaxWin';
      console.log(
        `[${caseId}] payload watch flag=${maxWinFlagPath} initMaxWin=${maxWinAmount ?? '-'} ` +
          `multiplier=${Number.isFinite(maxWinMultiplier) ? maxWinMultiplier : '-'} ` +
          `holdPath=${holdAndWinPath ?? 'discover'}`,
      );
      const watcher = new ScenarioWatcher();
      const reel = new CaptureReel(sgapDriver.gameCanvas(), { seconds: 40, fps: 5 });
      reel.start();

      const pending: Response[] = [];
      const onBet = (response: Response): void => {
        if (response.ok() && matchesBetUrl(response.url())) {
          pending.push(response);
        }
      };
      page.on('response', onBet);

      const staging = getLauncherMode() === 'staging';
      const startedAt = Date.now();
      let bets = 0;
      let lastSession: 'base' | 'freeSpin' | 'holdAndWin' = 'base';
      let lastBetAt = Date.now();
      let autoplayArmed = false;
      let autoplayBetsAtStart = 0;
      let continueReloaded = false;
      const capturedHere: HuntScenarioId[] = [];
      const autoplaySpins = Math.max(
        1,
        Number(String(sgapSession.manifest.metadata?.autoplaySelectedSpins ?? '1000').replace(/[,\s]/gu, '')) || 1000,
      );

      const refill = async (reason: string): Promise<void> => {
        console.log(`[${caseId}] ${reason} — refill wallet`);
        await stopAutoplayQuietly(sgapSession, page).catch(() => undefined);
        await restoreStagingWallet({
          page,
          platform: sgapSession.platform,
          driver: sgapDriver,
          manifest: sgapSession.manifest,
          amount: STAGING_DEFAULT_WALLET,
        });
        await setLauncherBetLimit(page, STAGING_DEFAULT_BET_LIMIT).catch(() => undefined);
        await prepareAutoplayCanvas(sgapSession, sgapDriver, page);
      };

      const dumpScenario = async (scenario: HuntScenarioId, body: unknown): Promise<void> => {
        const dir = captureDir(sgapSession.manifest.gameId, workerId, scenario);
        await mkdir(dir, { recursive: true });
        const still = await sgapDriver
          .gameCanvas()
          .screenshot({ type: 'jpeg', quality: 70 })
          .catch(() => undefined);
        const clip = await reel.dump(dir, still);
        await writeFile(path.join(dir, 'payload.json'), redactText(JSON.stringify(body, null, 2)), 'utf8');
        markScenarioCaptured({
          scenario,
          workerId,
          gameId: sgapSession.manifest.gameId,
          dir,
          at: new Date().toISOString(),
        });
        capturedHere.push(scenario);
        await testInfo.attach(`${scenario}-still.jpg`, {
          path: clip.stillPath,
          contentType: 'image/jpeg',
        });
        await testInfo.attach(`${scenario}-replay.html`, {
          path: clip.replayPath,
          contentType: 'text/html',
        });
        if (clip.webmPath !== undefined) {
          await testInfo.attach(`${scenario}-clip.webm`, {
            path: clip.webmPath,
            contentType: 'video/webm',
          });
        }
        console.log(`[${caseId}] captured ${scenario} → ${dir} (${clip.frameCount} frames)`);
      };

      try {
        while (!huntComplete()) {
          if (staging) {
            const balance = await readLauncherBalance(page);
            const remaining = await readLauncherBetRemaining(page);
            if (
              (balance !== undefined && balance < RESERVE) ||
              (remaining !== undefined && remaining < RESERVE)
            ) {
              await refill(`balance=${balance ?? '?'} remaining=${remaining ?? '?'}`);
            }
          }

          if (watcher.captured().size === 2) {
            break;
          }

          const timedOut = await isSessionTimedOut(page, sgapDriver);
          if (!timedOut && Date.now() - lastBetAt > SESSION_RECOVER_QUIET_MS) {
            const scene = await healInterferingScene({
              caseId,
              page,
              driver: sgapDriver,
              testInfo,
              manifest: sgapSession.manifest,
              source: 'hunt',
              waitMs: 12_000,
            });
            if (scene.kind !== 'idle') {
              console.log(
                `[${caseId}] idle >3m — scene=${scene.kind} blocker=${scene.blocker ?? 'none'} (healing overlay, not session recover)`,
              );
              sgapSession.autoplay.acknowledgeStopped();
              autoplayArmed = false;
              lastBetAt = Date.now();
              if (scene.kind === 'continue') {
                const probe = await probeOngoingFreeSpinContinue({
                  caseId,
                  page,
                  driver: sgapDriver,
                  testInfo,
                  source: 'leftover-launch',
                  manifest: sgapSession.manifest,
                });
                if (probe.verdict === 'game-ok') {
                  lastSession = 'freeSpin';
                  continueReloaded = true;
                }
              }
              continue;
            }
          }
          if (timedOut || Date.now() - lastBetAt > SESSION_RECOVER_QUIET_MS) {
            console.log(
              `[${caseId}] ${timedOut ? 'session timeout' : 'idle >3m'} — recover then reuse leftover Continue + 1000 autoplay`,
            );
            const recovered = await recoverTimedOutSession({
              caseId,
              sgapSession,
              sgapDriver,
              page,
              testInfo,
            });
            sgapSession.autoplay.acknowledgeStopped();
            autoplayArmed = false;
            lastSession = 'base';
            continueReloaded = false;
            lastBetAt = Date.now();
            if (recovered.kind === 'server-offline') {
              testInfo.annotations.push({ type: 'serverOffline', description: recovered.detail });
              console.log(`[${caseId}] ${recovered.detail} — staging needs a server restart`);
              await page.waitForTimeout(15_000);
            }
            continue;
          }

          while (pending.length > 0) {
            const response = pending.shift();
            if (response === undefined) {
              break;
            }
            let body: unknown;
            try {
              body = await response.json();
            } catch {
              continue;
            }
            bets += 1;
            lastBetAt = Date.now();
          const progress = watcher.ingest(body, {
            stake: stakeFrom(response),
            maxWinFlagPath,
            maxWinMultiplier: Number.isFinite(maxWinMultiplier) ? maxWinMultiplier : undefined,
            maxWinAmount,
            holdBoardSize,
            holdAndWinPath,
          });
            lastSession = progress.session;
            const featureBet =
              progress.view.inFreeSpin ||
              progress.view.inHoldAndWin ||
              progress.view.maxWin ||
              progress.completed.length > 0;
            if (bets === 1 || bets % 25 === 0 || featureBet) {
              const elapsed = ((Date.now() - startedAt) / 60_000).toFixed(1);
              console.log(
                `[${caseId}] w${workerId} bets=${bets} ${elapsed}m ` +
                  `session=${progress.session} scatter=${progress.view.inFreeSpin} ` +
                  `hold=${progress.view.inHoldAndWin} maxWin=${progress.view.maxWin} ` +
                  `retrigger=${progress.latchedRetriggerOnLast} spinsLeft=${progress.view.spinsLeft ?? '-'} ` +
                  describeSlotFlags(body),
              );
            }
            for (const scenario of progress.completed) {
              await dumpScenario(scenario, body);
            }
          }

          const quietMs = Date.now() - lastBetAt;
          const batch = Math.max(0, bets - autoplayBetsAtStart);
          const betsFlowing = bets > 0 && quietMs < AUTOPLAY_QUIET_MS;
          const finished1000 = autoplayArmed && batch >= autoplaySpins && quietMs >= AUTOPLAY_SETTLE_MS;
          const controllerOn = sgapSession.autoplay.isAutoplayActive();
          const inFeature = lastSession === 'freeSpin' || lastSession === 'holdAndWin';

          if (!inFeature) {
            continueReloaded = false;
          }

          if (inFeature) {
            continueReloaded = true;
            await sgapDriver.clickCanvas('skip', { timeoutMs: 3_000, singleInput: true }).catch(() => undefined);
            await page.waitForTimeout(200);
          } else if (
            (controllerOn || autoplayArmed) &&
            betsFlowing &&
            !finished1000 &&
            (bets === 0 || quietMs < AUTOPLAY_QUIET_MS)
          ) {
            await page.waitForTimeout(250);
          } else if (betsFlowing && !finished1000) {
            autoplayArmed = true;
            await page.waitForTimeout(250);
          } else if (controllerOn || autoplayArmed || finished1000) {
            console.log(
              `[${caseId}] autoplay batch=${batch}/${autoplaySpins} quiet=${(quietMs / 1000).toFixed(0)}s — starting 1000 again`,
            );
            sgapSession.autoplay.acknowledgeStopped();
            autoplayArmed = false;
          } else {
            const scene = await healInterferingScene({
              caseId,
              page,
              driver: sgapDriver,
              testInfo,
              manifest: sgapSession.manifest,
              source: 'hunt',
              waitMs: 15_000,
            });
            if (scene.kind === 'continue') {
              const probe = await probeOngoingFreeSpinContinue({
                caseId,
                page,
                driver: sgapDriver,
                testInfo,
                source: 'leftover-launch',
                manifest: sgapSession.manifest,
              });
              if (probe.verdict === 'game-ok') {
                lastSession = 'freeSpin';
                continueReloaded = true;
              }
              continue;
            }
            if (scene.kind !== 'idle') {
              console.log(
                `[${caseId}] not starting autoplay — scene=${scene.kind} blocker=${scene.blocker ?? 'none'}`,
              );
              await page.waitForTimeout(1_000);
              continue;
            }
            try {
              await sgapSession.autoplay.start({ timeoutMs: 25_000 });
              autoplayArmed = true;
              autoplayBetsAtStart = bets;
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : String(error);
              if (Date.now() - lastBetAt < AUTOPLAY_QUIET_MS && bets > 0 && !finished1000) {
                autoplayArmed = true;
                console.log(`[${caseId}] autoplay start threw after bets were already flowing — leaving it running (${message})`);
              } else {
                console.log(`[${caseId}] autoplay start missed — ${message}`);
                sgapSession.autoplay.acknowledgeStopped();
                autoplayArmed = false;
                await page.waitForTimeout(2_000);
              }
            }
          }

          if (huntComplete()) {
            break;
          }
        }

        expect(
          huntComplete() || capturedHere.length > 0,
          'Hunt stopped without a captured scenario on this lane or the shared board',
        ).toBe(true);
      } finally {
        page.off('response', onBet);
        reel.stop();
        await stopAutoplayQuietly(sgapSession, page).catch(() => undefined);
      }
}
