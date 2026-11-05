/**
 * Bounded learn-by-spinning for an unknown game: tap the discovered spin, wait for /bet,
 * dismiss a leftover overlay once if needed, repeat. Never taps buy, autoplay, amplify or confirm.
 */

import type { Page, Response } from 'playwright';

import { inspectRuntime, renderFrame, type RuntimeSnapshot } from './inspect.js';

export interface LearnSpinPoint {
  readonly x: number;
  readonly y: number;
}

export interface LearnSpinsResult {
  readonly bodies: unknown[];
  readonly evidence: readonly string[];
  readonly blocked?: string;
}

const SPIN_WAIT_MS = 45_000;
const SETTLE_MS = 12_000;
const MAX_SPINS = 3;
const OVERLAY = /(?:tap|press|click).{0,16}(?:to |anywhere)|anywhere to (?:spin|play|continue)|click to continue/iu;

/** True when HUD copy is a press-anywhere / tap-to-continue overlay, not a panel Start. */
export function isPressAnywhereText(text: string): boolean {
  return OVERLAY.test(text);
}

async function tapCanvas(page: Page, point: LearnSpinPoint): Promise<boolean> {
  const frame = await renderFrame(page);
  const box = await frame.locator('canvas').first().boundingBox();
  if (box === null) return false;
  await page.mouse.click(box.x + point.x * box.width, box.y + point.y * box.height);
  return true;
}

function isBet(response: Response): boolean {
  try {
    const url = new URL(response.url());
    return /\/(slots\/)?bet$/iu.test(url.pathname) && (response.request().resourceType() === 'xhr' || response.request().resourceType() === 'fetch');
  } catch {
    return false;
  }
}

function snapshotHasSpin(snapshot: RuntimeSnapshot | undefined): boolean {
  if (snapshot === undefined) return false;
  return snapshot.objects.some((object) => /spin/iu.test(`${object.key} ${object.name}`) && !/auto|free|turbo/iu.test(`${object.key} ${object.name}`));
}

function overlayHint(snapshot: RuntimeSnapshot | undefined): string | undefined {
  return snapshot?.texts.find((text) => isPressAnywhereText(text.text))?.text;
}

async function readHud(page: Page): Promise<RuntimeSnapshot | undefined> {
  return inspectRuntime(await renderFrame(page)).catch(() => undefined);
}

/** One mid-panel tap only when the HUD shows a press-anywhere / continue overlay. */
async function dismissOverlayOnce(page: Page, evidence: string[]): Promise<boolean> {
  const snapshot = await readHud(page);
  const hint = overlayHint(snapshot);
  if (hint === undefined) return snapshotHasSpin(snapshot);
  await tapCanvas(page, { x: 0.5, y: 0.55 });
  evidence.push(`dismissed overlay "${hint}" with one mid-panel tap`);
  await page.waitForTimeout(800);
  return snapshotHasSpin(await readHud(page));
}

/** Up to `count` normal spins (capped). Returns the /bet JSON bodies, or stops on 401/403. */
export async function learnBySpinning(page: Page, spin: LearnSpinPoint, count = 2): Promise<LearnSpinsResult> {
  const evidence: string[] = [];
  const bodies: unknown[] = [];
  const planned = Math.min(MAX_SPINS, Math.max(1, count));
  for (let i = 1; i <= planned; i += 1) {
    const idle = await dismissOverlayOnce(page, evidence);
    if (!idle && !snapshotHasSpin(await readHud(page))) {
      evidence.push(`spin ${i} skipped: HUD still blocked after one overlay dismiss`);
      break;
    }
    const pending = page.waitForResponse((response) => isBet(response), { timeout: SPIN_WAIT_MS }).catch(() => undefined);
    if (!(await tapCanvas(page, spin))) {
      return { bodies, evidence, blocked: 'no game canvas to tap for a learning spin' };
    }
    evidence.push(`learning spin ${i}/${planned} at ${spin.x},${spin.y}`);
    const response = await pending;
    if (response === undefined) {
      evidence.push(`spin ${i} produced no /bet within ${SPIN_WAIT_MS / 1000}s`);
      break;
    }
    if (response.status() === 401 || response.status() === 403) {
      return { bodies, evidence, blocked: `learning spin rejected (HTTP ${response.status()}). Request a new authorized testing session.` };
    }
    if (!response.ok()) {
      evidence.push(`spin ${i} /bet HTTP ${response.status()} — stopping learning spins`);
      break;
    }
    const body = await response.json().catch(() => undefined);
    if (body !== undefined) {
      bodies.push(body);
      evidence.push(`spin ${i} /bet HTTP ${response.status()}`);
    }
    const settleBy = Date.now() + SETTLE_MS;
    while (Date.now() < settleBy && !snapshotHasSpin(await readHud(page))) {
      await page.waitForTimeout(500);
    }
    if (!snapshotHasSpin(await readHud(page))) {
      const cleared = await dismissOverlayOnce(page, evidence);
      if (!cleared) {
        evidence.push(`spin ${i}: round still open after one overlay dismiss — stopping further learning spins`);
        break;
      }
    }
  }
  return { bodies, evidence };
}
