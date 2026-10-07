/**
 * Brute-force reelRegion candidates; score by same-spin self-consistency.
 *
 * Learn templates from a settled board, then re-read the SAME canvas crop grid.
 * A correct region scores near 100% MATCH. Wrong regions do not.
 *
 *   SGAP_LAUNCHER_MODE=staging npx pnpm build && node dist/driver/probe-reel-region.js
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
  clearCanvasOverlays,
} from '../platform/index.js';
import { UiRegistry } from '../ui/registry/index.js';
import { PlaywrightGameDriver } from './playwright-game-driver.js';
import {
  captureCanvasRgba,
  learnLiveSymbolTemplates,
  cellRect,
} from '../verification/reel/canvas-reel-reader.js';
import { parseReelGridFromBetResponse } from '../verification/reel/parse-reel-area.js';
import { encodePng, cropImage, bestTemplateMatch } from '../verification/reel/image-match.js';
import type { NormalizedRect } from '../core/models/index.js';
import { matchesBetUrl } from '../network/bet-url.js';

/** Dense grid around visually aligned Sugar board (logo above, candy-cane below). */
function buildCandidates(): Array<NormalizedRect & { label: string }> {
  const out: Array<NormalizedRect & { label: string }> = [];
  for (const y of [0.24, 0.25, 0.26, 0.27, 0.28]) {
    for (const height of [0.36, 0.37, 0.38, 0.39, 0.4]) {
      const bottom = y + height;
      if (bottom < 0.64 || bottom > 0.7) {
        continue;
      }
      for (const x of [0.03, 0.04, 0.05]) {
        for (const width of [0.9, 0.92, 0.94]) {
          if (x + width > 0.995) {
            continue;
          }
          out.push({
            label: `y${Math.round(y * 100)}_h${Math.round(height * 100)}_x${Math.round(x * 100)}`,
            x,
            y,
            width,
            height,
          });
        }
      }
    }
  }
  return out;
}

const CANDIDATES = buildCandidates();

