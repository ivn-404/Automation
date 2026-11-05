/**
 * Confirm / Absent merge keeps the learned profile, never stores a token, and isolates game keys.
 * Run: node scripts/verify-learned-store.mjs
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { stripLearnedSecrets } from './lib/learned-secrets.mjs';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'sgap-learned-'));
const learnedDir = path.join(tmp, '.sgap', 'learned');
mkdirSync(learnedDir, { recursive: true });
const fail = (message) => {
  throw new Error(message);
};

try {
  const alphaPath = path.join(learnedDir, 'alpha.json');
  const betaPath = path.join(learnedDir, 'beta.json');
  writeFileSync(
    alphaPath,
    `${JSON.stringify({
      gameKey: 'alpha',
      profile: { gameId: 'unregistered', canvasActions: { actions: { spin: { x: 0.81, y: 0.91 } } }, metadata: { launcherGameKey: 'alpha' } },
      payload: { spinsLearned: 2, fields: { balance: 'balance' }, features: {}, evidence: [] },
      token: 'must-not-survive',
      launchUrl: 'https://host/game?token=abc',
    }, null, 2)}\n`,
  );
  writeFileSync(
    betaPath,
    `${JSON.stringify({
      gameKey: 'beta',
      profile: { gameId: 'unregistered', canvasActions: { actions: { spin: { x: 0.2, y: 0.3 } } }, metadata: { launcherGameKey: 'beta' } },
    }, null, 2)}\n`,
  );

  const existing = JSON.parse(readFileSync(alphaPath, 'utf8'));
  const decisions = { autoplay: { decision: 'confirmed', by: 'qa', at: new Date().toISOString() } };
  const merged = stripLearnedSecrets({ ...existing, gameKey: 'alpha', decisions });
  writeFileSync(alphaPath, `${JSON.stringify(merged, null, 2)}\n`);

  const after = JSON.parse(readFileSync(alphaPath, 'utf8'));
  if (after.token || after.launchUrl) fail('Confirm merge stored a token or launch URL');
  if (JSON.stringify(after).includes('token=')) fail('Confirm merge stored a token query string');
  if (!after.profile?.canvasActions?.actions?.spin) fail('Confirm wiped the learned profile');
  if (after.payload?.spinsLearned !== 2) fail('Confirm wiped payload learning');
  if (after.decisions?.autoplay?.decision !== 'confirmed') fail('Confirm did not keep the decision');
  if (after.profile.canvasActions.actions.spin.x !== 0.81) fail('Confirm changed alpha spin point');

  const beta = JSON.parse(readFileSync(betaPath, 'utf8'));
  if (beta.profile.canvasActions.actions.spin.x === after.profile.canvasActions.actions.spin.x) {
    fail('beta loaded alpha spin points');
  }
  if (beta.gameKey !== 'beta') fail('beta file gameKey drifted');

  const absent = stripLearnedSecrets({
    ...after,
    decisions: { ...after.decisions, buyFeature: { decision: 'absent', by: 'qa', at: new Date().toISOString() } },
  });
  if (!absent.profile?.canvasActions?.actions?.spin) fail('Absent wiped the learned profile');

  console.log(JSON.stringify({ ok: true, confirmKeptProfile: true, noToken: true, isolated: true }, null, 2));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
