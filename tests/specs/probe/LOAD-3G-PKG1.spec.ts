/**
 * Package 1 cold-load time under one simulated 3G profile.
 *
 * Clock starts at the launcher Play click (the game launch request) and stops
 * when the round splash Play button is input-enabled. The timer stops there.
 * That button is the green circular control on the attract splash. It is not a wager.
 */

import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Browser, Page } from '@playwright/test';

import { FileEnvironmentLoader, defaultEnvironmentsDir } from '../../../src/platform/environment/index.js';
import {
  FileGameManifestLoader,
  defaultManifestsDir,
} from '../../../src/platform/manifest/file-game-manifest-loader.js';
import { PlaywrightPlatform } from '../../../src/platform/playwright-platform.js';
import { listPhaserInteractive, pickPhaserControl } from '../../../src/runtime/phaser-locate.js';
import { loadSurfaceProfile } from '../../../src/surfaces/load-surface-profile.js';
import type { GameManifest } from '../../../src/core/models/index.js';
import { UiRegistry } from '../../../src/ui/registry/ui-registry.js';
import { test } from '../../fixtures/index.js';
import { laneFromProjectMetadata, type ParallelLaneRuntime } from '../../support/parallel-lanes.js';
import { tileLaneWindow } from '../../support/tile-lane-window.js';

const GAMES = (
  process.env.SGAP_3G_GAMES ??
  (process.env.SGAP_3G_PARALLEL === '1' ? process.env.SGAP_GAME_ID : undefined) ??
  'sugar-wonderland,beelze-bop,felice-in-space,mars-triumph'
)
  .split(',')
  .map((gameId) => gameId.trim())
  .filter((gameId) => gameId.length > 0);
const RUNS = Number(process.env.SGAP_3G_RUNS ?? 3);
const POLL_MS = 200;
const LOAD_TIMEOUT_MS = Number(process.env.SGAP_3G_TIMEOUT_MS ?? 300_000);
const SIDE_REPORT = process.env.SGAP_3G_SIDE === '1';

/**
 * Chrome DevTools Network panel preset named "3G" (internal key Slow3G).
 * DevTools applies its adjustment factors before calling emulateNetworkConditions:
 * 500 Kbps × 0.8 and a 400 ms RTT × 5.
 */
const NETWORK = {
  name: 'Chrome DevTools 3G',
  offline: false,
  downloadThroughput: (500 * 1_000 / 8) * 0.8,
  uploadThroughput: (500 * 1_000 / 8) * 0.8,
  latency: 400 * 5,
} as const;

interface RunRecord {
  readonly gameId: string;
  readonly displayName: string;
  readonly run: number;
  readonly status: 'measured' | 'timeout' | 'error';
  readonly launchToReadyMs?: number;
  readonly portraitNavToReadyMs?: number;
  readonly iframeAttachedMs?: number;
  readonly portraitNavMs?: number;
  readonly confirmMs?: number;
  readonly bytesReceived?: number;
  readonly observedDownloadBps?: number;
  readonly detectionLagMaxMs: number;
  readonly startedAt: string;
  readonly stoppedAt?: string;
  readonly startEvent: string;
  readonly stopEvent?: string;
  readonly detail: string;
  readonly consoleErrors: readonly string[];
}

test.describe.configure({ retries: 0, mode: 'serial' });

