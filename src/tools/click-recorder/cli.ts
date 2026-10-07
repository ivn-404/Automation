/**
 * SGAP Click Recorder CLI — persistent QA discovery tool.
 *
 *   SGAP_LAUNCHER_MODE=staging npx pnpm recorder
 *   SGAP_LAUNCHER_MODE=staging npx pnpm recorder -- --skip-prime
 *
 * Evidence only. Confirm writes JSON; it does not patch tests or manifests.
 */

import { chromium, type Page } from 'playwright';

import {
  defaultEnvironmentsDir,
  defaultManifestsDir,
  FileEnvironmentLoader,
  FileGameManifestLoader,
  PlaywrightPlatform,
  primeCanvasSession,
} from '../../platform/index.js';
import { UiRegistry } from '../../ui/registry/index.js';
import { PlaywrightGameDriver } from '../../driver/playwright-game-driver.js';
import { INSTALL_CLICK_CAPTURE_FN } from './capture-script.js';
import {
  installGameHotkeys,
  openControlPanel,
  readCommand,
  setPanel,
} from './control-panel.js';
import { logClick, logCommand } from './log.js';
import { snapshotFromRaw } from './locators.js';
import { installRecorderMarkers, renderRecorderMarkers } from './markers.js';
import { saveRecorderEvidence } from './save.js';
import { RecorderSession } from './session.js';
import type { ClickSurface, OverlayReport } from './types.js';

interface RawClickPayload {
  readonly surface?: string;
  readonly inGameIframe?: boolean;
  readonly pageUrl?: string;
  readonly frameUrl?: string;
  readonly clientX?: number;
  readonly clientY?: number;
  readonly normalizedX?: number;
  readonly normalizedY?: number;
  readonly timestamp?: string;
  readonly element?: {
    readonly tagName?: string;
    readonly id?: string;
    readonly className?: string;
    readonly text?: string;
    readonly role?: string;
    readonly name?: string;
    readonly attributes?: Record<string, string>;
    readonly boundingBox?: { x: number; y: number; width: number; height: number };
  };
  readonly overlay?: OverlayReport;
}

async function ensureClickCapture(page: Page): Promise<void> {
  for (const frame of page.frames()) {
    await frame.evaluate(INSTALL_CLICK_CAPTURE_FN).catch(() => undefined);
  }
}

async function iframeOffset(page: Page, iframeSelector: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(iframeSelector).first().boundingBox().catch(() => null);
  if (box === null) {
    return { x: 0, y: 0 };
  }
  return { x: box.x, y: box.y };
}

function isSurface(value: string | undefined): value is ClickSurface {
  return (
    value === 'iframe-canvas' ||
    value === 'iframe-dom' ||
    value === 'host-dom' ||
    value === 'host-canvas'
  );
}

