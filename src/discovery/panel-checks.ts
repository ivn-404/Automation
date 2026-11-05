/**
 * Level 3 panel checks: open a panel that costs nothing, compare what it draws with a shared
 * registered layout, close it again. Never taps a buy, start or confirm control.
 */

import type { Page } from 'playwright';

import type { SharedScratchDrawer } from './assess.js';
import { inspectRuntime, renderFrame, type SceneText } from './inspect.js';

export interface PanelCheck {
  readonly target: string;
  readonly verified: boolean;
  readonly closed: boolean;
  readonly evidence: readonly string[];
  /** Panel controls where this game drew them (panel-relative), for the learned profile. */
  readonly measured?: Readonly<Record<string, Point>>;
}

/** Drawer-relative distance within which a drawn label counts as the shared layout's control. */
const MATCH_DISTANCE = 0.07;
const OPEN_WAIT_MS = 8_000;
const CLOSE_WAIT_MS = 5_000;

const SIZE_LABEL = (size: number): RegExp => new RegExp(`^${size}\\s*[x×]\\s*${size}$`, 'iu');

interface Point {
  readonly x: number;
  readonly y: number;
}

async function tapCanvas(page: Page, point: Point): Promise<boolean> {
  const frame = await renderFrame(page);
  const box = await frame.locator('canvas').first().boundingBox();
  if (box === null) return false;
  await page.mouse.click(box.x + point.x * box.width, box.y + point.y * box.height);
  return true;
}

function inDrawer(text: SceneText, drawer: SharedScratchDrawer['config']['inCanvasDrawer']): Point {
  return { x: (text.x - drawer.x) / drawer.width, y: (text.y - drawer.y) / drawer.height };
}

