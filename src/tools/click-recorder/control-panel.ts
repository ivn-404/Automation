/**
 * Separate control-panel window (RECORDER.MD §2).
 */

import type { Browser, Page } from 'playwright';

import type { RecorderCommand } from './types.js';

const CONTROL_PANEL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>SGAP Click Recorder</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; padding: 18px; background: #0b1018; color: #f5f7fa; font: 600 14px/1.45 "Segoe UI", system-ui, sans-serif; }
    #mode { color: #3dd68c; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6px; }
    #title { font-size: 20px; margin: 0 0 8px; font-weight: 750; }
    #hint { opacity: 0.9; font-weight: 500; margin-bottom: 10px; }
    #count { opacity: 0.8; font-size: 13px; margin-bottom: 12px; }
    #history { max-height: 160px; overflow: auto; background: #121821; border-radius: 8px; padding: 8px 10px; margin-bottom: 14px; font-size: 12px; font-weight: 500; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
    button { cursor: pointer; border: 0; border-radius: 10px; padding: 12px 14px; font: 800 13px/1 "Segoe UI", system-ui, sans-serif; }
    #confirm { background: #3dd68c; color: #062016; }
    #accept { background: #5b8def; color: #041018; }
    #skip { background: #4a5568; color: #fff; }
    #revert-last { background: #c9a227; color: #1a1400; }
    #revert-all { background: #8b5a2b; color: #fff; }
    #close { background: #c23b3b; color: #fff; }
    .keys { margin-top: 10px; opacity: 0.7; font-size: 11px; font-weight: 500; }
    kbd { display: inline-block; padding: 1px 5px; border-radius: 4px; background: #1c2430; border: 1px solid #3a4556; font-weight: 700; }
  </style>
</head>
<body>
  <div id="mode">Recording</div>
  <h1 id="title">SGAP Click Recorder</h1>
  <div id="hint">Click in the game window, then Confirm / Accept / Skip.</div>
  <div id="count">Clicks: 0</div>
  <div id="history">No clicks yet.</div>
  <div class="row">
    <button id="confirm" type="button">Confirm</button>
    <button id="accept" type="button">Accept</button>
    <button id="skip" type="button">Skip</button>
  </div>
  <div class="row">
    <button id="revert-last" type="button">Revert Last</button>
    <button id="revert-all" type="button">Revert All</button>
    <button id="close" type="button">Close</button>
  </div>
  <p class="keys">
    <kbd>Enter</kbd> Confirm · <kbd>A</kbd> Accept · <kbd>S</kbd> Skip ·
    <kbd>U</kbd> Revert last · <kbd>R</kbd> Revert all · <kbd>Esc</kbd> Close
  </p>
  <script>
    window.__sgapRecordCmd = null;
    const setCmd = (cmd) => { window.__sgapRecordCmd = cmd; };
    document.getElementById('confirm').onclick = () => setCmd('confirm');
    document.getElementById('accept').onclick = () => setCmd('accept');
    document.getElementById('skip').onclick = () => setCmd('skip');
    document.getElementById('revert-last').onclick = () => setCmd('revert-last');
    document.getElementById('revert-all').onclick = () => setCmd('revert-all');
    document.getElementById('close').onclick = () => setCmd('close');
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') setCmd('confirm');
      else if (e.key === 'a' || e.key === 'A') setCmd('accept');
      else if (e.key === 's' || e.key === 'S') setCmd('skip');
      else if (e.key === 'u' || e.key === 'U') setCmd('revert-last');
      else if (e.key === 'r' || e.key === 'R') setCmd('revert-all');
      else if (e.key === 'Escape') setCmd('close');
    });
  </script>
</body>
</html>`;

const SET_PANEL_FN = `({ titleText, hintText, modeValue, count, historyText }) => {
  const mode = document.getElementById('mode');
  const title = document.getElementById('title');
  const hint = document.getElementById('hint');
  const countEl = document.getElementById('count');
  const history = document.getElementById('history');
  if (!mode || !title || !hint || !countEl || !history) return false;
  mode.textContent = modeValue || 'Recording';
  title.textContent = titleText;
  hint.textContent = hintText || '';
  countEl.textContent = 'Clicks: ' + String(count || 0);
  history.textContent = historyText || 'No clicks yet.';
  document.title = 'SGAP · Recorder';
  return true;
}`;

const READ_CMD_FN = `(() => {
  const cmd = window.__sgapRecordCmd || null;
  window.__sgapRecordCmd = null;
  return cmd;
})()`;

const INSTALL_GAME_HOTKEYS_FN = `(() => {
  if (window.__sgapRecorderHotkeys) return true;
  window.__sgapRecorderHotkeys = true;
  window.__sgapRecordCmd = null;
  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'Enter') window.__sgapRecordCmd = 'confirm';
    else if (e.key === 'a' || e.key === 'A') window.__sgapRecordCmd = 'accept';
    else if (e.key === 's' || e.key === 'S') window.__sgapRecordCmd = 'skip';
    else if (e.key === 'u' || e.key === 'U') window.__sgapRecordCmd = 'revert-last';
    else if (e.key === 'r' || e.key === 'R') window.__sgapRecordCmd = 'revert-all';
    else if (e.key === 'Escape') window.__sgapRecordCmd = 'close';
  }, true);
  return true;
})()`;

export async function openControlPanel(browser: Browser): Promise<Page> {
  const panelContext = await browser.newContext({ viewport: { width: 560, height: 580 } });
  const panel = await panelContext.newPage();
  await panel.setContent(CONTROL_PANEL_HTML, { waitUntil: 'domcontentloaded' });
  await panel.bringToFront();
  console.log('[RECORDER] Control panel opened. Keep it beside the game. Do not close Chrome until Close.');
  return panel;
}

export async function setPanel(
  panel: Page,
  options: {
    readonly title: string;
    readonly hint: string;
    readonly mode: string;
    readonly count: number;
    readonly history: string;
  },
): Promise<void> {
  await panel.evaluate(SET_PANEL_FN, {
    titleText: options.title,
    hintText: options.hint,
    modeValue: options.mode,
    count: options.count,
    historyText: options.history,
  });
}

export async function readCommand(panel: Page, gamePage: Page): Promise<RecorderCommand | null> {
  const fromPanel = (await panel.evaluate(READ_CMD_FN).catch(() => null)) as RecorderCommand | null;
  if (fromPanel !== null) {
    return fromPanel;
  }
  return (await gamePage.evaluate(READ_CMD_FN).catch(() => null)) as RecorderCommand | null;
}

export async function installGameHotkeys(page: Page): Promise<void> {
  await page.evaluate(INSTALL_GAME_HOTKEYS_FN).catch(() => undefined);
}