test.describe('3G runtime simulation', () => {
  test('splash button ready under the DevTools 3G preset', async ({ page, sgapEnvironment, sgapUi }, testInfo) => {
    test.setTimeout(100 * 60 * 1000);
    await page.goto('about:blank').catch(() => undefined);

    const browser = page.context().browser();
    if (browser === null) {
      throw new Error('No browser is available for a fresh cold-load context');
    }
    const viewport = page.viewportSize() ?? { width: 960, height: 900 };
    const browserVersion = browser.version();
    const manifests = new FileGameManifestLoader({ manifestsDir: defaultManifestsDir() });
    const environment = await new FileEnvironmentLoader({
      environmentsDir: defaultEnvironmentsDir(),
    }).load(sgapEnvironment.name);
    const records: RunRecord[] = [];
    const lane = laneFromProjectMetadata(testInfo.project.metadata as Record<string, unknown> | undefined);

    for (const gameId of GAMES) {
      const manifest = await manifests.load(gameId);
      for (let run = 1; run <= RUNS; run += 1) {
        console.log(`[3g-runtime] starting ${manifest.displayName} run ${run}`);
        const record = await measureOne({
          browser,
          viewport,
          environment,
          manifest,
          uiSelector: sgapUi.resolveIframe().selector,
          run,
          lane,
        });
        records.push(record);
        writeReport(records, browserVersion, viewport);
        console.log(
          `[3g-runtime] ${record.displayName} run ${record.run} ${record.status} ` +
            `${record.launchToReadyMs === undefined ? '—' : `${(record.launchToReadyMs / 1000).toFixed(3)}s`} ` +
            record.detail,
        );
      }
    }

    const report = writeReport(records, browserVersion, viewport);
    await testInfo.attach('package1-3g-load.json', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });
    await testInfo.attach('package1-3g-load.md', {
      body: renderMarkdown(report),
      contentType: 'text/markdown',
    });
  });
});

