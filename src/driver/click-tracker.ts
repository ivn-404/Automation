/**
 * Visual click indicator for Playwright runs.
 *
 * Games render inside a fullscreen iframe (Phaser canvas). The hand pointer is
 * drawn on a host-page overlay above the iframe/modal stack.
 *
 * Default: ON for every test run (disable with SGAP_CLICK_TRACKER=0).
 * Optional click log panel: SGAP_CLICK_TRACKER_PANEL=1
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Frame, Locator, Page } from 'playwright';

export interface ClickRecord {
  readonly label: string;
  readonly pageX: number;
  readonly pageY: number;
  readonly kind: 'canvas' | 'dom' | 'mouse' | 'auto' | 'host';
}

export interface ClickTrackerEnableOptions {
  readonly headless?: boolean;
}

const patchedMousePages = new WeakSet<Page>();
const activeTrackerPages = new WeakSet<Page>();
const frameHandlers = new WeakMap<
  Page,
  {
    onFrameAttached: (frame: Frame) => void;
    onFrameNavigated: (frame: Frame) => void;
  }
>();

export function isClickTrackerEnabled(_options?: ClickTrackerEnableOptions): boolean {
  const value = process.env.SGAP_CLICK_TRACKER?.trim().toLowerCase();
  if (value === '0' || value === 'false' || value === 'no') {
    return false;
  }
  return true;
}

function isTrackerActive(page: Page): boolean {
  return activeTrackerPages.has(page) || isClickTrackerEnabled();
}

function isClickTrackerPanelEnabled(): boolean {
  const value = process.env.SGAP_CLICK_TRACKER_PANEL?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

const SHOW_PANEL = isClickTrackerPanelEnabled();
const POINTER_DISPLAY_MS = 2_500;
const POINTER_WIDTH_PX = 30;

/** Transparent PNG — white background removed; only the red hand is visible. */
function loadClickIndicatorDataUrl(): string {
  const candidates = [
    path.join(process.cwd(), 'assets', 'click-indicator.png'),
    path.join(process.cwd(), 'ClickIndicator.png'),
  ];
  for (const assetPath of candidates) {
    try {
      const buffer = readFileSync(assetPath);
      const mime =
        assetPath.endsWith('.jpg') || assetPath.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
      return `data:${mime};base64,${buffer.toString('base64')}`;
    } catch {
      // try next candidate
    }
  }
  return '';
}

const CLICK_INDICATOR_DATA_URL = loadClickIndicatorDataUrl();

