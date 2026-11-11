# 05 — Test coverage and traceability

> Audit date: 2026-11-11. Read-only.
> Spec existence is not effectiveness. A file with `expect` is not a green run.
> Catalogs under `docs/catalogs/` are what automation parses. They are QA-owned lists inside the repo. Google Sheets is still named as the manual source in older notes and is not loaded by the runner.

## Inventory method

Unique `tests/specs/**/*.spec.ts` count on 2026-11-11: **247**. Zero `test.fixme`. **61** files contain `test.skip` (includes conditional skips, not only permanent ones). The literal string `NOT CONFIGURED` appears inside `tests/specs/at/AT-001.spec.ts` (missing `multiplierValues`). The gate itself throws from `tests/fixtures/sgap.fixture.ts` and `tests/support/capabilities.ts`.

| Directory | Spec files | Family |
|---|---|---|
| `tests/specs` root | 1 (`fixture-smoke.spec.ts`) | harness |
| `ap` | 9 | Autoplay. No AP-007 |
| `at` | 10 | Additional. AT-001 through AT-010 |
| `bc` | 7 | Bet control |
| `bf` | 11 | Buy feature. Includes BF-011 and BF-012, which are not in the regression catalog. No BF-009 |
| `capture` | 4 | Rare-event hunts |
| `cp` | 2 | Currency precision |
| `csf` | 10 | Core spin. No CSF-009, CSF-010 |
| `demo` | 1 | Controller walkthrough |
| `discovery` | 1 | DISC-001 pasted URL |
| `es` | 12 | Edge. No ES-002, ES-014 |
| `fs` | 9 | Free spins |
| `mn` | 1 | Menu. Not a heading in `RegressionTestCases.md` |
| `pad` | 56 | PAD-001 through PAD-056, no gaps |
| `pad-load` | 1 | BUSY-056 helper for PAD-056 |
| `pen` | 59 | PEN cases plus `STR-blocked.spec.ts` |
| `probe` | 8 | PROBE-001–006, FPS-PHASE0, LOAD-3G-PKG1 |
| `regression` | 1 | Pending-catalog skip generator |
| `scg` | 24 | Scratch |
| `setup` | 1 | Restore staging wallet |
| `sm` | 6 | State |
| `tm` | 4 | Turbo. TM-002 unconditionally skipped |
| `tmp` | 1 | PEN discovery helper |
| `uids` | 5 | UIDS-003–006 and UIDS-012 only |
| `wd` | 3 | Wilds. Describes are skipped |

There is no `tests/specs/as/` directory. AS-001 through AS-009 exist only as catalog lines. The regression family `AS` in `config/qa-suites.json` points `folder` at `as`. A generated lane that includes AS will match no specs (or only whatever glob happens to be empty). That is a coverage hole, not an N/A.

## Authoritative lists inside the repo

| File | Role | Size signal |
|---|---|---|
| `docs/catalogs/RegressionTestCases.md` | Parser input for regression. Header says QA owns it and it is the source of truth for manual and automation | 132 case lines (explore count) |
| `docs/catalogs/SmokeTestingTestCases.md` | Alternate suite. Same header. **Different titles for shared ids** | 100 case lines |
| `docs/catalogs/PentestTestCases.md` | PEN and STR. Explicitly not the regression catalog | 64 case lines. No PEN-073 line; the spec exists |
| `docs/catalogs/FPS_TestCase.md` | PAD-001–056. Bands dated in the doc as agreed with QA 2026-10-28 | performance catalog |
| `docs/catalogs/ALL_GAMES.MD` | Game list, not cases | — |
| `docs/catalogs/PENTESTING.md` | Index. States `@regression` never includes PEN | — |
| `docs/catalogs/PERSONALTESTING.md` | Attack-surface notes, not an id catalog | — |
| `docs/tests/*.md` | 20 mapping notes (CSF, BC, BF, AP, TM, MN). `CSF-001.md` version 1.4.0 still sets source of truth to Google Sheets | partial |
| `tests/support/test-catalog.ts` | `parseTestCasesMarkdown`, `AUTOMATED_REGRESSION_IDS` (105 ids) | what “automated” means to the pending spec |

Identical copies of the regression, smoke, pentest, PENTESTING, and PERSONALTESTING files also sit in `docs/` (same byte lengths as the catalogs copies, per the coverage explore). Two trees can drift. The parser prefers `docs/catalogs/` and falls back to `docs/` if the catalogs copy is missing (`test-catalog.ts` comment and load path).

**External manual source:** Google Sheets is described as the manual source in `docs/handbook/SGAP_PROJECT_HISTORY.md` and in `docs/tests/CSF-001.md`. `SheetAppendReporter` only appends execution rows when `SGAP_SHEETS_SPREADSHEET_ID` and `SGAP_SHEETS_ACCESS_TOKEN` are set, and it refuses to write the manual tab (`executionTabName` must differ from `manualTabName`). The runner does not download manual cases. If Sheets and `docs/catalogs` disagree, the repo cannot say which a human QA signed. That is a traceability gap (see `11_OPEN_QUESTIONS.md`).

