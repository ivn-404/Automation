/**
 * Active scratch-hub client (SignalR JSON protocol).
 *
 * Where `ScratchHubWatcher` only *observes* the game's socket, this opens its own
 * socket to the hub and *drives* it: handshake, then arbitrary invocations and raw
 * frames. It is the base for the PERSONALTESTING PEN fuzzing — negative bets,
 * replays, unknown targets, malformed frames, spoofed identity — none of which the
 * click-only controller can send.
 *
 * Game-agnostic: the full hub URL (with the access_token) is captured from the live
 * game socket; nothing here is specific to a title.
 */

const RECORD_SEPARATOR = '\u001e';

export interface HubCompletion {
  /** Present when the hub answered `type:3` without an error. */
  readonly result?: unknown;
  /** Present when the hub rejected the invocation (server error or HubException). */
  readonly error?: string;
}

export interface InvokeOptions {
  /** Override the invocation id — reuse one to test replay/idempotency (PEN-010). */
  readonly invocationId?: string;
  readonly timeoutMs?: number;
}

interface Pending {
  readonly resolve: (completion: HubCompletion) => void;
  readonly reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/** Decodes the JWT claims from a hub `access_token` (no signature check — read only). */
export function decodeAccessToken(hubUrl: string): Record<string, unknown> | undefined {
  const token = new URL(hubUrl).searchParams.get('access_token');
  const payload = token?.split('.')[1];
  if (payload === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export class ScratchHubClient {
  private readonly socket: WebSocket;
  private readonly pending = new Map<string, Pending>();
  private nextId = 0;
  private closed = false;
  private closeReason: string | undefined;
  private readonly closeListeners: ((reason: string | undefined) => void)[] = [];

  private constructor(socket: WebSocket) {
    this.socket = socket;
    this.socket.addEventListener('message', (event) => this.onMessage(String(event.data)));
    this.socket.addEventListener('close', (event) => this.handleClose(`code ${event.code}`));
    this.socket.addEventListener('error', () => this.handleClose('socket error'));
  }

  /** Opens the socket and completes the SignalR JSON handshake. */
  static connect(
    hubUrl: string,
    options?: { readonly handshakeTimeoutMs?: number; readonly socketOptions?: unknown },
  ): Promise<ScratchHubClient> {
    return new Promise((resolve, reject) => {
      // Node's global WebSocket (undici) accepts an options bag (e.g. { headers: { Origin } })
      // used by the origin/CSRF PEN case; the DOM lib types don't model it, hence the cast.
      const socket =
        options?.socketOptions === undefined
          ? new WebSocket(hubUrl)
          : new (WebSocket as unknown as new (url: string, opts: unknown) => WebSocket)(
              hubUrl,
              options.socketOptions,
            );
      const client = new ScratchHubClient(socket);
      const timeout = setTimeout(
        () => reject(new Error('Scratch hub handshake timed out')),
        options?.handshakeTimeoutMs ?? 15_000,
      );
      const onHandshake = (event: MessageEvent): void => {
        for (const chunk of String(event.data).split(RECORD_SEPARATOR)) {
          if (chunk.trim().length === 0) {
            continue;
          }
          const message = safeParse(chunk);
          // The first non-empty frame is the handshake response: {} on success.
          clearTimeout(timeout);
          socket.removeEventListener('message', onHandshake);
          if (message !== undefined && typeof (message as { error?: unknown }).error === 'string') {
            reject(new Error(`Scratch hub handshake failed: ${(message as { error: string }).error}`));
          } else {
            resolve(client);
          }
          return;
        }
      };
      socket.addEventListener('open', () => socket.send(`{"protocol":"json","version":1}${RECORD_SEPARATOR}`));
      socket.addEventListener('message', onHandshake);
      socket.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('Scratch hub socket error before handshake'));
      });
    });
  }

  /** Sends a SignalR invocation and resolves with the hub's completion frame. */
  invoke(target: string, args: readonly unknown[], options?: InvokeOptions): Promise<HubCompletion> {
    const invocationId = options?.invocationId ?? String(this.nextId++);
    const frame = JSON.stringify({ type: 1, invocationId, target, arguments: args });
    return this.sendInvocation(invocationId, frame, options?.timeoutMs ?? 15_000);
  }

