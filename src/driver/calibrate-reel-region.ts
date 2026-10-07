/**
 * Dump a canvas screenshot with a Column×Row grid overlay for reelRegion calibration.
 *
 *   SGAP_LAUNCHER_MODE=staging npx pnpm calibrate:reel
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { chromium } from 'playwright';

import {
  defaultEnvironmentsDir,
  defaultManifestsDir,
  FileEnvironmentLoader,
  FileGameManifestLoader,
  PlaywrightPlatform,
  primeCanvasSession,
} from '../platform/index.js';
import { UiRegistry } from '../ui/registry/index.js';
import { encodePng, decodePng } from '../verification/reel/image-match.js';
import { parseReelGridFromBetResponse } from '../verification/reel/parse-reel-area.js';
import { PlaywrightGameDriver } from './playwright-game-driver.js';
import { matchesBetUrl } from '../network/bet-url.js';

async function main(): Promise<void> {
  process.env.SGAP_LAUNCHER_MODE = process.env.SGAP_LAUNCHER_MODE ?? 'staging';
  const gameId = process.env.SGAP_GAME_ID ?? 'sugar-wonderland';

  const env = await new FileEnvironmentLoader({
    environmentsDir: defaultEnvironmentsDir(),
  }).load(process.env.SGAP_ENV ?? 'staging');
  const manifest = await new FileGameManifestLoader({
    manifestsDir: defaultManifestsDir(),
  }).load(gameId);

  if (!process.env.SGAP_PLAYER_ID) {
    process.env.SGAP_PLAYER_ID = `${manifest.displayName}_reelcal_${Date.now().toString(36)}`;
  }
  console.log(`Using player: ${process.env.SGAP_PLAYER_ID}`);

  if (manifest.reelValidation === undefined) {
    throw new Error(`Game ${gameId} has no reelValidation config`);
  }

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });

  const ui = new UiRegistry(manifest);
  const platform = new PlaywrightPlatform({ page, environment: env, manifest, ui });
  const driver = new PlaywrightGameDriver({
    page,
    ui,
    manifest,
    defaultTimeoutMs: env.defaultTimeoutMs,
  });

  await platform.openGameHost();
  await platform.openGame();
  await platform.prepareMobilePortraitSession();
  await driver.attach();
  await primeCanvasSession({
    page,
    driver,
    manifest,
    initializeBody: platform.getInitializeBody(),
  });

  const betPromise = page.waitForResponse(
    (response) => response.ok() && matchesBetUrl(response.url()),
    { timeout: 45_000 },
  );
  await driver.clickCanvas('spin', { singleInput: true });
  const response = await betPromise;
  const body = await response.json();
  const grid = parseReelGridFromBetResponse(body, manifest.reelValidation);

  // Allow stop / overlays to settle before capture
  await page.waitForTimeout(4_000);

  const canvas = driver.gameCanvas();
  const png = await canvas.screenshot({ type: 'png' });
  const image = decodePng(png);
  const { reelRegion } = manifest.reelValidation;
  const boardX = Math.floor(reelRegion.x * image.width);
  const boardY = Math.floor(reelRegion.y * image.height);
  const boardW = Math.floor(reelRegion.width * image.width);
  const boardH = Math.floor(reelRegion.height * image.height);
  const cellW = boardW / grid.columns;
  const cellH = boardH / grid.rows;

  const data = Buffer.from(image.data);
  const plot = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
      return;
    }
    const i = (y * image.width + x) * 4;
    data[i] = 255;
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = 255;
  };

  for (let col = 0; col <= grid.columns; col += 1) {
    const x = Math.round(boardX + col * cellW);
    for (let y = boardY; y < boardY + boardH; y += 1) {
      plot(x, y);
    }
  }
  for (let row = 0; row <= grid.rows; row += 1) {
    const y = Math.round(boardY + row * cellH);
    for (let x = boardX; x < boardX + boardW; x += 1) {
      plot(x, y);
    }
  }

  const outDir = path.join(process.cwd(), 'test-results');
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `reel-region-overlay-${gameId}.png`);
  writeFileSync(outPath, encodePng({ width: image.width, height: image.height, data }));
  console.log(`Wrote ${outPath}`);
  console.log(`Backend grid: ${grid.columns}x${grid.rows}`);
  console.log(`reelRegion: ${JSON.stringify(reelRegion)}`);

  await browser.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
