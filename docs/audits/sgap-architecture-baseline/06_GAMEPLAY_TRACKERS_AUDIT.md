# 06 — Gameplay trackers audit

> Audit date: 2026-11-11. Read-only. No specs were executed.
> Status uses the audit vocabulary. “A spec asserts X” means the assertion is in source. It does not mean the latest Allure run passed.

Summary:

| Tracker | Status |
|---|---|
| Win lines / paylines / ways / clusters / tumbles | PARTIAL |
| RTP and payout aggregation | PLANNED (skipped test only). Calculator NOT FOUND |
| Free spins and bonus mode | PARTIAL |
| Scatter and retrigger | PARTIAL (payload count). Package 1 path has assertions and an offline smoke. Not re-run |
| Hold and win / respin reset | PARTIAL reader. Reset rule NOT FOUND |
| Wild and multiplier | PARTIAL |
| Buy feature cost and payout | PARTIAL |
| Balance reconciliation | IMPLEMENTED — UNVERIFIED as of this audit’s non-execution. Formula and specs exist. Latest full-suite evidence is mixed and not case-scored here |
| Autoplay | PARTIAL |
| Turbo | PARTIAL |
| Session interruption / unresolved spin | PARTIAL |
| Replay verification | NOT FOUND for slots. PARTIAL incidental meanings |
| FPS / pacing / load time | PARTIAL. Band function plus PAD specs. Load time is measured more often than failed |
| Asset / animation / audio | PARTIAL. Audio playback NOT FOUND |
| Currency precision | PARTIAL |

The user asked for VERIFIED only when implementation **and** execution evidence confirm a defined scope. This audit did not execute tests. October 2026 notes plus Allure **totals** are not case-level proof for November 2026. Where a checker has unit smokes (`src/verification/smoke-*.ts`) those smokes are source-level `assert`s. They were not run in this audit either. Status stays IMPLEMENTED — UNVERIFIED or PARTIAL unless a dated run is quoted for that exact case, and even then the scope is that run.

---

## 1. Win lines, paylines, ways, clusters, tumble wins — PARTIAL

**Payline geometry, “N of a kind”, and line counts: NOT FOUND.**

`winPattern` values (`eight-of-a-kind`, `paylines-30`, `paylines-20`, `paylines-10`, `ways-243`, `ways-3600`, `cluster-5`) live in `config/packages/package-*.json`. No TypeScript reads the key. `package-profile.ts` does not parse it.

What exists:

| Shape | Symbol | Inputs → outputs | Limitation |
|---|---|---|---|
| Ways win math | `readReelMultiplierWins` / `checkReelMultiplierWins` in `src/verification/reel-multiplier.ts` (~38–88) | Body + tumbles path. Fields `symbol`, `columns`, `ways`, `pay`, `win`, `multiplier`. Checks `pay × ways × sum(raised reels)` within 0.011, cent-rounded | Does not check a paytable. Mode is manifest `normalModeMultiplierMode: "reel"`, not a game-id branch. Package 7 comment names Oppals |
| Cluster cell multiplier | `readTumbleClusterWins` / `checkPositionMultiplierProgress` in `src/verification/position-multiplier.ts` (~35–98) | `symbols.out[].positions`, `win.multiplier`. Replays marks 0→1→double | Does not check cluster size (“5 connected”). Package 5 comment names Titanic Transport. Mode `"position"` |
| Tumble boards | `readBackendSpin` in `src/verification/reel/backend-reader.ts` (~318–404) | Area and tumble paths with prefixes | Emits boards. Does not sum tumble wins into `totalWin` |
| Payline multiplier fan-out | CSF-011 generic branch | `slot.paylines[].multipliers` via `getAllByPath` when the manifest path says so | Prices `{symbol, count}` or a number. Does not walk line geometry |

**Specs:** `tests/specs/csf/CSF-011.spec.ts` expects checker `passed` on the branch that applies. Header cites an Oppals observation dated 2026-10-27 in a comment. That comment is an author’s note, not an Allure artifact opened in this audit. `PEN-072` also references the position checker.

**Capability flag:** `tumble` in `FEATURE_CAPABILITIES` only gates whether a case is allowed to run. It is not a win checker.

**Games:** any manifest that sets `normalModeMultiplier` and a mode/path. Package 1 sets the metadata to `"false"`, so CSF-011 is N/A there when the spec requires the capability (October note agrees). Package 2 and 4 set tumble false at package level.

---

## 2. RTP and payout aggregation — PLANNED / calculator NOT FOUND

`tests/specs/pen/PEN-019.spec.ts` is `test.skip`. The comment says a sample large enough for a 93–99% band is not run on shared staging. No `rtp` symbol under `src/` was found by the tracker search. `slot.totalWin` is copied into the win snapshot when the manifest path points at it. It is not accumulated across a session into an RTP. `baseWin` / `bonusWin` manifest paths are not applied by `parseBetResponseBody`.

