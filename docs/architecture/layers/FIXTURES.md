# FIXTURES.md

> Playwright test fixtures
> Version: 1.0.0
> Status: Implemented

---

## Purpose

Fixtures **Build Once, Reuse Everywhere** for test wiring.
Specs import `{ test, expect }` from `tests/fixtures/` — not from `src/` directly.

---

## Fixture graph

```
sgapEnvironment  ← config/environments/{SGAP_ENV}.json
sgapManifest     ← config/manifests/{SGAP_GAME_ID}.json
       ↓
sgapUi → sgapPlatform, sgapDriver, sgapRegistry
       ↓
sgapSession      → openGame + driver.attach()
```

---

## Example spec

```ts
import { test, expect } from '../fixtures/index.js';

test('CSF-001 player can trigger a spin', async ({ sgapSession }) => {
  await sgapSession.spin.spin();
});
```

See `tests/specs/csf/CSF-001.spec.ts` and `docs/tests/CSF-001.md`.

---

## Launcher modes

| Mode | Behavior |
|---|---|
| `local` (default) | In-memory HTML launcher — CI-safe, no auth |
| `staging` | `openGameHost()` → real DiJoker launcher |

```bash
# Offline (default)
pnpm test

# Live staging
SGAP_LAUNCHER_MODE=staging pnpm test:chrome
```

---

## Configuration

| Env var | Default |
|---|---|
| `SGAP_ENV` | `staging` |
| `SGAP_GAME_ID` | `sugar-wonderland` |
| `SGAP_LAUNCHER_MODE` | `local` |

---

## Rules

1. Specs use **fixtures** — not raw `page.goto` with hard-coded URLs.
2. Controllers register into `sgapRegistry` when implemented.
3. Manual test IDs (CSF-001) live in spec names / metadata — not in fixture code.

---

## Revision history

| Version | Change |
|---|---|
| 1.0.0 | Initial SGAP Playwright fixtures + fixture-smoke spec |
