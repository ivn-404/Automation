/**
 * Offline AT-003 evidence classifier. No browser, no wallet, no /bet.
 * node --import ./scripts/lib/register-ts-loader.mjs src/verification/smoke-at003-evidence.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  aggregateAt003Contracts,
  at003ContractVerificationResults,
  at003IncompleteSkipReason,
  classifyAt003Evidence,
  collectAt003DialogEvidence,
  isAt003ErrorDialogIdentity,
  parseBalanceTimeline,
  roundCents,
  type At003DialogEvidence,
  type At003SessionEvidence,
} from './at003-evidence.js';

function fail(message: string): never {
  throw new Error(message);
}

function loadOvernight(name: string): At003SessionEvidence {
  const file = path.join(process.cwd(), 'tests', 'fixtures', 'at003', name);
  return JSON.parse(readFileSync(file, 'utf8')) as At003SessionEvidence;
}

function assertKind(
  label: string,
  evidence: At003SessionEvidence,
  expected: { server: string; hud: string; dialog: string },
): void {
  const got = classifyAt003Evidence(evidence);
  if (got.server !== expected.server) {
    fail(`${label} server: expected ${expected.server}, got ${got.server} (${got.notes.join('; ')})`);
  }
  if (got.hud !== expected.hud) {
    fail(`${label} hud: expected ${expected.hud}, got ${got.hud} (${got.notes.join('; ')})`);
  }
  if (got.dialog !== expected.dialog) {
    fail(`${label} dialog: expected ${expected.dialog}, got ${got.dialog} (${got.notes.join('; ')})`);
  }
}

const warmAndRecover = (opts: {
  preHud: number;
  preServer: number;
  failHud: number;
  failServer: number;
  postServer: number;
  recovery?: At003SessionEvidence['recovery'];
  dialog?: At003SessionEvidence['dialog'];
  adjustments?: number;
}): At003SessionEvidence => ({
  injectedReachedStaging: false,
  recovery: opts.recovery,
  otherVerifiedAdjustments: opts.adjustments,
  dialog: opts.dialog,
  rows: [
    {
      trigger: 'bet response ← POST /api/v1/slots/bet → 201',
      hud: opts.preHud,
      server: opts.preServer,
      httpStatus: 201,
    },
    { trigger: 'sample', hud: opts.preHud, server: opts.preServer },
    { trigger: 'after error recovery', hud: opts.failHud, server: opts.failServer },
    {
      trigger: 'bet response ← POST /api/v1/slots/bet → 201',
      hud: opts.postServer,
      server: opts.postServer,
      httpStatus: 201,
    },
  ],
});

function main(): void {
  const parsed = parseBalanceTimeline(loadOvernight('overnight-sugar-wonderland.json').timeline ?? '');
  if (parsed.length < 8) {
    fail(`timeline parser lost rows: ${parsed.length}`);
  }
  if (parsed[4]?.httpStatus !== 201 || parsed[4]?.server !== 14999.4) {
    fail(`warm bet not parsed: ${JSON.stringify(parsed[4])}`);
  }

  const sugar = classifyAt003Evidence(loadOvernight('overnight-sugar-wonderland.json'));
  assertKind('Sugar overnight', loadOvernight('overnight-sugar-wonderland.json'), {
    server: 'SERVER_CONTINUITY_OK',
    hud: 'HUD_RESTORED',
    dialog: 'DIALOG_RECOVERED',
  });
  if (sugar.expectedPostRecovery !== 14998.4) {
    fail(`Sugar expected post-recovery ${sugar.expectedPostRecovery}`);
  }

  assertKind('Beelze overnight', loadOvernight('overnight-beelze-bop.json'), {
    server: 'SERVER_CONTINUITY_OK',
    hud: 'HUD_STALE_AFTER_FAILURE',
    dialog: 'DIALOG_RECOVERED',
  });

  const felice = classifyAt003Evidence(loadOvernight('overnight-felice-in-space.json'));
  assertKind('Felice overnight', loadOvernight('overnight-felice-in-space.json'), {
    server: 'SERVER_CONTINUITY_OK',
    hud: 'HUD_STALE_AFTER_FAILURE',
    dialog: 'DIALOG_RECOVERED',
  });
  if (felice.preFailure !== 14999.3 || felice.postRecovery !== 14999.3) {
    fail(`Felice net-zero recovery ${felice.preFailure} → ${felice.postRecovery}`);
  }

  assertKind('Mars overnight', loadOvernight('overnight-mars-triumph.json'), {
    server: 'SERVER_CONTINUITY_OK',
    hud: 'HUD_STALE_AFTER_FAILURE',
    dialog: 'DIALOG_RECOVERED',
  });

  assertKind(
    'pre-failure HUD mismatch',
    warmAndRecover({
      preHud: 15003.9,
      preServer: 14999,
      failHud: 15002.9,
      failServer: 14999,
      postServer: 14998,
      recovery: { stake: 1, win: 0, serverBalance: 14998 },
      dialog: { displayed: true, dismissed: true },
    }),
    {
      server: 'SERVER_CONTINUITY_OK',
      hud: 'PRE_FAILURE_HUD_DESYNC',
      dialog: 'DIALOG_RECOVERED',
    },
  );

  assertKind(
    'missing recovery response',
    {
      rows: [
        {
          trigger: 'bet response ← POST /api/v1/slots/bet → 201',
          hud: 100,
          server: 100,
          httpStatus: 201,
        },
        { trigger: 'after error recovery', hud: 99, server: 100 },
      ],
      recovery: { stake: 1, win: 0 },
      dialog: { displayed: true, dismissed: true },
    },
    {
      server: 'INSUFFICIENT_EVIDENCE',
      hud: 'HUD_STALE_AFTER_FAILURE',
      dialog: 'DIALOG_RECOVERED',
    },
  );

  assertKind(
    'missing win',
    warmAndRecover({
      preHud: 100,
      preServer: 100,
      failHud: 99,
      failServer: 100,
      postServer: 99,
      recovery: { stake: 1, serverBalance: 99 },
      dialog: { displayed: true, dismissed: true },
    }),
    {
      server: 'INSUFFICIENT_EVIDENCE',
      hud: 'HUD_STALE_AFTER_FAILURE',
      dialog: 'DIALOG_RECOVERED',
    },
  );

  assertKind(
    'unexplained authoritative debit',
    warmAndRecover({
      preHud: 100,
      preServer: 100,
      failHud: 99,
      failServer: 100,
      postServer: 98,
      recovery: { stake: 1, win: 0, serverBalance: 98 },
      dialog: { displayed: true, dismissed: true },
    }),
    {
      server: 'SERVER_CONTINUITY_MISMATCH',
      hud: 'HUD_STALE_AFTER_FAILURE',
      dialog: 'DIALOG_RECOVERED',
    },
  );

  assertKind(
    'correct HUD restoration',
    warmAndRecover({
      preHud: 100,
      preServer: 100,
      failHud: 100,
      failServer: 100,
      postServer: 99.5,
      recovery: { stake: 1, win: 0.5, serverBalance: 99.5 },
      dialog: { displayed: true, dismissed: true },
    }),
    {
      server: 'SERVER_CONTINUITY_OK',
      hud: 'HUD_RESTORED',
      dialog: 'DIALOG_RECOVERED',
    },
  );

  assertKind(
    'failed dialog dismissal',
    warmAndRecover({
      preHud: 100,
      preServer: 100,
      failHud: 99,
      failServer: 100,
      postServer: 99,
      recovery: { stake: 1, win: 0, serverBalance: 99 },
      dialog: { displayed: true, dismissed: false },
    }),
    {
      server: 'SERVER_CONTINUITY_OK',
      hud: 'HUD_STALE_AFTER_FAILURE',
      dialog: 'DIALOG_RECOVERY_FAILED',
    },
  );

  assertKind(
    'dialog evidence missing',
    warmAndRecover({
      preHud: 100,
      preServer: 100,
      failHud: 100,
      failServer: 100,
      postServer: 99,
      recovery: { stake: 1, win: 0, serverBalance: 99 },
    }),
    {
      server: 'SERVER_CONTINUITY_OK',
      hud: 'HUD_RESTORED',
      dialog: 'INSUFFICIENT_EVIDENCE',
    },
  );

  const rounded = classifyAt003Evidence(
    warmAndRecover({
      preHud: 10.005,
      preServer: 10.005,
      failHud: 10.005,
      failServer: 10.005,
      postServer: 9.01,
      recovery: { stake: 1, win: 0, serverBalance: 9.01 },
      dialog: { displayed: true, dismissed: true },
    }),
  );
  if (roundCents(10.005) !== 10.01) {
    fail(`roundCents(10.005) = ${roundCents(10.005)}`);
  }
  if (rounded.server !== 'SERVER_CONTINUITY_OK') {
    fail(`rounding continuity: ${rounded.server} expected ${rounded.expectedPostRecovery} notes=${rounded.notes.join('; ')}`);
  }
  if (rounded.expectedPostRecovery !== 9.01) {
    fail(`rounding expected ${rounded.expectedPostRecovery}`);
  }

  const hudNotUsedForCharge = classifyAt003Evidence({
    rows: [
      {
        trigger: 'bet response ← POST /api/v1/slots/bet → 201',
        hud: 100,
        server: 100,
        httpStatus: 201,
      },
      { trigger: 'after error recovery', hud: 98, server: 100 },
      {
        trigger: 'bet response ← POST /api/v1/slots/bet → 201',
        hud: 99,
        server: 99,
        httpStatus: 201,
      },
    ],
    recovery: { stake: 1, win: 0, serverBalance: 99 },
    dialog: { displayed: true, dismissed: true },
  });
  if (hudNotUsedForCharge.server !== 'SERVER_CONTINUITY_OK') {
    fail('stale HUD must not be treated as a backend charge');
  }
  if (hudNotUsedForCharge.hud !== 'HUD_STALE_AFTER_FAILURE') {
    fail(`HUD 98 vs server 100 should be stale, got ${hudNotUsedForCharge.hud}`);
  }

  function assertOverall(
    label: string,
    evidence: At003SessionEvidence,
    expected: { overall: string; server: string; hud: string; dialog: string; failed?: string[] },
  ): void {
    const report = aggregateAt003Contracts(classifyAt003Evidence(evidence));
    if (report.overall !== expected.overall) {
      fail(`${label} overall: expected ${expected.overall}, got ${report.overall} (${report.message})`);
    }
    if (report.classification.server !== expected.server) {
      fail(`${label} preserved server: expected ${expected.server}, got ${report.classification.server}`);
    }
    if (report.classification.hud !== expected.hud) {
      fail(`${label} preserved hud: expected ${expected.hud}, got ${report.classification.hud}`);
    }
    if (report.classification.dialog !== expected.dialog) {
      fail(`${label} preserved dialog: expected ${expected.dialog}, got ${report.classification.dialog}`);
    }
    const results = at003ContractVerificationResults(report);
    if (results.length !== 3) {
      fail(`${label} expected 3 contract results, got ${results.length}`);
    }
    if (expected.failed !== undefined) {
      for (const kind of expected.failed) {
        if (!report.failedKinds.includes(kind)) {
          fail(`${label} missing failed kind ${kind}: ${report.failedKinds.join(',')}`);
        }
      }
    }
    if (report.overall === 'FAIL' && !results.some((row) => !row.passed)) {
      fail(`${label} FAIL must keep at least one failed contract result`);
    }
    if (report.overall === 'INCOMPLETE_EVIDENCE') {
      if (!at003IncompleteSkipReason(report).startsWith('INCONCLUSIVE —')) {
        fail(`${label} incomplete skip must use INCONCLUSIVE prefix`);
      }
      if (report.failedKinds.length > 0) {
        fail(`${label} incomplete must not carry confirmed failures`);
      }
    }
  }

  assertOverall('Sugar overnight aggregate', loadOvernight('overnight-sugar-wonderland.json'), {
    overall: 'PASS',
    server: 'SERVER_CONTINUITY_OK',
    hud: 'HUD_RESTORED',
    dialog: 'DIALOG_RECOVERED',
  });
  assertOverall('Beelze overnight aggregate', loadOvernight('overnight-beelze-bop.json'), {
    overall: 'FAIL',
    server: 'SERVER_CONTINUITY_OK',
    hud: 'HUD_STALE_AFTER_FAILURE',
    dialog: 'DIALOG_RECOVERED',
    failed: ['HUD_STALE_AFTER_FAILURE'],
  });
  assertOverall('Felice overnight aggregate', loadOvernight('overnight-felice-in-space.json'), {
    overall: 'FAIL',
    server: 'SERVER_CONTINUITY_OK',
    hud: 'HUD_STALE_AFTER_FAILURE',
    dialog: 'DIALOG_RECOVERED',
    failed: ['HUD_STALE_AFTER_FAILURE'],
  });
  assertOverall('Mars overnight aggregate', loadOvernight('overnight-mars-triumph.json'), {
    overall: 'FAIL',
    server: 'SERVER_CONTINUITY_OK',
    hud: 'HUD_STALE_AFTER_FAILURE',
    dialog: 'DIALOG_RECOVERED',
    failed: ['HUD_STALE_AFTER_FAILURE'],
  });

  const missingRecoveryStaleHud: At003SessionEvidence = {
    rows: [
      {
        trigger: 'bet response ← POST /api/v1/slots/bet → 201',
        hud: 100,
        server: 100,
        httpStatus: 201,
      },
      { trigger: 'after error recovery', hud: 99, server: 100 },
    ],
    recovery: { stake: 1, win: 0 },
    dialog: { displayed: true, dismissed: true },
  };
  assertOverall('missing recovery + stale HUD', missingRecoveryStaleHud, {
    overall: 'FAIL',
    server: 'INSUFFICIENT_EVIDENCE',
    hud: 'HUD_STALE_AFTER_FAILURE',
    dialog: 'DIALOG_RECOVERED',
    failed: ['HUD_STALE_AFTER_FAILURE'],
  });

  const missingRecoveryOnly: At003SessionEvidence = {
    rows: [
      {
        trigger: 'bet response ← POST /api/v1/slots/bet → 201',
        hud: 100,
        server: 100,
        httpStatus: 201,
      },
      { trigger: 'after error recovery', hud: 100, server: 100 },
    ],
    recovery: { stake: 1, win: 0 },
    dialog: { displayed: true, dismissed: true },
  };
  assertOverall('missing recovery, no other failure', missingRecoveryOnly, {
    overall: 'INCOMPLETE_EVIDENCE',
    server: 'INSUFFICIENT_EVIDENCE',
    hud: 'HUD_RESTORED',
    dialog: 'DIALOG_RECOVERED',
  });

  assertOverall(
    'pre-failure HUD desync aggregate',
    warmAndRecover({
      preHud: 15003.9,
      preServer: 14999,
      failHud: 15002.9,
      failServer: 14999,
      postServer: 14998,
      recovery: { stake: 1, win: 0, serverBalance: 14998 },
      dialog: { displayed: true, dismissed: true },
    }),
    {
      overall: 'FAIL',
      server: 'SERVER_CONTINUITY_OK',
      hud: 'PRE_FAILURE_HUD_DESYNC',
      dialog: 'DIALOG_RECOVERED',
      failed: ['PRE_FAILURE_HUD_DESYNC'],
    },
  );
  const desync = aggregateAt003Contracts(
    classifyAt003Evidence(
      warmAndRecover({
        preHud: 15003.9,
        preServer: 14999,
        failHud: 15002.9,
        failServer: 14999,
        postServer: 14998,
        recovery: { stake: 1, win: 0, serverBalance: 14998 },
        dialog: { displayed: true, dismissed: true },
      }),
    ),
  );
  if (!desync.message.includes('Precondition')) {
    fail(`pre-failure desync must be labelled a precondition failure: ${desync.message}`);
  }

  assertOverall(
    'failed dialog aggregate',
    warmAndRecover({
      preHud: 100,
      preServer: 100,
      failHud: 99,
      failServer: 100,
      postServer: 99,
      recovery: { stake: 1, win: 0, serverBalance: 99 },
      dialog: { displayed: true, dismissed: false },
    }),
    {
      overall: 'FAIL',
      server: 'SERVER_CONTINUITY_OK',
      hud: 'HUD_STALE_AFTER_FAILURE',
      dialog: 'DIALOG_RECOVERY_FAILED',
      failed: ['HUD_STALE_AFTER_FAILURE', 'DIALOG_RECOVERY_FAILED'],
    },
  );

  assertOverall(
    'missing dialog + HUD fail',
    warmAndRecover({
      preHud: 100,
      preServer: 100,
      failHud: 99,
      failServer: 100,
      postServer: 99,
      recovery: { stake: 1, win: 0, serverBalance: 99 },
    }),
    {
      overall: 'FAIL',
      server: 'SERVER_CONTINUITY_OK',
      hud: 'HUD_STALE_AFTER_FAILURE',
      dialog: 'INSUFFICIENT_EVIDENCE',
      failed: ['HUD_STALE_AFTER_FAILURE'],
    },
  );

  const roundedAgg = aggregateAt003Contracts(rounded);
  if (roundedAgg.overall !== 'PASS') {
    fail(`rounding overall ${roundedAgg.overall}`);
  }
  const feliceAgg = aggregateAt003Contracts(felice);
  if (feliceAgg.overall !== 'FAIL' || feliceAgg.classification.server !== 'SERVER_CONTINUITY_OK') {
    fail('Felice net-zero recovery must keep server pass with HUD fail');
  }

  const beelzeResults = at003ContractVerificationResults(
    aggregateAt003Contracts(classifyAt003Evidence(loadOvernight('overnight-beelze-bop.json'))),
  );
  if (!beelzeResults[1]?.message.includes('HUD_STALE_AFTER_FAILURE')) {
    fail(`Beelze HUD result must keep stale-failure wording: ${beelzeResults[1]?.message}`);
  }
  if (beelzeResults[0]?.passed !== true || beelzeResults[2]?.passed !== true) {
    fail('Beelze report must keep server and dialog passes while HUD fails');
  }
  const sugarDialogNotes = classifyAt003Evidence(loadOvernight('overnight-sugar-wonderland.json')).dialogNotes.join(' ');
  if (!sugarDialogNotes.includes('older helper')) {
    fail(`historical Sugar dialog must stay legacy-helper classified: ${sugarDialogNotes}`);
  }

  if (isAt003ErrorDialogIdentity('OK') || isAt003ErrorDialogIdentity('Insufficient balance')) {
    fail('generic OK / wallet copy must not identify an error dialog');
  }
  if (!isAt003ErrorDialogIdentity('Internal server error')) {
    fail('Internal server error must identify an error dialog');
  }

  const independentPass: At003DialogEvidence = {
    source: 'independent',
    errorDialogObserved: true,
    errorDialogIdentity: 'Internal server error',
    dismissalActionObserved: true,
    errorDialogClosed: true,
    observationReliable: true,
  };
  assertOverall(
    '1 genuine error dialog recovered',
    warmAndRecover({
      preHud: 100,
      preServer: 100,
      failHud: 100,
      failServer: 100,
      postServer: 99,
      recovery: { stake: 1, win: 0, serverBalance: 99 },
      dialog: independentPass,
    }),
    {
      overall: 'PASS',
      server: 'SERVER_CONTINUITY_OK',
      hud: 'HUD_RESTORED',
      dialog: 'DIALOG_RECOVERED',
    },
  );

  assertKind(
    '2 dialog remains open',
    warmAndRecover({
      preHud: 100,
      preServer: 100,
      failHud: 100,
      failServer: 100,
      postServer: 99,
      recovery: { stake: 1, win: 0, serverBalance: 99 },
      dialog: { ...independentPass, errorDialogClosed: false },
    }),
    { server: 'SERVER_CONTINUITY_OK', hud: 'HUD_RESTORED', dialog: 'DIALOG_RECOVERY_FAILED' },
  );

  assertKind(
    '3 dialog observed, no dismissal',
    warmAndRecover({
      preHud: 100,
      preServer: 100,
      failHud: 100,
      failServer: 100,
      postServer: 99,
      recovery: { stake: 1, win: 0, serverBalance: 99 },
      dialog: { ...independentPass, dismissalActionObserved: false, errorDialogClosed: false },
    }),
    { server: 'SERVER_CONTINUITY_OK', hud: 'HUD_RESTORED', dialog: 'DIALOG_RECOVERY_FAILED' },
  );

  assertKind(
    '4 reliable absence',
    warmAndRecover({
      preHud: 100,
      preServer: 100,
      failHud: 100,
      failServer: 100,
      postServer: 99,
      recovery: { stake: 1, win: 0, serverBalance: 99 },
      dialog: collectAt003DialogEvidence({
        phaserTextsBeforeDismiss: ['BALANCE', '100.00', 'SPIN'],
        phaserTextsAfterDismiss: ['BALANCE', '100.00', 'SPIN'],
      }),
    }),
    { server: 'SERVER_CONTINUITY_OK', hud: 'HUD_RESTORED', dialog: 'DIALOG_RECOVERY_FAILED' },
  );

  assertKind(
    '5 unreliable observation',
    warmAndRecover({
      preHud: 100,
      preServer: 100,
      failHud: 100,
      failServer: 100,
      postServer: 99,
      recovery: { stake: 1, win: 0, serverBalance: 99 },
      dialog: collectAt003DialogEvidence({ phaserReadFailed: true }),
    }),
    { server: 'SERVER_CONTINUITY_OK', hud: 'HUD_RESTORED', dialog: 'INSUFFICIENT_EVIDENCE' },
  );

  assertKind(
    '6 generic OK without identity',
    warmAndRecover({
      preHud: 100,
      preServer: 100,
      failHud: 100,
      failServer: 100,
      postServer: 99,
      recovery: { stake: 1, win: 0, serverBalance: 99 },
      dialog: collectAt003DialogEvidence({
        phaserTextsBeforeDismiss: ['OK', 'BALANCE', '100.00'],
        phaserTextsAfterDismiss: ['BALANCE', '100.00'],
        interactions: [{ action: 'errorOk' }],
      }),
    }),
    { server: 'SERVER_CONTINUITY_OK', hud: 'HUD_RESTORED', dialog: 'INSUFFICIENT_EVIDENCE' },
  );

  assertKind(
    '7 closure unconfirmed',
    warmAndRecover({
      preHud: 100,
      preServer: 100,
      failHud: 100,
      failServer: 100,
      postServer: 99,
      recovery: { stake: 1, win: 0, serverBalance: 99 },
      dialog: {
        ...independentPass,
        errorDialogClosed: undefined,
      },
    }),
    { server: 'SERVER_CONTINUITY_OK', hud: 'HUD_RESTORED', dialog: 'INSUFFICIENT_EVIDENCE' },
  );

  assertOverall(
    '8 HUD fail + dialog insufficient',
    warmAndRecover({
      preHud: 100,
      preServer: 100,
      failHud: 99,
      failServer: 100,
      postServer: 99,
      recovery: { stake: 1, win: 0, serverBalance: 99 },
      dialog: collectAt003DialogEvidence({ phaserReadFailed: true }),
    }),
    {
      overall: 'FAIL',
      server: 'SERVER_CONTINUITY_OK',
      hud: 'HUD_STALE_AFTER_FAILURE',
      dialog: 'INSUFFICIENT_EVIDENCE',
      failed: ['HUD_STALE_AFTER_FAILURE'],
    },
  );

  assertOverall(
    '9 HUD pass + dialog insufficient',
    warmAndRecover({
      preHud: 100,
      preServer: 100,
      failHud: 100,
      failServer: 100,
      postServer: 99,
      recovery: { stake: 1, win: 0, serverBalance: 99 },
      dialog: collectAt003DialogEvidence({ phaserReadFailed: true }),
    }),
    {
      overall: 'INCOMPLETE_EVIDENCE',
      server: 'SERVER_CONTINUITY_OK',
      hud: 'HUD_RESTORED',
      dialog: 'INSUFFICIENT_EVIDENCE',
    },
  );

  assertOverall(
    '10 all three contracts verified',
    warmAndRecover({
      preHud: 100,
      preServer: 100,
      failHud: 100,
      failServer: 100,
      postServer: 99,
      recovery: { stake: 1, win: 0, serverBalance: 99 },
      dialog: independentPass,
    }),
    {
      overall: 'PASS',
      server: 'SERVER_CONTINUITY_OK',
      hud: 'HUD_RESTORED',
      dialog: 'DIALOG_RECOVERED',
    },
  );

  const collectedRecovered = collectAt003DialogEvidence({
    phaserTextsBeforeDismiss: ['Internal server error', 'OK', 'BALANCE'],
    phaserTextsAfterDismiss: ['BALANCE', '100.00'],
    observations: [{ name: 'modal-opened', detail: '"Internal server error"' }],
    interactions: [{ action: 'errorOk' }],
  });
  if (
    collectedRecovered.errorDialogObserved !== true ||
    collectedRecovered.dismissalActionObserved !== true ||
    collectedRecovered.errorDialogClosed !== true
  ) {
    fail(`collector missed recovered sequence: ${JSON.stringify(collectedRecovered)}`);
  }

  console.log('at003 evidence smoke ok');
}

main();
