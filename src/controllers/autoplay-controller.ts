/**
 * Autoplay Controller — start / stop automated spins.
 *
 * Canvas games: clickCanvas("autoplay") (+ optional confirm overlay).
 */

import type { IAutoplayController } from '../core/contracts/index.js';
import type {
  ControllerLockState,
  GameManifest,
  ObservableWaitOptions,
} from '../core/models/index.js';
import type { PlaywrightGameDriver } from '../driver/playwright-game-driver.js';
import { clearInterferingScreens } from '../eye/index.js';
import { clearCanvasOverlays, markSpinTriggered } from '../platform/canvas-session-primer.js';
import { ControllerDisabledError } from './registry/errors.js';
import { clickCanvasControl } from './strategy/click-control.js';
import { matchesBetUrl } from '../network/bet-url.js';
import { candidatePoints, phaserBand } from '../surfaces/index.js';
import { listPhaserTexts } from '../runtime/index.js';

export interface AutoplayControllerOptions {
  readonly driver: PlaywrightGameDriver;
  readonly manifest: GameManifest;
}

export class AutoplayController implements IAutoplayController {
  readonly id = 'autoplay' as const;
  private readonly driver: PlaywrightGameDriver;
  private readonly manifest: GameManifest;
  private active = false;
  private lockState: ControllerLockState = { locked: false };

  constructor(options: AutoplayControllerOptions) {
    this.driver = options.driver;
    this.manifest = options.manifest;
  }

  isAutoplayActive(): boolean {
    return this.active;
  }

  /** Sync controller state after autoplay ends on its own (no canvas click). */
  acknowledgeStopped(): void {
    this.active = false;
  }

  async isAvailable(): Promise<boolean> {
    const capability = this.manifest.controllers.find((entry) => entry.id === 'autoplay');
    if (capability === undefined || !capability.enabled) {
      return false;
    }
    return this.driver.isAttached();
  }

  async getLockState(): Promise<ControllerLockState> {
    return this.lockState;
  }

  async start(options?: ObservableWaitOptions & { spinCountAction?: string }): Promise<void> {
    if (this.active) {
      return;
    }
    if (!(await this.isAvailable())) {
      throw new ControllerDisabledError('autoplay');
    }

    this.lockState = { locked: true, lockedBy: 'autoplay', reason: 'autoplay-start' };
    try {
      const rendering = this.manifest.metadata?.rendering ?? 'dom';
      if (rendering === 'canvas') {
        await clearInterferingScreens({
          page: this.driver.getPage(),
          driver: this.driver,
          manifest: this.manifest,
          intent: 'autoplay',
        });
        await clickCanvasControl(this.driver, this.manifest, 'autoplay', options);
        const spinCountAction =
          options?.spinCountAction ?? this.manifest.metadata?.autoplaySpinCountAction;
        const spinCountPoint =
          spinCountAction === undefined ? undefined : this.manifest.canvasActions?.actions[spinCountAction];
        if (spinCountAction !== undefined && spinCountPoint !== undefined) {
          // The panel animates in; a tap before its count label renders keeps the previous
          // or default count, and autoplay then runs a different number of spins.
          const label = await this.waitForSpinCountLabel(spinCountPoint);
          if (label !== undefined) {
            await this.driver.clickCanvasAt(label, {
              ...options,
              singleInput: true,
              label: spinCountAction,
              strategy: 'phaser',
            });
          } else {
            await this.driver.getPage().waitForTimeout(1_500);
            await this.driver.clickCanvas(spinCountAction, {
              ...options,
              singleInput: true,
            });
          }
        }
        if (this.manifest.metadata?.autoplayNeedsConfirm === 'true') {
          await this.confirmAutoplayStart(options);
        }
      } else {
        await this.driver.click('autoplayButton', options);
      }
      this.active = true;
    } finally {
      this.lockState = { locked: false };
    }
  }

