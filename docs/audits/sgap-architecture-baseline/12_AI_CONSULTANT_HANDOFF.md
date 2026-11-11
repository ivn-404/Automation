# 12 — AI consultant handoff

> Audit date: 2026-11-11.
> Self-contained briefing. The consultant does not have the repository.
> This audit did not modify source, tests, configuration, or git history outside `docs/audits/sgap-architecture-baseline/`. It did not run Playwright, did not spin games, and did not move wallets.

## System summary

SGAP is a QA automation framework for iframe-based Phaser slot games and a scratch-card hub on the DiJoker launcher. It is one Node package (`sgap` 0.1.0): TypeScript, Playwright 1.51, pnpm, Node 20+.

A test does not pass because a canvas click looked right. The intended oracle is an HTTP-ok bet, buy, or initialize response, parsed with paths from that game’s manifest. Clicks are a locator problem (Phaser scene graph, then vision, then manifest ratios, then candidate points). Support is a configuration problem (enabled / disabled / not declared). Those two problems are deliberately separate so a missed click cannot become “feature not applicable”.

The framework is past its original Milestone-0 plan and short of the architecture diagram in the approved folder map. The code that matters is the fixture, the controllers, the bet watcher, the capability gate, the eye/runtime locator, and the parallel runner. Several named layers are empty constants.

## Current architecture

```text
QA catalogs (markdown)          config/qa-suites.json
        │                                │
        ▼                                ▼
specs tests/specs/<ID>.spec.ts    lane JSON or suite queue
        │                                │
        └────────────┬───────────────────┘
                     ▼
        tests/fixtures/sgap.fixture.ts
                     │
     capability gate before the browser game opens
                     │
        host page (wallet, bet limit, pick game)
                     │
        iframe[title="Game session"]
                     │
        controller → driver → runtime/eye → canvas
                     │
        BetResponseWatcher armed before the click
                     │
        parsers + verification functions
                     │
        Allure history + monitor :3847 + optional Sheets CSV
```

Workers are **processes**, not Playwright workers inside one browser. Each lane is `--workers=1`. All lanes in a file start together. The JSON `workers` number does not cap them.

## Important paths

| Path | Why it matters |
|---|---|
| `docs/architecture/README.md` | Best current map. Treat “packages 2–11 scratch-only” as outdated |
| `docs/architecture/NEXT_STEPS.md` | October 2026 done-list is historical evidence. The “Now” list is partly stale |
| `docs/architecture/layers/REPOSITORY_STRUCTURE.md` | Approved folder map. Over-claims empty layers, omits eye/runtime |
| `docs/architecture/GAME_SPECIFIC.md` | Leak list. Menu-controller row is outdated |
| `docs/catalogs/RegressionTestCases.md` | Case list the parser uses. QA-owned |
| `docs/handbook/SGAP_PROJECT_HISTORY.md` | Early philosophy. Not current status |
| `docs/handbook/AI_PROJECT_CONTEXT.md` | Outline only |
| `playwright.config.ts` | Timeouts, retries, projects, reporters |
| `tests/fixtures/sgap.fixture.ts` | Composition root |
| `src/capabilities/game-capabilities.ts` | Support / N/A / NOT CONFIGURED |
| `src/controllers/spin-controller.ts` | `spinAndRead` |
| `src/network/bet-response-watcher.ts` | `/bet` oracle |
| `src/network/round-tracker.ts` | Feature rounds |
| `src/data/parse-bet-response.ts` | What is actually copied out of the body |
| `src/verification/` | Balance, retrigger, ways, clusters, reels |
| `src/observability/` | Monitor stream and redaction |
| `src/eye/`, `src/runtime/`, `src/engine/` | How a button is found |
| `config/manifests/*.json` | 31 production titles + 3 fixtures |
| `config/packages/package-1.json` through `package-7.json`, `package-9.json` | Shared math flags. No package 8, 10, or 11 file |
| `config/qa-suites.json` | Families and game lists |
| `scripts/run-parallel-workers.mjs` | Normal runner |
| `scripts/qa-testing-page.mjs` | Local dashboard, port 3850 |
| `allure-history/` | 326 published runs as of this audit |

## Existing capabilities

Configured and implemented in code, with the status a consultant should assume:

| Capability | Status to assume |
|---|---|
| Open host, set wallet if short, attach iframe, portrait-lock | IMPLEMENTED. Package 1 historical gates exist (Oct 2026, ~40 tests). Not re-run |
| Spin and read one `/bet` | IMPLEMENTED. Inner retry max 2. Server errors not retried |
| Capability gate | IMPLEMENTED and central |
| Balance equation | IMPLEMENTED. Not re-executed. Tolerance one cent |
| Free-spin item discovery and retrigger scoring | PARTIAL. Rules required for a real verdict. Package 1 has rules. Package 2 sets retrigger false |
| Ways and cluster multiplier arithmetic | PARTIAL. CSF-011. Does not use `winPattern` |
| Reel cell compare | PARTIAL. `reelValidation` on Package 1 manifests only |
| Buy cost versus wallet | PARTIAL. Default multiplier 100 if metadata omits it |
| Autoplay | PARTIAL. One or N bet responses, not “spin count equals the picker” |
| Turbo | PARTIAL. Click plus “spin still works”. No turbo payload field documented for Package 1 |
| Unresolved feature round wait | IMPLEMENTED as a wait. Resume identity asserted in PEN-072, not in regression |
| Scratch hub controls and SCG specs | PARTIAL. Separate protocol from slots |
| FPS bands and asset inventories | PARTIAL. PAD specs. Often annotated or soft |
| Worker monitor, interaction journal, Allure history | IMPLEMENTED |
| Google Sheets | Append-only execution log, env-gated. Not the case loader |
| State machine, event bus, history API, RTP, payline geometry, audio playback, slot replay | NOT FOUND as implementations |

## Verified versus unverified

Nothing in this audit is VERIFIED as live staging behavior on 2026-11-11, because no tests were run.

Safe to call **verified as repository fact** (the file says what it says):

- Kobo Ass manifest enables slot controllers (so the October NOT CONFIGURED claim is not current).
- `winPattern` is unused by TypeScript.
- Allure folder totals quoted in `05` and F-049–F-052.
- Spec count 247. Automated regression id set size 105.
- Empty layers and the capability function order.

Safe to call **historically evidenced, narrow scope**:

- 2026-10-06 runs `run-20261006-110811` and `run-20261006-120222`: 35 passed, 1 failed, 4 skipped, 40 total. The markdown says the failure was AT-003 on Sugar and that feature rounds completed. The summary JSON does not, by itself, name AT-003.
- 2026-10-07 `run-20261007-112403`: 34 passed, 0 failed, 34 total. The markdown attributes menu cases on four Package 1 games.

Do **not** treat those as the state of packages 2–9 or of November 2026. A 2026-11-06 regression is 207/109/36 of 352. A 2026-11-07 run labeled all packages is 0/430/10 of 440. Causes were not investigated.

## Major constraints

- New games are data-only only when they match the existing canvas, iframe, and `/api/v1/slots` assumptions and when a human fills manifest, package rules, and surface.
- Unmapped capabilities fail. Disabled capabilities skip. Do not “detect” N/A by clicking.
- Family baseline for regression is only `spin` and `bet`. Buy, free spins, and turbo are per-spec gates.
- One spin is not a first-class id across network, HUD, and Allure.
- Staging retries and hunt loops spend a real wallet. Caps are local to FS-008 unless set. `minimumBetBalance` is not enforced.
- Parallel runs drop video and trace.
- PEN is not part of regression. Most PEN cases are scratch-hub tests.
- Secrets exist as env vars. Do not ask a tool to print them. Observation redaction is implemented and not proven complete.
- Catalog files are QA-owned. Do not rewrite case sentences to match code.

## Technical debt that will mislead a design

1. Folder map and `src/index.ts` advertise layers that do not run.
2. `NEXT_STEPS.md` “Now” item 2 and the architecture README “current game” paragraph understate how many slot manifests are enabled and overstate how proven they are.
3. `GAME_SPECIFIC.md` still points at `menu-controller.ts` for a coordinate that now lives in surface config and in `discovery/panel-checks.ts`.
4. Smoke versus regression ids collide.
5. `AUTOMATED_REGRESSION_IDS` does not match the spec tree (missing CSF-006 and SCG-024, including MN-001, pending generator lies about WD).
6. Two protocol surfaces (slot `/bet` and scratch hub) share suites, manifests (scratch controller enabled on slot games), and a launcher.
7. Healer lives in `tests/support` and only wraps spin.
8. Default game and several CLIs are Sugar Wonderland.
9. Handbook constitution files were never filled in.

## Historical decisions worth keeping

From `docs/handbook/SGAP_PROJECT_HISTORY.md` and the architecture README, still visible in code:

- No Page Object `pages/` layer. Controllers are the action API.
- Configuration over a copied spec per game.
- Manual cases keep their ids. Automation reports back to those ids.
- Observable sync over a screenshot as the pass.
- AI may advise and must not be required to run the suite (`src/ai` is empty; `package.json` has no AI dependency).
- Google Sheets manual tab must not be overwritten. The reporter appends a different tab or a local CSV.
- Build once, reuse everywhere. The leaks list exists because that rule is enforced socially and only partly by the type system.

October 2026 decisions that the code still follows: eye-gated overlay taps, buy-panel close via visible text, `RoundTracker` before spin, package capability files, surface profiles, interaction journal on every test.

## Known unresolved issues

See `11_OPEN_QUESTIONS.md`. The ones that change a design:

- No per-game score for the November regressions.
- No copied server round id for ordinary spins.
- AT-003 Sugar HUD lag, Felice BF-003 stall, and AT-004/005 session disconnect are documented and not reconfirmed.
- Package 2+ controllers enabled with unknown calibration.
- WD skipped, AS absent, RTP skipped, paylines unread.

## Glossary

| Term | Meaning in SGAP |
|---|---|
| Manifest | `config/manifests/<gameId>.json`. Per title |
| Package | Math family. `package-N` in metadata. Numeric key in `qa-suites.json` |
| Surface | `config/surfaces`. Vision bands and candidate points. Falls back to `base.json` |
| N/A | Capability declared unsupported. Test skipped before launch |
| NOT CONFIGURED | Capability missing. Test fails before launch |
| Lane | One Playwright process, one player id, one slice of specs |
| Monitor Worker | Observation stream and the `/observe` page. Port 3847 |
| Eye | HUD/blocker classifier in `src/eye` |
| Healer | `ActionHealer` prepare/settle/recover. Canvas implementation in test support |
| `/bet` | `POST` (typically) `/api/v1/slots/bet`. The spin oracle |
| unresolvedSpin | Id of a feature round still in progress. Not used for a normal spin |
| BuyFeat | Request flag for a purchase, not the price, in the cost helper |
| Amplify | `isEnhancedBet` on the bet request. Not turbo |
| Turbo | HUD toggle. Local boolean. Not a Package 1 payload field, per the controller comment |
| SCG | Scratch game cases |
| PEN | Security cases. Not in `@regression` |
| PAD | Performance and asset diagnostics |
| PROBE-002 | Iframe inventory and calibration writer |
| History id | Allure’s identity for trend lines. Influenced by `gameId`. Not a spin id |
| DiJoker | Game host named in manifests |
| Sugar Wonderland | `sugar-wonderland`. Default `SGAP_GAME_ID`. Package 1 |

## Recommended reading order

1. This file.
2. `00_EXECUTIVE_OVERVIEW.md` for the argument.
3. `01_REPOSITORY_ARCHITECTURE.md` and `02_EXECUTION_LIFECYCLE.md` for structure and runtime.
4. `03_NETWORK_AND_GAMEPLAY_DATA.md` before designing any analytics event.
5. `04_GAME_CAPABILITY_MATRIX.md` before proposing a registry.
6. `06_GAMEPLAY_TRACKERS_AUDIT.md` before claiming a mechanic exists.
7. `05` and `07` before designing dashboards or traceability.
8. `08` for risk.
9. `09` only after the above. It is recommendation, not current behavior.
10. `10_EVIDENCE_INDEX.md` when a sentence needs a file.
11. `11_OPEN_QUESTIONS.md` for what not to invent.

Then, in the repo if access is granted later: `docs/architecture/README.md`, `src/capabilities/game-capabilities.ts`, `tests/fixtures/sgap.fixture.ts`, `src/controllers/spin-controller.ts`, `config/qa-suites.json`, one Package 1 manifest (`sugar-wonderland`) and one Package 2 manifest (`kobo-ass`) side by side.

## What not to conclude

- Do not conclude the suite is green because October gates were green.
- Do not conclude packages 2–7 are production-automated because controllers are `enabled: true`.
- Do not conclude paylines, RTP, hold-and-win resets, audio, or slot replay are tested.
- Do not conclude a passing autoplay or turbo spec measured speed or spin count.
- Do not put tokens, cookies, or raw bet bodies from `allure-history` into a design doc. The recorder is supposed to redact. Assume attachments may still be sensitive until reviewed.
- Do not implement the sketches in `09` as part of understanding the system. They are not the architecture.
