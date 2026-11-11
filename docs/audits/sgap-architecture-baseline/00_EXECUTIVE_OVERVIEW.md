# SGAP architecture baseline — executive overview

> Audit date: 2026-11-11
> Method: static, read-only inspection of the repository. No tests were executed for this audit.
> Audience: an external architecture consultant who cannot open the repo.
> Classification vocabulary: VERIFIED, IMPLEMENTED — UNVERIFIED, PARTIAL, PLANNED, NOT FOUND, UNKNOWN. See `10_EVIDENCE_INDEX.md`.

## What SGAP is

SGAP (Slot Game Automation Platform) is a TypeScript + Playwright framework that drives **iframe-hosted Phaser slot games** (and a scratch-card hub on the same launcher) for the DiJoker staging platform. A test passes only when an **observable response** is true — usually an HTTP-ok `/api/v1/slots/bet` (or `/buy`) body — not because a click looked correct.

The intended product rule, stated in `docs/architecture/README.md` and still visible in the code, is:

**A new title should need a manifest, symbol/package data, and a probe. It should not need a new controller or a copied spec.**

That rule is partly achieved. Controllers and specs do not branch on `gameId === '<title>'`. Support is declared in JSON. Several layers named in the original folder map were never implemented, and a large amount of real behavior lives in folders the folder map does not mention (`src/eye`, `src/runtime`, `src/capabilities`, `src/observability`, `src/discovery`, `src/perf`).

Package version in `package.json`: `0.1.0`. Runtime: Node `>=20`, package manager `pnpm@9.15.0`. Playwright `^1.51.0`.

## What it currently does

1. Opens a casino **host page**, sets a staging wallet and bet limit (unless a pasted Game URL is used), then attaches to `iframe[title="Game session"]`.
2. Clicks canvas HUD controls by a locator ladder: Phaser scene graph, then vision, then manifest ratios, then surface-profile candidate points. Every click is journaled.
3. Arms `BetResponseWatcher` before the click and parses balance, total win, and transaction state from paths declared on the game manifest.
4. Gates each family of tests before launch: supported (run), unsupported (**N/A**), or unmapped (**NOT CONFIGURED**, which fails).
5. Runs many games at once as **separate Playwright processes** (one lane each), with a local worker monitor (default `127.0.0.1:3847`) and an Allure history publisher (default port `5055`).
6. Records a per-test observation stream: network, console, websocket, derived game events, and a HUD-versus-server balance timeline.

## Major components

| Component | Where it actually lives | Role |
|---|---|---|
| Specs | `tests/specs/<family>/` | One file per manual case id where automated |
| Session fixture | `tests/fixtures/sgap.fixture.ts` | Wires manifest, platform, driver, controllers, watchers |
| Capability gate | `src/capabilities/game-capabilities.ts` | Config-only support decision |
| Controllers | `src/controllers/` | Spin, bet, buy, autoplay, turbo, amplify, menu, settings, fullscreen, scratch |
| Game driver | `src/driver/playwright-game-driver.ts` | iframe attach and canvas clicks |
| Platform | `src/platform/playwright-platform.ts` | Host navigation, portrait lock, wallet setup entry |
| Eye + runtime | `src/eye/`, `src/runtime/` | Blocker detection, Phaser locate, healing inputs |
| Network | `src/network/` | `/bet` waiter, unresolved-round tracker, scratch hub |
| Verification | `src/verification/` | Balance delta, reel match, retrigger, multiplier math |
| Observability | `src/observability/` | Monitor Worker recorder and redaction |
| Reporting | `src/reporting/` + Allure scripts | Execution JSON, optional Sheets append, Allure history |
| Orchestration | `scripts/run-parallel-workers.mjs`, `scripts/qa-testing-page.mjs` | Lanes, monitor, QA panel on port 3850 |

Contracts that exist only as TypeScript interfaces, with **no implementing class**, include the game state machine, readiness guard, event observer, history/session/wallet data sources, and traceability service (`src/state`, `src/readiness`, `src/events`, `src/traceability` export a layer name only).

## Strengths

- **Configuration is the capability source of truth.** A missed click cannot silently become N/A. Unmapped features fail with `NOT CONFIGURED —`.
- **One spin path.** `SpinController.spinAndRead` arms the watcher, clicks once, and bounds retries. A `/bet` HTTP error is not healed.
- **No title switches in controllers or specs.** Game differences are manifests, package profiles, and surface profiles.
- **Pass/fail is network-grounded** for the core spin and balance cases.
- **Observability is first-class:** interaction journal, redacted monitor stream, balance timeline, worker overlay.
- **Onboarding data exists for many titles:** 31 production manifests (plus 3 non-production), 8 package profiles, 10 surface files. Packages 2–7 and 9 now have slot controllers enabled. Packages 8 and 11 remain scratch-only.
- **Historical evidence is retained.** `allure-history/` holds 326 published runs (folders present on 2026-11-11). Each run must be read with its date, label, and total. A green October gate is not the November suite.

