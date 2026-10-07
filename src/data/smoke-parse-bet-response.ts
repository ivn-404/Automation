/**
 * Smoke: parse DiJoker bet response sample into balance/win snapshots.
 * Run: node dist/data/smoke-parse-bet-response.js
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parseBetResponseBody } from './parse-bet-response.js';

async function main(): Promise<void> {
  const samplePath = path.join(
    process.cwd(),
    'tests',
    'fixtures',
    'samples',
    'dijoker-bet-response.json',
  );
  const body = JSON.parse(await readFile(samplePath, 'utf8')) as unknown;
  const snapshot = parseBetResponseBody(body, {
    balance: 'balance',
    totalWin: 'slot.totalWin',
    transactionState: 'transactionState',
    baseWin: 'slot.base.win',
    bonusWin: 'slot.bonus.win',
  });

  console.log(
    JSON.stringify(
      {
        balance: snapshot.balance?.amount,
        totalWin: snapshot.win?.amount,
        transactionState: snapshot.transactionState,
      },
      null,
      2,
    ),
  );

  if (snapshot.balance?.amount !== '9721.85' || snapshot.win?.amount !== '0') {
    throw new Error('Unexpected parsed balance/win from sample');
  }

  console.log('parseBetResponseBody smoke passed');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
