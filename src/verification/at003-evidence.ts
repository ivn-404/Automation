/**
 * Offline AT-003 evidence classifier (F7-A).
 *
 * Splits three contracts the live spec currently folds into one HUD check:
 * server continuity after an intercepted HTTP 500, HUD restore, dialog dismiss.
 * Injected 500 is fulfilled by Playwright and does not prove a staging refund.
 */

import type { VerificationResult } from '../core/models/index.js';
import { verifyBalanceDelta } from './bet-response-verification.js';

/** Same cent rounding as the Monitor Worker balance timeline. */
export function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

const AMOUNT_TOLERANCE = 0.01;

export type ServerContinuityKind =
  | 'SERVER_CONTINUITY_OK'
  | 'SERVER_CONTINUITY_MISMATCH'
  | 'INSUFFICIENT_EVIDENCE';

export type HudRecoveryKind =
  | 'HUD_RESTORED'
  | 'HUD_STALE_AFTER_FAILURE'
  | 'PRE_FAILURE_HUD_DESYNC'
  | 'INSUFFICIENT_EVIDENCE';

export type DialogRecoveryKind =
  | 'DIALOG_RECOVERED'
  | 'DIALOG_RECOVERY_FAILED'
  | 'INSUFFICIENT_EVIDENCE';

export interface At003TimelineRow {
  readonly time?: string;
  readonly hud?: number;
  readonly server?: number;
  readonly host?: number;
  readonly trigger: string;
  readonly httpStatus?: number;
}

export interface At003RecoveryTransaction {
  readonly stake?: number;
  readonly win?: number;
  readonly serverBalance?: number;
}

export type At003DialogEvidenceSource = 'legacy-helper' | 'independent';

export interface At003DialogEvidence {
  /** Older helper boolean. Historical fixtures only; not independent proof. */
  readonly displayed?: boolean;
  readonly dismissed?: boolean;
  readonly source?: At003DialogEvidenceSource;
  readonly errorDialogObserved?: boolean;
  readonly errorDialogIdentity?: string;
  readonly dismissalActionObserved?: boolean;
  readonly errorDialogClosed?: boolean;
  readonly observationReliable?: boolean;
}

export interface At003SessionEvidence {
  readonly gameId?: string;
  readonly source?: string;
  /** Copied timeline text. Originals are not modified. */
  readonly timeline?: string;
  readonly rows?: readonly At003TimelineRow[];
  readonly recovery?: At003RecoveryTransaction;
  readonly otherVerifiedAdjustments?: number;
  readonly dialog?: At003DialogEvidence;
  /** Explicit: Playwright fulfilled HTTP 500 locally. */
  readonly injectedReachedStaging?: boolean;
}

export interface At003Classification {
  readonly server: ServerContinuityKind;
  readonly hud: HudRecoveryKind;
  readonly dialog: DialogRecoveryKind;
  readonly preFailure?: number;
  readonly expectedPostRecovery?: number;
  readonly postRecovery?: number;
  readonly serverNotes: readonly string[];
  readonly hudNotes: readonly string[];
  readonly dialogNotes: readonly string[];
  readonly notes: readonly string[];
  readonly dialogEvidence?: At003DialogEvidence;
}

function amountsClose(left: number, right: number, tolerance = AMOUNT_TOLERANCE): boolean {
  return Math.abs(roundCents(left) - roundCents(right)) <= tolerance;
}

