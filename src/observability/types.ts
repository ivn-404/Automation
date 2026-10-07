/**
 * Monitor Worker observation model — one ordered stream per test.
 *
 * Every entry carries `seq` (order within the test), `at` (epoch ms), a severity
 * and a one-line `summary`, so the monitor can render any kind in one timeline and
 * filter problems without knowing the payload shape.
 */

export type ObservationKind = 'network' | 'console' | 'websocket' | 'event' | 'balance';

export type ObservationSeverity = 'info' | 'warn' | 'error';

export type FrameOrigin = 'host' | 'game' | 'other';

interface ObservationBase {
  readonly seq: number;
  readonly at: number;
  readonly kind: ObservationKind;
  readonly severity: ObservationSeverity;
  readonly summary: string;
}

export interface NetworkObservation extends ObservationBase {
  readonly kind: 'network';
  readonly startedAt: number;
  readonly method: string;
  readonly url: string;
  readonly resourceType: string;
  readonly frame: FrameOrigin;
  /** bet / buy / initialize when the URL matches the game's network patterns. */
  readonly tags: readonly string[];
  readonly status?: number;
  readonly durationMs?: number;
  readonly failure?: string;
  /** Answered by a test route (response header `x-sgap-injected`), not the backend. */
  readonly injected: boolean;
  readonly requestHeaders?: Readonly<Record<string, string>>;
  readonly responseHeaders?: Readonly<Record<string, string>>;
  readonly requestBody?: unknown;
  readonly responseBody?: unknown;
}

export type ConsoleLevel =
  | 'log'
  | 'info'
  | 'debug'
  | 'warn'
  | 'error'
  | 'pageerror'
  | 'unhandledrejection';

export interface ConsoleObservation extends ObservationBase {
  readonly kind: 'console';
  readonly level: ConsoleLevel;
  readonly text: string;
  readonly frame: FrameOrigin;
  readonly location?: string;
  readonly stack?: string;
}

export type WebSocketEvent = 'open' | 'sent' | 'received' | 'error' | 'close';

export interface WebSocketObservation extends ObservationBase {
  readonly kind: 'websocket';
  readonly socketId: number;
  readonly url: string;
  readonly event: WebSocketEvent;
  readonly bytes?: number;
  /** SignalR invocation targets in this frame, when the payload uses that protocol. */
  readonly targets?: readonly string[];
  readonly payload?: unknown;
}

export interface GameEventObservation extends ObservationBase {
  readonly kind: 'event';
  readonly name: string;
  readonly detail?: string;
  readonly data?: unknown;
  /** Observation that caused this event (usually a network entry). */
  readonly relatedSeq?: number;
}

export interface BalanceObservation extends ObservationBase {
  readonly kind: 'balance';
  /** Balance painted by the game HUD. */
  readonly hud?: number;
  /** Last balance the backend reported (bet / buy / initialize response). */
  readonly server?: number;
  /** Balance shown by the host launcher page. */
  readonly host?: number;
  /** hud − server, rounded to cents, when both are known. */
  readonly diff?: number;
  readonly trigger: string;
  readonly relatedSeq?: number;
}

export type Observation =
  | NetworkObservation
  | ConsoleObservation
  | WebSocketObservation
  | GameEventObservation
  | BalanceObservation;

/** Distributive omit so each union member keeps its own fields. */
export type ObservationInput = Observation extends infer T
  ? T extends Observation
    ? Omit<T, 'seq' | 'at'> & { readonly at?: number }
    : never
  : never;

export interface ObservationSessionMeta {
  /** Stable per attempt: `w<lane>-<testCode>-r<retry>`. */
  readonly sessionId: string;
  readonly workerId?: number;
  readonly testKey: string;
  readonly testCode: string;
  readonly title: string;
  readonly gameId: string;
  readonly retry: number;
}
