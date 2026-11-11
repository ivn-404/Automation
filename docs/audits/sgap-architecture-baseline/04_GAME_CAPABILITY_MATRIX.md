# 04 — Game capability matrix

> Audit date: 2026-11-11. Read-only.
> “Configured” means JSON declares the capability. It does not mean a staging run passed.
> Execution evidence, where cited, is a historical Allure folder with a date. It is not a universal pass.

## How a game is identified

- Stable id: `gameId` in `config/manifests/<gameId>.json`. Must match `config/qa-suites.json` `packages` lists.
- Runtime selection: project metadata `sgapGameId`, else `SGAP_GAME_ID`, else `sugar-wonderland`.
- Package: `metadata.packageId` (string such as `package-2`). The suite file uses numeric keys `"1"` … `"9"`, `"11"`.
- Engine: no manifest sets `metadata.engine`. `engineIdFor` infers `phaser` when `metadata.rendering` is `canvas`, else `dom`. Every production title inspected is `rendering: "canvas"`.
- Host: production manifests use host `dijoker` and `stagingStatus: active` (spot-checked pattern; not re-validated against a live launcher).
- Iframe: `iframeSelectorKey` → `locatorKeys.gameIframe` = `iframe[title="Game session"]` on production manifests.

Schema file: `config/manifests/schema/game-manifest.schema.json`. `schemaVersion` on manifests is `1.0.0`. Package JSON has no separate schema version field observed in the samples. Surface files use `id` and `extends`.

## How support is decided

See `capabilityStatus` in `01`. Short matrix of outcomes:

| Config | Test result |
|---|---|
| Controller `enabled: true`, or metadata `"true"`, or package capability `true`, or config-backed data present | Runs. Pass/fail on the observable |
| `enabled: false`, metadata `"false"`, or package capability `false` | N/A before launch (`outcome=N/A`) when a gate asks for that capability |
| No entry and no package default | Fails `NOT CONFIGURED — …` |
| `reelValidation` / `symbolCatalog` | Supported only when the data exists. A package boolean cannot claim them |

Capabilities are **not** detected by clicking. Discovery (`DISC-001`) can learn a pasted URL into a profile. That is a separate mode (`unregistered` manifest, `metadata.discovery: "runtime"`). It does not silently flip production manifests.

`winPattern` is stored and **not** consulted by `capabilityStatus` or by any TypeScript reader found in this audit.

## Manifest inventory (34 JSON files)

Non-production (3):

| gameId | Role |
|---|---|
| `driver-smoke` | `spin` and `bet` on. Other controllers explicitly off. No package |
| `example` | Scaffold. `buyFeature` off. No `scratchCard` entry at all (unmapped, not false) |
| `unregistered` | Discovery template. Only `fullscreen: false` |

Scratch-only production (7). Only `scratchCard` enabled. No `reelValidation`. No `config/packages/package-8.json` or `package-11.json`.

| packageId | gameIds |
|---|---|
| package-8 | blockchain-blitz, mad-freaks, necronomicoin, sugar-pals, trippy-cat |
| package-11 | joker-ace, king-in-gold |

Slot manifests with **all ten controllers enabled** (23), including scratch. `reelValidation` block present only on the four Package 1 games.

| packageId | gameIds | `metadata.normalModeMultiplier` | Package profile file |
|---|---|---|---|
| package-1 | sugar-wonderland, beelze-bop, felice-in-space, mars-triumph | `"false"` | yes, retrigger rules present |
| package-2 | kobo-ass, hustle-the-blazing-horse, jungle-fruity, bad-beach | `"true"` | yes. `freeSpinRetrigger` and `tumble` **false** |
| package-3 | war-freaks, rainbow-fist, the-shuten-doji | `"true"` | yes, retrigger rules present |
| package-4 | thats-bait, genghis-bao, sk8leton | `"false"` | yes. `tumble` false. `maxWinMultiplier` 2100 |
| package-5 | pastry-cub, aztec-lost-empire, grave-threat, titanic-transport | `"true"` | yes. `maxWinMultiplier` 5000 |
| package-6 | zero-law, boobie-trap, gnome-mansland | `"true"` | yes, retrigger rules present. `maxWinMultiplier` 5000 |
| package-7 | oppals, amazonians | `"true"` | yes. `maxWinMultiplier` 20000 |

