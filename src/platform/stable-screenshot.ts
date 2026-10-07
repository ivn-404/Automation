/**
 * Region screenshots that leave the live window alone.
 *
 * Chromium's clipped capture (`locator.screenshot`, `page.screenshot({ clip })`)
 * briefly redraws a headed window with the clip moved to its top-left corner, so
 * the tester sees the game jump on every vision or reel check
 * (scripts/diagnose-screenshot-view.mjs reproduces it). An unclipped viewport
 * capture does not, so regions are cut out of one viewport shot in Node, with the
 * same integer rounding Playwright applies to element screenshots.
 *
 * After a capture, lanes that are watched on screen (SGAP_SCREENSHOT_TOAST=1)
 * show a small "Screenshot captured" notice on the host page. Every capture hides
 * the notice through Playwright's `style` option, so it never lands in an image.
 */
import type { Locator, Page } from 'playwright';
import { PNG } from 'pngjs';

export const SCREENSHOT_TOAST_ID = 'sgap-screenshot-toast';

/** Pass as `style` to any page screenshot so the notice stays out of the picture. */
export const HIDE_SCREENSHOT_TOAST = `#${SCREENSHOT_TOAST_ID}{display:none !important}`;

const TOAST_VISIBLE_MS = 1_200;

export interface ScreenRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StableScreenshotOptions {
  readonly timeout?: number;
  /** Shown under the notice title, e.g. "vision" or "reel check". */
  readonly label?: string;
}

/** PNG of `region` (CSS pixels of the page viewport). */
export async function captureViewportRegion(
  page: Page,
  region: ScreenRegion,
  options?: StableScreenshotOptions,
): Promise<Buffer> {
  const full = await page.screenshot({
    type: 'png',
    style: HIDE_SCREENSHOT_TOAST,
    ...(options?.timeout !== undefined ? { timeout: options.timeout } : {}),
  });
  const cropped = cropPng(full, region, page.viewportSize());
  notifyScreenshotCaptured(page, options?.label);
  return cropped;
}

/** PNG of a visible element, e.g. the game canvas inside the iframe. */
export async function captureLocator(
  locator: Locator,
  options?: StableScreenshotOptions,
): Promise<Buffer> {
  const box = await locator.boundingBox(
    options?.timeout !== undefined ? { timeout: options.timeout } : undefined,
  );
  if (box === null || box.width <= 0 || box.height <= 0) {
    throw new Error('Element is not visible — nothing to screenshot');
  }
  return captureViewportRegion(locator.page(), box, options);
}

function cropPng(
  png: Buffer,
  region: ScreenRegion,
  viewport: { readonly width: number; readonly height: number } | null,
): Buffer {
  const image = PNG.sync.read(png);
  const scale = viewport !== null && viewport.width > 0 ? image.width / viewport.width : 1;
  const left = clamp(Math.floor(region.x * scale), 0, image.width - 1);
  const top = clamp(Math.floor(region.y * scale), 0, image.height - 1);
  const right = clamp(Math.ceil((region.x + region.width) * scale), left + 1, image.width);
  const bottom = clamp(Math.ceil((region.y + region.height) * scale), top + 1, image.height);
  const out = new PNG({ width: right - left, height: bottom - top });
  PNG.bitblt(image, out, left, top, out.width, out.height, 0, 0);
  return PNG.sync.write(out);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const TOAST_SCRIPT = `(({ id, label, ms }) => {
  let toast = document.getElementById(id);
  if (!toast) {
    toast = document.createElement('div');
    toast.id = id;
    toast.setAttribute('aria-hidden', 'true');
    toast.style.cssText = [
      'position:fixed', 'right:14px', 'bottom:14px', 'z-index:2147483647', 'pointer-events:none',
      'min-width:170px', 'padding:8px 12px', 'border-radius:8px', 'text-align:center',
      'background:rgba(12,13,18,0.92)', 'color:#e8e9ee', 'border:1px solid rgba(255,255,255,0.14)',
      'font:12px/1.4 "Segoe UI",system-ui,sans-serif', 'box-shadow:0 6px 18px rgba(0,0,0,0.45)',
      'transition:opacity 0.2s ease', 'opacity:0',
    ].join(';');
    toast.innerHTML = '<div style="font-weight:600">Screenshot captured</div><div data-detail style="color:#9aa1b2"></div>';
    document.documentElement.appendChild(toast);
  }
  toast.querySelector('[data-detail]').textContent = label + ' · ' + new Date().toLocaleTimeString();
  toast.style.opacity = '1';
  clearTimeout(window.__sgapShotToastTimer);
  window.__sgapShotToastTimer = setTimeout(() => { toast.style.opacity = '0'; }, ms);
})`;

/** Fire-and-forget notice on the host page; never delays or fails the capture. */
export function notifyScreenshotCaptured(page: Page, label = 'screenshot'): void {
  if (process.env.SGAP_SCREENSHOT_TOAST !== '1' || page.isClosed()) {
    return;
  }
  void page
    .evaluate(`${TOAST_SCRIPT}(${JSON.stringify({ id: SCREENSHOT_TOAST_ID, label, ms: TOAST_VISIBLE_MS })})`)
    .catch(() => undefined);
}
