/**
 * Controller contracts.
 * Controllers execute actions; they are not test cases.
 */

import type { ControllerId } from '../constants/index.js';
import type { ControllerLockState, ObservableWaitOptions } from '../models/index.js';

/** Base port for every reusable controller. */
export interface IController {
  readonly id: ControllerId;

  /** Whether the controller can be invoked in the current game context. */
  isAvailable(): Promise<boolean>;

  /** Observes controller lock / busy state. */
  getLockState(): Promise<ControllerLockState>;
}

export interface ISpinController extends IController {
  readonly id: 'spin';
  /**
   * High-level spin: arms start/complete waiters, clicks spin, awaits both.
   * Prefer composing clickSpin + waitForSpinStart/Complete in specs when needed.
   */
  spin(options?: ObservableWaitOptions): Promise<void>;
  /** Clicks the spin control (DOM locator or canvas action from manifest). */
  clickSpin(options?: ObservableWaitOptions): Promise<void>;
  /**
   * Observes spin start (bet/spin request). Arm before or concurrent with clickSpin.
   */
  waitForSpinStart(options?: ObservableWaitOptions): Promise<void>;
  /**
   * Observes spin complete (bet/spin response). Arm before or concurrent with clickSpin.
   */
  waitForSpinComplete(options?: ObservableWaitOptions): Promise<void>;
  /** Whether this controller currently holds the spin lock. */
  isSpinLocked(): Promise<boolean>;
}

export interface IAutoplayController extends IController {
  readonly id: 'autoplay';
  /**
   * Start autoplay. Optional `spinCountAction` taps a canvas count chip
   * (e.g. `autoplaySpins10`) after opening the panel and before confirm.
   */
  start(options?: ObservableWaitOptions & { spinCountAction?: string }): Promise<void>;
  stop(options?: ObservableWaitOptions): Promise<void>;
  acknowledgeStopped(): void;
  isAutoplayActive(): boolean;
}

export interface IBuyFeatureController extends IController {
  readonly id: 'buyFeature';
  buy(options?: ObservableWaitOptions): Promise<void>;
}

export interface IBetController extends IController {
  readonly id: 'bet';
  setBet(amount: string, options?: ObservableWaitOptions): Promise<void>;
  getBet(): Promise<string>;
}

export interface IAmplifyBetController extends IController {
  readonly id: 'amplifyBet';
  enable(options?: ObservableWaitOptions): Promise<void>;
  disable(options?: ObservableWaitOptions): Promise<void>;
}

export interface ITurboController extends IController {
  readonly id: 'turbo';
  enable(options?: ObservableWaitOptions): Promise<void>;
  disable(options?: ObservableWaitOptions): Promise<void>;
}

export interface IMenuController extends IController {
  readonly id: 'menu';
  open(options?: ObservableWaitOptions): Promise<void>;
  close(options?: ObservableWaitOptions): Promise<void>;
}

export interface ISettingsController extends IController {
  readonly id: 'settings';
  open(options?: ObservableWaitOptions): Promise<void>;
  close(options?: ObservableWaitOptions): Promise<void>;
}

export interface IFullscreenController extends IController {
  readonly id: 'fullscreen';
  enter(options?: ObservableWaitOptions): Promise<void>;
  exit(options?: ObservableWaitOptions): Promise<void>;
}

export interface IScratchCardController extends IController {
  readonly id: 'scratchCard';
  open(options?: ObservableWaitOptions): Promise<void>;
  close(options?: ObservableWaitOptions): Promise<void>;
}

/** Union of all approved controller ports. */
export type AnyController =
  | ISpinController
  | IAutoplayController
  | IBuyFeatureController
  | IBetController
  | IAmplifyBetController
  | ITurboController
  | IMenuController
  | ISettingsController
  | IFullscreenController
  | IScratchCardController;

/** Maps controller id → concrete controller interface. */
export interface ControllerMap {
  spin: ISpinController;
  autoplay: IAutoplayController;
  buyFeature: IBuyFeatureController;
  bet: IBetController;
  amplifyBet: IAmplifyBetController;
  turbo: ITurboController;
  menu: IMenuController;
  settings: ISettingsController;
  fullscreen: IFullscreenController;
  scratchCard: IScratchCardController;
}

/**
 * Single discovery surface for controllers.
 * Prevents duplicate controller implementations.
 */
export interface IControllerRegistry {
  register<K extends ControllerId>(controller: ControllerMap[K]): void;
  get<K extends ControllerId>(id: K): ControllerMap[K];
  tryGet<K extends ControllerId>(id: K): ControllerMap[K] | undefined;
  has(id: ControllerId): boolean;
  list(): readonly ControllerId[];
}