Slot with one controller off:

| gameId | package | Difference |
|---|---|---|
| fruit-attack | package-9 | `buyFeature: false`. No `normalModeMultiplier` metadata. No `reelValidation`. Package capabilities: free spins, scatter, retrigger, maxWin true; tumble and scatterMode false; no `multiplierWild`. `maxWinMultiplier` 2000. `winPattern` `paylines-30`. Zero symbols in the package file |

Kobo Ass was re-read for this audit: `spin`, `autoplay`, `buyFeature`, `bet`, `amplifyBet`, `turbo`, `menu`, `settings`, `fullscreen`, `scratchCard` are all `enabled: true`, `metadata.packageId` is `package-2`, `rendering` is `canvas`. That contradicts the October “NOT CONFIGURED” note in `docs/architecture/NEXT_STEPS.md`. Whether those enabled flags are **correct** for Kobo Ass (as opposed to copied) was not proven by a staging bet in this audit. IMPLEMENTED as configuration. UNVERIFIED as behavior.

## Package profile booleans

Absent keys are not `false`. They fall through to unmapped unless metadata says otherwise.

| File | freeSpins | scatterTrigger | freeSpinRetrigger | tumble | multiplierWild | scatterMode | maxWin | winPattern (unread) | grid hint |
|---|---|---|---|---|---|---|---|---|---|
| package-1 | true | true | true | true | true | true | true | eight-of-a-kind | 6×5, 23 symbols, retrigger rules |
| package-2 | true | true | **false** | **false** | true | absent | true | paylines-20 | 5×3, 14 symbols |
| package-3 | true | true | true | true | true | absent | true | eight-of-a-kind | 6×5, 25 symbols, rules |
| package-4 | true | true | true | **false** | true | true | true | paylines-10 | 5×3, 19 symbols |
| package-5 | true | true | true | true | true | true | true | cluster-5 | 7×7, 23 symbols |
| package-6 | true | true | true | true | true | true | true | ways-3600 | 6×5, 10 symbols, rules |
| package-7 | true | true | true | true | true | true | true | ways-243 | 5×3, 10 symbols |
| package-9 | true | true | true | **false** | absent | **false** | true | paylines-30 | 5×4, 0 symbols |

Package 1 retrigger rules (from the profile type and the architecture README): scatter entry at 4, retrigger at 3, award +5, `awardLagItems` 1, opener-in-bonus for purchased rounds. Confirm exact keys in `config/packages/package-1.json` (`freeSpinRetriggerRules`) before treating a number as universal. Packages without rules return `insufficient_evidence` from `evaluateFreeSpinRetrigger` rather than a guessed +5.

## Surfaces

Lookup (`surfaceProfileIdFor` in `src/surfaces/load-surface-profile.ts`): `<gameId>.json` if present, else `metadata.surfaceProfile`, else `<packageId>.json`, else `base`.

| File | Extends | Notes |
|---|---|---|
| `base.json` | — | Default bands and candidates: spin, bet ±, turbo, autoplay, buy, menu, menu close, amplify, blockers |
| `package-3.json` | base | Attract, autoplay start, buy, enter, spin |
| `package-5.json` | base | Buy feature points |
| `package-6.json` | base | Bet ± and buy |
| `package-7.json` | base | Amplify, bet ±, buy |
| `package-9.json` | package-6 | pressAnywhere only |
| `sugar-wonderland.json` | base | Buy feature points |
| `rainbow-fist.json` | package-3 | Blockers only |
| `the-shuten-doji.json` | package-3 | Blockers only |
| `gnome-mansland.json` | package-6 | pressAnywhere only |

No surface file for package-1 (except Sugar), package-2, package-4, package-8, or package-11. Those titles use `base.json` plus whatever ratios are in the manifest `canvasActions`.

## Symbols

- `config/symbols/sugar-wonderland/catalog.json` — 23 symbols, package-1, row order bottom-to-top, PNGs `0.png`–`9.png` plus a README. Not a full art set for ids 0–22.
- `config/symbols/beelze-bop/catalog.json` — same 23 ids, no PNGs found beside it.
- Other packages keep symbol arrays **inside** `config/packages/*.json`.
- `symbolCatalog` is supported when the package `symbols` array is non-empty or `config/symbols/<gameId>/catalog.json` exists. Package 9 has neither, so `symbolCatalog` is unmapped for Fruit Attack unless a game catalog is added.

