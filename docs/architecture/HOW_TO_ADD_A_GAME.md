# How to add a game

> Do this in order. Do not start by copying a spec.

---

## 1. Config

1. Copy `config/manifests/example.json` (or the closest Package 1 manifest) to `config/manifests/<gameId>.json`.
2. Set `gameId`, `displayName`, `locatorKeys`, `canvasActions`, `network`, and which `controllers` are enabled.
3. Add symbol files under `config/symbols/<gameId>/` if reel checks are in scope.
4. If this title is **not** Package 1 math, add `config/packages/<packageId>.json`. Do not overwrite Package 1's candy names.

## 2. Select it

```bash
SGAP_GAME_ID=<gameId>
SGAP_LAUNCHER_MODE=staging
```

## 3. Probe (must pass before the catalog)

Follow `docs/PROBE_GATE.md`.

| Probe | Question |
|---|---|
| PROBE-002 | Can we enter the iframe? Is the surface canvas, DOM, Phaser, or mixed? |
| PROBE-001 | Do spin, bet, turbo, and amplify show up correctly on the bet response? |

Both must pass on the **first attempt** before a full catalog run.

## 4. Run one scenario, not the whole suite

Example:

```bash
SGAP_GAME_ID=<gameId> SGAP_LAUNCHER_MODE=staging npx playwright test tests/specs/csf/CSF-001.spec.ts --project=chromium --headed --workers=1
```

## 5. If a click misses

1. Fix the ratio in **that game's manifest**.
2. If vision or Phaser bands are wrong for this layout, treat it as a leak in [GAME_SPECIFIC.md](./GAME_SPECIFIC.md). Move the band into config. Do not add `if (gameId === '…')`.

## 6. Catalog

Only after the probe and a single spin case are green, run the suite (1 worker first, then 4 workers).

Manual-only cases stay manual (Max Win, audio, visual, ZAR, multi-session, pooling, italic font) unless QA says otherwise.

---

## You are done when

- [ ] Manifest loads with `SGAP_GAME_ID`
- [ ] PROBE-002 and PROBE-001 are green
- [ ] CSF-001 (or the equivalent spin case) is green
- [ ] No new game-name branch was added under `src/controllers` or `tests/specs`
