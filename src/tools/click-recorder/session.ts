/**
 * In-memory recorder session. Revert All clears this session only — never tests or locators.
 */

import type { ClickEvidence, ClickVisualState, RecorderSessionSnapshot } from './types.js';

export class RecorderSession {
  private readonly clicks: ClickEvidence[] = [];
  private nextSeq = 1;

  constructor(readonly gameId: string) {}

  add(click: Omit<ClickEvidence, 'seq' | 'state'>): ClickEvidence {
    const entry: ClickEvidence = { ...click, seq: this.nextSeq, state: 'active' };
    this.nextSeq += 1;
    this.clicks.push(entry);
    return entry;
  }

  acceptLatest(): ClickEvidence | undefined {
    const latest = this.latestMutable('active');
    if (latest === undefined) {
      return undefined;
    }
    this.replace(latest.seq, { ...latest, state: 'accepted' });
    return this.clicks.find((click) => click.seq === latest.seq);
  }

  skipLatest(): ClickEvidence | undefined {
    const latest = this.latestMutable('active') ?? this.latestMutable('accepted');
    if (latest === undefined) {
      return undefined;
    }
    this.replace(latest.seq, { ...latest, state: 'skipped' });
    return this.clicks.find((click) => click.seq === latest.seq);
  }

  revertLast(): ClickEvidence | undefined {
    for (let i = this.clicks.length - 1; i >= 0; i -= 1) {
      const click = this.clicks[i];
      if (click !== undefined && click.state !== 'reverted') {
        this.replace(click.seq, { ...click, state: 'reverted' });
        return this.clicks[i];
      }
    }
    return undefined;
  }

  revertAll(): void {
    for (const click of this.clicks) {
      if (click.state !== 'reverted') {
        this.replace(click.seq, { ...click, state: 'reverted' });
      }
    }
  }

  live(): ClickEvidence[] {
    return this.clicks.filter((click) => click.state === 'active' || click.state === 'accepted');
  }

  historyLine(): string {
    const live = this.live();
    if (live.length === 0) {
      return 'No clicks yet.';
    }
    return live
      .map((click) => `#${click.seq} ${click.state} ${click.surface} (${click.normalizedX ?? '?'}, ${click.normalizedY ?? '?'})`)
      .join('\n');
  }

  snapshot(): RecorderSessionSnapshot {
    return {
      gameId: this.gameId,
      recordedAt: new Date().toISOString(),
      clicks: [...this.clicks],
      accepted: this.clicks.filter((click) => click.state === 'accepted'),
      skipped: this.clicks.filter((click) => click.state === 'skipped'),
      reverted: this.clicks.filter((click) => click.state === 'reverted'),
    };
  }

  private latestMutable(state: ClickVisualState): ClickEvidence | undefined {
    for (let i = this.clicks.length - 1; i >= 0; i -= 1) {
      const click = this.clicks[i];
      if (click?.state === state) {
        return click;
      }
    }
    return undefined;
  }

  private replace(seq: number, next: ClickEvidence): void {
    const index = this.clicks.findIndex((click) => click.seq === seq);
    if (index >= 0) {
      this.clicks[index] = next;
    }
  }
}