async function measureOne(input: {
  readonly browser: Browser;
  readonly viewport: { width: number; height: number };
  readonly environment: Awaited<ReturnType<FileEnvironmentLoader['load']>>;
  readonly manifest: GameManifest;
  readonly uiSelector: string;
  readonly run: number;
  readonly lane?: ParallelLaneRuntime;
}): Promise<RunRecord> {
  const { browser, viewport, environment, manifest, run, lane } = input;
  const displayName = manifest.displayName;
  const consoleErrors: string[] = [];
  const context = await browser.newContext({
    viewport,
    hasTouch: true,
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  const gamePage = await context.newPage();
  if (lane !== undefined) {
    await tileLaneWindow(gamePage, lane);
  }
  const banner = bannerName(displayName);
  let launchAt = 0;
  let interactiveAt = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const tickBanner = (): void => {
    if (launchAt <= 0) {
      return;
    }
    if (interactiveAt > 0) {
      void paintTimer(gamePage, `${banner} — finished at ${finishedPhrase(interactiveAt - launchAt)}`);
      return;
    }
    void paintTimer(gamePage, `${banner} — ${formatClock((performance.now() - launchAt) / 1000)}`);
  };
  gamePage.on('console', (message) => {
    if (message.type() === 'error' && consoleErrors.length < 20) {
      consoleErrors.push(message.text().slice(0, 300));
    }
  });
  gamePage.on('pageerror', (error) => {
    if (consoleErrors.length < 20) {
      consoleErrors.push(error.message.slice(0, 300));
    }
  });
  const startedAt = new Date().toISOString();
  let iframeAt: number | undefined;
  let portraitAt: number | undefined;
  let bytesReceived = 0;
  try {
    await arm3g(gamePage);
    const ui = new UiRegistry(manifest);
    const platform = new PlaywrightPlatform({ page: gamePage, environment, manifest, ui });
    await platform.openGameHost({ timeoutMs: 180_000 });
    const client = await arm3g(gamePage);
    const tree = (await client.send('Page.getFrameTree')) as {
      frameTree?: { frame?: { id?: string } };
    };
    const mainFrameId = tree.frameTree?.frame?.id;
    let servedFromCache = 0;
    let bytesAtLaunch = 0;
    client.on('Network.loadingFinished', (event: { encodedDataLength?: number }) => {
      bytesReceived += event.encodedDataLength ?? 0;
    });
    client.on('Network.requestServedFromCache', () => {
      servedFromCache += 1;
    });
    const launchWallHolder = { value: '' };
    let startSource = '';
    const acceptLaunch = (at: number, source: string): void => {
      if (launchAt !== 0 && at >= launchAt) {
        return;
      }
      launchAt = at;
      bytesAtLaunch = bytesReceived;
      launchWallHolder.value = new Date().toISOString();
      startSource = source;
    };
    client.on('Network.requestWillBeSent', (event: { type?: string; frameId?: string }) => {
      if (event.type === 'Document' && event.frameId !== undefined && event.frameId !== mainFrameId) {
        acceptLaunch(performance.now(), 'iframe-document');
      }
    });
    gamePage.on('request', (request) => {
      if (request.resourceType() === 'document' && request.frame() !== gamePage.mainFrame()) {
        acceptLaunch(performance.now(), 'iframe-document');
      }
    });
    const nodeAtInstall = performance.now();
    const pageAtInstall = Number(await gamePage.evaluate("globalThis['perf' + 'ormance'].now()"));
    await gamePage.exposeBinding('__sgapMarkPlay', (_source, pageNow: number) => {
      acceptLaunch(nodeAtInstall + (pageNow - pageAtInstall), 'play-click');
    });
    await gamePage.evaluate(`document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target && target.closest('button, [role="button"]');
      const label = String((button && button.getAttribute('aria-label')) || '') + ' ' + String((button && button.textContent) || '');
      if (/play/i.test(label)) {
        void window.__sgapMarkPlay(globalThis['perf' + 'ormance'].now());
      }
    }, true);`);
    timer = setInterval(tickBanner, 250);
    await platform.openGame({ timeoutMs: 180_000 });
    if (launchAt === 0) {
      acceptLaunch(performance.now(), 'play-click-fallback');
    }
    const launchWall = launchWallHolder.value || new Date().toISOString();
    iframeAt = performance.now();
    await arm3g(gamePage);
    await platform.prepareGameView('desktop', { timeoutMs: 120_000 });
    portraitAt = performance.now();
    const ready = await waitForSplashPlay(
      gamePage,
      ui.resolveIframe().selector,
      manifest,
      launchAt,
      manifest.gameId,
      run,
      {
        onInteractive: (at) => {
          interactiveAt = at;
        },
      },
    );
    if (ready === undefined) {
      await gamePage.screenshot({ path: shotPath(manifest.gameId, run, 'timeout'), timeout: 10_000 }).catch(() => undefined);
      await finishBanner(gamePage, timer, `${banner} — still loading at ${formatClock(LOAD_TIMEOUT_MS / 1000)}`);
      timer = undefined;
      return base(manifest, displayName, run, startedAt, consoleErrors, iframeAt, portraitAt, launchAt, {
        status: 'timeout',
        detail: `Splash Play was not interactive within ${LOAD_TIMEOUT_MS}ms of the Play click (${startSource || 'no start'})`,
        startedAt: launchWall,
      });
    }
    const launchToReadyMs = ready.at - launchAt;
    interactiveAt = ready.at;
    await finishBanner(gamePage, timer, `${banner} — finished at ${finishedPhrase(launchToReadyMs)}`);
    timer = undefined;
    return base(manifest, displayName, run, startedAt, consoleErrors, iframeAt, portraitAt, launchAt, {
      status: 'measured',
      launchToReadyMs,
      portraitNavToReadyMs: portraitAt === undefined ? undefined : ready.at - portraitAt,
      detail:
        `Started at ${startSource}. Splash Play input-enabled at ${ready.x.toFixed(3)},${ready.y.toFixed(3)} ${ready.width}x${ready.height} (${ready.type}). Timer stopped. ` +
        `Transferred ${Math.max(0, bytesReceived - bytesAtLaunch)} bytes after the iframe document request; ${servedFromCache} cache hits on the page session.`,
      startedAt: launchWall,
      stoppedAt: new Date().toISOString(),
      stopEvent: 'splash Play button input.enabled; timer stopped, run closed',
    });
  } catch (error: unknown) {
    return base(manifest, displayName, run, startedAt, consoleErrors, iframeAt, portraitAt, launchAt, {
      status: 'error',
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (timer !== undefined) {
      clearInterval(timer);
    }
    await context.close().catch(() => undefined);
  }
}

async function paintTimer(page: Page, text: string): Promise<void> {
  await page
    .evaluate((label) => {
      let el = document.getElementById('sgap-load-timer');
      if (el === null) {
        el = document.createElement('div');
        el.id = 'sgap-load-timer';
        el.style.cssText = [
          'position:fixed',
          'top:12px',
          'left:12px',
          'z-index:2147483647',
          'pointer-events:none',
          'padding:10px 14px',
          'border-radius:8px',
          'background:rgba(8,10,16,0.92)',
          'color:#fff',
          'font:700 22px/1.2 Segoe UI,sans-serif',
          'letter-spacing:0.02em',
          'box-shadow:0 4px 16px rgba(0,0,0,0.35)',
        ].join(';');
        document.documentElement.appendChild(el);
      }
      el.textContent = label;
    }, text)
    .catch(() => undefined);
}

async function finishBanner(page: Page, timer: ReturnType<typeof setInterval> | undefined, text: string): Promise<void> {
  if (timer !== undefined) {
    clearInterval(timer);
  }
  await paintTimer(page, text);
  await page.waitForTimeout(1_000).catch(() => undefined);
}

function bannerName(displayName: string): string {
  const name = displayName.toLowerCase();
  if (name.includes('felice')) return 'FELICE';
  if (name.includes('beelze')) return 'BEELZE-BOP';
  if (name.includes('mars')) return 'MARS TRIUMPH';
  if (name.includes('sugar')) return 'SUGAR WONDERLAND';
  return displayName.toUpperCase();
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  return `${minutes}:${String(remain).padStart(2, '0')}`;
}

function finishedPhrase(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const minuteLabel = minutes === 1 ? 'minute' : 'minutes';
  const secondLabel = seconds === 1 ? 'second' : 'seconds';
  if (minutes === 0) {
    return `${seconds} ${secondLabel}`;
  }
  if (seconds === 0) {
    return `${minutes} ${minuteLabel}`;
  }
  return `${minutes} ${minuteLabel} ${seconds} ${secondLabel}`;
}

function base(
  manifest: GameManifest,
  displayName: string,
  run: number,
  startedAt: string,
  consoleErrors: readonly string[],
  iframeAt: number | undefined,
  portraitAt: number | undefined,
  launchAt: number,
  extra: {
    readonly status: RunRecord['status'];
    readonly detail: string;
    readonly launchToReadyMs?: number;
    readonly portraitNavToReadyMs?: number;
    readonly confirmMs?: number;
    readonly startedAt?: string;
    readonly stoppedAt?: string;
    readonly stopEvent?: string;
  },
): RunRecord {
  return {
    gameId: manifest.gameId,
    displayName,
    run,
    status: extra.status,
    ...(extra.launchToReadyMs !== undefined ? { launchToReadyMs: extra.launchToReadyMs } : {}),
    ...(extra.portraitNavToReadyMs !== undefined ? { portraitNavToReadyMs: extra.portraitNavToReadyMs } : {}),
    ...(iframeAt !== undefined && launchAt > 0 ? { iframeAttachedMs: iframeAt - launchAt } : {}),
    ...(portraitAt !== undefined && launchAt > 0 ? { portraitNavMs: portraitAt - launchAt } : {}),
    ...(extra.confirmMs !== undefined ? { confirmMs: extra.confirmMs } : {}),
    detectionLagMaxMs: POLL_MS,
    startedAt: extra.startedAt ?? startedAt,
    ...(extra.stoppedAt !== undefined ? { stoppedAt: extra.stoppedAt } : {}),
    startEvent: 'launcher Play click',
    ...(extra.stopEvent !== undefined ? { stopEvent: extra.stopEvent } : {}),
    detail: extra.detail,
    consoleErrors,
  };
}

async function arm3g(page: Page): Promise<import('playwright').CDPSession> {
  const client = await page.context().newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.setCacheDisabled', { cacheDisabled: true });
  await client.send('Network.emulateNetworkConditions', {
    offline: NETWORK.offline,
    downloadThroughput: NETWORK.downloadThroughput,
    uploadThroughput: NETWORK.uploadThroughput,
    latency: NETWORK.latency,
  });
  return client;
}

async function waitForSplashPlay(
  page: Page,
  iframeSelector: string,
  manifest: GameManifest,
  launchAt: number,
  gameId: string,
  run: number,
  hooks?: { onInteractive: (at: number) => void },
): Promise<{ at: number; x: number; y: number; width: number; height: number; type: string } | undefined> {
  const profile = loadSurfaceProfile(manifest);
  const shape = profile.splashPlayShape ?? { minAspect: 0.75, maxAspect: 1.33 };
  const deadline = launchAt + LOAD_TIMEOUT_MS;
  while (performance.now() < deadline) {
    const seenAt = performance.now();
    const hits = await listPhaserInteractive(page, iframeSelector).catch(() => []);
    const play =
      pickPhaserControl(hits, 'spin', profile) === undefined
        ? pickPhaserControl(hits, 'attractPlay', profile)
        : undefined;
    const painted = play !== undefined && (play.type === '' || /image|sprite/i.test(play.type));
    const aspect = play === undefined ? 0 : play.width / Math.max(1, play.height);
    if (painted && play !== undefined && aspect >= shape.minAspect && aspect <= shape.maxAspect) {
      const ready = {
        at: seenAt,
        x: play.xRatio,
        y: play.yRatio,
        width: play.width,
        height: play.height,
        type: play.type,
      };
      hooks?.onInteractive(ready.at);
      await page.screenshot({ path: shotPath(gameId, run, 'ready'), timeout: 10_000 }).catch(() => undefined);
      return ready;
    }
    await page.waitForTimeout(POLL_MS);
  }
  return undefined;
}

function shotPath(gameId: string, run: number, label: string): string {
  const dir = path.join('test-results', 'package1-3g');
  mkdirSync(dir, { recursive: true });
  const prefix = process.env.SGAP_3G_LABEL ?? '';
  return path.join(dir, `${gameId}-${prefix}run${run}-${label}.png`);
}

function writeReport(
  records: readonly RunRecord[],
  browserVersion: string,
  viewport: { width: number; height: number },
): unknown {
  const report = {
    network: {
      ...NETWORK,
      downloadKbps: 400,
      uploadKbps: 400,
      latencyMs: NETWORK.latency,
    },
    cachePolicy: 'Network.setCacheDisabled true, fresh browser context, service workers blocked',
    browser: browserVersion,
    viewport,
    siteIsolation: 'disabled for this run so the 3G profile applies inside the game iframe',
    pollMs: POLL_MS,
    records,
    games: summarize(records),
  };
  const dir = path.join('test-results', 'package1-3g');
  mkdirSync(dir, { recursive: true });
  const parallel = process.env.SGAP_3G_PARALLEL === '1';
  const stem = parallel
    ? `parallel-${records[0]?.gameId ?? 'game'}`
    : SIDE_REPORT
      ? 'package1-3g-rerun'
      : 'package1-3g-load';
  writeFileSync(path.join(dir, `${stem}.json`), JSON.stringify(report, null, 2));
  const markdown = renderMarkdown(report);
  if (parallel || SIDE_REPORT) {
    writeFileSync(path.join(dir, `${stem}.md`), markdown);
  } else {
    writeFileSync(path.join('docs', 'PACKAGE1_3G_LOAD.md'), markdown);
  }
  return report;
}

function summarize(records: readonly RunRecord[]): Array<{
  gameId: string;
  displayName: string;
  runsMs: Array<number | null>;
  medianMs: number | null;
  status: string;
}> {
  const ids = [...new Set(records.map((record) => record.gameId))];
  return ids.map((gameId) => {
    const rows = records.filter((record) => record.gameId === gameId);
    const runsMs = rows.map((row) => (row.status === 'measured' ? row.launchToReadyMs ?? null : null));
    const numeric = runsMs.filter((value): value is number => value !== null).slice().sort((a, b) => a - b);
    const medianMs = numeric.length === 3 ? numeric[1] ?? null : null;
    const status = numeric.length === rows.length ? 'measured' : numeric.length === 0 ? rows[0]?.status ?? 'pending' : 'partial';
    return {
      gameId,
      displayName: rows[0]?.displayName ?? gameId,
      runsMs,
      medianMs,
      status,
    };
  });
}

function renderMarkdown(report: {
  network: { name: string; downloadThroughput: number; uploadThroughput: number; latency: number };
  cachePolicy: string;
  browser: string;
  viewport: { width: number; height: number };
  siteIsolation: string;
  pollMs: number;
  records: readonly RunRecord[];
  games: ReturnType<typeof summarize>;
}): string {
  const lines = [
    '# 3G runtime simulation',
    '',
    'The clock starts at the launcher Play click and stops when the splash Play button is input-enabled. The run for that game ends there.',
    '',
    `- Network: ${report.network.name}. Download ${report.network.downloadThroughput} B/s (400 Kbps), upload ${report.network.uploadThroughput} B/s (400 Kbps), latency ${report.network.latency} ms. No other throttling preset.`,
    `- Browser: ${report.browser}`,
    `- Viewport: ${report.viewport.width}x${report.viewport.height}`,
    `- Cache: ${report.cachePolicy}`,
    `- Iframe: ${report.siteIsolation}`,
    `- Detection: Phaser poll every ${report.pollMs} ms. The recorded time can be up to one poll later than the button actually enabled. That lag is not subtracted.`,
    '',
    '| Game | Run 1 | Run 2 | Run 3 | Median | Status |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  const ranked = [...report.games].sort((a, b) => {
    if (a.medianMs === null) return 1;
    if (b.medianMs === null) return -1;
    return a.medianMs - b.medianMs;
  });
  for (const game of ranked) {
    const cells = [0, 1, 2].map((index) => formatSeconds(game.runsMs[index] ?? null));
    lines.push(`| ${game.displayName} | ${cells[0]} | ${cells[1]} | ${cells[2]} | ${formatSeconds(game.medianMs)} | ${game.status} |`);
  }
  lines.push('', '## Raw milliseconds', '');
  for (const record of report.records) {
    lines.push(
      `- ${record.displayName} run ${record.run}: ${record.status}` +
        `${record.launchToReadyMs === undefined ? '' : `, launch→ready ${record.launchToReadyMs} ms`}` +
        `${record.iframeAttachedMs === undefined ? '' : `, iframe attached ${record.iframeAttachedMs} ms`}` +
        `${record.portraitNavMs === undefined ? '' : `, portrait layout ${record.portraitNavMs} ms`}` +
        `${record.portraitNavToReadyMs === undefined ? '' : `, portrait nav→ready ${record.portraitNavToReadyMs} ms`}` +
        `. ${record.detail}`,
    );
    if (record.consoleErrors.length > 0) {
      lines.push(`  - console: ${record.consoleErrors.join(' | ')}`);
    }
  }
  const withMedian = ranked.filter((game) => game.medianMs !== null);
  if (withMedian.length > 0) {
    const fastest = withMedian[0];
    const slowest = withMedian[withMedian.length - 1];
    lines.push('', `Fastest median: ${fastest?.displayName} ${formatSeconds(fastest?.medianMs ?? null)}.`);
    lines.push(`Slowest median: ${slowest?.displayName} ${formatSeconds(slowest?.medianMs ?? null)}.`);
  }
  lines.push('');
  return lines.join('\n');
}

function formatSeconds(ms: number | null): string {
  if (ms === null) {
    return '—';
  }
  return `${(ms / 1000).toFixed(3)} s`;
}
