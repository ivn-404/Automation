/**
 * PROBE-006 — Normal-mode multiplier path.
 *
 * Not a QA catalog ID. Spins until a tumble pays or a multiplier field appears,
 * then writes the payload paths. The manifest path is set only from this file.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { test, expect } from '../../fixtures/index.js';
import { settleCanvasToBaseGame } from '../../../src/platform/index.js';
import { getByPath } from '../../../src/shared/json-path.js';
import { spinForBet } from '../../support/canvas-bet-flow.js';
import { prepareCanvasTurbo } from '../../support/canvas-bet-control.js';
import { ensureBaseHud } from '../../support/session-guard.js';

const MANUAL_TEST_ID = 'PROBE-006' as const;
const MAX_SPINS = 40;

interface PathNote {
  readonly path: string;
  readonly kind: string;
  readonly sample?: string | number;
}

function notePaths(value: unknown, prefix: string, out: PathNote[], depth = 0): void {
  if (depth > 7 || value === null || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    out.push({ path: prefix, kind: `array:${value.length}` });
    if (value.length > 0) {
      notePaths(value[0], `${prefix}[]`, out, depth + 1);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const next = prefix.length === 0 ? key : `${prefix}.${key}`;
    if (/mult|tumble|win|area|spot/iu.test(key)) {
      const kind = Array.isArray(child)
        ? `array:${child.length}`
        : child === null
          ? 'null'
          : typeof child;
      out.push({
        path: next,
        kind,
        ...(typeof child === 'number' || typeof child === 'string' ? { sample: child } : {}),
      });
    }
    notePaths(child, next, out, depth + 1);
  }
}

function tumbleCount(body: unknown): number {
  const tumbles = getByPath(body, 'slot.tumbles');
  return Array.isArray(tumbles) ? tumbles.length : 0;
}

test.describe('PROBE — multiplier path', () => {
  test(`${MANUAL_TEST_ID} capture a paid tumble payload`, async ({
    sgapSession,
    sgapDriver,
    page,
  }, testInfo) => {
    test.setTimeout(480_000);
    testInfo.annotations.push(
      { type: 'manualTestId', description: MANUAL_TEST_ID },
      { type: 'category', description: 'PROBE' },
      { type: 'gameId', description: sgapSession.manifest.gameId },
    );

    await expect(sgapDriver.isAttached()).resolves.toBe(true);
    await ensureBaseHud(sgapSession, sgapDriver, page);
    await settleCanvasToBaseGame(
      page,
      sgapDriver,
      sgapSession.manifest,
      sgapSession.platform.getInitializeBody(),
    );
    await prepareCanvasTurbo(sgapSession, sgapDriver, page);
    await sgapSession.turbo.enable({ timeoutMs: 12_000 }).catch(() => undefined);

    let captured: unknown;
    let spins = 0;
    for (; spins < MAX_SPINS; spins += 1) {
      const bet = await spinForBet(sgapSession, sgapDriver, page);
      const notes: PathNote[] = [];
      notePaths(bet.raw, '', notes);
      const paid = Number(bet.win?.amount ?? '0') > 0 || tumbleCount(bet.raw) > 0;
      const hasMultiplier = notes.some((note) => /mult/iu.test(note.path));
      if (paid || hasMultiplier) {
        captured = { spins: spins + 1, win: bet.win?.amount, paths: notes, raw: bet.raw };
        break;
      }
    }

    const outDir = path.join('test-results', 'probe', MANUAL_TEST_ID, sgapSession.manifest.gameId);
    mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'multiplier-path.json');
    writeFileSync(
      outPath,
      `${JSON.stringify(captured ?? { spins, found: false }, null, 2)}\n`,
      'utf8',
    );
    await testInfo.attach('multiplier-path.json', { path: outPath, contentType: 'application/json' });
    expect(captured, `no paid tumble or multiplier field in ${spins} spins`).toBeDefined();
  });
});