function parseCell(raw: string): number | undefined {
  const trimmed = raw.replace(/,/gu, '');
  if (trimmed === '—' || trimmed === '-' || trimmed === '') {
    return undefined;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

/** Parse a Monitor Worker `balance-timeline.txt` body. */
export function parseBalanceTimeline(text: string): At003TimelineRow[] {
  const rows: At003TimelineRow[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const match = /^(\d{2}:\d{2}:\d{2}\.\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/u.exec(line);
    if (match === null) {
      continue;
    }
    const trigger = match[6]!.trim();
    const statusMatch = /→\s+(\d{3})/u.exec(trigger);
    rows.push({
      time: match[1],
      hud: parseCell(match[2]!),
      server: parseCell(match[3]!),
      host: parseCell(match[4]!),
      trigger,
      httpStatus: statusMatch !== null ? Number(statusMatch[1]) : undefined,
    });
  }
  return rows;
}

function rowsOf(evidence: At003SessionEvidence): readonly At003TimelineRow[] {
  if (evidence.rows !== undefined && evidence.rows.length > 0) {
    return evidence.rows;
  }
  if (evidence.timeline !== undefined && evidence.timeline.trim() !== '') {
    return parseBalanceTimeline(evidence.timeline);
  }
  return [];
}

function isWarmBet(row: At003TimelineRow): boolean {
  return row.trigger.includes('bet response') && row.httpStatus === 201 && row.server !== undefined;
}

function splitPhases(rows: readonly At003TimelineRow[]): {
  readonly warm: At003TimelineRow | undefined;
  readonly afterWarm: readonly At003TimelineRow[];
  readonly recovery: At003TimelineRow | undefined;
  readonly failureWindow: readonly At003TimelineRow[];
} {
  const warmIndex = rows.findIndex((row) => isWarmBet(row));
  const warm = warmIndex >= 0 ? rows[warmIndex] : undefined;
  const afterWarm = warmIndex >= 0 ? rows.slice(warmIndex + 1) : rows;
  const recoveryIndex = afterWarm.findIndex((row) => isWarmBet(row));
  const recovery = recoveryIndex >= 0 ? afterWarm[recoveryIndex] : undefined;
  const failureWindow = recoveryIndex >= 0 ? afterWarm.slice(0, recoveryIndex) : afterWarm;
  return { warm, afterWarm, recovery, failureWindow };
}

function recoveryHudCheckRow(failureWindow: readonly At003TimelineRow[]): At003TimelineRow | undefined {
  const labeled = [...failureWindow].reverse().find((row) => row.trigger.includes('after error recovery'));
  if (labeled !== undefined) {
    return labeled;
  }
  return [...failureWindow].reverse().find((row) => row.hud !== undefined);
}

function classifyServer(evidence: At003SessionEvidence): {
  readonly kind: ServerContinuityKind;
  readonly preFailure?: number;
  readonly expectedPostRecovery?: number;
  readonly postRecovery?: number;
  readonly notes: string[];
} {
  const notes: string[] = [];
  if (evidence.injectedReachedStaging === true) {
    notes.push('Injected HTTP 500 was marked as reaching staging — this harness treats Playwright fulfill as local');
  } else {
    notes.push('Injected HTTP 500 is Playwright-fulfilled and does not prove a staging refund transaction');
  }

  const rows = rowsOf(evidence);
  const phases = splitPhases(rows);
  const preFailure = phases.warm?.server;
  const recoveryTx = evidence.recovery ?? {};
  const postRecovery = recoveryTx.serverBalance ?? phases.recovery?.server;
  const stake = recoveryTx.stake;
  const win = recoveryTx.win;

  if (preFailure === undefined) {
    notes.push('No pre-failure authoritative /bet 201 server balance');
    return { kind: 'INSUFFICIENT_EVIDENCE', notes };
  }
  if (phases.recovery === undefined && recoveryTx.serverBalance === undefined) {
    notes.push('No recovery /bet 201 response');
    return { kind: 'INSUFFICIENT_EVIDENCE', preFailure, notes };
  }
  if (stake === undefined || win === undefined) {
    notes.push('Recovery stake or win missing — not inferred from HUD');
    return { kind: 'INSUFFICIENT_EVIDENCE', preFailure, postRecovery, notes };
  }
  if (postRecovery === undefined) {
    notes.push('Post-recovery authoritative balance missing');
    return { kind: 'INSUFFICIENT_EVIDENCE', preFailure, notes };
  }

  const adjustments = evidence.otherVerifiedAdjustments ?? 0;
  const expectedPostRecovery = roundCents(preFailure - stake + win + adjustments);
  const delta = verifyBalanceDelta({
    before: { amount: String(roundCents(preFailure + adjustments)) },
    after: { amount: String(postRecovery) },
    win: { amount: String(win) },
    stakeAmount: String(stake),
    tolerance: AMOUNT_TOLERANCE,
  });
  if (!delta.passed) {
    notes.push(
      `Unexplained authoritative debit/credit: expected ${expectedPostRecovery}, actual ${postRecovery} (${delta.message})`,
    );
    return {
      kind: 'SERVER_CONTINUITY_MISMATCH',
      preFailure,
      expectedPostRecovery,
      postRecovery,
      notes,
    };
  }
  notes.push(
    `postRecovery ${postRecovery} = preFailure ${preFailure} - stake ${stake} + win ${win}` +
      (adjustments !== 0 ? ` + adj ${adjustments}` : ''),
  );
  return {
    kind: 'SERVER_CONTINUITY_OK',
    preFailure,
    expectedPostRecovery,
    postRecovery,
    notes,
  };
}

function classifyHud(evidence: At003SessionEvidence, preFailure: number | undefined): {
  readonly kind: HudRecoveryKind;
  readonly notes: string[];
} {
  const notes: string[] = [];
  const rows = rowsOf(evidence);
  const phases = splitPhases(rows);
  if (phases.warm === undefined) {
    notes.push('No warm /bet 201 — cannot judge HUD vs server before injection');
    return { kind: 'INSUFFICIENT_EVIDENCE', notes };
  }

  const check = recoveryHudCheckRow(phases.failureWindow);
  const beforeCheck = check === undefined ? phases.failureWindow : phases.failureWindow.slice(0, phases.failureWindow.indexOf(check));
  const syncedPairs = [phases.warm, ...beforeCheck].filter(
    (row) => row.hud !== undefined && row.server !== undefined && amountsClose(row.hud, row.server),
  );
  const preHudRow = syncedPairs.at(-1);
  const mismatchedPair = [phases.warm, ...beforeCheck].find(
    (row) => row.hud !== undefined && row.server !== undefined && !amountsClose(row.hud, row.server),
  );

  if (preHudRow?.hud === undefined || preHudRow.server === undefined) {
    if (mismatchedPair?.hud !== undefined && mismatchedPair.server !== undefined) {
      notes.push(`HUD ${mismatchedPair.hud} ≠ server ${mismatchedPair.server} before injection`);
      return { kind: 'PRE_FAILURE_HUD_DESYNC', notes };
    }
    notes.push('No paired HUD/server reading after the warm spin');
    return { kind: 'INSUFFICIENT_EVIDENCE', notes };
  }

  if (check?.hud === undefined) {
    notes.push('No HUD sample in the failure window');
    return { kind: 'INSUFFICIENT_EVIDENCE', notes };
  }
  const baseline = preFailure ?? preHudRow.server;
  if (amountsClose(check.hud, baseline) || amountsClose(check.hud, preHudRow.hud)) {
    notes.push(`HUD ${check.hud} matches pre-failure ${baseline} at "${check.trigger}"`);
    return { kind: 'HUD_RESTORED', notes };
  }

  const stake = evidence.recovery?.stake;
  const droppedByStake =
    stake !== undefined && amountsClose(check.hud, roundCents(baseline - stake));
  const droppedVsServer =
    check.server !== undefined && !amountsClose(check.hud, check.server) && check.hud < check.server - AMOUNT_TOLERANCE;
  if (droppedByStake || droppedVsServer) {
    notes.push(
      `HUD ${check.hud} stale vs authoritative ${check.server ?? baseline} at "${check.trigger}" (optimistic debit not restored)`,
    );
    return { kind: 'HUD_STALE_AFTER_FAILURE', notes };
  }

  notes.push(`HUD ${check.hud} at "${check.trigger}" neither restored nor a clear stake debit vs ${baseline}`);
  return { kind: 'HUD_STALE_AFTER_FAILURE', notes };
}

const GENERIC_DIALOG_BUTTON = /^(OK|CLOSE|CONTINUE)$/iu;
const ERROR_DIALOG_IDENTITY =
  /internal server error|server error|something went wrong|request failed|try again|\berror\b/iu;
const NON_ERROR_DIALOG =
  /insufficient|not enough|balance too low|session has been|opened in another window|logged in|session expired/iu;

function stripDialogQuotes(text: string): string {
  return text.replace(/^[\s"'“”]+|[\s"'“”]+$/gu, '').trim();
}

export function isAt003ErrorDialogIdentity(text: string): boolean {
  const normalized = stripDialogQuotes(text);
  if (normalized.length === 0 || GENERIC_DIALOG_BUTTON.test(normalized) || NON_ERROR_DIALOG.test(normalized)) {
    return false;
  }
  return ERROR_DIALOG_IDENTITY.test(normalized);
}

export interface At003DialogObservationInput {
  readonly phaserTextsBeforeDismiss?: readonly string[];
  readonly phaserTextsAfterDismiss?: readonly string[];
  readonly observations?: readonly { readonly name: string; readonly detail?: string }[];
  readonly interactions?: readonly { readonly action: string; readonly detail?: string }[];
  readonly phaserReadFailed?: boolean;
}

function firstErrorIdentity(texts: readonly string[]): string | undefined {
  for (const text of texts) {
    if (isAt003ErrorDialogIdentity(text)) {
      return stripDialogQuotes(text);
    }
  }
  return undefined;
}

function textsIncludeIdentity(texts: readonly string[], identity: string): boolean {
  return texts.some((text) => {
    const normalized = stripDialogQuotes(text);
    return normalized === identity || normalized.includes(identity) || identity.includes(normalized);
  });
}

/**
 * Derive independent AT-003 dialog evidence from Phaser texts, recorder events,
 * and the interaction journal. Does not call dismiss helpers.
 */
export function collectAt003DialogEvidence(input: At003DialogObservationInput): At003DialogEvidence {
  const before = input.phaserTextsBeforeDismiss;
  const after = input.phaserTextsAfterDismiss;
  const observationEvents = input.observations ?? [];
  const phaserReadable = before !== undefined && before.length > 0 && input.phaserReadFailed !== true;
  const modalEvents = observationEvents.filter(
    (event) => event.name === 'modal-opened' || event.name === 'modal-closed',
  );
  const observationReliable =
    input.phaserReadFailed === true ? false : phaserReadable || modalEvents.length > 0;

  const modalOpened = observationEvents
    .filter((event) => event.name === 'modal-opened' && event.detail !== undefined)
    .map((event) => event.detail!);
  const modalClosed = observationEvents
    .filter((event) => event.name === 'modal-closed' && event.detail !== undefined)
    .map((event) => event.detail!);

  const identity =
    firstErrorIdentity(before ?? []) ?? firstErrorIdentity(modalOpened);

  const errorDialogObserved = identity !== undefined;
  const dismissalActionObserved = (input.interactions ?? []).some(
    (entry) => entry.action === 'errorOk' || entry.action.startsWith('errorOk'),
  );

  let errorDialogClosed: boolean | undefined;
  if (identity === undefined) {
    errorDialogClosed = undefined;
  } else if (after !== undefined) {
    errorDialogClosed = !textsIncludeIdentity(after, identity);
  } else if (modalClosed.some((detail) => isAt003ErrorDialogIdentity(detail) && stripDialogQuotes(detail).includes(identity))) {
    errorDialogClosed = true;
  } else {
    errorDialogClosed = undefined;
  }

  return {
    source: 'independent',
    errorDialogObserved,
    errorDialogIdentity: identity,
    dismissalActionObserved,
    errorDialogClosed,
    observationReliable,
  };
}

function hasIndependentDialogFields(dialog: At003DialogEvidence): boolean {
  return (
    dialog.source === 'independent' ||
    dialog.errorDialogObserved !== undefined ||
    dialog.errorDialogIdentity !== undefined ||
    dialog.dismissalActionObserved !== undefined ||
    dialog.errorDialogClosed !== undefined ||
    dialog.observationReliable !== undefined
  );
}

function classifyIndependentDialog(dialog: At003DialogEvidence): {
  readonly kind: DialogRecoveryKind;
  readonly notes: string[];
} {
  const notes: string[] = [];
  const identity = dialog.errorDialogIdentity?.trim();
  const observed = dialog.errorDialogObserved === true && identity !== undefined && identity.length > 0;
  const genericDismissWithoutIdentity =
    dialog.dismissalActionObserved === true && !observed;

  if (dialog.observationReliable === false && !observed) {
    notes.push('Phaser/modal observation was unreliable; cannot prove error-dialog appearance or absence');
    return { kind: 'INSUFFICIENT_EVIDENCE', notes };
  }
  if (genericDismissWithoutIdentity) {
    notes.push('Generic OK/CLOSE/CONTINUE click without error-dialog identity');
    return { kind: 'INSUFFICIENT_EVIDENCE', notes };
  }
  if (dialog.observationReliable === true && dialog.errorDialogObserved === false) {
    notes.push('Reliably confirmed absence of an error-specific dialog after the simulated HTTP 500');
    return { kind: 'DIALOG_RECOVERY_FAILED', notes };
  }
  if (!observed) {
    notes.push('Error-dialog appearance not independently established — HTTP 500 injection is not appearance evidence');
    return { kind: 'INSUFFICIENT_EVIDENCE', notes };
  }

  notes.push(`Error dialog observed: ${identity}`);
  if (dialog.dismissalActionObserved !== true) {
    notes.push('No dismissal action targeting the observed error dialog');
    return { kind: 'DIALOG_RECOVERY_FAILED', notes };
  }
  if (dialog.errorDialogClosed === false) {
    notes.push('Error dialog remained open after dismissal');
    return { kind: 'DIALOG_RECOVERY_FAILED', notes };
  }
  if (dialog.errorDialogClosed !== true) {
    notes.push('Error dialog closure could not be confirmed');
    return { kind: 'INSUFFICIENT_EVIDENCE', notes };
  }
  notes.push('Error dialog dismissed and closed');
  return { kind: 'DIALOG_RECOVERED', notes };
}

function classifyDialog(evidence: At003SessionEvidence): {
  readonly kind: DialogRecoveryKind;
  readonly notes: string[];
} {
  const notes: string[] = [];
  const dialog = evidence.dialog;
  if (dialog === undefined) {
    notes.push('No dialog evidence — recovery /bet does not prove dismiss');
    return { kind: 'INSUFFICIENT_EVIDENCE', notes };
  }
  if (dialog.source !== 'legacy-helper' && hasIndependentDialogFields(dialog)) {
    return classifyIndependentDialog(dialog);
  }
  if (dialog.displayed === undefined && dialog.dismissed === undefined) {
    notes.push('No dialog evidence — recovery /bet does not prove dismiss');
    return { kind: 'INSUFFICIENT_EVIDENCE', notes };
  }
  notes.push('Dialog evidence from older helper; not independently verified');
  if (dialog.dismissed === false) {
    notes.push('Error dialog would not close');
    return { kind: 'DIALOG_RECOVERY_FAILED', notes };
  }
  if (dialog.dismissed === true && dialog.displayed === false) {
    notes.push('Dismissed=true but displayed=false is contradictory');
    return { kind: 'INSUFFICIENT_EVIDENCE', notes };
  }
  if (dialog.dismissed === true) {
    notes.push(dialog.displayed === true ? 'Error dialog displayed and dismissed' : 'Error dialog dismissed');
    return { kind: 'DIALOG_RECOVERED', notes };
  }
  if (dialog.displayed === true && dialog.dismissed === undefined) {
    notes.push('Dialog displayed but dismiss result not recorded');
    return { kind: 'INSUFFICIENT_EVIDENCE', notes };
  }
  notes.push('Dialog evidence incomplete');
  return { kind: 'INSUFFICIENT_EVIDENCE', notes };
}

/** Classify one AT-003 session. Fields stay independent. */
export function classifyAt003Evidence(evidence: At003SessionEvidence): At003Classification {
  const server = classifyServer(evidence);
  const hud = classifyHud(evidence, server.preFailure);
  const dialog = classifyDialog(evidence);
  return {
    server: server.kind,
    hud: hud.kind,
    dialog: dialog.kind,
    preFailure: server.preFailure,
    expectedPostRecovery: server.expectedPostRecovery,
    postRecovery: server.postRecovery,
    serverNotes: server.notes,
    hudNotes: hud.notes,
    dialogNotes: dialog.notes,
    notes: [...server.notes, ...hud.notes, ...dialog.notes],
    dialogEvidence: evidence.dialog,
  };
}

const SERVER_FAIL: ReadonlySet<string> = new Set(['SERVER_CONTINUITY_MISMATCH']);
const HUD_FAIL: ReadonlySet<string> = new Set(['HUD_STALE_AFTER_FAILURE', 'PRE_FAILURE_HUD_DESYNC']);
const DIALOG_FAIL: ReadonlySet<string> = new Set(['DIALOG_RECOVERY_FAILED']);
const PASS_KINDS: ReadonlySet<string> = new Set([
  'SERVER_CONTINUITY_OK',
  'HUD_RESTORED',
  'DIALOG_RECOVERED',
]);

export type At003OverallOutcome = 'PASS' | 'FAIL' | 'INCOMPLETE_EVIDENCE';

export interface At003ContractReport {
  readonly classification: At003Classification;
  readonly overall: At003OverallOutcome;
  readonly failedKinds: readonly string[];
  readonly incompleteKinds: readonly string[];
  readonly message: string;
}

export interface At003LiveEvidenceInput {
  readonly gameId?: string;
  readonly preFailureHud?: number;
  readonly preFailureServer?: number;
  readonly hudAfterFailure?: number;
  readonly serverAfterFailure?: number;
  readonly recoveryHud?: number;
  readonly recovery?: At003RecoveryTransaction;
  readonly dialog?: At003DialogEvidence;
  readonly otherVerifiedAdjustments?: number;
}

function finiteAmount(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

/** Build classifier input from live AT-003 samples. Does not invent missing numbers. */
export function buildAt003LiveEvidence(input: At003LiveEvidenceInput): At003SessionEvidence {
  const rows: At003TimelineRow[] = [];
  const preHud = finiteAmount(input.preFailureHud);
  const preServer = finiteAmount(input.preFailureServer);
  if (preHud !== undefined || preServer !== undefined) {
    rows.push({
      trigger: 'bet response ← POST /api/v1/slots/bet → 201',
      hud: preHud,
      server: preServer,
      httpStatus: 201,
    });
  }
  const hudAfter = finiteAmount(input.hudAfterFailure);
  const serverAfter = finiteAmount(input.serverAfterFailure) ?? preServer;
  if (hudAfter !== undefined || input.serverAfterFailure !== undefined) {
    rows.push({
      trigger: 'after error recovery',
      hud: hudAfter,
      server: serverAfter,
    });
  }
  const recoveryBalance = finiteAmount(input.recovery?.serverBalance);
  const recoveryHud = finiteAmount(input.recoveryHud);
  if (recoveryBalance !== undefined) {
    rows.push({
      trigger: 'bet response ← POST /api/v1/slots/bet → 201',
      hud: recoveryHud,
      server: recoveryBalance,
      httpStatus: 201,
    });
  }
  const stake = finiteAmount(input.recovery?.stake);
  const win = finiteAmount(input.recovery?.win);
  const recovery =
    input.recovery === undefined
      ? undefined
      : {
          stake,
          win,
          serverBalance: recoveryBalance,
        };
  return {
    gameId: input.gameId,
    source: 'AT-003 live session',
    injectedReachedStaging: false,
    rows,
    recovery,
    dialog: input.dialog,
    otherVerifiedAdjustments: input.otherVerifiedAdjustments,
  };
}

function kindBucket(kind: string): 'pass' | 'fail' | 'incomplete' {
  if (PASS_KINDS.has(kind)) {
    return 'pass';
  }
  if (SERVER_FAIL.has(kind) || HUD_FAIL.has(kind) || DIALOG_FAIL.has(kind)) {
    return 'fail';
  }
  return 'incomplete';
}

/**
 * Combine the three independent contracts.
 * Confirmed failures always win over missing evidence. PASS requires all three verified.
 */
export function aggregateAt003Contracts(
  classification: At003Classification,
  options?: { readonly failureInjected?: boolean },
): At003ContractReport {
  const failedKinds: string[] = [];
  const incompleteKinds: string[] = [];
  const entries: Array<{ readonly name: string; readonly kind: string }> = [
    { name: 'server', kind: classification.server },
    { name: 'hud', kind: classification.hud },
    { name: 'dialog', kind: classification.dialog },
  ];
  for (const entry of entries) {
    const bucket = kindBucket(entry.kind);
    if (bucket === 'fail') {
      failedKinds.push(entry.kind);
    } else if (bucket === 'incomplete') {
      incompleteKinds.push(`${entry.name}:${entry.kind}`);
    }
  }

  const contracts = `server=${classification.server}; hud=${classification.hud}; dialog=${classification.dialog}`;
  let overall: At003OverallOutcome;
  if (options?.failureInjected === false) {
    overall = 'FAIL';
  } else if (failedKinds.length > 0) {
    overall = 'FAIL';
  } else if (incompleteKinds.length > 0) {
    overall = 'INCOMPLETE_EVIDENCE';
  } else {
    overall = 'PASS';
  }

  const precondition = failedKinds.includes('PRE_FAILURE_HUD_DESYNC')
    ? ' Precondition: HUD did not match the server before injection.'
    : '';
  const injection = options?.failureInjected === false ? ' Simulated /bet HTTP 500 never fired.' : '';
  const message =
    overall === 'PASS'
      ? `AT-003 PASS — ${contracts}. Injected HTTP 500 is Playwright-fulfilled and does not prove a staging refund.`
      : overall === 'FAIL'
        ? `AT-003 FAIL — ${failedKinds.join(', ') || 'failure path not exercised'}.${precondition}${injection} ${contracts}`
        : `AT-003 INCOMPLETE_EVIDENCE — ${incompleteKinds.join(', ')}. No confirmed contract failure. ${contracts}`;

  return {
    classification,
    overall,
    failedKinds,
    incompleteKinds,
    message,
  };
}

const AT003_INCONCLUSIVE_PREFIX = 'INCONCLUSIVE —';

/** Skip reason for incomplete evidence. Do not call when a contract already failed. */
export function at003IncompleteSkipReason(report: At003ContractReport): string {
  return `${AT003_INCONCLUSIVE_PREFIX} ${report.message}`;
}

function contractMessage(kind: string, notes: readonly string[]): string {
  const detail = notes.join('; ');
  if (kind === 'HUD_STALE_AFTER_FAILURE') {
    return `HUD_STALE_AFTER_FAILURE — HUD balance not refunded after the failed bet, even after closing the error dialog (${detail})`;
  }
  if (kind === 'PRE_FAILURE_HUD_DESYNC') {
    return `PRE_FAILURE_HUD_DESYNC — HUD did not match the server before the failed bet (precondition failure). ${detail}`;
  }
  if (kind === 'DIALOG_RECOVERY_FAILED') {
    return `DIALOG_RECOVERY_FAILED — Failed-bet error dialog would not close. ${detail}`;
  }
  if (kind === 'SERVER_CONTINUITY_MISMATCH') {
    return `SERVER_CONTINUITY_MISMATCH — ${detail}`;
  }
  if (kind === 'INSUFFICIENT_EVIDENCE') {
    return `INSUFFICIENT_EVIDENCE — ${detail}`;
  }
  return `${kind} — ${detail}`;
}

/** One VerificationResult per contract. All three are always present. */
export function at003ContractVerificationResults(report: At003ContractReport): VerificationResult[] {
  const { classification } = report;
  return [
    {
      kind: 'balance',
      passed: classification.server === 'SERVER_CONTINUITY_OK',
      message: contractMessage(classification.server, classification.serverNotes),
      expected: classification.expectedPostRecovery,
      actual: { kind: classification.server, postRecovery: classification.postRecovery },
    },
    {
      kind: 'balance',
      passed: classification.hud === 'HUD_RESTORED',
      message: contractMessage(classification.hud, classification.hudNotes),
      expected: 'HUD_RESTORED',
      actual: classification.hud,
    },
    {
      kind: 'stateManagement',
      passed: classification.dialog === 'DIALOG_RECOVERED',
      message: contractMessage(classification.dialog, classification.dialogNotes),
      expected: 'DIALOG_RECOVERED',
      actual: classification.dialog,
    },
  ];
}

