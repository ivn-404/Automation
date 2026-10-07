/**
 * Numbered click markers on the host page (above iframe / modal).
 */

import type { Page } from 'playwright';

import type { ClickEvidence } from './types.js';

const INSTALL_MARKERS_FN = `(() => {
  const id = 'sgap-recorder-markers';
  let root = document.getElementById(id);
  if (!root) {
    root = document.createElement('div');
    root.id = id;
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
    document.documentElement.appendChild(root);
  }
  return true;
})()`;

const RENDER_MARKERS_FN = `(items) => {
  const root = document.getElementById('sgap-recorder-markers');
  if (!root) return false;
  root.innerHTML = '';
  const colors = {
    active: '#3dd68c',
    accepted: '#5b8def',
    skipped: '#9aa3b2',
    reverted: '#c23b3b',
  };
  for (const item of items) {
    const el = document.createElement('div');
    el.textContent = String(item.seq);
    el.style.cssText = [
      'position:absolute',
      'left:' + item.pageX + 'px',
      'top:' + item.pageY + 'px',
      'transform:translate(-50%,-50%)',
      'width:28px',
      'height:28px',
      'border-radius:50%',
      'background:' + (colors[item.state] || colors.active),
      'color:#041018',
      'font:800 13px/28px Segoe UI,system-ui,sans-serif',
      'text-align:center',
      'box-shadow:0 0 0 2px #041018, 0 4px 12px rgba(0,0,0,.45)',
      'opacity:' + (item.state === 'reverted' || item.state === 'skipped' ? '0.45' : '1'),
      item.state === 'reverted' ? 'text-decoration:line-through' : '',
    ].filter(Boolean).join(';');
    root.appendChild(el);
  }
  return true;
}`;

export async function installRecorderMarkers(page: Page): Promise<void> {
  await page.evaluate(INSTALL_MARKERS_FN).catch(() => undefined);
}

export async function renderRecorderMarkers(page: Page, clicks: readonly ClickEvidence[]): Promise<void> {
  const visible = clicks
    .filter((click) => click.state !== 'reverted')
    .map((click) => ({
      seq: click.seq,
      pageX: click.pageX,
      pageY: click.pageY,
      state: click.state,
    }));
  await page.evaluate(RENDER_MARKERS_FN, visible).catch(() => undefined);
}
