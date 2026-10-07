/**
 * Spin Controller — reusable spin action with observable start/complete sync.
 *
 * Controllers are not test cases. Specs orchestrate this controller.
 * No package-specific or game-specific logic: behavior comes from manifest
 * (DOM locator keys / canvas action names / network URL patterns).
 */

import type { Page, Request, Response } from 'playwright';

import type { ISpinController } from '../core/contracts/index.js';
import type {
  BetResponseSnapshot,
  ControllerLockState,
  GameManifest,
  NetworkConfig,
  ObservableWaitOptions,
} from '../core/models/index.js';
import type { BetResponseWatcher } from '../network/bet-response-watcher.js';
import { NO_HEAL, type ActionHealer } from './strategy/action-healer.js';
import type { PlaywrightGameDriver } from '../driver/playwright-game-driver.js';
import { resolveTimeoutMs } from '../driver/wait-options.js';
import { gateCanvasIntent } from '../eye/index.js';
import { matchesUrlPattern } from '../network/bet-response-watcher.js';
import { clearNonGridOverlays, markSpinTriggered } from '../platform/canvas-session-primer.js';
import { ControllerDisabledError } from './registry/errors.js';
import { matchesBetUrl } from '../network/bet-url.js';

export interface SpinControllerOptions {
  readonly driver: PlaywrightGameDriver;
  readonly manifest: GameManifest;
  /** Required for waitForSpinStart / waitForSpinComplete (observable network sync). */
  readonly page?: Page;
  /** Required for waitForSpinStart / waitForSpinComplete — URL patterns from manifest. */
  readonly network?: NetworkConfig;
  readonly defaultTimeoutMs?: number;
  /** Required for spinAndRead — the parsed /bet response is the pass/fail evidence. */
  readonly betWatcher?: BetResponseWatcher;
}

export interface SpinAndReadOptions {
  readonly timeoutMs: number;
  /** Attempts including the first; later attempts use the healer's re-located point. */
  readonly maxAttempts?: number;
}

export class SpinController implements ISpinController {
  readonly id = 'spin' as const;
  private readonly driver: PlaywrightGameDriver;
  private readonly manifest: GameManifest;
  private readonly page: Page | undefined;
  private readonly network: NetworkConfig | undefined;
  private readonly defaultTimeoutMs: number;
  private readonly betWatcher: BetResponseWatcher | undefined;
  private healer: ActionHealer = NO_HEAL;
  private lockState: ControllerLockState = { locked: false };
  private startPending: Promise<Request> | undefined;
  private completePending: Promise<Response> | undefined;

  constructor(options: SpinControllerOptions) {
    this.driver = options.driver;
    this.manifest = options.manifest;
    this.page = options.page;
    this.network = options.network ?? options.manifest.network;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
    this.betWatcher = options.betWatcher;
  }

  /** Readiness / recovery strategy for spinAndRead. Defaults to none. */
  useHealer(healer: ActionHealer): void {
    this.healer = healer;
  }

  async isAvailable(): Promise<boolean> {
    const capability = this.manifest.controllers.find((entry) => entry.id === 'spin');
    if (capability === undefined || !capability.enabled) {
      return false;
    }
    return this.driver.isAttached();
  }

  async getLockState(): Promise<ControllerLockState> {
    return this.lockState;
  }

  async isSpinLocked(): Promise<boolean> {
    return this.lockState.locked === true;
  }