---

## 3. Free spins and bonus mode — PARTIAL

**Implemented:**

- `discoverFeatureSpinItems`, `getFreeSpinItems`, `isFreeSpinBundleComplete`, `freeSpinItemsRemaining` in `src/shared/spin-payload-discovery.ts` (~204–288).
- Output type `FeatureSpinItem`: `area`, `tumbles`, `spinsRemaining`, `totalWin`, `sourceIndex`, `sourcePath`.
- `readBackendSpin` labels groups `Free Spin i/n`.
- `featureEnteredFromBody` in `tests/support/buy-feature-verify.ts` treats `slot.bonus` as feature entry.
- FS-001 through FS-009 spec files exist.

**Not implemented:** a bonus state machine. `bonusStart` / `bonusEnd` are constants only. `src/events` does not emit them.

**Bundle rule:** more than one item with an area marks the bundle complete and forces remaining to 0. That can hide a mid-bundle remaining count. Limitation, not a second parser.

**Evidence:** specs exist. A full FS pass on every package was not established from Allure summaries in this audit. FS-008 is the retrigger case (next section).

---

## 4. Scatter detection and retrigger — PARTIAL

`evaluateFreeSpinRetrigger` (`src/verification/free-spin-retrigger.ts`, function at line 154) returns `FreeSpinRetriggerVerdict` (`kind`, `verified`, `hits`, `observations`, `reason`).

Rules type `FreeSpinRetriggerRules` (`src/capabilities/package-profile.ts`): `scatterEntryAt`, `scatterRetriggerAt`, `awardKind` `add`|`reset`, `awardSpins`, `purchasedOpenerInBonus`, `awardLagItems`.

`countScatterInArea` counts ids in `area`. Default scatter id is 0. Thresholds come from the package. Opening scatters are not a retrigger (`itemIsInBonus`). Award must match `add` (consume-then-add or add) or `reset` (remaining equals `awardSpins`).

**Offline:** `src/verification/smoke-free-spin-retrigger.ts` asserts bundled clones are not double-counted. Not executed in this audit.

**Live spec:** `tests/specs/fs/FS-008.spec.ts` calls the evaluator and expects a pass, with spend caps (`SGAP_FS008_MAX_BUYS`, `SGAP_FS008_MAX_SPEND`). The spec can skip with a computed reason. Architecture README says Package 1’s `freeSpinRetrigger: true` is backed by FS-008. That is a design claim tied to Package 1 rules. It is not a statement that FS-008 is green on packages 3, 5, 6, or 9.

**Limitations:** no visual scatter check. Catalog `kind: scatter` is a name, not this counter. Packages with the capability true and **no** `freeSpinRetriggerRules` get `insufficient_evidence` rather than a guessed +5. Package 2 is `false` (N/A when required).

`NEXT_STEPS.md` item 5 says FS-001 still hardcodes `SCATTER_TRIGGER_AT` and FS-008 still says “≥4 scatters” in the spec. If those literals remain, package rules and spec literals can disagree. This audit did not re-open FS-001 to quote the constant. Treat the NEXT_STEPS line as a documented debt from October 2026 until the spec is re-read. Marked as a doc claim in F-021.

---

## 5. Hold and win / respin resets — PARTIAL

Reader only, `tests/support/scenario-watch.ts`:

- `inspectHoldNode` / `readHold`.
- Paths include `slot.holdAndWin`, `slot.holdWin`, `slot.respin`, `slot.respins`, nested `slot.bonus.*`, `slot.moneyRespin`, `data.slot.*`, and `metadata.holdAndWinPath`.
- Output flags: `inHoldAndWin`, `holdRespinsLeft`, `lockedCount`.
- A number from 1 to 8 on the node is treated as respins left.

**Not found:** a check that a new locked symbol resets the count to 3. Package 9 notes describe 6 apples / 3 respins. That text is not executed.

`CAPTURE-001` through `CAPTURE-004` hunt a `hold-win-maxwin` clip. They do not assert the reset rule. A capture run `allure-history/run-20261106-143720-capture` (label CAPTURE · 2026-11-06) is 3 passed, 0 failed, 2578 skipped, 2581 total. The skip count shows a hunt that did not treat most iterations as failures. It is not evidence the reset rule holds.

---

## 6. Wild and multiplier tracking — PARTIAL

Multiplier math is section 1 (CSF-011).

Additional:

- `readWildBoard` in `tests/support/wild-board.ts` counts catalog symbols whose `kind` is `wild` or `multiplier` on `readBackendSpin` boards. `exploded` means a bomb board followed by a tumble in the same payload.
- `WD-001`, `WD-002`, `WD-003` are `test.describe.skip`. The explode assertion is **not in the run set**. Status of wild explode: IMPLEMENTED — UNVERIFIED, and currently excluded from execution.
- Reel-wild increment fields (`type`, `increment`, `targets` described in package 7 notes) are not read. The ways checker sums `multipliers[]`.
- Tumble multiplier ladders in CSF-011 compare `metadata.normalModeTumbleMultipliers` via `getAllByPath`.

`qa-suites.json` labels WD “Wilds (packages 7 and 11)”. Package 11 has no package profile and no slot controllers. The label and the skip disagree with “WD runs on package 7”.

---

## 7. Buy feature costs and payouts — PARTIAL

| Function | File | Behavior |
|---|---|---|
| `resolveGrossBuyCost` | `src/verification/buy-feature-spend.ts` | `totalBet` if larger than stake, else `stake * multiplier`. `buyFeat` 0/1 is not a price |
| `expectedBuyCost` | `tests/support/buy-feature-verify.ts` | `stake * metadata.buyFeatureMultiplier`, default **100**. Comment names Sugar |
| `resolveBuyPurchaseCost` | same | `before − after + win`. Comment says not to infer gross spend from a wallet that already includes feature wins |
| `decideNextBuyBudget` | `buy-feature-spend.ts` | FS-008 cap |
| `buyFeatureForBet` | `tests/support/canvas-bet-flow.ts` | Snapshot plus `requestStake`, `requestTotalBet`, `requestBuyFeat` |

**Specs:** BF-004 uses `expectedBuyCost` to set the launcher balance to half the cost and expects no purchase. BF-006 and BF-010 call `verifyBalanceDelta`. No checker compares the feature’s paid win to a buy-bonus paytable.

**Default 100** is a Package 1-shaped fallback. A title whose multiplier is not 100 and whose manifest omits `buyFeatureMultiplier` will compute the wrong expected cost. That is a silent config hole, not NOT CONFIGURED.

`NEXT_STEPS.md` item 3: BF-004 Felice, balance 100 equals the buy cost at bet 1.00. Documented product/setup issue as of that file. Not re-tested.

---

## 8. Balance reconciliation — IMPLEMENTED — UNVERIFIED (this audit)

Formula and call sites are in `03`. Specs: CSF-005, CSF-007, CSF-008, BF-006, BF-010, AT-009. Offline smoke: `src/verification/smoke-bet-verification.ts`.

**Why not VERIFIED:** this audit did not run them, and November regression totals include large failure counts without a per-id breakdown in the summary widget. October gates were 40 tests, not these ids isolated in the summary JSON.

**Limitations of the formula:** tolerance 0.01; stake must be explicit or the delta is skipped in favor of a weaker “implied pre-spin balance is positive” check; currency code unused; JavaScript number rounding.

Monitor `server-balance-changed` is observational. It does not fail the test by itself.

---

## 9. Autoplay — PARTIAL

`AutoplayController` clicks manifest actions. `verifyAutoplayProducedBets` passes if at least one HTTP-ok `/bet` arrives. `armBetResponses` waits for N responses. AP-001, AP-005, and TM-003 collect responses. The helper comment says this is not a turbo-on proof. The selected spin count in `metadata.autoplaySelectedSpins` is not what the verifier checks.

AP-007 has no spec (catalog gap).

---

## 10. Turbo — PARTIAL

`TurboController` toggles a canvas control and a local boolean. Controller comment: Package 1 `/bet` has no turbo field, and `isEnhancedBet` is Amplify, not turbo.

TM-001: after the lightning tap, `verifyBetSpinOutcome(..., { requireCompleted: true })` must pass. That proves the spin still completes. It does not prove reel speed. TM-002 is skipped for that reason. TM-003 checks autoplay still sends `/bet` after the lightning tap. TM-004 is a hunt skip around win dialogue.

PAD-005 is the FPS-during-turbo spec. Its pass/fail is a performance band, not a turbo flag in the payload.

`SGAP_DEFAULT_TURBO` (read in `tests/support/canvas-bet-control.ts`) arms turbo unless set to `0`. A spin result can therefore be a turbo spin without the spec having asked. That confounds “normal speed” cases if the default stays on. Confirm the current default before comparing FPS baselines. The reader found the env default as “armed unless `0`”.

---

## 11. Session interruption and unresolved spins — PARTIAL

`RoundTracker` (`src/network/round-tracker.ts`, class at line 45): see `02` and `03`.

