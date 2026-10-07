/**
 * Game event observation contracts.
 * Events are observed — controllers do not own event semantics.
 */

import type { GameEventId } from '../constants/index.js';
import type { GameEventPayload, ObservableWaitOptions } from '../models/index.js';

export type GameEventHandler = (payload: GameEventPayload) => void | Promise<void>;

export interface ISubscription {
  unsubscribe(): void;
}

/**
 * Observes approved game lifecycle / in-game events.
 * Prefer waitFor / on over fixed sleeps.
 */
export interface IGameEventObserver {
  waitFor(eventId: GameEventId, options?: ObservableWaitOptions): Promise<GameEventPayload>;
  on(eventId: GameEventId, handler: GameEventHandler): ISubscription;
}

/** Single discovery surface for event observers / producers. */
export interface IGameEventRegistry {
  register(observer: IGameEventObserver): void;
  getObserver(): IGameEventObserver;
}
