/**
 * Live FPS badge on the launcher page (outside the game iframe, so the game is untouched).
 * Text only, updated about twice a second. Hidden from SGAP vision screenshots by
 * `HIDE_SCREENSHOT_TOAST`.
 */

import type { Page } from 'playwright';

import { FPS_COUNTER_ID } from '../platform/stable-screenshot.js';

export interface FpsCounterState {
  readonly fps: number;
  readonly low1: number;
  readonly color: string;
  readonly band: string;
  readonly status: string;
}

export function isFpsCounterEnabled(): boolean {
  const value = process.env.SGAP_PERF_COUNTER?.trim().toLowerCase();
  return !(value === '0' || value === 'false' || value === 'no');
}

export async function showFpsCounter(page: Page, state: FpsCounterState): Promise<void> {
  await page
    .evaluate(
      ({ id, state: s }) => {
        let badge = document.getElementById(id);
        if (badge === null) {
          badge = document.createElement('div');
          badge.id = id;
          badge.setAttribute('aria-hidden', 'true');
          badge.style.cssText = [
            'position:fixed',
            'top:8px',
            'left:8px',
            'z-index:2147483647',
            'pointer-events:none',
            'font:600 12px/1.35 ui-monospace,Consolas,monospace',
            'color:#fff',
            'background:rgba(15,23,42,.88)',
            'border-radius:8px',
            'padding:6px 10px',
            'min-width:150px',
            'box-shadow:0 2px 8px rgba(0,0,0,.35)',
          ].join(';');
          document.body.appendChild(badge);
        }
        const fps = Number.isFinite(s.fps) ? Math.round(s.fps) : '–';
        const low = Number.isFinite(s.low1) ? Math.round(s.low1) : '–';
        badge.style.borderLeft = `6px solid ${s.color}`;
        badge.textContent = '';
        const head = document.createElement('div');
        head.style.fontSize = '18px';
        head.textContent = `${fps} FPS`;
        const sub = document.createElement('div');
        sub.textContent = `1% low ${low} · ${s.band}`;
        const status = document.createElement('div');
        status.style.opacity = '.75';
        status.textContent = s.status;
        badge.append(head, sub, status);
      },
      { id: FPS_COUNTER_ID, state },
    )
    .catch(() => undefined);
}

/** Text the badge currently shows (PAD-054 checks it against the recorded numbers). */
export async function readFpsCounter(page: Page): Promise<number | undefined> {
  const text = await page
    .locator(`#${FPS_COUNTER_ID}`)
    .first()
    .textContent({ timeout: 1_000 })
    .catch(() => null);
  const match = text?.match(/^(\d+)\s*FPS/);
  return match === null || match === undefined ? undefined : Number(match[1]);
}

export async function hideFpsCounter(page: Page): Promise<void> {
  await page
    .evaluate((id) => document.getElementById(id)?.remove(), FPS_COUNTER_ID)
    .catch(() => undefined);
}
