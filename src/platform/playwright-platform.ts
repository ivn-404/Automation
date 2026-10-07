/**
 * Playwright Platform — host/launcher bootstrap.
 *
 * Opens the game launcher (environment baseUrl), ensures launcher user session,
 * selects a game tile from the manifest (config-driven), and waits for the game iframe.
 *
 * In-game canvas actions are NOT handled here — Controllers + Game Driver.
 */

import type { Frame, Locator, Page, Response } from 'playwright';

import type { GameView, IPlatform } from '../core/contracts/index.js';
import type {
  BalanceSnapshot,
  EnvironmentConfig,
  GameManifest,
  ObservableWaitOptions,
} from '../core/models/index.js';
import { parseBalanceFromBody } from '../data/parse-balance.js';
import { resolveTimeoutMs } from '../driver/wait-options.js';
import { matchesUrlPattern } from '../network/bet-response-watcher.js';
import { clickHostWithIndicator } from '../driver/click-tracker.js';
import type { UiRegistry } from '../ui/registry/index.js';
import { PlatformConfigurationError } from './errors.js';
import { removePortraitLock, shrinkIframeToVisibleRoom } from './portrait-guard.js';
import {
  fitPortraitSize,
  parseWxH,
  portraitAspectFor,
} from './game-view-layout.js';

export interface PlaywrightPlatformOptions {
  readonly page: Page;
  readonly environment: EnvironmentConfig;
  readonly manifest: GameManifest;
  readonly ui: UiRegistry;
}

export class PlaywrightPlatform implements IPlatform {
  private readonly page: Page;
  readonly environment: EnvironmentConfig;
  readonly manifest: GameManifest;
  private readonly ui: UiRegistry;
  private disposed = false;
  private lastInitializeBody: unknown | undefined;
  private activeGameView: GameView = 'desktop';

  constructor(options: PlaywrightPlatformOptions) {
    this.page = options.page;
    this.environment = options.environment;
    this.manifest = options.manifest;
    this.ui = options.ui;
  }

  /** Balance from the last successful initialize response (staging ground truth). */
  getInitializeBalance(): BalanceSnapshot | undefined {
    const fields = this.manifest.network?.fields;
    if (fields === undefined || this.lastInitializeBody === undefined) {
      return undefined;
    }
    return parseBalanceFromBody(this.lastInitializeBody, fields);
  }

  /** Raw initialize JSON (for free-spin / bonus session guards). */
  getInitializeBody(): unknown | undefined {
    return this.lastInitializeBody;
  }

  async openGameHost(options?: ObservableWaitOptions): Promise<void> {
    this.assertNotDisposed();
    const timeout = resolveTimeoutMs(options, this.environment.defaultTimeoutMs);
    await this.page.goto(this.environment.baseUrl, {
      waitUntil: 'domcontentloaded',
      timeout,
    });
    await this.waitForLauncherReady(timeout);
    await this.ensureLauncherUser(options);

    // Dialog can race in after Change user paints — dismiss again if needed.
    const setUserDialog = this.page.locator('div.fixed.inset-0.z-50').filter({ hasText: 'Set user' });
    if (await setUserDialog.first().isVisible().catch(() => false)) {
      await this.ensureLauncherUser(options);
    }
    await this.ensureConfiguredPlayer(options);
    await this.page.getByRole('button', { name: 'Change user' }).waitFor({ state: 'visible', timeout });
  }

  /**
   * If an existing launcher session is for a different playerId, open Change user
   * and re-apply the configured Automation identity.
   */
  private async ensureConfiguredPlayer(options?: ObservableWaitOptions): Promise<void> {
    const timeout = resolveTimeoutMs(options, this.environment.defaultTimeoutMs);
    const expected =
      process.env.SGAP_PLAYER_ID ?? this.environment.metadata?.launcherPlayerId;
    if (!expected) {
      return;
    }

    const headerHasExpected =
      (await this.page
        .locator('div')
        .filter({ has: this.page.getByText('User:', { exact: true }) })
        .filter({ has: this.page.getByText(expected, { exact: true }) })
        .count()) > 0;

    if (headerHasExpected) {
      return;
    }

    const changeUser = this.page.getByRole('button', { name: 'Change user' });
    if (!(await changeUser.isVisible().catch(() => false))) {
      return;
    }
    await clickHostWithIndicator(this.page, changeUser, { timeout }, 'change-user');
    const setUserDialog = this.page.locator('div.fixed.inset-0.z-50').filter({ hasText: 'Set user' });
    await setUserDialog.first().waitFor({ state: 'visible', timeout });
    await this.ensureLauncherUser(options);
    await this.page.getByText(expected, { exact: true }).first().waitFor({ state: 'visible', timeout });
  }

