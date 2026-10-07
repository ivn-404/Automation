/**
 * SGAP Playwright fixtures.
 *
 * Specs must import { test, expect } from this module — not from @playwright/test directly.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { test as base, expect } from '@playwright/test';

import type {
  BalanceSnapshot,
  EnvironmentConfig,
  GameManifest,
} from '../../src/core/models/index.js';
import {
  notApplicableReason,
  notConfiguredMessage,
  supportsCapability,
  unmappedCapabilities,
  unsupportedCapabilities,
  type Capability,
} from '../../src/capabilities/index.js';
import { familyForSpec } from '../support/qa-families.js';
import { AutoplayController } from '../../src/controllers/autoplay-controller.js';
import { AmplifyBetController } from '../../src/controllers/amplify-bet-controller.js';
import { BetController } from '../../src/controllers/bet-controller.js';
import { BuyFeatureController } from '../../src/controllers/buy-feature-controller.js';
import { ControllerRegistry } from '../../src/controllers/registry/index.js';
import { FullscreenController } from '../../src/controllers/fullscreen-controller.js';
import { MenuController } from '../../src/controllers/menu-controller.js';
import { ScratchCardController } from '../../src/controllers/scratch-card-controller.js';
import { SettingsController } from '../../src/controllers/settings-controller.js';
import { SpinController } from '../../src/controllers/spin-controller.js';
import { TurboController } from '../../src/controllers/turbo-controller.js';
import { PlaywrightGameDriver } from '../../src/driver/playwright-game-driver.js';
import { installClickTracker, isClickTrackerEnabled, refreshClickTracker } from '../../src/driver/click-tracker.js';
import {
  installWorkerMonitorOverlay,
  refreshWorkerMonitorOverlay,
} from '../../src/driver/worker-monitor-overlay.js';
import { BetResponseWatcher } from '../../src/network/bet-response-watcher.js';
import { trackRounds, untrackRounds } from '../../src/network/round-tracker.js';
import {
  defaultEnvironmentsDir,
  defaultManifestsDir,
  FileEnvironmentLoader,
  FileGameManifestLoader,
  PlaywrightPlatform,
  primeCanvasSession,
} from '../../src/platform/index.js';
import { UiRegistry } from '../../src/ui/registry/index.js';
import {
  getLauncherMode,
  getSgapEnvName,
  getSgapGameId,
  LOCAL_LAUNCHER_HTML,
} from './local-launcher-html.js';
import { attachBetTraffic } from '../support/failure-report.js';
import {
  applySgapAllureMetadata,
  applySgapInteractionMetadata,
  applySgapOutcomeMetadata,
} from '../support/sgap-allure.js';
import { takeInteractions } from '../../src/reporting/interaction-journal.js';
import { createCanvasActionHealer } from '../support/canvas-action-healer.js';
import { buildLauncherPlayerId } from '../support/launcher-player.js';
import {
  setLauncherBalance,
  setLauncherBetLimit,
  readLauncherBalance,
  readLauncherBetLimit,
  readLauncherBetRemaining,
  STAGING_DEFAULT_BET_LIMIT,
} from '../support/launcher-balance.js';
import { laneFromProjectMetadata, workerTag } from '../support/parallel-lanes.js';
import { tileLaneWindow } from '../support/tile-lane-window.js';
import { reportFixtureTestEnd, testCodeFromTitle } from '../support/worker-monitor-client.js';
import {
  formatBalanceTimeline,
  formatObservationTimeline,
  MonitorSink,
  monitorUrlFromEnv,
  persistableObservations,
  startObservation,
  stopObservation,
  summarizeObservations,
} from '../../src/observability/index.js';
import { attachBackendReaderCapture, isImmediateRestartSpec } from '../../src/verification/reel/backend-reader-capture.js';

/** Default tests stay on the 1400×900 desktop shell. Mobile specs opt in. */
export type SgapView = 'desktop' | 'mobile';

/** Fully wired SGAP session after launcher bootstrap + driver attach. */
export interface SgapSession {
  readonly environment: EnvironmentConfig;
  readonly manifest: GameManifest;
  readonly ui: UiRegistry;
  readonly platform: PlaywrightPlatform;
  readonly driver: PlaywrightGameDriver;
  readonly registry: ControllerRegistry;
  readonly spin: SpinController;
  readonly bet: BetController;
  readonly buyFeature: BuyFeatureController;
  readonly turbo: TurboController;
  readonly autoplay: AutoplayController;
  readonly menu: MenuController;
  readonly amplifyBet: AmplifyBetController;
  readonly settings: SettingsController;
  readonly fullscreen: FullscreenController;
  readonly scratchCard: ScratchCardController;
  readonly betWatcher?: BetResponseWatcher;
  readonly initializeBalance?: BalanceSnapshot;
  /** Manifest-declared support for a controller or game feature. */
  supports(capability: Capability): boolean;
}