  /**
   * Sends a caller-built frame string verbatim (PEN-032 malformed, PEN-039 spoofed
   * identity, PEN-006 literal NaN/Infinity that JSON.stringify cannot express).
   * Awaits a completion only when `invocationId` is given.
   */
  sendRawInvocation(
    frameText: string,
    options?: { readonly invocationId?: string; readonly timeoutMs?: number },
  ): Promise<HubCompletion> | undefined {
    if (this.closed) {
      throw new Error(`Scratch hub socket already closed (${this.closeReason ?? 'unknown'})`);
    }
    if (options?.invocationId === undefined) {
      this.socket.send(frameText.endsWith(RECORD_SEPARATOR) ? frameText : frameText + RECORD_SEPARATOR);
      return undefined;
    }
    return this.sendInvocation(
      options.invocationId,
      frameText.replace(new RegExp(`${RECORD_SEPARATOR}$`, 'u'), ''),
      options.timeoutMs ?? 15_000,
    );
  }

  /** Raw bytes with no framing help — for protocol-violation tests. */
  sendRaw(text: string): void {
    if (this.closed) {
      throw new Error(`Scratch hub socket already closed (${this.closeReason ?? 'unknown'})`);
    }
    this.socket.send(text);
  }

  get isOpen(): boolean {
    return !this.closed && this.socket.readyState === WebSocket.OPEN;
  }

  onClose(listener: (reason: string | undefined) => void): void {
    if (this.closed) {
      listener(this.closeReason);
      return;
    }
    this.closeListeners.push(listener);
  }

  /** Waits until the socket closes (server-initiated) or the timeout elapses. */
  waitForClose(timeoutMs = 5_000): Promise<{ readonly closed: boolean; readonly reason?: string }> {
    if (this.closed) {
      return Promise.resolve({ closed: true, reason: this.closeReason });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ closed: false }), timeoutMs);
      this.onClose((reason) => {
        clearTimeout(timer);
        resolve({ closed: true, reason });
      });
    });
  }

  close(): void {
    if (!this.closed) {
      try {
        this.socket.close();
      } catch {
        // Already closing.
      }
    }
  }

  private sendInvocation(invocationId: string, frame: string, timeoutMs: number): Promise<HubCompletion> {
    if (this.closed) {
      return Promise.reject(new Error(`Scratch hub socket already closed (${this.closeReason ?? 'unknown'})`));
    }
    return new Promise<HubCompletion>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(invocationId);
        reject(new Error(`Hub did not answer invocation ${invocationId} within ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(invocationId, { resolve, reject, timer });
      this.socket.send(frame + RECORD_SEPARATOR);
    });
  }

  private onMessage(payload: string): void {
    for (const chunk of payload.split(RECORD_SEPARATOR)) {
      if (chunk.trim().length === 0) {
        continue;
      }
      const message = safeParse(chunk);
      if (message === undefined) {
        continue;
      }
      const record = message as { type?: number; invocationId?: string; result?: unknown; error?: string };
      if (record.type === 3 && typeof record.invocationId === 'string') {
        const pending = this.pending.get(record.invocationId);
        if (pending !== undefined) {
          if (pending.timer !== undefined) {
            clearTimeout(pending.timer);
          }
          this.pending.delete(record.invocationId);
          pending.resolve(
            typeof record.error === 'string' ? { error: record.error } : { result: record.result },
          );
        }
      }
      // type 6 (ping) and type 7 (close) need no action for short-lived fuzzing sessions.
    }
  }

  private handleClose(reason: string): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.closeReason = reason;
    for (const pending of this.pending.values()) {
      if (pending.timer !== undefined) {
        clearTimeout(pending.timer);
      }
      pending.reject(new Error(`Scratch hub socket closed (${reason}) before the invocation completed`));
    }
    this.pending.clear();
    for (const listener of this.closeListeners) {
      listener(reason);
    }
    this.closeListeners.length = 0;
  }
}

function safeParse(chunk: string): unknown {
  try {
    return JSON.parse(chunk);
  } catch {
    return undefined;
  }
}
