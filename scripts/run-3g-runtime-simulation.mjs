/**
 * 3G runtime simulation.
 * Runs one package at a time. The next package starts only after the current one exits.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PACKAGES = [
  {
    id: '2',
    games: [
      ['kobo-ass', 'Kobo Ass'],
      ['hustle-the-blazing-horse', 'Hustle The Blazing Horse'],
      ['jungle-fruity', 'Jungle Fruity'],
      ['bad-beach', 'Bad Beach'],
    ],
  },
  {
    id: '3',
    games: [
      ['war-freaks', 'War Freaks'],
      ['rainbow-fist', 'Rainbow Fist'],
      ['the-shuten-doji', 'The Shuten Doji'],
    ],
  },
  {
    id: '4',
    games: [
      ['thats-bait', "That's Bait"],
      ['genghis-bao', 'Genghis Bao'],
      ['sk8leton', 'Sk8leton'],
    ],
  },
  {
    id: '5',
    games: [
      ['pastry-cub', 'Pastry Cub'],
      ['aztec-lost-empire', 'Aztec Lost Empire'],
      ['grave-threat', 'Grave Threat'],
      ['titanic-transport', 'Titanic Transport'],
    ],
  },
  {
    id: '6',
    games: [
      ['zero-law', 'Zero Law'],
      ['boobie-trap', 'Boobie Trap'],
    ],
  },
  {
    id: '7',
    games: [
      ['oppals', 'Oppals'],
      ['amazonians', 'Amazonians'],
    ],
  },
  {
    id: '8',
    games: [
      ['blockchain-blitz', 'Blockchain Blitz'],
      ['trippy-cat', 'Trippy Cat'],
      ['mad-freaks', 'Mad Freaks'],
      ['necronomicoin', 'Necronomicoin'],
    ],
  },
  {
    id: '8b',
    games: [['sugar-pals', 'Sugar Pals']],
  },
  {
    id: '11',
    games: [
      ['joker-ace', 'Joker Ace'],
      ['king-in-gold', 'King in Gold'],
    ],
  },
];

function laneConfig(pkg) {
  const lanes = pkg.games.map(([gameId, gameName], index) => {
    const id = index + 1;
    return {
      id,
      category: 'PROBE',
      categories: ['PROBE'],
      gameId,
      gameName,
      packageId: pkg.id.replace('b', ''),
      testMatch: ['probe/**/LOAD-3G-PKG1.spec.ts'],
      playerId: `${gameName}_3G${pkg.id}`,
      monitor: Math.floor(index / 2),
      slot: index % 2,
    };
  });
  return {
    workers: lanes.length,
    layout: lanes.length <= 2 ? '1 2' : '1 2 | 3 4',
    notes: `3G runtime simulation, package ${pkg.id}. DevTools 3G preset only. Next package waits for this one.`,
    defaultBalance: 15000,
    defaultBetLimit: 15000,
    minimumBetBalance: 100,
    lanes,
  };
}

function runPackage(pkg) {
  const dir = path.join('config', 'generated');
  mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, `3g-runtime-package-${pkg.id}.json`);
  writeFileSync(configPath, JSON.stringify(laneConfig(pkg), null, 2));
  console.log(`\n[3g-runtime] package ${pkg.id} — ${pkg.games.map((game) => game[1]).join(', ')}`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/run-parallel-workers.mjs'], {
      env: {
        ...process.env,
        SGAP_3G_CALIBRATION: '1',
        SGAP_3G_PARALLEL: '1',
        SGAP_3G_RUNS: '1',
        SGAP_3G_LABEL: `p${pkg.id}-`,
        SGAP_3G_TIMEOUT_MS: '3000000',
        SGAP_3G_PACKAGE: pkg.id,
        SGAP_LAUNCHER_MODE: 'staging',
        SGAP_PARALLEL_CONFIG: configPath,
      },
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

for (const pkg of PACKAGES) {
  const code = await runPackage(pkg);
  console.log(`[3g-runtime] package ${pkg.id} exited ${code}`);
}
console.log('[3g-runtime] all packages finished');
