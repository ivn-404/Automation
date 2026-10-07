/**
 * Bet Controller — increase / decrease / set stake.
 *
 * Controllers are not test cases. Specs orchestrate this controller.
 * Canvas games: clickCanvas("betPlus" | "betMinus") from manifest.
 * DOM games: click logical keys betPlus / betMinus via UI Registry.
 */

import type { IBetController } from '../core/contracts/index.js';
import type {
  ControllerLockState,
  GameManifest,
  ObservableWaitOptions,
} from '../core/models/index.js';
import type { PlaywrightGameDriver } from '../driver/playwright-game-driver.js';
import { nearestBetLevelIndex, parseBetLevels, stepBetLevel } from '../shared/bet-levels.js';
import { ControllerDisabledError } from './registry/errors.js';
import { clickCanvasControl } from './strategy/click-control.js';

export interface BetControllerOptions {
  readonly driver: PlaywrightGameDriver;
  readonly manifest: GameManifest;
  /** Seed from initialize / prior spin when known. */
  readonly initialBet?: string;
  /** Optional ladder override (initialize `betLevels`). */
  readonly betLevels?: readonly number[];
}

export class BetController implements IBetController {
  readonly id = 'bet' as const;
  private readonly driver: PlaywrightGameDriver;
  private readonly manifest: GameManifest;
  private betLevels: readonly number[];
  private lastKnownBet: string | undefined;
  private lockState: ControllerLockState = { locked: false };

  constructor(options: BetControllerOptions) {
    this.driver = options.driver;
    this.manifest = options.manifest;
    this.lastKnownBet = options.initialBet;
    this.betLevels =
      options.betLevels !== undefined && options.betLevels.length >= 2
        ? [...options.betLevels].sort((a, b) => a - b)
        : parseBetLevels(this.manifest.metadata?.betLevels);
  }

  /** Update tracked stake from network observation (initialize / bet request). */
  observeBet(amount: string): void {
    this.lastKnownBet = amount;
  }

  /** Prefer initialize ladder over metadata defaults when available. */
  useBetLevels(levels: readonly number[]): void {
    if (levels.length < 2) {
      return;
    }
    this.betLevels = [...levels].sort((a, b) => a - b);
  }

  async isAvailable(): Promise<boolean> {
    const capability = this.manifest.controllers.find((entry) => entry.id === 'bet');
    if (capability === undefined || !capability.enabled) {
      return false;
    }
    return this.driver.isAttached();
  }

  async getLockState(): Promise<ControllerLockState> {
    return this.lockState;
  }

  async getBet(): Promise<string> {
    if (this.lastKnownBet === undefined) {
      throw new Error(
        'Bet amount unknown — seed via observeBet() from initialize/spin or call increase/decrease first',
      );
    }
    return this.lastKnownBet;
  }

  async increase(options?: ObservableWaitOptions): Promise<void> {
    await this.nudge('plus', options);
  }

  async decrease(options?: ObservableWaitOptions): Promise<void> {
    await this.nudge('minus', options);
  }

  /**
   * Click +/- toward the target amount (tracked locally using metadata.betStep).
   * Confirm on staging via a subsequent spin stake observation.
   */
  async setBet(amount: string, options?: ObservableWaitOptions): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new ControllerDisabledError('bet');
    }

    const target = Number(amount);
    if (!Number.isFinite(target)) {
      throw new Error(`Invalid bet amount "${amount}"`);
    }

    if (this.lastKnownBet === undefined) {
      this.lastKnownBet = amount;
      return;
    }

    for (let i = 0; i < 40; i += 1) {
      const current = Number(await this.getBet());
      if (Math.abs(current - target) < 0.001) {
        return;
      }
      const currentIndex = nearestBetLevelIndex(this.betLevels, current);
      const targetIndex = nearestBetLevelIndex(this.betLevels, target);
      if (currentIndex === targetIndex) {
        this.lastKnownBet = trimAmount(this.betLevels[targetIndex]!);
        return;
      }
      if (currentIndex < targetIndex) {
        await this.increase(options);
      } else {
        await this.decrease(options);
      }
    }

    throw new Error(`Unable to reach bet ${amount} from tracked ${this.lastKnownBet}`);
  }

  private async nudge(
    direction: 'plus' | 'minus',
    options?: ObservableWaitOptions,
  ): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new ControllerDisabledError('bet');
    }
    if (this.lockState.locked) {
      throw new Error('Bet controller is locked');
    }

    this.lockState = { locked: true, lockedBy: 'bet', reason: `bet-${direction}` };
    try {
      if (this.lastKnownBet !== undefined) {
        const current = Number(this.lastKnownBet);
        const next = stepBetLevel(this.betLevels, current, direction);
        // Already at ladder edge — extra clicks can open panels / corrupt UI stake.
        if (Math.abs(next - current) < 0.001) {
          return;
        }
      }

      const rendering = this.manifest.metadata?.rendering ?? 'dom';
      if (rendering === 'canvas') {
        const action = direction === 'plus' ? 'betPlus' : 'betMinus';
        await clickCanvasControl(this.driver, this.manifest, action, { ...options, singleInput: true });
      } else {
        await this.driver.click(direction === 'plus' ? 'betPlus' : 'betMinus', options);
      }

      if (this.lastKnownBet !== undefined) {
        const next = stepBetLevel(this.betLevels, Number(this.lastKnownBet), direction);
        this.lastKnownBet = trimAmount(next);
      }
    } finally {
      this.lockState = { locked: false };
    }
  }
}

function trimAmount(value: number): string {
  return String(Number(value.toFixed(4)));
}
