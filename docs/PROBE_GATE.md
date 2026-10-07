# Per-game probe gate (universal)

Run this **before** the catalog on every new Package 1 title.

## Universal path (thin GameRuntime)

Framework entry: `createGameRuntime({ page, driver, manifest, visionLocate? })`.

- `inspect()` — iframe surface inventory (PROBE-002)
- `locate(action)` — Phaser → vision hook → manifest
- `click(action)` — one canvas click at the resolved ratio

Miss recovery (`click-recovery`) uses `GameRuntime.locate`. Controllers still call
`driver.clickCanvas` unchanged.

## Steps

```bash
SGAP_GAME_ID=<game-id> node scripts/run-game-probe-gate.mjs
```

Order:

| Probe | What it answers |
|---|---|
| **PROBE-002** | Can we enter the iframe? Surface = `canvas-only` / `dom-rich` / `phaser-named` / `mixed`? |
| **PROBE-001** | Do spin, bet+, turbo, amplify map correctly on `/bet`? |

Both must be **first-attempt green** (`--retries=0`) before a 1-worker catalog.

## Surface routing

| Surface | Controller strategy |
|---|---|
| `canvas-only` | Canvas coords + vision heal + `/bet` (current Package 1 path) |
| `phaser-named` | Prefer Phaser HUD geometry (even if unnamed); vision as fallback; `/bet` oracle |
| `dom-rich` | Prefer DOM selectors; keep `/bet` as pass oracle |
| `mixed` | DOM where present; canvas for painted HUD |

## Reports

`test-results/probe/PROBE-002/<gameId>/iframe-inventory.md`