export async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const gameId = process.env.SGAP_GAME_ID?.trim() || 'sugar-wonderland';
  const envName = process.env.SGAP_LAUNCHER_MODE?.trim() || 'staging';
  const skipPrime = argv.includes('--skip-prime');

  const env = await new FileEnvironmentLoader({
    environmentsDir: defaultEnvironmentsDir(),
  }).load(envName);
  const manifest = await new FileGameManifestLoader({
    manifestsDir: defaultManifestsDir(),
  }).load(gameId);
  const ui = new UiRegistry(manifest);
  const iframeSelector = ui.resolveIframe().selector;
  const session = new RecorderSession(gameId);

  console.log(`[RECORDER] Opening ${manifest.displayName} (${envName})`);
  console.log('[RECORDER] Demonstrate clicks, then Confirm. Close when finished.');
  console.log('[RECORDER] This tool never writes automation code.');

  const browser = await chromium.launch({ headless: false, slowMo: 40 });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    hasTouch: true,
  });
  const page = await context.newPage();
  const panel = await openControlPanel(browser);

  const pending: RawClickPayload[] = [];
  await page.exposeBinding('sgapRecordClick', (_source, payload: RawClickPayload) => {
    pending.push(payload);
  });

  const refreshUi = async (): Promise<void> => {
    await renderRecorderMarkers(page, session.snapshot().clicks);
    await setPanel(panel, {
      title: 'SGAP Click Recorder',
      hint: 'Click the game, then Confirm / Accept / Skip. Revert Last undoes one click.',
      mode: 'Recording',
      count: session.live().length,
      history: session.historyLine(),
    });
  };

  try {
    const platform = new PlaywrightPlatform({ page, environment: env, manifest, ui });
    await platform.openGameHost();
    await platform.openGame();
    await platform.prepareMobilePortraitSession();

    const driver = new PlaywrightGameDriver({
      page,
      ui,
      manifest,
      defaultTimeoutMs: env.defaultTimeoutMs,
    });
    await driver.attach();
    await driver.gameCanvas().waitFor({ state: 'visible', timeout: 90_000 });

    if (!skipPrime) {
      await primeCanvasSession({
        page,
        driver,
        manifest,
        initializeBody: platform.getInitializeBody(),
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[RECORDER] primeCanvasSession skipped (${message}). Retry with --skip-prime if needed.`);
      });
    }

    await installRecorderMarkers(page);
    await installGameHotkeys(page);
    await ensureClickCapture(page);
    page.on('framenavigated', () => {
      void ensureClickCapture(page);
    });

    await refreshUi();
    await panel.bringToFront();
    logCommand('Ready. Keep Chrome and the small panel open until Close.');

    let lastArmMs = Date.now();
    let lastSavedPath: string | undefined;

    while (!page.isClosed() && !panel.isClosed()) {
      while (pending.length > 0) {
        const raw = pending.shift();
        if (raw === undefined || typeof raw.clientX !== 'number' || typeof raw.clientY !== 'number') {
          continue;
        }
        const inIframe = raw.inGameIframe === true;
        const offset = inIframe ? await iframeOffset(page, iframeSelector) : { x: 0, y: 0 };
        const element =
          raw.element?.tagName !== undefined
            ? snapshotFromRaw({
                tagName: raw.element.tagName,
                id: raw.element.id,
                className: raw.element.className,
                text: raw.element.text,
                role: raw.element.role,
                name: raw.element.name,
                attributes: raw.element.attributes ?? {},
                boundingBox: raw.element.boundingBox,
              })
            : undefined;
        const click = session.add({
          surface: isSurface(raw.surface)
            ? raw.surface
            : inIframe
              ? 'iframe-canvas'
              : 'host-dom',
          pageUrl: raw.pageUrl ?? page.url(),
          frameUrl: raw.frameUrl,
          inGameIframe: inIframe,
          clientX: raw.clientX,
          clientY: raw.clientY,
          pageX: Math.round(offset.x + raw.clientX),
          pageY: Math.round(offset.y + raw.clientY),
          normalizedX: raw.normalizedX,
          normalizedY: raw.normalizedY,
          element,
          overlay: raw.overlay,
          timestamp: raw.timestamp ?? new Date().toISOString(),
        });
        logClick(click);
        await refreshUi();
      }

      const cmd = await readCommand(panel, page);
      if (cmd === 'close') {
        logCommand('Close — session ended. Previously confirmed files are kept.');
        break;
      }
      if (cmd === 'accept') {
        const accepted = session.acceptLatest();
        logCommand(accepted !== undefined ? `Accept — click #${accepted.seq} kept; continue recording.` : 'Accept — no active click to keep.');
        await refreshUi();
      }
      if (cmd === 'skip') {
        const skipped = session.skipLatest();
        logCommand(skipped !== undefined ? `Skip — click #${skipped.seq} ignored.` : 'Skip — nothing to ignore.');
        await refreshUi();
      }
      if (cmd === 'revert-last') {
        const reverted = session.revertLast();
        logCommand(reverted !== undefined ? `Revert Last — removed click #${reverted.seq}.` : 'Revert Last — history already empty.');
        await refreshUi();
      }
      if (cmd === 'revert-all') {
        session.revertAll();
        logCommand('Revert All — current session click history cleared (tests untouched).');
        await refreshUi();
      }
      if (cmd === 'confirm') {
        const live = session.live();
        if (live.length === 0) {
          logCommand('Confirm — no live clicks yet. Click the game first.');
        } else {
          for (const click of live) {
            if (click.state === 'active') {
              session.acceptLatest();
            }
          }
          lastSavedPath = await saveRecorderEvidence(session.snapshot());
          logCommand(`Confirm — preserved ${session.live().length} click(s) → ${lastSavedPath}`);
          logCommand('Analyze this file before writing locators or canvasActions.');
          await refreshUi();
          await setPanel(panel, {
            title: 'Confirmed — keep recording or Close',
            hint: lastSavedPath,
            mode: 'Confirmed',
            count: session.live().length,
            history: session.historyLine(),
          });
        }
      }

      if (Date.now() - lastArmMs > 2500) {
        await ensureClickCapture(page);
        await installRecorderMarkers(page);
        lastArmMs = Date.now();
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    if (session.live().length > 0 && lastSavedPath === undefined) {
      lastSavedPath = await saveRecorderEvidence(session.snapshot());
      logCommand(`Auto-saved on close → ${lastSavedPath}`);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (/has been closed|Target closed/i.test(message)) {
    console.error('[RECORDER] Browser closed early. Leave Chrome open until you click Close.');
    console.error('[RECORDER] Restart: SGAP_LAUNCHER_MODE=staging npx pnpm recorder -- --skip-prime');
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
