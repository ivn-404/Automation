/**
 * State machine, controller locking, and readiness contracts.
 */

import type { ControllerId, GameState } from '../constants/index.js';
import type {
  ControllerLockState,
  ObservableWaitOptions,
  ReadinessReport,
} from '../models/index.js';

export interface IGameStateMachine {
  getState(): Promise<GameState>;
  canTransition(to: GameState): Promise<boolean>;
  transitionTo(to: GameState, options?: ObservableWaitOptions): Promise<void>;
  waitForState(state: GameState, options?: ObservableWaitOptions): Promise<void>;
}

export interface IControllerLock {
  getState(): Promise<ControllerLockState>;
  acquire(owner: ControllerId, reason?: string): Promise<void>;
  release(owner: ControllerId): Promise<void>;
  waitUntilUnlocked(options?: ObservableWaitOptions): Promise<void>;
}

/**
 * Readiness Detection — guards before controller actions.
 * Prefer these checks over fixed waits.
 */
export interface IReadinessGuard {
  check(): Promise<ReadinessReport>;
  waitUntilReady(options?: ObservableWaitOptions): Promise<ReadinessReport>;
}