  /** Centre of the panel's spin-count label (metadata.autoplaySelectedSpins) near the manifest point. */
  private async waitForSpinCountLabel(
    near: { readonly x: number; readonly y: number },
    timeoutMs = 8_000,
  ): Promise<{ x: number; y: number } | undefined> {
    const wanted = this.manifest.metadata?.autoplaySelectedSpins?.trim();
    if (wanted === undefined || wanted === '') {
      return undefined;
    }
    const wantedDigits = wanted.replace(/[,\s]/gu, '');
    const page = this.driver.getPage();
    const deadline = Date.now() + timeoutMs;
    let previous: { x: number; y: number } | undefined;
    while (Date.now() < deadline) {
      const texts = await listPhaserTexts(page, this.driver.iframeSelector).catch(() => []);
      const matches = texts
        .filter((entry) => {
          const label = entry.text.trim().replace(/[,\s]/gu, '');
          return label === wantedDigits && entry.gameWidth > 0 && entry.gameHeight > 0;
        })
        .map((entry) => ({
          x: (entry.x + entry.width / 2) / entry.gameWidth,
          y: (entry.y + entry.height / 2) / entry.gameHeight,
        }))
        .sort((a, b) => Math.hypot(a.x - near.x, a.y - near.y) - Math.hypot(b.x - near.x, b.y - near.y));
      const nearby = matches.filter((point) => Math.hypot(point.x - near.x, point.y - near.y) < 0.22);
      const hit = nearby[0] ?? matches[0];
      // The panel slides in: a label read mid-animation is not where it will be when tapped.
      if (hit !== undefined && previous !== undefined && Math.hypot(hit.x - previous.x, hit.y - previous.y) < 0.005) {
        return hit;
      }
      previous = hit;
      await page.waitForTimeout(250);
    }
    return previous;
  }

  private async confirmAutoplayStart(options?: ObservableWaitOptions): Promise<void> {
    const page = this.driver.getPage();
    const timeoutMs = Math.min(options?.timeoutMs ?? 12_000, 20_000);
    const points = uniquePoints([
      ...candidatePoints(this.driver.surface, this.manifest, 'autoplayConfirm'),
      ...candidatePoints(this.driver.surface, this.manifest, 'autoplayStart', ['autoplayStartAlt']),
    ]);

    let lastError: unknown;
    for (const point of points) {
      const betPromise = page.waitForResponse(
        (response) => response.ok() && matchesBetUrl(response.url()),
        { timeout: timeoutMs },
      );
      await this.driver.clickCanvasAt(point, {
        ...options,
        singleInput: true,
        timeoutMs: 10_000,
        label: 'autoplayStart',
        strategy: 'candidate',
      });
      try {
        await betPromise;
        // One /bet after confirm is enough. A TOTAL WIN / cascade can hold the next
        // autoplay /bet well past 30s; treating that as a miss re-taps Autoplay
        // (toggle) and kills the run that just started.
        markSpinTriggered(this.driver);
        return;
      } catch (error: unknown) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Autoplay confirm did not produce a bet response');
  }

  async stop(options?: ObservableWaitOptions): Promise<void> {
    if (!this.active) {
      return;
    }
    if (!(await this.driver.isAttached())) {
      this.active = false;
      return;
    }

    this.lockState = { locked: true, lockedBy: 'autoplay', reason: 'autoplay-stop' };
    try {
      const rendering = this.manifest.metadata?.rendering ?? 'dom';
      await clearCanvasOverlays(this.driver, this.manifest, 1, { allowGridSpam: false });
      if (rendering === 'canvas') {
        // Stop is the same button that started autoplay. A pinned autoplayStop
        // with no scene-graph band is a stale ratio — use the live control.
        const stopPinned = this.manifest.canvasActions?.actions.autoplayStop !== undefined;
        const stopAction =
          stopPinned && phaserBand(this.driver.surface, 'autoplayStop') !== undefined
            ? 'autoplayStop'
            : 'autoplay';
        await clickCanvasControl(this.driver, this.manifest, stopAction, options);
      } else {
        await this.driver.click('autoplayStopButton', options);
      }
      this.active = false;
    } finally {
      this.lockState = { locked: false };
    }
  }
}

function uniquePoints(
  points: readonly { readonly x: number; readonly y: number }[],
): readonly { readonly x: number; readonly y: number }[] {
  const seen = new Set<string>();
  const unique: { readonly x: number; readonly y: number }[] = [];
  for (const point of points) {
    const key = `${point.x.toFixed(3)},${point.y.toFixed(3)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(point);
  }
  return unique;
}
