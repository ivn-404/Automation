# Playwright Fixtures

**Responsibility:** Wire SGAP layers once per test — specs import from here.

## Usage

```ts
import { test, expect } from '../fixtures/index.js';

test('example', async ({ sgapSession, sgapDriver }) => {
  expect(await sgapDriver.isAttached()).toBe(true);
});
```

## Fixtures

| Fixture | Provides |
|---|---|
| `sgapEnvironment` | `EnvironmentConfig` from `config/environments/` |
| `sgapManifest` | `GameManifest` from `config/manifests/` |
| `sgapUi` | `UiRegistry` |
| `sgapPlatform` | `PlaywrightPlatform` (auto-dispose) |
| `sgapDriver` | `PlaywrightGameDriver` (auto-detach) |
| `sgapRegistry` | `ControllerRegistry` with manifest |
| `sgapSession` | Full bootstrap: open game + attach driver |

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `SGAP_ENV` | `staging` | Environment config file name |
| `SGAP_GAME_ID` | `sugar-wonderland` | Manifest file name |
| `SGAP_LAUNCHER_MODE` | `local` | `local` (offline HTML) or `staging` (live launcher) |
| `SGAP_PLAYER_ID` | env / generated | DiJoker launcher username (`playerId`) |
| `SGAP_PLAYER_ID_LOCK` | unset | Set `1` with `SGAP_PLAYER_ID` to pin a package-game player |

Package game projects (`game:sugar-wonderland`, …) generate launcher users as
`{Exact Game Name}_{random}` — e.g. `Mars Triumph_a3f9c2` — so multi-game runs
are attributable per title (not generic ids like `123`).

## Staging runs

```bash
SGAP_LAUNCHER_MODE=staging pnpm test:chrome
```

Requires valid launcher session (auth as your org requires). Do not commit tokens.

See `docs/FIXTURES.md`.