**Asserted resume:** `tests/specs/pen/PEN-072.spec.ts` includes checks named in source as TT-PT-010 and TT-PT-015 (reload, open round id, wallet) via `expectPenChecks`. That is a pentest file, not the regression suite. Scope is whatever game the PEN lane launched. `NEXT_STEPS.md` says slot pentests in that period targeted Titanic Transport after the Package 5 slice, and that the rest of PEN stays on the scratch hub. Do not generalize PEN-072 to every package.

**Not asserted:** `offline`, `reconnect`, `sessionTimeout` events. PAD-055 buys a feature, reloads, drains free spins, and asserts FPS, not that the same `unresolvedSpin` id resumed.

`AT-004` / `AT-005` (multiple sessions) are staging-gated. `NEXT_STEPS.md` item 3 says the build disconnects the first session (“opened in another window”) before any `/bet`, so the server refusal those cases expect does not happen. Documented as of that file. Not re-tested.

---

## 12. Replay verification — NOT FOUND for slot outcomes

See `03`. No history endpoint client. `IHistoryDataSource` has no class. UIDS-012’s title is “history matches backend”. The spec file exists (`tests/specs/uids/UIDS-012.spec.ts`). This audit did not read the assertion body far enough to say whether it compares a history API or a HUD string. Status of UIDS-012’s data source: UNKNOWN (F-033). The absence of a history client under `src/network` means any check is inline in the spec or support file.

---

## 13. FPS, frame pacing, loading time — PARTIAL

- `fpsBand` / `frameIntervals` in `src/perf/frame-metrics.ts`. Bands: at least 60 pass, 40–59 passable, 30–39 investigate, 24–29 optimize, below 24 priority. Long frame 33.3 ms, hitch 100 ms. Tolerance +0.5 so 59.x counts as 60. The band table is also written in `docs/catalogs/FPS_TestCase.md` as agreed with QA on 2026-10-28. Doc and code should be re-checked if either changes. This audit confirmed the code bands via the tracker pass, not by re-deriving them from the markdown.
- `PerfSession` (`src/perf/perf-session.ts`) uses Phaser `postrender` timestamps, long tasks, heap, and marks bet/round URLs.
- PAD-001 uses `expect.soft` on the verdict and on hitch count, plus an annotation. Soft expectations do not fail the build the way a hard `expect` does. Confirm Playwright config does not promote soft failures. Default Playwright soft failures still fail the test at the end. If that default holds, PAD-001 is a real assertion. UNKNOWN whether a custom reporter swallows soft failures (F-034).
- `tests/specs/probe/FPS-PHASE0.spec.ts` expects `renderedFps > 0`. A comment says postrender was checked against Chrome trace frames. The comment is not a stored trace in this audit.
- Load time: `reloadGame` returns `loadMs`. PAD-002 and PAD-018 annotate it. The tracker pass did not find a failing load-time budget on those lines.

Collector overhead is itself a case (PAD title “collector overhead”). Measurement changes the page. Baselines live under `SGAP_PERF_BASELINE_DIR` default `perf-baselines` (`src/perf/baseline-store.ts`).

---

## 14. Asset, animation, and audio — PARTIAL

- `AssetAudit` (`src/perf/asset-audit.ts`) groups by MIME/extension, SHA-256 duplicates, wasted bytes. Kinds include image and audio. Skips non-GET and bet/buy/unresolved URLs.
- PAD-028 lists audio clips and files over 1 MB, attaches `pad-028-audio.txt`, and the reviewed expect is `report.total > 0`. It does not assert playback, mute, or “no duplicates”.
- PAD-022 is duplicate downloads (same content, different URL).
- Spine: `frame-sampler.ts` records `available` versus `played`. PAD-025 attaches the list and says never-seen names are candidates, not confirmed unused. Expect is a non-empty network inventory, and it skips if no skeleton is readable.
- Reel symbol match compares canvas cells to backend ids (`src/verification/reel/validate.ts`, `compare-reels.ts`, `image-match.ts`). That is symbol identity, not animation timing. Package 1 templates are incomplete PNGs (0–9 only under sugar-wonderland).
- **Audio graph / “sound played”: NOT FOUND.**
- AS-001 through AS-009 (catalog “Audio & Settings”) have **no specs**.

---

## 15. Currency precision and rounding — PARTIAL

- Model comment: amounts are strings. `toAmountString` uses `String(number)`.
- Cent rounding: `roundCents` and observation `cents()`. AT-003 offline smoke asserts continuity. Not executed here.
- Balance tolerance 0.01. Ways slack 0.011.
- `PEN-005` posts a scratch `StartRound(0.123456789)` and expects reject or book at `currencyDecimalPlaces` (USD default 2) with a ledger check. **Scratch hub, not slots `/bet`.**
- CP-001 and CP-002 spec files exist (at most 2 decimal places; history and balance). Their staging results were not opened.

No slots spec was identified that sends an over-precise stake on `/bet`.