/** Browser-side click indicator (injected via page.evaluate + payload). */
const SHOW_CLICK_INDICATOR_BODY = `
  const pageX = payload.pageX;
  const pageY = payload.pageY;
  const label = payload.label;
  const pointerSrc = payload.pointerSrc;
  const showPanel = payload.showPanel;
  const displayMs = payload.displayMs;
  const pointerWidthPx = payload.pointerWidthPx;

  if (!document.getElementById('sgap-click-indicator-style')) {
    const style = document.createElement('style');
    style.id = 'sgap-click-indicator-style';
    style.textContent = \`
      #sgap-click-overlay-root {
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        margin: 0 !important;
        padding: 0 !important;
        pointer-events: none !important;
        z-index: 2147483647 !important;
        overflow: visible !important;
      }
      @keyframes sgap-click-pointer-pop {
        0% { transform: translate(-50%, -6%) scale(0.85); opacity: 1; }
        15% { transform: translate(-50%, -6%) scale(1.05); opacity: 1; }
        85% { transform: translate(-50%, -6%) scale(1); opacity: 1; }
        100% { transform: translate(-50%, -6%) scale(1.05); opacity: 0; }
      }
      .sgap-click-marker {
        position: absolute !important;
        width: var(--sgap-pointer-width, 64px);
        height: auto;
        margin: 0 !important;
        padding: 0 !important;
        border: none !important;
        background: transparent !important;
        pointer-events: none !important;
        animation: sgap-click-pointer-pop \${displayMs}ms ease-out forwards;
        filter: drop-shadow(0 2px 8px rgba(0,0,0,0.55));
        user-select: none;
        -webkit-user-drag: none;
      }
      .sgap-click-marker-fallback {
        position: absolute !important;
        width: 28px;
        height: 28px;
        margin: 0 !important;
        border: 4px solid #ff1744 !important;
        border-radius: 50% !important;
        background: rgba(255, 23, 68, 0.45) !important;
        pointer-events: none !important;
        transform: translate(-50%, -50%);
        animation: sgap-click-pointer-pop \${displayMs}ms ease-out forwards;
        box-shadow: 0 0 0 3px #fff, 0 0 16px rgba(255,23,68,0.95);
      }
      #sgap-click-tracker-panel {
        position: fixed !important; top: 0; right: 0;
        width: min(280px, 30vw); height: 100vh;
        background: rgba(8, 8, 14, 0.92); color: #f5f5f5;
        font: 12px/1.4 ui-monospace, monospace;
        z-index: 2147483647 !important;
        overflow: hidden; display: flex; flex-direction: column;
        border-left: 2px solid rgba(255, 23, 68, 0.65);
        pointer-events: none !important;
      }
      #sgap-click-tracker-panel h2 {
        margin: 0; padding: 10px 12px; font-size: 13px; font-weight: 700;
        color: #ff8a80; border-bottom: 1px solid rgba(255,255,255,0.12);
      }
      #sgap-click-list { list-style: none; margin: 0; padding: 8px; overflow-y: auto; flex: 1; }
      #sgap-click-list li {
        padding: 6px 8px; margin-bottom: 4px; border-radius: 4px;
        background: rgba(255,255,255,0.07); word-break: break-word;
      }
      #sgap-click-list li span.action { color: #ff8a80; font-weight: 600; }
      #sgap-click-list li span.coords { color: #69f0ae; }
    \`;
    (document.head || document.documentElement).appendChild(style);
  }

  let root = document.getElementById('sgap-click-overlay-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'sgap-click-overlay-root';
    root.setAttribute('aria-hidden', 'true');
    (document.documentElement || document.body).appendChild(root);
  }

  const marker = pointerSrc && pointerSrc.length > 0
    ? document.createElement('img')
    : document.createElement('div');
  marker.className = pointerSrc && pointerSrc.length > 0
    ? 'sgap-click-marker'
    : 'sgap-click-marker-fallback';
  if (marker.tagName === 'IMG') {
    marker.src = pointerSrc;
    marker.alt = '';
    marker.draggable = false;
    marker.style.setProperty('--sgap-pointer-width', pointerWidthPx + 'px');
  }
  marker.style.left = pageX + 'px';
  marker.style.top = pageY + 'px';
  marker.setAttribute('data-sgap-click', label || 'click');
  root.appendChild(marker);
  window.setTimeout(function () { marker.remove(); }, displayMs + 50);

  if (showPanel) {
    let panel = document.getElementById('sgap-click-tracker-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'sgap-click-tracker-panel';
      panel.innerHTML = '<h2>SGAP clicks</h2><ul id="sgap-click-list"></ul>';
      (document.documentElement || document.body).appendChild(panel);
    }
    const list = document.getElementById('sgap-click-list');
    if (list) {
      const item = document.createElement('li');
      item.innerHTML =
        '<span class="action">' + (label || 'click') + '</span><br>' +
        new Date().toLocaleTimeString() + '<br>' +
        '<span class="coords">(' + Math.round(pageX) + ', ' + Math.round(pageY) + ')</span>';
      list.prepend(item);
      while (list.children.length > 50) {
        list.removeChild(list.lastChild);
      }
    }
  }
`;

/** Same-origin child frames forward pointer coords to the host overlay. */
const IFRAME_FORWARD_INIT = `
(() => {
  if (window.__sgapIframeClickForwardReady) return;
  if (window === window.top) return;
  window.__sgapIframeClickForwardReady = true;

  function forward(event) {
    try {
      const frameEl = window.frameElement;
      if (!frameEl) return;
      const rect = frameEl.getBoundingClientRect();
      window.top.postMessage({
        type: 'sgap-click-ripple',
        pageX: rect.left + event.clientX,
        pageY: rect.top + event.clientY,
        label: event.type,
      }, '*');
    } catch (_) { /* cross-origin or detached */ }
  }

  document.addEventListener('pointerdown', forward, true);
  document.addEventListener('click', forward, true);
})();
`;