## Id collisions between smoke and regression

These are the same id strings with different meanings. Automation that keys only on the id will attach the wrong expectation if the wrong catalog is loaded.

| Id | Regression catalog (as reported) | Smoke catalog (as reported) |
|---|---|---|
| CSF-010 | max-win family wording | “Normal mode multiplier” |
| CSF-011 | normal-mode multiplier in the **spec** title path; regression catalog uses CSF-010/011 for max-win cases and puts multiplier on CSF-011 and skip on CSF-012 | “Skip function via Space” |
| AT-002 | currency code from initialize | display ZAR instead of R |

The spec files follow the **regression** numbering for the multiplier and skip cases: `CSF-011` is the multiplier spec, `CSF-012` is skip-via-Space. Smoke’s CSF-010/011 titles do not match those files. Treat `docs/catalogs/RegressionTestCases.md` as the list the pending-test generator and the regression family names follow, and treat the smoke file as a second document that has not been reconciled.

This audit did not diff all 132 regression lines against spec titles. The collisions above are the ones called out by direct comparison in the coverage pass. Other mismatches may exist.

## `AUTOMATED_REGRESSION_IDS` (105)

Defined in `tests/support/test-catalog.ts`. `tests/specs/regression/regression-pending.spec.ts` emits one `test.skip` per catalog id **not** in this set, with the message that it is not yet automated.

Included but easy to miss: `MN-001` (spec exists, catalog heading does not), `SCG-001`–`SCG-023`.

Excluded even though a spec file exists:

| Id | Why this matters |
|---|---|
| CSF-006 | Reel match spec exists. Not in the automated set, so the pending generator still lists it |
| TM-002 | Spec exists and is unconditionally skipped (“Manual — reel speed has no /bet field”) |
| WD-001, WD-002, WD-003 | Specs exist and the describes are skipped |
| SCG-024 | Spec exists (“Scratch card background consistent with Scatter Mode background”) |

Specs with **no** catalog line: `BF-011`, `BF-012`, `PEN-073`, `DISC-001`, probe ids, PAD ids (those live in `FPS_TestCase.md`, not the regression file), `BUSY-056`.

Catalog ids with **no** spec file (22 regression ids): `CSF-009`, `CSF-010`, `BF-009`, `AP-007`, `UIDS-001`, `UIDS-002`, `UIDS-007` through `UIDS-011`, `AS-001` through `AS-009`, `ES-002`, `ES-014`.

`PEN-040` through `PEN-049` have neither a catalog line nor a spec. `STR-001` through `STR-007` are catalogued and implemented only as an unconditional `test.skip` in `tests/specs/pen/STR-blocked.spec.ts`.

## Permanent skips versus conditional skips

Always skipped (registered, then skipped without a runtime condition):

- `AT-001` — catalog marks it manual.
- `TM-002` — manual, no `/bet` speed field.
- `PEN-019` — RTP sample not run on shared staging.
- `STR-001`–`STR-007`.
- Every id emitted by `regression-pending.spec.ts`.
- WD describes (`WD-001`–`003`) — comment that workers must not run them.

Conditional skips (not a complete list): staging-only (`AT-003`, `AT-004`, `AT-005`, `ES-012`, `PROBE-003`, `PROBE-004`, fixture-smoke inverse), hunt skips (`CSF-005`, `CSF-008`, `SM-005`, `TM-004`), missing second buy option (`BF-011`), undeclared buy tier (`BF-012`), FS-008 computed reason, many PEN skips when no card is dealt, several PAD skips (007, 012, 025, 032, 033, 035, 049, 052, 053, 056). `DISC-001` and wallet restore skip unless their mode is active.

## What the suites claim to cover

Regression family folders that have specs exercise, in title form:

- **CSF:** one verifiable spin, two consecutive spins, immediate deduction, reels stop, balance after win, canvas versus backend reels (CSF-006), total win, zero totalWin, normal-mode multiplier (CSF-011), skip via Space (CSF-012).
- **BC:** increase, decrease, floor, ceiling, lock during spin, backend match, currency formatting.
- **BF:** open and cancel, confirm, disabled during spin, insufficient balance, disabled when amplify is on, amount deducted, correct feature, idle during win dialogue, no balance mismatch, plus uncatalogued second option and tier.
- **AP:** start, selected count, manual stop, insufficient balance, lightning tap still sends `/bet`, scatter continues, scatter credits, disables amplify/bet/buy, returns after free spins.
- **FS:** scatter trigger, count displayed, no deduction, wins accumulate, multiplier, exit, reset, retrigger (FS-008), refreshed session winnings.
- **TM:** lightning tap does not break the spin or the win dialogue; autoplay still sends `/bet`. Speed increase is the skipped manual case.
- **SM / ES / UIDS / CP / MN:** state locks, edge recovery, a subset of HUD sync, two currency cases, menu open/close.
- **SCG-001–024:** scratch button through total win, plus background similarity.
- **PAD-001–056:** FPS bands, CPU/heap, assets, spine, cache, long session, resume. Assertions are often soft (`expect.soft`) or “inventory non-empty”, not a product budget. See `06`.
- **PEN:** scratch hub economy and protocol (001–064, with gaps 040–049), slot checks 070–073. Not part of `@regression`.

