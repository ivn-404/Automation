/**
 * Platform and Game Driver contracts.
 * Host/shell entry lives here — not Page Objects.
 */

import type {
  EnvironmentConfig,
  GameManifest,
  ObservableWaitOptions,
} from '../models/index.js';

/** Viewport / iframe device used after the launcher opens the game. */
export type GameView = 'desktop' | 'mobile';

/**
 * Platform Layer — browser/session bootstrap and environment binding.
 * Implementations may use Playwright; this port does not.
 *
 * Host/launcher concerns (open URL, select game tile) live here.
 * In-game actions remain Controllers + Game Driver.
 */
export interface IPlatform {
  readonly environment: EnvironmentConfig;
  readonly manifest: GameManifest;

  /** Navigate to the game host / launcher URL for the configured environment. */
  openGameHost(options?: ObservableWaitOptions): Promise<void>;

  /**
   * Open the configured game from the host launcher (e.g. click tile → iframe).
   * Game identity and launcher selectors come from the game manifest.
   */
  openGame(options?: ObservableWaitOptions): Promise<void>;

  /**
   * Keep the desktop host window and lock the game iframe to a fitted
   * portrait so "Rotate to portrait" does not block canvas input.
   */
  prepareDesktopSession(options?: ObservableWaitOptions): Promise<void>;

  /**
   * For mobile-capable games launched on a desktop shell: switch to a portrait
   * viewport and reload the game frame so orientation gates clear.
   * No-op when metadata.devices does not include mobile.
   */
  prepareMobilePortraitSession(options?: ObservableWaitOptions): Promise<void>;

  /**
   * Apply a specific view after the game iframe is attached.
   * Default test sessions use desktop; mobile specs opt in explicitly.
   */
  prepareGameView(view: GameView, options?: ObservableWaitOptions): Promise<void>;

  /**
   * Re-apply the view last selected by prepareDesktopSession /
   * prepareMobilePortraitSession / prepareGameView (used after reload).
   */
  prepareActiveGameView(options?: ObservableWaitOptions): Promise<void>;

  /**
   * Reload the game frame as device=desktop in a wide, unlocked iframe — the
   * layout where side panels (e.g. the scratch drawer) render outside the main canvas.
   */
  prepareLandscapeDesktopView(options?: ObservableWaitOptions): Promise<void>;

  /** Tear down session resources owned by the platform. */
  dispose(): Promise<void>;
}

/**
 * Game Driver — iframe attach and game surface interaction.
 * Game-agnostic; package variance comes from the manifest + UI Registry.
 */
export interface IGameDriver {
  readonly gameId: string;

  /** Attach to the game iframe / surface defined by the manifest. */
  attach(options?: ObservableWaitOptions): Promise<void>;

  /** Whether the driver is attached and usable. */
  isAttached(): Promise<boolean>;

  /** Click a logical locator key resolved via UI Registry (DOM games). */
  click(locatorKey: string, options?: ObservableWaitOptions): Promise<void>;

  /**
   * Click a named canvas action using relative coordinates from the game manifest.
   * Used when metadata.rendering is "canvas".
   */
  clickCanvas(actionName: string, options?: ObservableWaitOptions): Promise<void>;

  /** Read text content for a logical locator key. */
  readText(locatorKey: string, options?: ObservableWaitOptions): Promise<string>;

  /** Detach from the game surface. */
  detach(): Promise<void>;
}
