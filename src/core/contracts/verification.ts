/**
 * Verification contracts — validate outcomes; do not execute actions.
 */

import type { VerificationKind } from '../constants/index.js';
import type {
  BalanceSnapshot,
  BetSnapshot,
  ControllerLockState,
  FreeSpinsSnapshot,
  VerificationContext,
  VerificationResult,
  WinSnapshot,
} from '../models/index.js';

export interface IVerification {
  readonly kind: VerificationKind;
  verify(context: VerificationContext): Promise<VerificationResult>;
}

export interface IBalanceVerification {
  verifyEquals(expected: BalanceSnapshot, actual: BalanceSnapshot): VerificationResult;
}

export interface IBetVerification {
  verifyEquals(expected: BetSnapshot, actual: BetSnapshot): VerificationResult;
}

export interface IControllerLockVerification {
  verifyLocked(state: ControllerLockState, expectedLocked: boolean): VerificationResult;
}

export interface IWinVerification {
  verifyEquals(expected: WinSnapshot, actual: WinSnapshot): VerificationResult;
}

export interface IFreeSpinsVerification {
  verifyEquals(expected: FreeSpinsSnapshot, actual: FreeSpinsSnapshot): VerificationResult;
}

export interface IUiSynchronizationVerification {
  verifySynced(context: VerificationContext): Promise<VerificationResult>;
}

/**
 * Verification Library — reusable assertions behind a single facade.
 */
export interface IVerificationLibrary {
  balance: IBalanceVerification;
  bet: IBetVerification;
  controllerLock: IControllerLockVerification;
  win: IWinVerification;
  freeSpins: IFreeSpinsVerification;
  uiSynchronization: IUiSynchronizationVerification;

  run(kind: VerificationKind, context: VerificationContext): Promise<VerificationResult>;
}