  /**
   * Launcher may show Set user dialog or an existing session (Change user).
   * Set user can appear after session chrome paints — poll for it briefly first.
   */
  private async waitForLauncherReady(timeout: number): Promise<void> {
    const setUserDialog = this.page.locator('div.fixed.inset-0.z-50').filter({ hasText: 'Set user' });
    const changeUser = this.page.getByRole('button', { name: 'Change user' });

    const setUserAppeared = await setUserDialog
      .waitFor({ state: 'visible', timeout: Math.min(timeout, 8_000) })
      .then(() => true)
      .catch(() => false);

    if (!setUserAppeared) {
      await changeUser.waitFor({ state: 'visible', timeout });
    }
  }

  /**
   * Opens the configured game from the launcher grid.
   * Uses manifest locatorKeys + metadata (launcherGameId / launcherGameLabel).
   */
  async openGame(options?: ObservableWaitOptions): Promise<void> {
    this.assertNotDisposed();
    const timeout = resolveTimeoutMs(options, this.environment.defaultTimeoutMs);
    await this.ensureLauncherUser(options);

    // Ensure any leftover Set user modal is gone before searching/playing.
    const setUserDialog = this.page.locator('div.fixed.inset-0.z-50').filter({ hasText: 'Set user' });
    if (await setUserDialog.first().isVisible().catch(() => false)) {
      await this.ensureLauncherUser(options);
    }

    const metadata = this.manifest.metadata ?? {};
    const gameId = metadata.launcherGameId;
    const gameLabel = metadata.launcherGameLabel ?? this.manifest.displayName;
    const playAria = metadata.playButtonAriaLabel ?? 'Play in modal';

    if (!gameId && !gameLabel) {
      throw new PlatformConfigurationError(
        'Manifest metadata must include launcherGameId and/or launcherGameLabel',
      );
    }

    await this.searchForGame(gameLabel, timeout);

    if (gameId) {
      await this.page.getByText(gameId, { exact: true }).first().waitFor({ state: 'visible', timeout });
    } else if (gameLabel) {
      await this.page.getByRole('img', { name: gameLabel }).first().waitFor({ state: 'visible', timeout });
    }

    await this.ensureFreeSpinGrantOff(gameId, timeout);

    const playButton = this.resolvePlayButton(playAria, gameId, gameLabel);

    // Arm before Play so initialize is not missed while the iframe boots.
    // Attach catch immediately to avoid unhandled rejection if Play/iframe is slow.
    const initializeWait = this.beginInitializeWait(timeout)?.catch(() => undefined);

    // DiJoker: Play is `lg:opacity-0 lg:group-hover:opacity-100` — hover the tile group first.
    await this.revealAndClickPlay(playButton, gameLabel, timeout);

    const iframe = this.ui.resolveIframe();
    await this.page.locator(iframe.selector).waitFor({ state: 'attached', timeout });

    if (initializeWait !== undefined) {
      await initializeWait;
    }

    await this.dismissHostOverlays();
  }

  /**
   * Desktop host window + portrait game iframe.
   * DiJoker Play opens a landscape modal; without a portrait iframe the game
   * shows "Rotate to portrait". device=desktop does not clear that gate.
   */
  async prepareDesktopSession(options?: ObservableWaitOptions): Promise<void> {
    await this.prepareGameView('desktop', options);
  }

  /**
   * Full-page mobile portrait (390×844 by default). Used by ES-012 and calibrators.
   * No-op when metadata.devices does not include mobile.
   */
  async prepareMobilePortraitSession(options?: ObservableWaitOptions): Promise<void> {
    this.assertNotDisposed();
    const devices = this.manifest.metadata?.devices ?? '';
    if (!devices.includes('mobile')) {
      return;
    }
    await this.prepareGameView('mobile', options);
  }