function near(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

interface DrawerReading {
  readonly matches: readonly string[];
  readonly missing: readonly string[];
  readonly measured: Readonly<Record<string, Point>>;
}

function rounded(point: Point): Point {
  return { x: Number(point.x.toFixed(3)), y: Number(point.y.toFixed(3)) };
}

async function readDrawer(page: Page, shared: SharedScratchDrawer): Promise<DrawerReading> {
  const snapshot = await inspectRuntime(await renderFrame(page)).catch(() => undefined);
  const config = shared.config;
  const texts = snapshot?.texts ?? [];
  const matches: string[] = [];
  const missing: string[] = [];
  const measured: Record<string, Point> = {};
  for (const size of [3, 4, 5]) {
    const target = config.actions[`size${size}x${size}`];
    const hit = texts.find((text) => SIZE_LABEL(size).test(text.text));
    if (target !== undefined && hit !== undefined && near(inDrawer(hit, config.inCanvasDrawer), target) <= MATCH_DISTANCE) {
      measured[`size${size}x${size}`] = rounded(inDrawer(hit, config.inCanvasDrawer));
      matches.push(`${size}x${size} tab at ${near(inDrawer(hit, config.inCanvasDrawer), target).toFixed(3)} from the shared point`);
    } else {
      missing.push(`${size}x${size} tab`);
    }
  }
  const buyTarget = config.actions.buyCard;
  const pill = config.textAreas?.pill;
  const inPill = (point: Point): boolean =>
    pill !== undefined && point.x >= pill.x && point.x <= pill.x + pill.width && point.y >= pill.y && point.y <= pill.y + pill.height;
  const buy = texts.find((text) => {
    // BUY CARD and SCRATCH ALL are one pill; it reads SCRATCH ALL while a card is in play.
    if (!/\bbuy\b|\bscratch\s*all\b/iu.test(text.text)) return false;
    const point = inDrawer(text, config.inCanvasDrawer);
    return inPill(point) || (buyTarget !== undefined && near(point, buyTarget) <= MATCH_DISTANCE);
  });
  for (const [action, label] of [['betMinus', /^[-−–]$/u], ['betPlus', /^\+$/u]] as const) {
    const target = config.actions[action];
    const hit = texts.find((text) => label.test(text.text) && target !== undefined && near(inDrawer(text, config.inCanvasDrawer), target) <= MATCH_DISTANCE);
    if (hit !== undefined && target !== undefined) {
      measured[action] = rounded(inDrawer(hit, config.inCanvasDrawer));
      matches.push(`${action} at ${near(inDrawer(hit, config.inCanvasDrawer), target).toFixed(3)} from the shared point`);
    }
  }
  if (buy !== undefined) {
    measured.buyCard = rounded(inDrawer(buy, config.inCanvasDrawer));
    measured.scratchAll = measured.buyCard;
    matches.push(`"${buy.text}" pill at the shared buy point (not tapped)`);
  }
  else {
    const bottom = texts
      .map((text) => ({ text: text.text, point: inDrawer(text, config.inCanvasDrawer) }))
      .filter((entry) => entry.point.y >= 0.8 && entry.point.y <= 1.05)
      .map((entry) => `"${entry.text}"@${entry.point.x.toFixed(2)},${entry.point.y.toFixed(2)}`);
    missing.push(`BUY pill (drawer bottom shows ${bottom.length > 0 ? bottom.join(' ') : 'no text'})`);
  }
  return { matches, missing, measured };
}

/**
 * Opens the scratch drawer from the HUD button, checks its size tabs and buy pill sit where the
 * shared layout puts them, then closes it with the shared close point.
 */
export async function checkScratchDrawer(page: Page, button: Point, shared: SharedScratchDrawer): Promise<PanelCheck> {
  const evidence: string[] = [];
  const before = await readDrawer(page, shared);
  if (before.matches.length >= 3) {
    return { target: 'scratchCard', verified: false, closed: false, evidence: ['drawer labels already visible before the tap; not opening anything'] };
  }
  if (!(await tapCanvas(page, button))) {
    return { target: 'scratchCard', verified: false, closed: true, evidence: ['no game canvas to tap'] };
  }
  evidence.push(`tapped the HUD scratch button at ${button.x},${button.y}`);
  let reading = before;
  const openDeadline = Date.now() + OPEN_WAIT_MS;
  while (Date.now() < openDeadline) {
    await page.waitForTimeout(750);
    reading = await readDrawer(page, shared);
    if (reading.missing.length === 0) break;
  }
  const verified = reading.missing.length === 0;
  evidence.push(...reading.matches);
  if (!verified) evidence.push(`not matched: ${reading.missing.join(', ')}`);

  const drawer = shared.config.inCanvasDrawer;
  const close = shared.config.actions.close;
  let closed = reading.matches.length === 0;
  if (!closed && close !== undefined) {
    await tapCanvas(page, { x: drawer.x + close.x * drawer.width, y: drawer.y + close.y * drawer.height });
    const closeDeadline = Date.now() + CLOSE_WAIT_MS;
    while (Date.now() < closeDeadline && !closed) {
      await page.waitForTimeout(750);
      closed = (await readDrawer(page, shared)).matches.length === 0;
    }
    evidence.push(closed ? 'closed with the shared close point' : 'drawer still open after the shared close point');
  }
  return { target: 'scratchCard', verified: verified && closed, closed, evidence, measured: reading.measured };
}

const AUTOPLAY_COUNT = /^(10|20|25|30|50|75|100|200|500|∞)$/u;
const AUTOPLAY_START = /^(start|autoplay)$/iu;
const MENU_ITEM = /^(settings|sound|music|help|info|paytable|rules|history|home|lobby)$/iu;
const BUY_LABEL = /buy\s*(feature|bonus|fs|now)?|^buy$/iu;
const CANCEL_LABEL = /^(cancel|close|x)$/iu;
const CONFIRM_LABEL = /^(confirm|yes|buy now|purchase)$/iu;

interface HudPanelSpec {
  readonly target: string;
  readonly button: Point;
  readonly alreadyOpen: (texts: readonly SceneText[]) => boolean;
  readonly read: (texts: readonly SceneText[]) => { readonly matches: string[]; readonly missing: string[]; readonly measured: Record<string, Point> };
  /** When set, the panel is open only while this is true (idle HUD numbers must not count as still-open). */
  readonly stillOpen?: (texts: readonly SceneText[]) => boolean;
  readonly closePoints: readonly Point[];
}

async function snapshotTexts(page: Page): Promise<readonly SceneText[]> {
  const snapshot = await inspectRuntime(await renderFrame(page)).catch(() => undefined);
  return snapshot?.texts ?? [];
}

async function checkHudPanel(page: Page, spec: HudPanelSpec): Promise<PanelCheck> {
  const evidence: string[] = [];
  const before = await snapshotTexts(page);
  if (spec.alreadyOpen(before)) {
    return { target: spec.target, verified: false, closed: false, evidence: [`${spec.target} labels already visible before the tap; not opening anything`] };
  }
  if (!(await tapCanvas(page, spec.button))) {
    return { target: spec.target, verified: false, closed: true, evidence: ['no game canvas to tap'] };
  }
  evidence.push(`tapped ${spec.target} at ${spec.button.x},${spec.button.y}`);
  let reading = spec.read(before);
  const openDeadline = Date.now() + OPEN_WAIT_MS;
  while (Date.now() < openDeadline) {
    await page.waitForTimeout(750);
    reading = spec.read(await snapshotTexts(page));
    if (reading.missing.length === 0) break;
  }
  const verified = reading.missing.length === 0;
  evidence.push(...reading.matches);
  if (!verified) evidence.push(`not matched: ${reading.missing.join(', ')}`);

  const isOpen = spec.stillOpen ?? ((texts: readonly SceneText[]) => spec.read(texts).matches.length > 0);
  let closed = !isOpen(await snapshotTexts(page));
  for (const point of spec.closePoints) {
    if (closed) break;
    await tapCanvas(page, point);
    const closeDeadline = Date.now() + CLOSE_WAIT_MS;
    while (Date.now() < closeDeadline && !closed) {
      await page.waitForTimeout(500);
      closed = !isOpen(await snapshotTexts(page));
    }
  }
  evidence.push(closed ? 'closed without tapping start, confirm or buy' : `${spec.target} still open after close taps`);
  return { target: spec.target, verified: verified && closed, closed, evidence, measured: reading.measured };
}

/** Opens autoplay, checks spin-count labels and a Start label, closes it. Never taps Start. */
export async function checkAutoplayPanel(page: Page, button: Point, closeHint?: Point): Promise<PanelCheck> {
  return checkHudPanel(page, {
    target: 'autoplay',
    button,
    alreadyOpen: (texts) => texts.filter((text) => AUTOPLAY_COUNT.test(text.text)).length >= 3,
    read: (texts) => {
      const counts = texts.filter((text) => AUTOPLAY_COUNT.test(text.text));
      const start = texts.find((text) => AUTOPLAY_START.test(text.text));
      const matches: string[] = [];
      const missing: string[] = [];
      const measured: Record<string, Point> = {};
      if (counts.length >= 2) {
        matches.push(`spin counts ${counts.map((text) => text.text).join(', ')}`);
        const ten = counts.find((text) => text.text === '10');
        if (ten !== undefined) measured.autoplaySpins10 = rounded({ x: ten.x, y: ten.y });
      } else missing.push('spin-count options');
      if (start !== undefined) {
        matches.push(`"${start.text}" (not tapped)`);
        measured.autoplayStart = rounded({ x: start.x, y: start.y });
      } else missing.push('Start');
      return { matches, missing, measured };
    },
    stillOpen: (texts) => texts.some((text) => /^start$/iu.test(text.text)),
    closePoints: [button, ...(closeHint !== undefined ? [closeHint] : [])],
  });
}

/** Opens the menu, checks for settings/help/sound items, closes it. */
export async function checkMenuPanel(page: Page, button: Point, closeHint?: Point): Promise<PanelCheck> {
  return checkHudPanel(page, {
    target: 'menu',
    button,
    alreadyOpen: (texts) => texts.filter((text) => MENU_ITEM.test(text.text)).length >= 3,
    read: (texts) => {
      const items = texts.filter((text) => MENU_ITEM.test(text.text));
      const measured: Record<string, Point> = {};
      const settings = items.find((text) => /^settings$/iu.test(text.text));
      if (settings !== undefined) measured.settingsTab = rounded({ x: settings.x, y: settings.y });
      return {
        matches: items.length >= 2 ? items.map((text) => `"${text.text}"`) : [],
        missing: items.length >= 2 ? [] : ['menu items (settings / help / sound)'],
        measured,
      };
    },
    closePoints: [button, ...(closeHint !== undefined ? [closeHint] : []), { x: 0.86, y: 0.08 }],
  });
}

/**
 * Opens the buy panel, checks it shows a buy label and a cancel/close, closes it.
 * Never taps confirm, a tier, or buy-now.
 */
export async function checkBuyPanel(page: Page, button: Point, closeHint?: Point): Promise<PanelCheck> {
  return checkHudPanel(page, {
    target: 'buyFeature',
    button,
    alreadyOpen: (texts) => texts.some((text) => BUY_LABEL.test(text.text)) && texts.some((text) => CANCEL_LABEL.test(text.text)),
    read: (texts) => {
      const buy = texts.find((text) => BUY_LABEL.test(text.text) && !CONFIRM_LABEL.test(text.text));
      const cancel = texts.find((text) => CANCEL_LABEL.test(text.text));
      const matches: string[] = [];
      const missing: string[] = [];
      const measured: Record<string, Point> = {};
      if (buy !== undefined) {
        matches.push(`"${buy.text}" (not tapped)`);
        measured.buyFeature = rounded({ x: buy.x, y: buy.y });
      } else missing.push('BUY label');
      if (cancel !== undefined) {
        matches.push(`"${cancel.text}" close`);
        measured.buyFeatureCancel = rounded({ x: cancel.x, y: cancel.y });
      } else missing.push('cancel/close');
      return { matches, missing, measured };
    },
    closePoints: [...(closeHint !== undefined ? [closeHint] : []), button, { x: 0.86, y: 0.22 }],
  });
}
