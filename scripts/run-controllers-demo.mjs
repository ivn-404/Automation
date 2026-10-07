/**
 * Headed controller walkthrough on staging with optional click tracker.
 */
import { spawnSync } from 'node:child_process';

const env = {
  ...process.env,
  SGAP_LAUNCHER_MODE: process.env.SGAP_LAUNCHER_MODE ?? 'staging',
  SGAP_GAME_ID: process.env.SGAP_GAME_ID ?? 'sugar-wonderland',
  SGAP_CLICK_TRACKER: process.env.SGAP_CLICK_TRACKER ?? '1',
};

const result = spawnSync(
  'npx',
  [
    'playwright',
    'test',
    'tests/specs/demo/controllers-walkthrough.spec.ts',
    '--project=chromium',
    '--headed',
    '--workers=1',
  ],
  { stdio: 'inherit', shell: true, env },
);

process.exit(result.status ?? 1);
