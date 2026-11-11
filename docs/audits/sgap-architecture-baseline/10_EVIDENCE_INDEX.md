# 10 — Evidence index

> Audit date: 2026-11-11. Read-only inspection. Line numbers are the lines observed on that date and can drift.
> Confidence: high = symbol and file re-read or searched in this audit; medium = reported by a full-tree read that was spot-checked; low = doc claim not re-opened in source.

| ID | Claim | Path | Symbol | Lines | Support | Confidence | Limitation |
|---|---|---|---|---|---|---|---|
| F-001 | Package is Playwright + TypeScript, version 0.1.0, Node ≥20, pnpm 9.15 | `package.json` | scripts, devDependencies | 1–75 | File read | high | — |
| F-002 | Working architecture map requires manifest + symbols + probe, and pass/fail is `/bet` | `docs/architecture/README.md` | “The one rule”, “What green means” | 12–22, 161–165 | File read | high | README “Current game” table still centers Sugar and says packages 2–11 are scratch-only. That sentence is stale (F-010) |
| F-003 | Folder map lists events, state, readiness, traceability as real layers | `docs/architecture/layers/REPOSITORY_STRUCTURE.md` | folder table | 96–145 | File read | high | — |
| F-004 | Those four layers export a string constant only | `src/events/index.ts`, `src/state/index.ts`, `src/readiness/index.ts`, `src/traceability/index.ts` | `EVENTS_LAYER`, `STATE_LAYER`, `READINESS_LAYER`, `TRACEABILITY_LAYER` | each file is a few lines | Tree search | high | Constants are re-exported from `src/index.ts` |
| F-005 | Extra implemented modules are absent from the folder map | `src/eye`, `src/runtime`, `src/engine`, `src/capabilities`, `src/observability`, `src/discovery`, `src/perf`, `src/surfaces` | directories | — | `find src -maxdepth 1` | high | Architecture README does describe eye, runtime, engine, capabilities, observability |
| F-006 | No `gameId === '<title>'` branch in controllers | `src/controllers` | search `gameId ===` | — | Ripgrep under `src` | high | Lookups exist in `package-profile.ts` ~174 and `package-catalog.ts` ~116 |
| F-007 | Capability resolution order | `src/capabilities/game-capabilities.ts` | `FEATURE_CAPABILITIES`, `capabilityStatus` | 27–47, 66–82 | File read | high | — |
| F-008 | Manifest loader is the only reader of manifest files for the session | `src/platform/manifest/file-game-manifest-loader.ts` | `FileGameManifestLoader` | — | Import search | medium | Calibrate CLIs and the recorder construct the loader too |
| F-009 | Kobo Ass enables all ten controllers | `config/manifests/kobo-ass.json` | `controllers[]` | 6–46 | File read | high | Enabled is not staged-proven |
| F-010 | NEXT_STEPS “Now” item 2 says packages 2–11 are scratch-only and Kobo slot cases are NOT CONFIGURED | `docs/architecture/NEXT_STEPS.md` | Now list | 33–36 | File read | high | Contradicts F-009. October Done table is still valid as history |
| F-011 | `winPattern` is present on package JSON and has no TypeScript reader | `config/packages/package-*.json` | `winPattern` | package-1 line 12 and siblings | Ripgrep `winPattern` hits JSON only | high | — |
| F-012 | Bet waiter accepts only HTTP-ok responses and manifest or default bet URL | `src/network/bet-response-watcher.ts` | `BetResponseWatcher` | class at 30 | File region via search | high | Exact predicate lines 50–64 cited by code read during explore; not re-quoted byte for byte in the final pass |
| F-013 | Platform default routes | `src/network/bet-url.ts` | `PLATFORM_ROUTES`, `matchesUrlPattern` | 16–39 | File read | high | — |
| F-014 | Parser copies balance, totalWin, transactionState only | `src/data/parse-bet-response.ts` | `parseBetResponseBody` | function ~8–32 | Explore read, symbol search | medium | `baseWin` / `bonusWin` not applied. Re-read of the function body was not repeated in the final pass |
| F-015 | Balance delta formula `before - stake + win`, tolerance 0.01 | `src/verification/bet-response-verification.ts` | `verifyBalanceDelta` | 83+ | Symbol search | high | Specs call it. This audit did not execute them |
| F-016 | No shared spin id on the snapshot | `src/core/models/index.ts` `BetResponseSnapshot`; `src/network/round-tracker.ts` | snapshot vs `OpenRound` | models ~268–283; class at 45 | Model and tracker reads via explore | medium | `unresolvedSpin` exists for feature rounds only and is not copied onto the snapshot |
| F-017 | Round wait 45s stall / 180s cap | `src/network/round-tracker.ts` | `waitForResolved` | defaults ~71–74 | Explore | medium | — |
| F-018 | Retrigger evaluator and rules type | `src/verification/free-spin-retrigger.ts`, `src/capabilities/package-profile.ts` | `evaluateFreeSpinRetrigger`, `FreeSpinRetriggerRules` | 154+; rules ~21–38 | Symbol search | high | Offline smoke not executed |
| F-019 | Ways and cluster checkers exist and do not read `winPattern` | `src/verification/reel-multiplier.ts`, `src/verification/position-multiplier.ts` | `checkReelMultiplierWins`, `checkPositionMultiplierProgress` | ~38–88 and ~35–98 | Explore | medium | — |
| F-020 | Hold-and-win reader does not assert reset-to-3 | `tests/support/scenario-watch.ts` | `inspectHoldNode`, `readHold` | ~184–267 | Explore | medium | Package 9 notes are JSON text |
| F-021 | FS-008 spec asserts retrigger; spend env caps | `tests/specs/fs/FS-008.spec.ts` | spec | require and expects ~95–391 region | Explore | medium | Not executed. NEXT_STEPS says a hardcoded “≥4” remains; that line was not re-opened (low confidence on the literal) |
| F-022 | WD specs are describe-skipped | `tests/specs/wd/WD-001.spec.ts` and siblings | `test.describe.skip` | ~8–24 | Explore | medium | — |
| F-023 | PEN-019 RTP test is skipped; no RTP calculator under `src/` | `tests/specs/pen/PEN-019.spec.ts` | `test.skip` | ~10–13 | Explore | medium | — |
| F-024 | Turbo controller does not read a turbo field from `/bet` | `src/controllers/turbo-controller.ts` | `TurboController` | comment ~34–39 | Explore | medium | Amplify uses `isEnhancedBet` in `parse-balance.ts` |
| F-025 | Autoplay pass condition is at least one ok `/bet` | `tests/support/autoplay-flow.ts` | `verifyAutoplayProducedBets` | ~42–56 | Explore | medium | — |
| F-026 | Buy cost default multiplier 100 | `tests/support/buy-feature-verify.ts` | `expectedBuyCost` | ~37–58 | Explore | medium | — |
| F-027 | AT-003 injection does not prove a staging refund | `src/verification/at003-evidence.ts` | classifier comment | ~4–6, ~174, ~639 | Explore | medium | — |
| F-028 | 247 spec files | `tests/specs/**/*.spec.ts` | — | — | `find` unique count | high | 61 files contain `test.skip` |
| F-029 | `AUTOMATED_REGRESSION_IDS` has 105 ids and omits CSF-006, TM-002, WD-*, SCG-024 | `tests/support/test-catalog.ts` | `AUTOMATED_REGRESSION_IDS` | 40–146 | File read and count | high | — |
| F-030 | Smoke and regression catalogs disagree on CSF-010, CSF-011, AT-002 | `docs/catalogs/SmokeTestingTestCases.md`, `docs/catalogs/RegressionTestCases.md` | case lines | — | Explore comparison | medium | Full 132-line diff was not repeated |
| F-031 | Sheets reporter appends only, and only with env configured | `src/reporting/sheet-append-reporter.ts` | `appendGoogleSheetIfConfigured` | ~104–106 | Explore | medium | Token values not read |
| F-032 | Execution tracker key versus gameId is UNKNOWN | `src/reporting/in-memory-execution-tracker.ts` | `InMemoryExecutionTracker` | — | Not fully read | low | Allure `gameId` parameter is separate (F-037) |
| F-033 | No history data-source class; UIDS-012 data source UNKNOWN | `src/core/contracts/data.ts`, `tests/specs/uids/UIDS-012.spec.ts` | `IHistoryDataSource` | contract ~29–31 | Explore | medium | Spec body not fully read |
| F-034 | PAD-001 uses soft expects on FPS verdict | `tests/specs/pad/PAD-001.spec.ts` | `expect.soft` | ~37–41 | Explore | medium | Whether a reporter swallows soft failures was not checked |
| F-035 | Allure history id is SDK-derived; `gameId` parameter is non-excluded | `tests/support/sgap-allure.ts` | `applySgapAllureMetadata` | — | Explore plus `smoke-at003-historyid.ts` mention | medium | Retry field in result JSON not opened |
| F-036 | Custom Allure category regexes were not inventoried | `scripts/generate-allure-report.mjs`, `allure-report/data/categories.json` | — | — | Not read for regex list | low | — |
| F-037 | Parallel runner starts all lanes, port 3847, Allure after, signal skips publish | `scripts/run-parallel-workers.mjs` | `runLane`, monitor listen, `publishAllureReport` | regions cited in `02` | Explore of the script | medium | Not executed |
| F-038 | JSON `workers` field is not a concurrency cap | `scripts/run-parallel-workers.mjs` | lane `Promise.all` | ~566–568 | Explore | medium | QA page may still write at most 4 lanes. Comment in `qa-suites.json` line 2 says max 4 |
| F-039 | Fixture staging timeout floors 300s/360s and wallet top-up | `tests/fixtures/sgap.fixture.ts` | `sgapSession` | ~507–639 | Explore | medium | — |
| F-040 | `minimumBetBalance` is not read by tests; no `SGAP_MAX` | repo search | — | — | Explore search | medium | — |
| F-041 | Menu close uses surface candidates | `src/controllers/menu-controller.ts` | `close` | 100–101 | Ripgrep | high | `GAME_SPECIFIC.md` line 58 still names this file as a hardcoded leak |
| F-042 | `engineIdFor` falls back to phaser for canvas | `src/engine/engine-adapter.ts` | `engineIdFor` | 38+ | Symbol search | high | No manifest sets `metadata.engine` (explore of 34 files) |
| F-043 | Default game id sugar-wonderland | `tests/fixtures/local-launcher-html.ts` | `getSgapGameId` | ~259 | Explore | medium | — |
| F-044 | Playwright retries 1 on staging; test timeout 60s in config | `playwright.config.ts` | `defineConfig` | ~202–209 | Explore | medium | Fixture overrides timeout on staging (F-039) |
| F-045 | spinAndRead maxAttempts default 2; defects not retried | `src/controllers/spin-controller.ts` | `spinAndRead` | class 49; method ~98–156 | Explore | medium | — |
| F-046 | Redaction before observation persist | `src/observability/redact.ts` | `redactUrl`, `redactBody`, `redactHeaders` | — | Module exists; called from recorder | medium | Completeness not tested |
| F-047 | FPS bands in code | `src/perf/frame-metrics.ts` | `fpsBand` | ~1–77 | Explore | medium | Doc agreement dated 2026-10-28 in `docs/catalogs/FPS_TestCase.md` was not re-diffed line by line |
| F-048 | Audio playback assertion NOT FOUND; AS specs NOT FOUND | `src/`, `tests/specs/as` | — | — | No `as` directory; PAD-028 expect is count | medium | — |
| F-049 | October gate totals | `allure-history/run-20261006-110811/widgets/summary.json` and `run-20261006-120222`, `run-20261007-112403` | `statistic` | — | Node read of summary JSON | high | Does not name which tests passed. Narrative is `NEXT_STEPS.md` |
| F-050 | November large-run totals | `allure-history/run-20261106-182629-regression`, `run-20261107-165618` | summary `statistic`, `sgap-run.json` label | — | Node read | high | 430 failures not root-caused. Game list not in the summary file |
| F-051 | 326 Allure run folders | `allure-history/run-*` | — | — | Node directory count | high | Includes 1-test slices |
| F-052 | Newest inspected run is a single failure | `allure-history/run-20261110-202542-regr` | summary | — | File read of `widgets/summary.json` and `sgap-run.json` | high | Label `REGR · 2026-11-10`. Not a full regression |
| F-053 | qa-suites packages and family requires | `config/qa-suites.json` | `packages`, `families` | 3–56 | File read | high | No package 10. No family with `scope: package` |
| F-054 | Package 1 capabilities and retrigger rules present | `config/packages/package-1.json` | `capabilities`, `freeSpinRetriggerRules` | — | Node print of capabilities and `hasRules` | high | Exact scatter numbers not re-printed in the audit body; confirm in the JSON before quoting 4/3/+5 as current. Architecture README states 4/3/+5 |
| F-055 | Handbook files are outlines; history doc is an early plan | `docs/handbook/AI_PROJECT_CONTEXT.md`, `SGAP_ENGINEERING_HANDBOOK.md`, `SGAP_PROJECT_HISTORY.md` | headings | context file lines 1–80 and 200–270 | File read | high | History doc does contain real philosophy text, not only headings |
| F-056 | Public barrel exports SpinController only among controllers | `src/index.ts` | re-exports | ~5–126 | Explore | medium | Other controllers export from `src/controllers/index.ts` |
| F-057 | Iframe title selector on Sugar | `config/manifests/sugar-wonderland.json` | `gameIframe` | ~5, 18–21 | Explore | medium | Other production manifests follow the same key; not every file was opened |
| F-058 | Scratch-only packages 8 and 11 have no package JSON | `config/packages/` listing | — | — | `ls config/packages` | high | Manifests exist for those game ids |
| F-059 | `src/ai` is a README only | `src/ai/README.md` | — | — | Directory listing | high | — |
| F-060 | Duplicate catalog trees | `docs/catalogs/` and `docs/` | same filenames | — | Explore byte lengths | medium | Lengths: regression 9833, smoke 5541, pentest 9059, PENTESTING 32113, PERSONALTESTING 14536. Not re-hashed in the final pass |
| F-061 | Eye-gate and buy-panel numbers are documentary | `docs/architecture/NEXT_STEPS.md` Done table | proof column | 20–22 | File read | high | The runs exist (F-049). The tap counts 299→14 are in the doc, not re-measured |
| F-062 | Stale rerun script project names | `scripts/run-suite10-failures.mjs` | project list | ~34–40 | Explore | medium | — |
| F-063 | Observation event names differ from `GAME_EVENT_IDS` | `src/core/constants/index.ts`, `src/observability/observation-recorder.ts` | `GAME_EVENT_IDS`, `deriveFromResponse` | constants ~41–50; recorder ~383–451 | Explore | medium | — |
| F-064 | `toAmountString` stringifies a JS number | `src/shared/json-path.ts` | `toAmountString` | ~34–41 | Explore | medium | — |
| F-065 | Suite queue publishes one combined Allure report | `scripts/run-suite-queue.mjs` | publish path | ~281–290 | Explore | medium | — |
| F-066 | Probe gate does not publish Allure and forces monitor off | `scripts/run-game-probe-gate.mjs` | — | ~28, 37–67 | Explore | medium | — |
| F-067 | Interaction journal fields | `src/reporting/interaction-journal.ts` | `recordInteraction` | — | Architecture README plus module presence | medium | — |
| F-068 | 34 manifest JSON files | `config/manifests/*.json` | — | — | Glob | high | Includes 3 non-production |
| F-069 | 8 package profiles | `config/packages/*.json` | — | — | `ls` | high | — |
| F-070 | 10 surface files | `config/surfaces/` | — | — | `ls` | high | — |
| F-071 | Symbol catalogs on disk for two games only | `config/symbols/sugar-wonderland`, `config/symbols/beelze-bop` | `catalog.json` | — | Explore | medium | Other symbols live inside package JSON |
| F-072 | Capture run skip-heavy | `allure-history/run-20261106-143720-capture` | summary | — | Node read: 3 passed, 2578 skipped, 2581 total | high | Does not prove hold-and-win rules |
| F-073 | `HealableAction` is only spin | controller strategy types | `HealableAction` | — | Explore | medium | NEXT_STEPS step C agrees |
| F-074 | Local mode fulfills a sample bet | `tests/fixtures/sgap.fixture.ts`, `tests/fixtures/samples/dijoker-bet-response.json` | local branch | — | Explore | medium | Sample file not opened (could be large). Not a secret review |
| F-075 | Monitor routes | `scripts/lib/sgap-worker-monitor-server.mjs` | listen, `/observe`, `/api/stop` | listen ~834; routes ~717–826 | Explore | medium | — |
| F-076 | QA page port 3850 | `scripts/qa-testing-page.mjs` | `SGAP_QA_PAGE_PORT` | ~39 | Explore | medium | — |
| F-077 | CSF-011 spec expects checker passed | `tests/specs/csf/CSF-011.spec.ts` | expects | ~175–390 region | Explore | medium | Not executed. Header cites Oppals 2026-10-27 as a comment |
| F-078 | Fruit Attack buyFeature false | `config/manifests/fruit-attack.json` | controllers | — | Explore inventory | medium | File not re-opened in the final pass. Package-9 JSON was listed by `ls` |
| F-079 | Pending spec skips catalog ids outside the automated set | `tests/specs/regression/regression-pending.spec.ts` | `test.skip` | — | Explore | medium | — |
| F-080 | No `tests/specs/as` directory | `tests/specs` | — | — | Spec inventory | high | `qa-suites.json` still lists family AS |

Confidence notes:

- **high** — this audit’s own read, ripgrep, directory listing, or JSON parse.
- **medium** — a structured repository read whose key symbols were spot-checked (exports, Kobo manifest, qa-suites, NEXT_STEPS, Allure totals) but whose every line range was not re-opened while writing.
- **low** — explicitly unknown or a document sentence not checked against current source.

No finding in this index is marked VERIFIED for live game behavior. Execution evidence is limited to stored Allure statistics and to comments in source.