  /**
   * The spin path specs use: healer.prepare → arm /bet → one click → read /bet →
   * healer.settle. A failed attempt goes to healer.recover, and the retry clicks the
   * point recover re-located (if any) — still the spin control, never another action.
   * Resolves with the parsed /bet response; rejects with the last attempt's error.
   */
  async spinAndRead(options: SpinAndReadOptions): Promise<BetResponseSnapshot> {
    if (this.betWatcher === undefined) {
      throw new Error('spinAndRead requires a bet watcher (manifest.network.betUrlPattern)');
    }
    if (!this.manifest.controllers.some((entry) => entry.id === 'spin' && entry.enabled)) {
      throw new ControllerDisabledError('spin');
    }
    if (await this.isSpinLocked()) {
      throw new Error('Spin controller is locked');
    }

    const { timeoutMs } = options;
    const maxAttempts = options.maxAttempts ?? 2;
    const watcher = this.betWatcher;
    let lastError: unknown;
    this.lockState = { locked: true, lockedBy: 'spin', reason: 'spin-and-read' };
    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          if (!(await this.driver.isAttached())) {
            await this.driver.attach();
          }
          await this.healer.prepare('spin');
          watcher.reset();
          watcher.arm({ timeoutMs });
          await this.clickSpin({ timeoutMs, singleInput: true, useHealedRatio: attempt > 1 });
          const bet = await watcher.read({ timeoutMs });
          await this.healer.settle('spin');
          return bet;
        } catch (error: unknown) {
          lastError = error;
          watcher.reset();
          await this.healer.recover('spin', error);
        }
      }
      throw lastError;
    } finally {
      this.lockState = { locked: false };
    }
  }

  /**
   * Probe spin without a healer: arm network waiters → click → await start + complete.
   * Canvas sessions may dismiss config-driven overlays before the click (manifest actions only).
   */
  async spin(options?: ObservableWaitOptions): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new ControllerDisabledError('spin');
    }
    if (await this.isSpinLocked()) {
      throw new Error('Spin controller is locked');
    }

    this.lockState = { locked: true, lockedBy: 'spin', reason: 'spin-in-progress' };
    try {
      const rendering = this.manifest.metadata?.rendering ?? 'dom';
      if (rendering === 'canvas') {
        await gateCanvasIntent({
          page: this.driver.getPage(),
          driver: this.driver,
          manifest: this.manifest,
          intent: 'spin',
        });
        await clearNonGridOverlays(this.driver, this.manifest);
      }

      const start = this.armSpinStart(options);
      const complete = this.armSpinComplete(options);
      await this.clickSpin(options);
      await start;
      await complete;
      this.startPending = undefined;
      this.completePending = undefined;
    } finally {
      this.lockState = { locked: false };
    }
  }

  async clickSpin(options?: ObservableWaitOptions): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new ControllerDisabledError('spin');
    }

    const rendering = this.manifest.metadata?.rendering ?? 'dom';
    if (rendering === 'canvas') {
      await this.driver.clickCanvas('spin', { ...options, singleInput: true });
    } else {
      await this.driver.click('spinButton', options);
    }
    markSpinTriggered(this.driver);
  }

  async waitForSpinStart(options?: ObservableWaitOptions): Promise<void> {
    const pending = this.armSpinStart(options);
    await pending;
    this.startPending = undefined;
  }

  async waitForSpinComplete(options?: ObservableWaitOptions): Promise<void> {
    const pending = this.armSpinComplete(options);
    await pending;
    this.completePending = undefined;
  }

  private armSpinStart(options?: ObservableWaitOptions): Promise<Request> {
    if (this.startPending !== undefined) {
      return this.startPending;
    }
    const { page, network } = this.requireNetwork();
    const timeout = resolveTimeoutMs(options, this.defaultTimeoutMs);
    this.startPending = page.waitForRequest(
      (request) => isSpinNetworkUrl(request.url(), network.betUrlPattern),
      { timeout },
    );
    return this.startPending;
  }

  private armSpinComplete(options?: ObservableWaitOptions): Promise<Response> {
    if (this.completePending !== undefined) {
      return this.completePending;
    }
    const { page, network } = this.requireNetwork();
    const timeout = resolveTimeoutMs(options, this.defaultTimeoutMs);
    this.completePending = page.waitForResponse(
      (response) =>
        response.ok() && isSpinNetworkUrl(response.url(), network.betUrlPattern),
      { timeout },
    );
    return this.completePending;
  }

  private requireNetwork(): { page: Page; network: NetworkConfig } {
    if (this.page === undefined || this.network === undefined) {
      throw new Error(
        'SpinController network observation requires page + manifest.network (betUrlPattern)',
      );
    }
    return { page: this.page, network: this.network };
  }
}

function isSpinNetworkUrl(url: string, betUrlPattern: string): boolean {
  return matchesUrlPattern(url, betUrlPattern) || matchesBetUrl(url);
}