## Traceability mechanism

```text
docs/catalogs/RegressionTestCases.md
        │ parseTestCasesMarkdown
        ▼
tests/support/test-catalog.ts
        │ AUTOMATED_REGRESSION_IDS
        ▼
regression-pending.spec.ts  →  skip rows for the rest
        │
        ▼
specs named <ID>.spec.ts  →  Allure title starts with the manual id
        │
        ▼
optional SheetAppendReporter row (manualTestId, status, times, project, error)
```

There is no generated matrix file checked in as the authority. `src/traceability` is a constant. `docs/tests/` covers 20 ids, not the catalog.

`InMemoryExecutionTracker` keys records by `manualTestId`. If two games run the same id, the in-memory tracker’s key choice matters. This audit did not read `in-memory-execution-tracker.ts` far enough to prove it composites `gameId` into the key. Allure does add `gameId` as a parameter so Allure history ids differ per game (`tests/support/sgap-allure.ts`). Assume the Allure history id is per game and the execution-tracker key is per manual id unless a later reader confirms a composite key. Marked UNKNOWN in the evidence index (F-032).

## Game and package coverage (configuration, not passes)

| Package | Slot specs can start? | Known config N/A | Scratch |
|---|---|---|---|
| 1 | Yes, controllers on, reel validation present | `normalModeMultiplier` false → CSF-011 N/A if the spec requires it | scratch controller also enabled |
| 2 | Controllers on. No `reelValidation` → reel cases NOT CONFIGURED | retrigger and tumble false | scratch controller enabled |
| 3–7 | Controllers on. Reel block absent | per package booleans in `04` | scratch controller enabled |
| 8, 11 | Spin not enabled → regression baseline N/A or NOT CONFIGURED | slot features unmapped (no package file) | SCG can run |
| 9 | Controllers on except buy | buy N/A if gated; tumble and scatterMode false; no symbol catalog | scratch enabled |
| (none) | driver-smoke, example, unregistered | not in `qa-suites.json` packages | — |

Historical execution that is safe to quote:

| When | Folder | Label | Totals | What it is evidence of |
|---|---|---|---|---|
| 2026-10-06 | `allure-history/run-20261006-110811` | (no sgap-run label) | 35 passed, 1 failed, 4 skipped, 40 total | A small gate. `NEXT_STEPS.md` attributes the failure to AT-003 Sugar and says three feature rounds completed. Not a full catalog |
| 2026-10-06 | `run-20261006-120222` | — | same 35/1/4/40 | Same class of gate. Doc attributes buy-panel improvements |
| 2026-10-07 | `run-20261007-112403` | — | 34 passed, 0 failed, 0 skipped, 34 total | Doc attributes MN-001 / ES-013 on four Package 1 games. Totals match a small set, not 34 games |
| 2026-11-06 | `run-20261106-182629-regression` | Regression Test · 2026-11-06 | 207 passed, 109 failed, 36 skipped, 352 total | A large regression. Games not identified from the summary JSON alone |
| 2026-11-07 | `run-20261107-165618` | All Regression (packages 1-9, 11) | 0 passed, 430 failed, 10 skipped, 440 total | Label says all packages. A 0-pass run of this size is consistent with an environment or harness failure. Cause not investigated in this audit. Do not read 430 as 430 distinct assertion bugs |
| 2026-11-09 to 2026-11-10 | `run-20261109-*` and `run-20261110-*-regr` | REGR · date | mostly totals of 1 to 12 | Slice runs of the “regression-remaining” style preset or single cases. The newest folder `run-20261110-202542-regr` is 0 passed, 1 failed, total 1 |

No Allure summary in this audit was opened far enough to list per-test names for the 352-case run. Per-game pass rates are therefore **UNKNOWN** for November. October notes in `NEXT_STEPS.md` name Package 1 titles for specific small gates. Those notes are historical and partly stale about packages 2–11 (see `01`).

## Effectiveness versus existence

A spec can pass by checking a weak observable:

- Autoplay helpers pass on **one** ok `/bet`, not on the configured spin count (`verifyAutoplayProducedBets`).
- Turbo passes when a spin still returns `/bet` after the lightning tap (TM-001). Speed is not measured there. FPS during turbo is a different spec (PAD-005).
- Several PAD specs `expect` a non-empty inventory or use `expect.soft` on the FPS verdict.
- WD specs do not run.
- CSF-006 is implemented and excluded from the automated-id set, so dashboards that trust `AUTOMATED_REGRESSION_IDS` under-count it, and the pending generator over-counts it as manual.

Effectiveness for balance delta, retrigger scoring, and ways/cluster math is “the spec asserts the checker’s `passed` flag”. Whether that flag was true on a given staging day is an Allure question this audit did not re-score case by case.
