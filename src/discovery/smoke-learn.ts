/**
 * Smoke: persist isolation, secret stripping, unverified panels stay calibration.
 * Run after build: node dist/discovery/smoke-learn.js
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  assessCapabilities,
  loadPersistedProfile,
  persistLearnedProfile,
  stripLearnedSecrets,
  type DiscoveredControl,
} from './assess.js';
import { isPressAnywhereText } from './learn-spins.js';
import { learnPayload } from './payload-learn.js';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'sgap-learn-'));
const fail = (message: string): never => {
  throw new Error(message);
};

function control(name: string, extra?: Partial<DiscoveredControl>): DiscoveredControl {
  return {
    name,
    capability: name,
    level: 2,
    method: 'scene-graph',
    confidence: 'high',
    calibration: 'unconfirmed',
    point: { x: 0.8, y: 0.9 },
    evidence: [`found ${name}`],
    ...extra,
  };
}

try {
  const secret = stripLearnedSecrets({
    gameKey: 'alpha',
    token: 'should-not-survive',
    launchUrl: 'https://example.test/?token=abc',
    profile: {
      gameId: 'unregistered',
      metadata: { launcherGameKey: 'alpha', notes: 'https://host/?token=leak' },
    },
    nested: { refresh_token: 'nope', ok: 1 },
  }) as Record<string, unknown>;
  if ('token' in secret || 'launchUrl' in secret) fail('stripLearnedSecrets kept a token/url key');
  if ((secret.nested as Record<string, unknown>).refresh_token !== undefined) fail('stripLearnedSecrets kept refresh_token');
  if (JSON.stringify(secret).includes('token=')) fail('stripLearnedSecrets kept a token query string');

  persistLearnedProfile(
    'alpha',
    {
      schemaVersion: '1',
      gameId: 'unregistered',
      displayName: 'Alpha',
      metadata: { launcherGameKey: 'alpha', token: 'injected', launchUrl: 'https://x/?token=zzz' },
      canvasActions: { canvasSelector: 'canvas', actions: { spin: { x: 0.81, y: 0.91 } } },
    },
    { payload: learnPayload([{ balance: 10, slot: { totalWin: 0, area: [[1], [2]] } }], 2), build: 'v1' },
    tmp,
  );
  persistLearnedProfile(
    'beta',
    {
      schemaVersion: '1',
      gameId: 'unregistered',
      displayName: 'Beta',
      metadata: { launcherGameKey: 'beta' },
      canvasActions: { canvasSelector: 'canvas', actions: { spin: { x: 0.2, y: 0.3 } } },
    },
    undefined,
    tmp,
  );

  const alphaFile = path.join(tmp, '.sgap', 'learned', 'alpha.json');
  const betaFile = path.join(tmp, '.sgap', 'learned', 'beta.json');
  if (!existsSync(alphaFile) || !existsSync(betaFile)) fail('expected a learned file per game key');
  const alphaRaw = readFileSync(alphaFile, 'utf8');
  if (/token|launchUrl/iu.test(alphaRaw)) fail('persisted alpha file contains a token or URL key');
  const alpha = loadPersistedProfile('alpha', tmp);
  const beta = loadPersistedProfile('beta', tmp);
  if (alpha === undefined || beta === undefined) throw new Error('loadPersistedProfile missed a stored game');
  const alphaActions = (alpha.canvasActions as { actions?: { spin?: { x?: number } } } | undefined)?.actions;
  const betaActions = (beta.canvasActions as { actions?: { spin?: { x?: number } } } | undefined)?.actions;
  const alphaSpin = alphaActions?.spin?.x;
  const betaSpin = betaActions?.spin?.x;
  if (alphaSpin === undefined || betaSpin === undefined) fail('learned spin points missing');
  if (alphaSpin === betaSpin) fail('different games shared the same learned spin point');
  if (loadPersistedProfile('gamma', tmp) !== undefined) fail('unknown game key loaded a profile');
  writeFileSync(
    path.join(tmp, '.sgap', 'learned', 'gamma.json'),
    `${JSON.stringify({ gameKey: 'alpha', profile: { metadata: { launcherGameKey: 'alpha' }, canvasActions: { actions: { spin: { x: 0.81, y: 0.91 } } } } })}\n`,
  );
  if (loadPersistedProfile('gamma', tmp) !== undefined) fail('mismatched launcherGameKey loaded another game\'s profile');

  persistLearnedProfile('alpha', { ...alpha, displayName: 'Alpha reused' }, undefined, tmp);
  const reused = JSON.parse(readFileSync(alphaFile, 'utf8')) as { payload?: { spinsLearned?: number } };
  if (reused.payload?.spinsLearned !== 2) fail('re-persist wiped the previous payload');

  const unverified = assessCapabilities({
    controls: [control('spin'), control('autoplay'), control('menu'), control('buyFeature')],
    decisions: { gameKey: 'alpha', decisions: {} },
    initializeSeen: true,
    panelChecks: [
      { target: 'autoplay', verified: false, closed: true, evidence: ['START label not matched'] },
      { target: 'menu', verified: false, closed: true, evidence: ['CLOSE not matched'] },
      { target: 'buyFeature', verified: false, closed: true, evidence: ['CONFIRM not matched'] },
    ],
  });
  for (const name of ['autoplay', 'menu', 'buyFeature'] as const) {
    const row = unverified.find((entry) => entry.capability === name);
    if (row?.status !== 'calibration') fail(`${name} with an unverified panel check became ${row?.status}`);
  }
  const spin = unverified.find((entry) => entry.capability === 'spin');
  if (spin?.status !== 'ready') fail(`spin should be ready after initialize, got ${spin?.status}`);
  const reel = unverified.find((entry) => entry.capability === 'reelValidation');
  if (reel?.status !== 'calibration') fail('reelValidation must stay calibration even with payload paths');

  const verified = assessCapabilities({
    controls: [control('spin'), control('autoplay')],
    decisions: { gameKey: 'alpha', decisions: {} },
    initializeSeen: true,
    panelChecks: [{ target: 'autoplay', verified: true, closed: true, evidence: ['spin count', 'start', 'closed'] }],
  });
  if (verified.find((entry) => entry.capability === 'autoplay')?.status !== 'ready') {
    fail('verified autoplay panel should be ready');
  }

  if (!isPressAnywhereText('TAP ANYWHERE TO CONTINUE')) fail('overlay detector missed TAP ANYWHERE');
  if (!isPressAnywhereText('PRESS ANYWHERE')) fail('overlay detector missed PRESS ANYWHERE');
  if (isPressAnywhereText('START')) fail('overlay detector treated START as press-anywhere');
  if (isPressAnywhereText('CONFIRM')) fail('overlay detector treated CONFIRM as press-anywhere');

  if (existsSync(path.join(tmp, 'config', 'manifests'))) fail('learning wrote into config/manifests');

  console.log(
    JSON.stringify(
      {
        ok: true,
        games: ['alpha', 'beta'],
        alphaSpin,
        betaSpin,
        autoplayUnverified: unverified.find((entry) => entry.capability === 'autoplay')?.status,
        autoplayVerified: verified.find((entry) => entry.capability === 'autoplay')?.status,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