Reel image compare (`src/verification/reel/`) needs templates. That path is real for Package 1 manifests that carry `reelValidation`. Other slot manifests do not have `reelValidation`, so CSF-006 style reel-match is NOT CONFIGURED there even though spin is enabled.

## Mechanic configuration versus code

| Mechanic | Config signal | Code that consumes it | Games where config says yes | Execution support |
|---|---|---|---|---|
| Base spin | controller `spin` | `SpinController` | All slot manifests; not scratch-only | PARTIAL. Historical Package 1 gates passed CSF-001/002 (Oct 2026, 4 games). Nov 2026 full regressions were mixed. Not re-run |
| Bet change | controller `bet` | `BetController` | Slot manifests | IMPLEMENTED. Package coverage UNVERIFIED beyond historical gates |
| Buy feature | controller `buyFeature` | `BuyFeatureController` | All slot manifests except fruit-attack (`false`) and scratch-only | PARTIAL. Cost helper exists. Paytable of the feature does not |
| Autoplay | controller `autoplay` | `AutoplayController` | Slot manifests | PARTIAL. Proves at least one `/bet`, not the selected spin count |
| Turbo | controller `turbo` | `TurboController` local toggle | Slot manifests | PARTIAL. No `/bet` turbo field on Package 1 (controller comment). TM-002 skipped as manual |
| Amplify | controller `amplifyBet` | request `isEnhancedBet` | Slot manifests | PARTIAL. Distinct from turbo. Verified only where AT/BC specs assert the flag; scope not re-run |
| Free spins | package `freeSpins` | payload discovery + FS specs | All 8 package files true | PARTIAL |
| Scatter trigger | package `scatterTrigger` | retrigger module counts area ids | All 8 package files true | PARTIAL. Count is payload, not art |
| Retrigger | package `freeSpinRetrigger` plus rules | `evaluateFreeSpinRetrigger` | false on package-2; true elsewhere; rules only on some packages | PARTIAL. Package 1 rules + FS-008 spec. Packages without rules cannot pass a guessed award |
| Tumble | package `tumble` | capability gate; reader emits boards; does not sum tumble win into a checked total | false on package-2, 4, 9 | PARTIAL |
| Ways / cluster math | `normalModeMultiplier` metadata + mode/path | `reel-multiplier.ts`, `position-multiplier.ts`, CSF-011 | Package 1 metadata **false** (CSF-011 N/A there, per Oct 2026 note). Package 2/3/5/6/7 metadata true. `winPattern` itself unused | PARTIAL. CSF-011 branches on mode, not on `winPattern` |
| Payline geometry | `winPattern` | **no reader** | labels on all 8 packages | NOT FOUND as an assertion |
| Hold and win | `metadata.holdAndWinPath` (Fruit Attack sets `slot.holdAndWin`) | `scenario-watch.ts` reader only | Package 9 notes in JSON; capture specs hunt clips | PARTIAL reader. Reset-to-3 rule NOT FOUND |
| Max win | package `maxWin` and `maxWinMultiplier` | ES specs and initialize readers | multipliers differ by package (2100, 5000, 20000, 2000, and Package 1 has the flag without a number in the summary above) | PARTIAL. Do not copy one package’s cap onto another |
| Scratch | controller `scratchCard` | `ScratchCardController` + hub | Enabled even on slot manifests; only controller on packages 8 and 11 | PARTIAL. SCG suite exists. Slot manifests enabling scratch does not prove the scratch drawer is the same product |
| Reel validation | `reelValidation` block | `validateBackendFrontendReels` | Package 1 manifests only | PARTIAL. PROBE-004 claimed green on four Package 1 games in Oct 2026 notes |
| Symbol catalog | package symbols or catalog file | reel + wild board | Packages 1–7 have symbols. Package 9 does not. PNG templates are sparse | PARTIAL |
| Unresolved round | `network.fields.unresolvedSpin` | `RoundTracker` | default field name if unset | PARTIAL. Resume asserted in PEN-072 slot checks, not as a product suite |
| RTP | none | none. PEN-019 is `test.skip` | — | PLANNED only as a skipped pentest, not as a calculator |
| Replay endpoint | none | none for slots | — | NOT FOUND |
| FPS | not a manifest capability | `src/perf` | any game the PAD lane opens | PARTIAL. Bands implemented. Historical PAD runs were not re-scored here |