export interface SgapFixtures {
  _sgapBaseline: void;
  _sgapAllure: void;
  _sgapInteractions: void;
  _sgapClickTracker: void;
  _sgapBetTraffic: void;
  _sgapRounds: void;
  _sgapWorkerMonitor: void;
  _sgapObserve: void;
  sgapEnvironment: EnvironmentConfig;
  sgapManifest: GameManifest;
  sgapUi: UiRegistry;
  sgapPlatform: PlaywrightPlatform;
  sgapDriver: PlaywrightGameDriver;
  sgapRegistry: ControllerRegistry;
  sgapSpin: SpinController;
  sgapBet: BetController;
  sgapBuyFeature: BuyFeatureController;
  sgapTurbo: TurboController;
  sgapAutoplay: AutoplayController;
  sgapMenu: MenuController;
  sgapAmplifyBet: AmplifyBetController;
  sgapSettings: SettingsController;
  sgapFullscreen: FullscreenController;
  sgapScratchCard: ScratchCardController;
  sgapBetWatcher: BetResponseWatcher | undefined;
  sgapView: SgapView;
  sgapSession: SgapSession;
}

export const test = base.extend<SgapFixtures>({
  sgapView: ['desktop', { option: true }],
  // Declared first so a family baseline the game lacks ends the case before the game opens.
  _sgapBaseline: [
    async ({ sgapManifest }, use, testInfo) => {
      const requires = familyForSpec(testInfo.file)?.requires ?? [];
      if (unsupportedCapabilities(sgapManifest, requires).length > 0) {
        testInfo.skip(true, notApplicableReason(sgapManifest, requires));
      }
      if (unmappedCapabilities(sgapManifest, requires).length > 0) {
        throw new Error(notConfiguredMessage(sgapManifest, requires));
      }
      await use();
    },
    { auto: true },
  ],
  _sgapAllure: [
    async ({ sgapManifest }, use, testInfo) => {
      await applySgapAllureMetadata(testInfo, sgapManifest.gameId);
      await use();
      await applySgapOutcomeMetadata(testInfo);
    },
    { auto: true },
  ],

  _sgapInteractions: [
    async ({ page }, use, testInfo) => {
      await use();
      await applySgapInteractionMetadata(testInfo, takeInteractions(page));
    },
    { auto: true },
  ],

  _sgapClickTracker: [
    async ({ page }, use) => {
      if (isClickTrackerEnabled()) {
        await installClickTracker(page);
      }
      await use();
    },
    { auto: true },
  ],

  _sgapBetTraffic: [
    async ({ page }, use) => {
      const traffic = attachBetTraffic(page);
      await use();
      traffic.stop();
    },
    { auto: true },
  ],

  _sgapRounds: [
    async ({ page, sgapManifest }, use) => {
      trackRounds(page, sgapManifest);
      await use();
      untrackRounds(page);
    },
    { auto: true },
  ],

  _sgapWorkerMonitor: [
    async ({ page }, use, testInfo) => {
      const lane = laneFromProjectMetadata(
        testInfo.project.metadata as Record<string, unknown> | undefined,
      );
      await installWorkerMonitorOverlay(page, { workerId: lane?.id });
      await use();
    },
    { auto: true },
  ],

  _sgapObserve: [
    async ({ page, sgapManifest, sgapUi }, use, testInfo) => {
      if (process.env.SGAP_OBSERVE === '0') {
        await use();
        return;
      }
      const lane = laneFromProjectMetadata(
        testInfo.project.metadata as Record<string, unknown> | undefined,
      );
      const testCode = testCodeFromTitle(testInfo.title, testInfo.file);
      const monitorUrl = monitorUrlFromEnv();
      const sink =
        monitorUrl === undefined
          ? undefined
          : new MonitorSink(monitorUrl, {
              sessionId: `w${lane?.id ?? 0}-${testCode}-${sgapManifest.gameId}-r${testInfo.retry}`,
              workerId: lane?.id,
              testKey: testInfo.testId,
              testCode,
              title: testInfo.title,
              gameId: sgapManifest.gameId,
              retry: testInfo.retry,
            });
      sink?.start();
      const sampleMs = Number(process.env.SGAP_OBSERVE_BALANCE_MS ?? '500');
      let iframeSelector: string | undefined;
      try {
        iframeSelector = sgapUi.resolveIframe().selector;
      } catch {
        iframeSelector = undefined;
      }
      const recorder = await startObservation(page, {
        manifest: sgapManifest,
        iframeSelector,
        sampleMs: Number.isFinite(sampleMs) ? sampleMs : 500,
        ignoreOrigins: monitorUrl === undefined ? [] : [monitorUrl],
        sink: sink === undefined ? undefined : (observation) => sink.push(observation),
      });
      recorder.event('test-started', `${testCode} retry ${testInfo.retry}`);
      await use();
      recorder.event('test-finished', `${testInfo.status ?? 'unknown'}`, {
        severity: testInfo.status === 'passed' || testInfo.status === 'skipped' ? 'info' : 'error',
      });
      await stopObservation(page);
      await sink?.close(testInfo.status ?? 'unknown');
      const observations = recorder.observations();
      const summary = { ...summarizeObservations(observations), ...recorder.stats() };
      await testInfo.attach('monitor-summary.txt', {
        body: `${JSON.stringify(summary, null, 2)}\n\n${formatObservationTimeline(observations)}`,
        contentType: 'text/plain',
      });
      await testInfo.attach('balance-timeline.txt', {
        body: formatBalanceTimeline(observations),
        contentType: 'text/plain',
      });
      await testInfo.attach('monitor-worker.json', {
        body: JSON.stringify({ summary, observations: persistableObservations(observations) }, null, 1),
        contentType: 'application/json',
      });
    },
    { auto: true },
  ],

  sgapEnvironment: async ({}, use) => {
    const loader = new FileEnvironmentLoader({ environmentsDir: defaultEnvironmentsDir() });
    await use(await loader.load(getSgapEnvName()));
  },

  sgapManifest: async ({}, use, testInfo) => {
    const loader = new FileGameManifestLoader({ manifestsDir: defaultManifestsDir() });
    const projectGameId =
      typeof testInfo.project.metadata?.sgapGameId === 'string'
        ? testInfo.project.metadata.sgapGameId
        : undefined;
    await use(await loader.load(getSgapGameId(projectGameId)));
  },

  sgapUi: async ({ sgapManifest }, use) => {
    await use(new UiRegistry(sgapManifest));
  },

  sgapPlatform: async ({ page, sgapEnvironment, sgapManifest, sgapUi }, use) => {
    const platform = new PlaywrightPlatform({
      page,
      environment: sgapEnvironment,
      manifest: sgapManifest,
      ui: sgapUi,
    });
    await use(platform);
    await platform.dispose();
  },

  sgapDriver: async ({ page, sgapUi, sgapEnvironment, sgapManifest }, use) => {
    const driver = new PlaywrightGameDriver({
      page,
      ui: sgapUi,
      manifest: sgapManifest,
      defaultTimeoutMs: sgapEnvironment.defaultTimeoutMs,
    });
    await use(driver);
    await driver.detach();
  },

  sgapRegistry: async ({ sgapManifest }, use) => {
    const registry = new ControllerRegistry();
    registry.setManifest(sgapManifest);
    await use(registry);
  },

  sgapSpin: async (
    { sgapDriver, sgapManifest, sgapRegistry, sgapEnvironment, sgapBetWatcher, page },
    use,
  ) => {
    const spin = new SpinController({
      driver: sgapDriver,
      manifest: sgapManifest,
      page,
      network: sgapManifest.network,
      defaultTimeoutMs: sgapEnvironment.defaultTimeoutMs,
      betWatcher: sgapBetWatcher,
    });
    sgapRegistry.register(spin);
    await use(spin);
  },

  sgapBet: async ({ sgapDriver, sgapManifest, sgapRegistry }, use) => {
    const bet = new BetController({
      driver: sgapDriver,
      manifest: sgapManifest,
      initialBet: sgapManifest.metadata?.defaultBet ?? '1',
    });
    sgapRegistry.register(bet);
    await use(bet);
  },

  sgapBuyFeature: async ({ sgapDriver, sgapManifest, sgapRegistry }, use) => {
    const buyFeature = new BuyFeatureController({ driver: sgapDriver, manifest: sgapManifest });
    sgapRegistry.register(buyFeature);
    await use(buyFeature);
  },

  sgapTurbo: async ({ sgapDriver, sgapManifest, sgapRegistry }, use) => {
    const turbo = new TurboController({ driver: sgapDriver, manifest: sgapManifest });
    sgapRegistry.register(turbo);
    await use(turbo);
  },

  sgapAutoplay: async ({ sgapDriver, sgapManifest, sgapRegistry }, use) => {
    const autoplay = new AutoplayController({ driver: sgapDriver, manifest: sgapManifest });
    sgapRegistry.register(autoplay);
    await use(autoplay);
  },

  sgapMenu: async ({ sgapDriver, sgapManifest, sgapRegistry }, use) => {
    const menu = new MenuController({ driver: sgapDriver, manifest: sgapManifest });
    sgapRegistry.register(menu);
    await use(menu);
  },

  sgapAmplifyBet: async ({ sgapDriver, sgapManifest, sgapRegistry }, use) => {
    const amplifyBet = new AmplifyBetController({ driver: sgapDriver, manifest: sgapManifest });
    sgapRegistry.register(amplifyBet);
    await use(amplifyBet);
  },

  sgapSettings: async ({ sgapDriver, sgapManifest, sgapRegistry }, use) => {
    const settings = new SettingsController({ driver: sgapDriver, manifest: sgapManifest });
    sgapRegistry.register(settings);
    await use(settings);
  },

  sgapFullscreen: async ({ sgapDriver, sgapManifest, sgapRegistry }, use) => {
    const fullscreen = new FullscreenController({ driver: sgapDriver, manifest: sgapManifest });
    sgapRegistry.register(fullscreen);
    await use(fullscreen);
  },

  // Built before sgapSession opens the game: the scratch hub connects once, on game start.
  sgapScratchCard: async ({ sgapDriver, sgapManifest, sgapRegistry }, use) => {
    const scratchCard = new ScratchCardController({ driver: sgapDriver, manifest: sgapManifest });
    sgapRegistry.register(scratchCard);
    await use(scratchCard);
    scratchCard.dispose();
  },

  sgapBetWatcher: async ({ page, sgapManifest, sgapEnvironment }, use) => {
    if (sgapManifest.network === undefined) {
      await use(undefined);
      return;
    }
    const watcher = new BetResponseWatcher({
      page,
      network: sgapManifest.network,
      defaultTimeoutMs: sgapEnvironment.defaultTimeoutMs,
    });
    await use(watcher);
  },

  sgapSession: async (
    {
      page,
      sgapPlatform,
      sgapDriver,
      sgapRegistry,
      sgapSpin,
      sgapBet,
      sgapBuyFeature,
      sgapTurbo,
      sgapAutoplay,
      sgapMenu,
      sgapAmplifyBet,
      sgapSettings,
      sgapFullscreen,
      sgapScratchCard,
      sgapBetWatcher,
      sgapEnvironment,
      sgapManifest,
      sgapUi,
      sgapView,
    },
    use,
    testInfo,
  ) => {
    const mode = getLauncherMode();

    if (mode === 'staging') {
      // Setup alone (host wallet + openGame + prepareGameView) can exceed 3m under
      // 4-worker load. Raise early so UIDS-005 / ES-004 do not die mid-fixture.
      testInfo.setTimeout(Math.max(testInfo.timeout, 300_000));
    }

    // Parallel lanes pin a dedicated player per worker (config/parallel-workers.json).
    // Otherwise: exact Game Name + random suffix. Pin with SGAP_PLAYER_ID_LOCK=1 for debugging.
    const parallelLane = laneFromProjectMetadata(
      testInfo.project.metadata as Record<string, unknown> | undefined,
    );
    const projectGameName =
      typeof testInfo.project.metadata?.sgapGameName === 'string' &&
      testInfo.project.metadata.sgapGameName.length > 0
        ? testInfo.project.metadata.sgapGameName
        : sgapManifest.displayName;
    if (parallelLane?.playerId) {
      process.env.SGAP_PLAYER_ID = parallelLane.playerId;
      testInfo.annotations.push(
        { type: 'launcherPlayerId', description: parallelLane.playerId },
        { type: 'parallelWorker', description: workerTag(parallelLane) },
      );
      console.log(`${workerTag(parallelLane)} player=${parallelLane.playerId}`);
      await tileLaneWindow(page, parallelLane);
    } else if (projectGameName.length > 0) {
      const locked =
        process.env.SGAP_PLAYER_ID_LOCK === '1' &&
        typeof process.env.SGAP_PLAYER_ID === 'string' &&
        process.env.SGAP_PLAYER_ID.length > 0;
      const playerId = locked
        ? process.env.SGAP_PLAYER_ID!
        : buildLauncherPlayerId(projectGameName);
      process.env.SGAP_PLAYER_ID = playerId;
      testInfo.annotations.push({ type: 'launcherPlayerId', description: playerId });
    }

    if (mode === 'local') {
      if (sgapManifest.network !== undefined) {
        const samplePath = path.join(
          process.cwd(),
          'tests',
          'fixtures',
          'samples',
          'dijoker-bet-response.json',
        );
        const sampleBody = await readFile(samplePath, 'utf8');
        await page.route(sgapManifest.network.betUrlPattern, async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: sampleBody,
          });
        });
      }

      await page.setContent(LOCAL_LAUNCHER_HTML);
      await sgapPlatform.openGame();
      await sgapDriver.attach();
    } else {
      await sgapPlatform.openGameHost();
      if (parallelLane !== undefined) {
        await tileLaneWindow(page, parallelLane);
        console.log(`${workerTag(parallelLane)} launcher ready`);
      }
      if (mode === 'staging') {
        const targetBalance = parallelLane?.defaultBalance ?? STAGING_DEFAULT_BET_LIMIT;
        const targetBetLimit = parallelLane?.defaultBetLimit ?? STAGING_DEFAULT_BET_LIMIT;
        const current = await readLauncherBalance(page);
        if (current === undefined || current < targetBalance - 0.5) {
          await setLauncherBalance(page, targetBalance);
        }
        await setLauncherBetLimit(page, targetBetLimit);
        const after = await readLauncherBalance(page);
        const betLimit = await readLauncherBetLimit(page);
        const remaining = await readLauncherBetRemaining(page);
        const tag = parallelLane !== undefined ? workerTag(parallelLane) : '[staging]';
        console.log(
          `${tag} host balance=${after ?? 'unknown'} (target ${targetBalance}) betLimit=${betLimit ?? 'unknown'} remaining=${remaining ?? 'unknown'} (target ${targetBetLimit})`,
        );
      }
      await sgapPlatform.openGame();
      if (parallelLane !== undefined) {
        await tileLaneWindow(page, parallelLane);
      }
      await sgapPlatform.prepareGameView(sgapView);
      if (parallelLane !== undefined) {
        await tileLaneWindow(page, parallelLane, { syncViewport: false });
      }
      testInfo.annotations.push({ type: 'sgapView', description: sgapView });
      await sgapDriver.attach();
      await primeCanvasSession({
        page,
        driver: sgapDriver,
        manifest: sgapManifest,
        initializeBody: sgapPlatform.getInitializeBody(),
      });
    }

    if (mode === 'staging') {
      testInfo.setTimeout(Math.max(testInfo.timeout, 360_000));
    }

    if (isClickTrackerEnabled()) {
      await refreshClickTracker(page);
    }
    if (parallelLane !== undefined) {
      await refreshWorkerMonitorOverlay(page, { workerId: parallelLane.id });
    } else {
      await refreshWorkerMonitorOverlay(page);
    }

    const testIdMatch = testInfo.title.match(/[A-Z]+-\d+/);
    const testId = testIdMatch?.[0] ?? testInfo.title;
    const detachReader = attachBackendReaderCapture({
      page,
      driver: sgapDriver,
      manifest: sgapManifest,
      workerId: parallelLane?.id,
      testId,
      testTitle: testInfo.title,
      isAutoplayActive: () => sgapAutoplay.isAutoplayActive(),
      waitOnStop: !isImmediateRestartSpec(testId, testInfo.title),
    });

    const session: SgapSession = {
      environment: sgapEnvironment,
      manifest: sgapManifest,
      ui: sgapUi,
      platform: sgapPlatform,
      driver: sgapDriver,
      registry: sgapRegistry,
      spin: sgapSpin,
      bet: sgapBet,
      buyFeature: sgapBuyFeature,
      turbo: sgapTurbo,
      autoplay: sgapAutoplay,
      menu: sgapMenu,
      amplifyBet: sgapAmplifyBet,
      settings: sgapSettings,
      fullscreen: sgapFullscreen,
      scratchCard: sgapScratchCard,
      betWatcher: sgapBetWatcher,
      initializeBalance: sgapPlatform.getInitializeBalance(),
      supports: (capability) => supportsCapability(sgapManifest, capability),
    };
    if ((sgapManifest.metadata?.rendering ?? 'dom') === 'canvas') {
      sgapSpin.useHealer(createCanvasActionHealer(session));
    }

    try {
      await use(session);
    } finally {
      // Mark the monitor row finished before Backend Reader teardown can sit
      // for minutes on awaitingMore — otherwise the HUD stays on "running".
      await reportFixtureTestEnd(testInfo).catch(() => undefined);
      await detachReader();
    }
  },
});

export { expect };