async function main(): Promise<void> {
  process.env.SGAP_LAUNCHER_MODE = 'staging';
  const gameId = process.env.SGAP_GAME_ID ?? 'sugar-wonderland';
  const env = await new FileEnvironmentLoader({
    environmentsDir: defaultEnvironmentsDir(),
  }).load('staging');
  const manifest = await new FileGameManifestLoader({
    manifestsDir: defaultManifestsDir(),
  }).load(gameId);
  if (manifest.reelValidation === undefined) {
    throw new Error('reelValidation missing');
  }

  process.env.SGAP_PLAYER_ID = `${manifest.displayName}_probe_${Date.now().toString(36)}`;
  console.log(`player=${process.env.SGAP_PLAYER_ID}`);

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
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
  // Extra attract exit — probe must not spin while splash is up.
  for (const action of ['enter', 'acknowledge', 'acknowledgeAlt'] as const) {
    if (manifest.canvasActions?.actions[action] !== undefined) {
      await driver.clickCanvas(action, { singleInput: true }).catch(() => undefined);
    }
  }
  await clearCanvasOverlays(driver, manifest, 4, { forceGridSpam: true });
  // Turbo shortens reel stop so canvas matches bet.area sooner.
  if (manifest.canvasActions?.actions.turbo !== undefined) {
    await driver.clickCanvas('turbo', { singleInput: true }).catch(() => undefined);
  }

  const reelBandMean = async (): Promise<number[]> => {
    const shot = await captureCanvasRgba(driver);
    const { width, height, data } = shot.image;
    // Sample center reel band only (ignore sparkle chrome at edges).
    const x0 = Math.floor(width * 0.08);
    const x1 = Math.floor(width * 0.92);
    const y0 = Math.floor(height * 0.24);
    const y1 = Math.floor(height * 0.66);
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    const step = 4;
    for (let y = y0; y < y1; y += step) {
      for (let x = x0; x < x1; x += step) {
        const i = (y * width + x) * 4;
        r += data[i]!;
        g += data[i + 1]!;
        b += data[i + 2]!;
        n += 1;
      }
    }
    return n === 0 ? [0, 0, 0] : [r / n, g / n, b / n];
  };

  const meanDelta = (a: number[], b: number[]): number =>
    Math.abs(a[0]! - b[0]!) + Math.abs(a[1]! - b[1]!) + Math.abs(a[2]! - b[2]!);

  /** Wait for reel band to stop changing (turbo spin ~1–3s; normal longer). */
  async function waitForSettledBoard(): Promise<{
    image: Awaited<ReturnType<typeof captureCanvasRgba>>['image'];
    png: Buffer;
  }> {
    // Bet returns before reels finish — minimum wait before sampling.
    await page.waitForTimeout(2_500);
    const deadline = Date.now() + 18_000;
    let prev = await reelBandMean();
    let quietHits = 0;
    while (Date.now() < deadline) {
      await page.waitForTimeout(350);
      const next = await reelBandMean();
      const delta = meanDelta(prev, next);
      if (delta < 4) {
        quietHits += 1;
        if (quietHits >= 4) {
          console.log(`reel band quiet (delta=${delta.toFixed(2)})`);
          return captureCanvasRgba(driver);
        }
      } else {
        quietHits = 0;
      }
      prev = next;
    }
    console.log('settle timeout — capturing anyway');
    return captureCanvasRgba(driver);
  }

  // Prefer a zero-win board. After bet: do NOT click dismiss (can desync / retrigger).
  let body: unknown;
  let captured: Awaited<ReturnType<typeof captureCanvasRgba>> | undefined;
  for (let i = 0; i < 8; i += 1) {
    await clearCanvasOverlays(driver, manifest, 4, { forceGridSpam: true });
    const betPromise = page.waitForResponse(
      (response) => response.ok() && matchesBetUrl(response.url()),
      { timeout: 60_000 },
    );
    await driver.clickCanvas('spin', { singleInput: true });
    let response;
    try {
      response = await betPromise;
    } catch {
      await clearCanvasOverlays(driver, manifest, 6, { forceGridSpam: true });
      await driver.clickCanvas('enter', { singleInput: true }).catch(() => undefined);
      continue;
    }
    body = await response.json();
    const win = Number((body as { slot?: { totalWin?: number } }).slot?.totalWin ?? 0);
    captured = await waitForSettledBoard();
    console.log(`spin ${i + 1} totalWin=${win} settled`);
    if (win === 0) {
      break;
    }
    // Win overlays — one careful dismiss cycle, then re-settle.
    await clearCanvasOverlays(driver, manifest, 3, { forceGridSpam: true });
    await page.waitForTimeout(1_500);
    captured = await captureCanvasRgba(driver);
  }
  if (body === undefined || captured === undefined) {
    throw new Error('No bet response captured for reel probe');
  }

  const config = manifest.reelValidation;
  const backend = parseReelGridFromBetResponse(body, config);
  console.log(
    `candidates=${CANDIDATES.length} canvas=${captured.image.width}x${captured.image.height}`,
  );

  const outDir = path.join(process.cwd(), 'test-results', 'reel-probe');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'canvas.png'), captured.png);
  writeFileSync(path.join(outDir, 'bet.json'), JSON.stringify(body, null, 2));

  const scores: Array<{ label: string; match: number; total: number; region: NormalizedRect }> = [];

  for (const candidate of CANDIDATES) {
    const regionConfig = {
      ...config,
      reelRegion: candidate,
      cellInset: config.cellInset ?? 0.12,
    };
    const templates = learnLiveSymbolTemplates({
      canvasImage: captured.image,
      backendGrid: backend,
      config: regionConfig,
    });

    let matchCount = 0;
    const total = backend.columns * backend.rows;
    for (let col = 0; col < backend.columns; col += 1) {
      for (let row = 0; row < backend.rows; row += 1) {
        const selfIndex = col * backend.rows + row;
        const cell = backend.cells[col]![row]!;
        const selfTemplate = templates[selfIndex]!;
        const others = templates.filter((_, index) => index !== selfIndex);
        const match = bestTemplateMatch(
          selfTemplate.image,
          others.map((entry) => ({ id: entry.id, image: entry.image })),
        );
        if (match !== undefined && match.id === cell.symbolId && match.score >= 0.4) {
          matchCount += 1;
        }
      }
    }

    scores.push({
      label: candidate.label,
      match: matchCount,
      total,
      region: candidate,
    });
  }

  scores.sort((a, b) => b.match - a.match || a.label.localeCompare(b.label));
  console.log('\nTop candidates:');
  for (const entry of scores.slice(0, 15)) {
    console.log(
      `${entry.label.padEnd(22)} ${entry.match}/${entry.total} MATCH  region=${JSON.stringify({
        x: entry.region.x,
        y: entry.region.y,
        width: entry.region.width,
        height: entry.region.height,
      })}`,
    );
  }
  const best = scores[0]!;
  console.log('\nBEST:', best);

  // Dump cell crops for the best region
  for (let col = 0; col < backend.columns; col += 1) {
    for (let row = 0; row < backend.rows; row += 1) {
      const cell = backend.cells[col]![row]!;
      const rect = cellRect(
        best.region,
        backend.columns,
        backend.rows,
        col,
        row,
        0.18,
        captured.image.width,
        captured.image.height,
      );
      const crop = cropImage(captured.image, rect.x, rect.y, rect.width, rect.height);
      writeFileSync(
        path.join(
          outDir,
          `c${cell.column}r${cell.row}_id${cell.symbolId}_${cell.symbolName}.png`,
        ),
        encodePng(crop),
      );
    }
  }

  writeFileSync(path.join(outDir, 'scores.json'), JSON.stringify(scores, null, 2));
  console.log(`Wrote crops + scores to ${outDir}`);
  await browser.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
