/**
 * Url Platform — opens a pasted game URL ("Game URL" in the control panel) instead of the
 * staging launcher. The host page is served from the game's own origin (Chrome blocks an
 * about:blank host from framing LAN dev servers) and holds the same `Game session` iframe the
 * launcher creates, so drivers, controllers and the manifest iframe selector work unchanged.
 *
 * There is no launcher chrome: no player login, wallet top-up, bet limit or provider grid.
 * The session belongs to whoever the pasted URL was issued for.
 */

import type { Frame } from 'playwright';

import type { GameView } from '../core/contracts/index.js';
import type { ObservableWaitOptions } from '../core/models/index.js';
import { resolveTimeoutMs } from '../driver/wait-options.js';
import { redactText } from '../observability/redact.js';
import { PlaywrightPlatform, type PlaywrightPlatformOptions } from './playwright-platform.js';

const HOST_PATH = '/__sgap_host__';
/** Dev and demo builds never call initialize; do not hold every load for the full default timeout. */
const INITIALIZE_WAIT_MS = 15_000;

/** Playwright navigation errors quote the full URL, session token included. */
async function redactingErrors(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof Error) {
      error.message = redactText(error.message);
      if (error.stack !== undefined) error.stack = redactText(error.stack);
    }
    throw error;
  }
}

/**
 * `preserve` keeps whatever `device` the pasted URL carries; the others are an explicit QA choice.
 * `switch` lets each test set the layout it needs, as launcher runs do.
 */
export type LaunchDevice = 'preserve' | 'mobile' | 'desktop' | 'switch';

export interface UrlPlatformOptions extends PlaywrightPlatformOptions {
  readonly launchUrl: string;
  readonly device?: LaunchDevice;
}

export class UrlPlatform extends PlaywrightPlatform {
  private readonly launchUrl: URL;
  private readonly device: LaunchDevice;

  constructor(options: UrlPlatformOptions) {
    super(options);
    this.launchUrl = new URL(options.launchUrl);
    if (this.launchUrl.protocol !== 'http:' && this.launchUrl.protocol !== 'https:') {
      throw new Error('Game URL must be http or https');
    }
    this.device = options.device ?? 'preserve';
    if (this.device === 'mobile' || this.device === 'desktop') this.launchUrl.searchParams.set('device', this.device);
  }

  /** The device configuration actually loaded: the URL's own, or the QA override. */
  launchDevice(): { readonly mode: LaunchDevice; readonly device: string | undefined } {
    return { mode: this.device, device: this.launchUrl.searchParams.get('device') ?? undefined };
  }

  /** Never rewrites the session URL's device behind QA's back. */
  protected override applyDeviceParam(src: string, device: 'desktop' | 'mobile'): string {
    if (this.device === 'switch') return super.applyDeviceParam(src, device);
    const pinned = this.device === 'preserve' ? this.launchUrl.searchParams.get('device') ?? undefined : this.device;
    if (pinned !== undefined && pinned !== device && !this.deviceNotes.has(device)) {
      this.deviceNotes.add(device);
      console.log(
        `[sgap-device] this step wants the ${device} layout, but the Game URL session is pinned to device=${pinned}` +
          ` (Device: ${this.device === 'preserve' ? "keep the link's" : pinned}). Choose "switch per test" to allow it.`,
      );
    }
    return this.device === 'preserve' ? src : super.applyDeviceParam(src, this.device);
  }

  private readonly deviceNotes = new Set<string>();

  override async openGameHost(options?: ObservableWaitOptions): Promise<void> {
    this.assertNotDisposed();
    const timeout = resolveTimeoutMs(options, this.environment.defaultTimeoutMs);
    const hostUrl = new URL(HOST_PATH, this.launchUrl.origin).toString();
    const html =
      // Full size lives in the stylesheet: view changes set and clear inline sizes on the iframe.
      '<!doctype html><html><head><meta charset="utf-8"><title>SGAP host</title>' +
      '<style>iframe[title="Game session"]{border:0;width:100%;height:100%}</style></head>' +
      '<body style="margin:0;height:100vh;background:#111;display:flex;align-items:center;justify-content:center;overflow:hidden">' +
      '<iframe title="Game session" allow="autoplay; fullscreen"></iframe>' +
      '</body></html>';
    await this.page.route(hostUrl, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    await this.page.goto(hostUrl, { waitUntil: 'domcontentloaded', timeout });
  }

  /** Loads (or reloads) the pasted URL in the host iframe. */
  override async openGame(options?: ObservableWaitOptions): Promise<void> {
    await redactingErrors(() => this.loadGame(options));
  }

  override async prepareGameView(view: GameView, options?: ObservableWaitOptions): Promise<void> {
    await redactingErrors(() => super.prepareGameView(view, options));
  }

  override async prepareLandscapeDesktopView(options?: ObservableWaitOptions): Promise<void> {
    await redactingErrors(() => super.prepareLandscapeDesktopView(options));
  }

  override async reloadActiveGameSession(options?: ObservableWaitOptions): Promise<void> {
    await redactingErrors(() => super.reloadActiveGameSession(options));
  }

  private async loadGame(options?: ObservableWaitOptions): Promise<void> {
    this.assertNotDisposed();
    const timeout = resolveTimeoutMs(options, this.environment.defaultTimeoutMs);
    const selector = this.ui.resolveIframe().selector;
    const iframe = this.page.locator(selector);
    await iframe.waitFor({ state: 'attached', timeout });
    const initializeWait = this.beginInitializeWait(timeout)?.catch(() => undefined);
    await iframe.evaluate((el, src) => {
      (el as unknown as { src: string }).src = src;
    }, this.launchUrl.toString());
    const deadline = Date.now() + timeout;
    while (this.findGameFrame() === undefined && Date.now() < deadline) {
      await this.page.waitForTimeout(250);
    }
    if (initializeWait !== undefined) {
      await initializeWait;
    }
  }

  /**
   * Sets the iframe `src` instead of `frame.goto`: reporters record goto steps with the full URL,
   * and the session URL carries tokens.
   */
  protected override async navigateGameFrame(frame: Frame, url: string, timeout: number): Promise<void> {
    const before = frame.url();
    const element = await frame.frameElement();
    await element.evaluate((el, src) => {
      (el as unknown as { src: string }).src = src;
    }, url);
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline && frame.url() === before && before !== url) {
      await this.page.waitForTimeout(100);
    }
    await frame.waitForLoadState('domcontentloaded', { timeout: Math.max(1_000, deadline - Date.now()) }).catch(() => undefined);
  }

  protected override beginInitializeWait(timeout: number): ReturnType<PlaywrightPlatform['beginInitializeWait']> {
    return super.beginInitializeWait(Math.min(timeout, INITIALIZE_WAIT_MS));
  }

  /** The pasted URL need not contain the manifest's launcher game key. */
  protected override findGameFrame(): Frame | undefined {
    const prefix = `${this.launchUrl.origin}${this.launchUrl.pathname}`.toLowerCase();
    const main = this.page.mainFrame();
    return (
      this.page.frames().find((frame) => frame !== main && frame.url().toLowerCase().startsWith(prefix)) ??
      super.findGameFrame()
    );
  }
}
