# Game-specific configuration

> Everything that changes from title to title belongs here — as **data**.
> Code in this list is the current home of that data. Some of it is still
> written as TypeScript. That is a leak. Do not add more leaks.

---

## Per game (edit these, do not fork the framework)

| What | File |
|---|---|
| Game id, buttons, iframe, network fields, capabilities | `config/manifests/<gameId>.json` |
| Symbol pictures and names | `config/symbols/<gameId>/` |
| Package math shared by a family (grid hint, id list) | `config/packages/package-1.json` |
| Which games run in parallel | `config/parallel-workers-4.json` (or a copy) |
| Environment URL | `config/environments/` and `SGAP_LAUNCHER_MODE` |

Select the game:

```bash
SGAP_GAME_ID=beelze-bop
```

Default today if unset: `sugar-wonderland` (`tests/fixtures/local-launcher-html.ts`).

---

## Manifest is the adapter

One JSON file answers:

| Question | Manifest field |
|---|---|
| How do I find the iframe? | `locatorKeys` via `iframeSelectorKey` |
| Where is Spin / Buy / Bet? | `canvasActions.actions` |
| Which features exist? | `controllers[]` (`enabled: true` = supported, `false` = N/A, missing = not configured) |
| Game-level features (not controllers) | `metadata.normalModeMultiplier: "true" \| "false"` |
| Which QA package? | `metadata.packageId` (from `config/qa-suites.json`) |
| What URL is a spin? | `network.betUrlPattern` |
| Which JSON fields are balance and win? | `network.fields` |
| Where are the reels? | `reelValidation` |

Controllers read this file. They should not grow a second copy of these numbers.

Visual hints for healing (colour bands, Phaser boxes, candidate ladders, blocker signatures, portrait aspect) live in `config/surfaces/`. Lookup order: `<gameId>.json` → `metadata.surfaceProfile` → `<packageId>.json` → `base.json`.

---

## Known leaks (shared code that still knows Sugar / Package 1)

Do not copy these patterns. When you touch the file, move the number into the manifest if you can do it safely.

| Leak | File | Why it blocks the next game |
|---|---|---|
| Looks for `window.phaserGame` | `src/runtime/phaser-locate.ts` | Game without that object cannot heal this way (falls back to vision / manifest, journaled) |
| Fallback URL `/api/v1/slots/bet` | `src/network/bet-url.ts` (single place), `tests/support/failure-report.ts` | Another API path needs `network.betUrlPattern` |
| Menu close guesses around `{0.86, 0.08}` | `src/controllers/menu-controller.ts` | Should be manifest points only |
| Eye screenshots named sugar | `assets/eye/scenarios/` | Vision golden is one title |
| Package 1 symbol names used as the family catalog | `config/packages/package-1.json` | A new package needs its own file, not edits that rename Sugar's candies |

Recalibrate HUD ratios with PROBE-002: it writes `test-results/probe/PROBE-002/<gameId>/calibration.json` (live Phaser position vs manifest, with drift) for spin, turbo, amplify, bet±, autoplay and menu. Package 1 manifests were recalibrated from it in October 2026.

Moved to config (no longer leaks): Sugar buy-confirm branch, vision bands (`CONTROL_SIGNATURES`), Phaser HUD boxes (`ACTION_BANDS`), portrait aspect → `config/surfaces/`; duplicate bet URLs → `src/network/bet-url.ts`.

Probe scripts `src/driver/probe-sugar-buy-*.ts` are Sugar tools. They are not the framework.

---

## What is allowed to be game-specific

| Allowed | Not allowed |
|---|---|
| A new `config/manifests/<gameId>.json` | `if (gameId === '…')` in a controller or spec |
| New PNGs under `config/symbols/<gameId>/` | Copy-paste of `canvas-healing.ts` per game |
| A package JSON if the math family is new | Hard-coded confirm coordinates in support code |
| Notes in the manifest `notes` field | A second Spin controller |

---

## Same family vs new family

| Situation | What you do |
|---|---|
| Another Package 1 title (similar HUD, same `/bet`) | New manifest + symbols. Then run the probe. Expect heal bands to be checked, not rewritten from scratch. |
| New layout or new API | Manifest first. Then move the matching leak in the table above into config. Do not fork specs. |