/**
 * Install iframe forwarding + mouse.click backup. Pointer rendering is always
 * driven by recordClick (self-contained evaluate).
 */
export async function installClickTracker(
  page: Page,
  _options?: ClickTrackerEnableOptions,
): Promise<void> {
  if (!isClickTrackerEnabled()) {
    return;
  }

  activeTrackerPages.add(page);

  await page.addInitScript(IFRAME_FORWARD_INIT);

  for (const frame of page.frames()) {
    if (frame.parentFrame() === null) {
      continue;
    }
    await frame.evaluate(IFRAME_FORWARD_INIT).catch(() => undefined);
  }

  const previous = frameHandlers.get(page);
  if (previous !== undefined) {
    page.off('frameattached', previous.onFrameAttached);
    page.off('framenavigated', previous.onFrameNavigated);
  }

  const onFrameAttached = (frame: Frame): void => {
    if (frame.parentFrame() === null) {
      return;
    }
    void frame.evaluate(IFRAME_FORWARD_INIT).catch(() => undefined);
  };

  const onFrameNavigated = (frame: Frame): void => {
    if (frame.parentFrame() === null) {
      return;
    }
    void frame.evaluate(IFRAME_FORWARD_INIT).catch(() => undefined);
  };

  frameHandlers.set(page, { onFrameAttached, onFrameNavigated });
  page.on('frameattached', onFrameAttached);
  page.on('framenavigated', onFrameNavigated);

  if (patchedMousePages.has(page)) {
    return;
  }
  patchedMousePages.add(page);

  const mouse = page.mouse;
  const originalClick = mouse.click.bind(mouse) as (
    x: number,
    y: number,
    options?: { delay?: number; button?: 'left' | 'right' | 'middle'; clickCount?: number },
  ) => Promise<void>;
  mouse.click = async (x: number, y: number, clickOptions?) => {
    await recordClick(page, {
      label: 'mouse.click',
      pageX: x,
      pageY: y,
      kind: 'mouse',
    });
    await originalClick(x, y, clickOptions);
  };
}

/** Re-ensure iframe forwarding after launcher navigation / game iframe attach. */
export async function refreshClickTracker(page: Page): Promise<void> {
  if (!isTrackerActive(page)) {
    return;
  }
  for (const frame of page.frames()) {
    if (frame.parentFrame() === null) {
      continue;
    }
    await frame.evaluate(IFRAME_FORWARD_INIT).catch(() => undefined);
  }
}

/** Draw the hand pointer on the host overlay (viewport coordinates). */
export async function recordClick(page: Page, record: ClickRecord): Promise<void> {
  if (!isClickTrackerEnabled()) {
    return;
  }
  activeTrackerPages.add(page);

  await page
    .evaluate(
      ({ body, payload }) => {
        // eslint-disable-next-line no-new-func
        new Function('payload', body)(payload);
      },
      {
        body: SHOW_CLICK_INDICATOR_BODY,
        payload: {
          pageX: record.pageX,
          pageY: record.pageY,
          label: record.label,
          pointerSrc: CLICK_INDICATOR_DATA_URL,
          showPanel: SHOW_PANEL,
          displayMs: POINTER_DISPLAY_MS,
          pointerWidthPx: POINTER_WIDTH_PX,
        },
      },
    )
    .catch(() => undefined);
}

/** Host-page locator click with visible pointer (launcher chrome, modals). */
export async function clickHostWithIndicator(
  page: Page,
  locator: Locator,
  options?: Parameters<Locator['click']>[0],
  label = 'host',
): Promise<void> {
  const box = await locator.boundingBox().catch(() => null);
  if (box !== null) {
    await recordClick(page, {
      label,
      pageX: box.x + box.width / 2,
      pageY: box.y + box.height / 2,
      kind: 'host',
    });
  }
  await locator.click(options);
}