  async prepareGameView(view: GameView, options?: ObservableWaitOptions): Promise<void> {
    this.assertNotDisposed();
    this.activeGameView = view;
    const timeout = resolveTimeoutMs(options, this.environment.defaultTimeoutMs);
    const preferred = portraitAspectFor(this.manifest);

    if (view === 'mobile') {
      await this.page.setViewportSize(preferred);
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await this.reloadGameFramePortrait(preferred, timeout);
        lastError = undefined;
        break;
      } catch (error: unknown) {
        lastError = error;
        if (
          attempt >= 2 ||
          !(error instanceof PlatformConfigurationError) ||
          !/Game frame for .* not found/u.test(error.message)
        ) {
          throw error;
        }
        await this.page.waitForTimeout(1_000);
      }
    }
    if (lastError !== undefined) {
      throw lastError;
    }

    if (await this.rotateOverlayVisible()) {
      const viewport = this.page.viewportSize() ?? preferred;
      await this.page.setViewportSize(fitPortraitSize(viewport, preferred));
      await this.reloadGameFramePortrait(preferred, timeout);
    }
  }

  async prepareActiveGameView(options?: ObservableWaitOptions): Promise<void> {
    await this.prepareGameView(this.activeGameView, options);
  }

  async prepareLandscapeDesktopView(options?: ObservableWaitOptions): Promise<void> {
    this.assertNotDisposed();
    const timeout = resolveTimeoutMs(options, this.environment.defaultTimeoutMs);
    await this.page.setViewportSize(
      parseWxH(this.manifest.metadata?.desktopViewport, { width: 1400, height: 900 }),
    );
    await removePortraitLock(this.page);
    const iframe = this.page.locator(this.ui.resolveIframe().selector);
    await iframe.evaluate((el) => {
      const node = el as unknown as {
        style: { removeProperty: (key: string) => void };
        removeAttribute: (name: string) => void;
      };
      for (const key of ['width', 'height', 'max-width', 'max-height', 'min-width', 'min-height']) {
        node.style.removeProperty(key);
      }
      node.removeAttribute('width');
      node.removeAttribute('height');
    });
    const gameFrame = this.findGameFrame();
    if (gameFrame === undefined) {
      throw new PlatformConfigurationError('Game frame not found for desktop landscape reload');
    }
    const initializeWait = this.beginInitializeWait(timeout)?.catch(() => undefined);
    await gameFrame.goto(this.applyDeviceParam(gameFrame.url(), 'desktop'), {
      waitUntil: 'domcontentloaded',
      timeout,
    });
    if (initializeWait !== undefined) {
      await initializeWait;
    }
  }

  /**
   * Reload the existing game iframe (same session URL). Does not click Play again.
   */
  async reloadActiveGameSession(options?: ObservableWaitOptions): Promise<void> {
    this.assertNotDisposed();
    const timeout = resolveTimeoutMs(options, this.environment.defaultTimeoutMs);
    const gameFrame = this.findGameFrame();
    if (gameFrame === undefined) {
      throw new PlatformConfigurationError('Game frame not found for session reload');
    }
    const src = gameFrame.url();
    if (!src || src === 'about:blank') {
      throw new PlatformConfigurationError('Game frame has no session URL to reload');
    }
    const initializeWait = this.beginInitializeWait(timeout)?.catch(() => undefined);
    await gameFrame.goto(src, { waitUntil: 'domcontentloaded', timeout });
    if (initializeWait !== undefined) {
      await initializeWait;
    }
  }

  getActiveGameView(): GameView {
    return this.activeGameView;
  }

  private applyDeviceParam(src: string, device: 'desktop' | 'mobile'): string {
    try {
      const url = new URL(src);
      url.searchParams.set('device', device);
      return url.toString();
    } catch {
      if (/[?&]device=/iu.test(src)) {
        return src.replace(/([?&]device=)[^&]*/iu, `$1${device}`);
      }
      const sep = src.includes('?') ? '&' : '?';
      return `${src}${sep}device=${device}`;
    }
  }

  private findGameFrame(): Frame | undefined {
    const gameKey =
      this.manifest.metadata?.launcherGameKey ?? this.manifest.gameId.replace(/-/gu, '_');
    const keyLower = gameKey.toLowerCase();
    return this.page.frames().find((frame) => frame.url().toLowerCase().includes(keyLower));
  }

  private async rotateOverlayVisible(): Promise<boolean> {
    const frame = this.findGameFrame();
    if (frame === undefined) {
      return this.page.getByText(/rotate to portrait/i).isVisible().catch(() => false);
    }
    const inFrame = await frame
      .getByText(/rotate to portrait/i)
      .isVisible()
      .catch(() => false);
    if (inFrame) {
      return true;
    }
    return this.page.getByText(/rotate to portrait/i).isVisible().catch(() => false);
  }

  private async lockGameIframePortrait(size: {
    readonly width: number;
    readonly height: number;
  }): Promise<void> {
    const iframe = this.ui.resolveIframe();
    const iframeLocator = this.page.locator(iframe.selector);
    await iframeLocator.evaluate((el, next) => {
      const apply = (node: {
        style: { setProperty: (key: string, value: string, priority: string) => void };
      }) => {
        node.style.setProperty('width', `${next.width}px`, 'important');
        node.style.setProperty('height', `${next.height}px`, 'important');
        node.style.setProperty('max-width', `${next.width}px`, 'important');
        node.style.setProperty('max-height', `${next.height}px`, 'important');
        node.style.setProperty('min-width', `${next.width}px`, 'important');
        node.style.setProperty('min-height', `${next.height}px`, 'important');
      };
      const iframeEl = el as {
        style: { setProperty: (key: string, value: string, priority: string) => void };
        setAttribute: (name: string, value: string) => void;
        parentElement: {
          tagName: string;
          style: { setProperty: (key: string, value: string, priority: string) => void };
          parentElement: unknown;
        } | null;
      };
      apply(iframeEl);
      iframeEl.setAttribute('width', String(next.width));
      iframeEl.setAttribute('height', String(next.height));
    }, size);
  }

  private async reloadGameFramePortrait(
    preferred: { readonly width: number; readonly height: number },
    timeout: number,
  ): Promise<void> {
    const iframe = this.ui.resolveIframe();
    const iframeLocator = this.page.locator(iframe.selector);
    await iframeLocator.waitFor({ state: 'attached', timeout });
    const src = await iframeLocator.getAttribute('src');
    if (!src) {
      throw new PlatformConfigurationError('Game iframe has no src to reload in portrait');
    }

    // Under parallel load the iframe can be attached before its Frame is
    // registered on the page (TM-003 flake). Poll briefly before failing.
    const frameDeadline = Date.now() + Math.min(timeout, 20_000);
    let gameFrame = this.findGameFrame();
    while (gameFrame === undefined && Date.now() < frameDeadline) {
      await this.page.waitForTimeout(250);
      gameFrame = this.findGameFrame();
    }
    if (gameFrame === undefined) {
      const gameKey =
        this.manifest.metadata?.launcherGameKey ?? this.manifest.gameId.replace(/-/gu, '_');
      throw new PlatformConfigurationError(`Game frame for "${gameKey}" not found`);
    }

    const viewport = this.page.viewportSize() ?? { width: 1400, height: 900 };
    let fitted = fitPortraitSize(viewport, preferred);
    await this.lockGameIframePortrait(fitted);
    fitted = await shrinkIframeToVisibleRoom(this.page, iframe.selector, fitted, preferred, (size) =>
      this.lockGameIframePortrait(size),
    );

    const innerBefore = await gameFrame
      .evaluate(() => {
        const g = globalThis as unknown as { innerWidth: number; innerHeight: number };
        return { w: g.innerWidth, h: g.innerHeight };
      })
      .catch(() => undefined);
    if (innerBefore !== undefined && innerBefore.w >= innerBefore.h) {
      await this.page.setViewportSize(fitted);
      await this.lockGameIframePortrait(fitted);
    }

    const initializeWait = this.beginInitializeWait(timeout)?.catch(() => undefined);
    const iframeDevice =
      this.manifest.metadata?.orientationLock === 'landscape' ? 'desktop' : 'mobile';
    await gameFrame.goto(this.applyDeviceParam(src, iframeDevice), {
      waitUntil: 'domcontentloaded',
      timeout,
    });
    await this.lockGameIframePortrait(fitted);
    if (initializeWait !== undefined) {
      await initializeWait;
    }
  }

  /**
   * Launcher "Free Spin: YES" injects an ongoing free-spin round into the session.
   * CSF base-game spin needs that grant off — toggle until header shows NO.
   */
  private async ensureFreeSpinGrantOff(gameId: string | undefined, timeout: number): Promise<void> {
    const freeSpinYes = (): Locator =>
      this.page
        .locator('div')
        .filter({ hasText: /Free Spin:/u })
        .getByText('YES', { exact: true })
        .first();

    const freeSpinNo = (): Locator =>
      this.page
        .locator('div')
        .filter({ hasText: /Free Spin:/u })
        .getByText('NO', { exact: true })
        .first();

    // Up to 3 toggles — header YES is the source of truth for grant state.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await freeSpinNo().isVisible().catch(() => false)) {
        return;
      }
      if (!(await freeSpinYes().isVisible().catch(() => false))) {
        break;
      }

      await clickHostWithIndicator(this.page, freeSpinYes(), { timeout, force: true }, 'free-spin-yes').catch(
        () => undefined,
      );

      if (gameId) {
        const grant = this.page.getByRole('button', { name: `Grant free spins for ${gameId}` });
        if (await grant.count()) {
          await clickHostWithIndicator(this.page, grant.first(), { timeout, force: true }, 'grant-free-spins').catch(
            () => undefined,
          );
        }
      }

      const off = await freeSpinNo()
        .waitFor({ state: 'visible', timeout: Math.min(timeout, 5_000) })
        .then(() => true)
        .catch(() => false);
      if (off) {
        return;
      }
    }

    if (await freeSpinYes().isVisible().catch(() => false)) {
      throw new PlatformConfigurationError(
        'Launcher Free Spin is still YES after toggle attempts. Turn Free Spin OFF before CSF base-game spin.',
      );
    }
  }

  /** Click Play; force-click is required because the control overlays the tile. */
  private async revealAndClickPlay(
    playButton: Locator,
    gameLabel: string | undefined,
    timeout: number,
  ): Promise<void> {
    if (gameLabel) {
      const tile = this.page
        .locator('div')
        .filter({ has: this.page.getByRole('img', { name: gameLabel }) })
        .filter({ has: playButton })
        .last();
      await tile.hover({ timeout, force: true }).catch(() => undefined);
    }

    await clickHostWithIndicator(this.page, playButton, { timeout, force: true }, 'play-game');
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }

  /**
   * DiJoker launcher shows a "Set user" dialog when no player session exists.
   * Player/brand come from environment metadata (config) — not hard-coded in specs.
   */
  private async ensureLauncherUser(options?: ObservableWaitOptions): Promise<void> {
    const timeout = resolveTimeoutMs(options, this.environment.defaultTimeoutMs);

    const dialog = this.page
      .locator('div.fixed.inset-0.z-50')
      .filter({ hasText: 'Set user' })
      .first();

    const dialogVisible = await dialog.isVisible().catch(() => false);
    if (!dialogVisible) {
      return;
    }

    const playerId =
      process.env.SGAP_PLAYER_ID ?? this.environment.metadata?.launcherPlayerId;
    const forcedBrandId = process.env.SGAP_BRAND_ID;
    const brandId = forcedBrandId ?? this.environment.metadata?.launcherBrandId ?? '123';

    if (!playerId) {
      throw new PlatformConfigurationError(
        'Launcher requires a player session. Set environment metadata.launcherPlayerId or SGAP_PLAYER_ID.',
      );
    }

    // Labels are sibling <label> + <input> without `for`; placeholders change between
    // launcher builds and "e.g. player-123" substring-matches a brand placeholder of "123".
    const fieldByLabel = (label: string) =>
      dialog
        .locator('label', { hasText: new RegExp(`^${label}$`) })
        .first()
        .locator('xpath=following-sibling::input[1]');

    const userInput = fieldByLabel('User name');
    await userInput.waitFor({ state: 'visible', timeout });
    await userInput.fill(playerId, { timeout });

    // Keep the launcher's prefilled brand unless SGAP_BRAND_ID forces one.
    const brandInput = fieldByLabel('Brand ID');
    if (await brandInput.isEnabled().catch(() => false)) {
      const currentBrand = (await brandInput.inputValue().catch(() => '')).trim();
      if (forcedBrandId !== undefined || currentBrand === '') {
        await brandInput.fill(brandId, { timeout });
      }
    }

    await clickHostWithIndicator(
      this.page,
      dialog.getByRole('button', { name: 'Continue' }),
      { timeout },
      'set-user-continue',
    );
    await dialog.waitFor({ state: 'hidden', timeout });
    await this.page.getByRole('button', { name: 'Change user' }).waitFor({ state: 'visible', timeout });
  }

  private async searchForGame(gameLabel: string | undefined, timeout: number): Promise<void> {
    if (!gameLabel) {
      return;
    }

    if (this.ui.has('searchGames')) {
      const search = this.ui.resolve('searchGames');
      const searchInput = this.page.locator(search.selector);
      if (await searchInput.count()) {
        await searchInput.fill(gameLabel, { timeout });
        return;
      }
    }

    const searchBox = this.page.getByRole('searchbox');
    if (await searchBox.count()) {
      await searchBox.first().fill(gameLabel, { timeout });
    }
  }

  /** Dismiss fixed host backdrops (history / dialogs) that intercept game clicks. */
  private async dismissHostOverlays(): Promise<void> {
    const backdrop = this.page.locator('div.fixed.inset-0.z-50 [role="button"].absolute.inset-0');
    if (await backdrop.first().isVisible().catch(() => false)) {
      await this.page.keyboard.press('Escape').catch(() => undefined);
      await clickHostWithIndicator(this.page, backdrop.first(), { force: true }, 'dismiss-backdrop').catch(
        () => undefined,
      );
    }
  }

  /**
   * Wait for slots initialize when the manifest declares a pattern.
   * Captures JSON body for before-balance verification.
   * Skipped on local about:blank fixtures (no initialize network call).
   */
  private beginInitializeWait(timeout: number): Promise<Response | undefined> | undefined {
    const pattern = this.manifest.network?.initializeUrlPattern;
    if (pattern === undefined) {
      return undefined;
    }

    const pageUrl = this.page.url();
    if (pageUrl === 'about:blank' || pageUrl.startsWith('data:')) {
      return undefined;
    }

    return this.page
      .waitForResponse(
        (response) => {
          if (!response.ok()) {
            return false;
          }
          const url = response.url();
          return matchesUrlPattern(url, pattern) || url.includes('/api/v1/slots/initialize');
        },
        { timeout },
      )
      .then(async (response) => {
        try {
          this.lastInitializeBody = await response.json();
        } catch {
          this.lastInitializeBody = undefined;
        }
        return response;
      });
  }

  /**
   * Resolve Play on the target game tile.
   * Do not scope to `div.grid`.first() — DiJoker can have multiple grids; the first
   * often is not the game catalogue. Prefer the innermost card that owns gameId + Play.
   */
  private resolvePlayButton(playAria: string, gameId?: string, gameLabel?: string) {
    if (gameId) {
      return this.page
        .locator('div')
        .filter({ has: this.page.getByText(gameId, { exact: true }) })
        .filter({ has: this.page.getByRole('button', { name: playAria }) })
        .last()
        .getByRole('button', { name: playAria });
    }

    if (gameLabel) {
      return this.page
        .locator('div')
        .filter({ has: this.page.getByRole('img', { name: gameLabel }) })
        .filter({ has: this.page.getByRole('button', { name: playAria }) })
        .last()
        .getByRole('button', { name: playAria });
    }

    return this.page.getByRole('button', { name: playAria }).first();
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new PlatformConfigurationError('Platform has been disposed');
    }
  }
}