## Missing configuration behavior

- Unmapped feature requested by `requireCapabilities` or by the family baseline: the test **fails** before launch with `NOT CONFIGURED —`.
- Unsupported: **skipped**, Allure label `outcome=N/A`.
- Family baseline for regression is only `spin` and `bet`. A scratch-only manifest (spin unmapped or disabled) fails or N/As the whole regression family before launch. Packages 8 and 11 should not run CSF as if they were slots. SCG requires `scratchCard`, which they enable.
- Package 2 `freeSpinRetrigger: false` and `tumble: false` make FS-008 and tumble-dependent cases N/A **if** the spec requires those capabilities. WD specs are `test.describe.skip` entirely (“workers must not run these specs”), so they do not currently produce that N/A at runtime. The October note that WD reports N/A on Package 2 described an earlier gate, not the skip that is in the files now.
- A missing payload path is supposed to stay NOT CONFIGURED rather than be guessed (`docs/architecture/README.md`). Package 2’s `/bet` area paths were deliberately absent in that October note. This audit did not diff every package-2 manifest `network.fields` against a captured bet. UNKNOWN whether those paths have since been filled. Controllers being enabled does not imply `reelValidation` exists. Package 2 manifests were reported as having **no** `reelValidation` block.

## Can a new game be onboarded without source changes?

**Designed yes, for a title that matches the DiJoker canvas contract:**

1. Add `config/manifests/<gameId>.json` (controllers, iframe, canvas actions, network fields).
2. Add the id to `config/qa-suites.json` under a package, and a `config/packages/package-N.json` if the math family is new.
3. Add a surface file only if `base.json` bands miss.
4. Add symbols if reel validation or wild kind checks are in scope.
5. Run PROBE-002 then PROBE-001 (`docs/guides/PROBE_GATE.md`). PROBE-002 writes calibration JSON under test-results. That step **is** a source-of-data change (manifest ratios), not a TypeScript change, when the probe’s assumptions hold.

**Still requires code or will mis-report when:**

- The game does not expose `window.phaserGame` and vision/manifest ratios are wrong. Fallback exists. It is journaled at low confidence. It is not a calibrated onboard.
- Routes differ from `/api/v1/slots/*` and the manifest omits `network.*UrlPattern`. Defaults still match the platform paths, which can false-trigger on the wrong host.
- Math is payline geometry, RTP, hold-and-win reset, or audio. No config key turns those checkers on, because the checkers do not exist.
- The title is not a portrait canvas iframe. `UrlPlatform` and discovery cover a pasted URL. They do not remove the Phaser locate path.
- Scratch-only packages have no package profile, so feature capabilities that are not controllers stay unmapped. That is correct for slot cases and incomplete for any scratch rule that should have been a package boolean.

## Versioning

- Manifest `schemaVersion`: `1.0.0`.
- Framework `SGAP_VERSION` / package version: `0.1.0`.
- Package profiles and surfaces: no schemaVersion field was required by the loader in the code paths reviewed.
- Learned profiles overlay a manifest in memory for a run. They are not a second schema.
- Allure runs are versioned by folder timestamp, not by a game-build id, unless a spec records `SGAP_GAME_BUILD` (PAD). That variable was seen as an env name. Whether every PAD spec stamps the build is UNKNOWN without reading all 56 files line by line. PAD-038’s title is “build vs previous”.

## Adaptive hooks already present

Useful later, not a finished adaptive system:

- Capability gate (supported / N/A / unmapped) from config.
- Surface candidate ladders and interaction journal (strategy + confidence).
- `engineFor` adapter seam (call sites not fully migrated).
- Payload path learning (`src/discovery/payload-learn.ts`) and `DISC-001`.
- PROBE-002 calibration output (live Phaser versus manifest).
- Eye catalog and learned ratios (`src/eye/learned-ratios.ts`, `src/eye/store.ts`).

See `09_ADAPTIVE_AUTOMATION_READINESS.md`.