## Weaknesses and current limitations

- **The approved folder map is stale.** `docs/architecture/layers/REPOSITORY_STRUCTURE.md` does not name eye, runtime, engine, capabilities, observability, discovery, perf, or surfaces. It describes events, state, readiness, and traceability as if they were implemented.
- **`docs/architecture/NEXT_STEPS.md` “Now” item 2 is stale.** It still says packages 2–11 are scratch-only and that Kobo Ass slot cases fail as NOT CONFIGURED. `config/manifests/kobo-ass.json` enables every slot controller, including `buyFeature` and `scratchCard`. The October “Done” table remains a historical record, not a description of today’s open work.
- **`winPattern` is documentation inside JSON.** Values such as `paylines-20`, `ways-243`, and `cluster-5` appear in `config/packages/*.json` and are not read by TypeScript. There is no payline-geometry or RTP tracker.
- **No shared spin id** ties one spin across the bet response, the HUD sample, verification, and the Allure result. Correlation is “the response this waiter just saw” plus observation `seq` inside one test.
- **Many mechanics are partial.** Free-spin retrigger scoring, ways/cluster multiplier checks, and balance delta exist. Hold-and-win reset rules, wild explode specs, audio playback, and slot replay do not.
- **Recent large regressions were not green.** Example, scope unknown beyond the Allure label: `allure-history/run-20261106-182629-regression` — 207 passed, 109 failed, 36 skipped, 352 total, label “Regression Test · 2026-11-06”. A later run labeled “All Regression (packages 1-9, 11)” (`run-20261107-165618`) is 0 passed / 430 failed / 10 skipped / 440 total. This audit did not re-execute those cases and does not treat the 430 as 430 distinct product defects. November 9–10 history is mostly 1–12 result slices labeled `REGR`, not a full-suite confirmation.
- **Authoritative manual cases are split.** Automation parses `docs/catalogs/*.md`. Those headers call themselves the source of truth. `docs/handbook/SGAP_PROJECT_HISTORY.md` and several `docs/tests/*.md` notes still say Google Sheets is the manual source. The Sheets client only **appends** an execution row when tokens are configured. It does not load the manual tab. Smoke and regression catalogs reuse ids with different titles (`CSF-010`, `CSF-011`, `AT-002`).
- **Handbook constitution files are outlines.** `docs/handbook/AI_PROJECT_CONTEXT.md` and `docs/handbook/SGAP_ENGINEERING_HANDBOOK.md` are heading skeletons. The working map is `docs/architecture/README.md`.
- **Wallet safeguards are uneven.** The runner logs `minimumBetBalance` and does not enforce it. FS-008 has an explicit spend cap. There is no global `SGAP_MAX` spin or spend ceiling.
- **Default game is still Sugar Wonderland** when `SGAP_GAME_ID` and project metadata are absent.

## How to read the rest of this audit

| File | Question it answers |
|---|---|
| `01_REPOSITORY_ARCHITECTURE.md` | Folders, modules, dependencies, diagrams |
| `02_EXECUTION_LIFECYCLE.md` | From lane JSON to Allure |
| `03_NETWORK_AND_GAMEPLAY_DATA.md` | `/bet`, rounds, correlation gaps |
| `04_GAME_CAPABILITY_MATRIX.md` | Games, packages, mechanics, config status |
| `05_TEST_COVERAGE_AND_TRACEABILITY.md` | Specs versus catalogs |
| `06_GAMEPLAY_TRACKERS_AUDIT.md` | Per-mechanic status |
| `07_OBSERVABILITY_AND_REPORTING.md` | Allure, monitor, dashboard, identity |
| `08_RELIABILITY_AND_TECHNICAL_DEBT.md` | Flakes, leaks, security boundaries |
| `09_ADAPTIVE_AUTOMATION_READINESS.md` | What would have to exist for adaptive automation |
| `10_EVIDENCE_INDEX.md` | Finding ids, paths, confidence |
| `11_OPEN_QUESTIONS.md` | What the repo cannot answer |
| `12_AI_CONSULTANT_HANDOFF.md` | Self-contained briefing |

Findings are cited as `F-###` in the evidence index. Recommendations in `09` are documentation only. Nothing in this audit was implemented.
