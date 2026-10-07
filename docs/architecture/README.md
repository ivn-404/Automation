# SGAP architecture — start here

> Version: 1.0.0
> Status: Working map (does not replace the constitution)
> Audience: testers and AI assistants

Open this file first. The other architecture notes are linked below.
Existing automation code was **not moved**. This is a map of what we already have and what belongs where.

---

## The one rule

**Build once. Reuse everywhere.**

A new game should need:

1. a manifest (config)
2. symbol / reel assets (config)
3. a short probe (PROBE-002, then PROBE-001)

It should **not** need a rewrite of controllers, test scenarios, the driver, or the sync system.

---

## Read these in order

| Order | File | What it answers |
|---|---|---|
| 1 | This file | What the system is, in plain language |
| 2 | [REUSABLE.md](./REUSABLE.md) | Code we share across every game |
| 3 | [GAME_SPECIFIC.md](./GAME_SPECIFIC.md) | What changes per game, and what is still stuck in shared code |
| 4 | [HOW_TO_ADD_A_GAME.md](./HOW_TO_ADD_A_GAME.md) | Checklist for the next title |
| 5 | [NEXT_STEPS.md](./NEXT_STEPS.md) | What to fix next, without throwing away progress |

Older docs stay valid. Use them when you need detail:

| Topic | Doc |
|---|---|
| Philosophy / conflict rules | `docs/AI_PROJECT_CONTEXT.md` |
| Folder map | `docs/REPOSITORY_STRUCTURE.md` |
| Manifest fields | `docs/GAME_MANIFEST.md` |
| Driver / iframe | `docs/GAME_DRIVER.md` |
| Probe before catalog | `docs/PROBE_GATE.md` |

---

## Picture of one test

```text
Spec (manual case)
    → Capability gate        requireCapabilities('buyFeature')      manifest decides: run, N/A, or NOT CONFIGURED
    → Controller             sgapSession.spin.spinAndRead()         one reusable action per capability
        → ActionHealer       prepare / settle / recover             canvas games only; logged, never a blind click
        → Locator strategy   phaser → vision → manifest → candidate first hit wins; each click is journaled
        → Game Driver        clicks inside the iframe
    → State verification     BetResponseWatcher on /bet             armed before the click, read after
    → Report                 Allure: outcome, strategy, fallback, confidence
```

## Capabilities: Pass / Fail / N/A / Not configured

Configuration is the only source of truth for what a game has. Nothing is "detected" by clicking around, because a missed click would turn into a false N/A.

| Config says | State | Test result |
|---|---|---|
| `controllers[]` entry `enabled: true`, or `metadata.<feature>: "true"`, or the package profile sets it `true` | supported | runs; Pass / Fail on the observable |
| entry `enabled: false`, or `metadata.<feature>: "false"`, or the package profile sets it `false` | unsupported | **N/A** — skipped before launch, Allure label `outcome=N/A` |
| no entry, no key, no package default | unmapped | **Fails** with `NOT CONFIGURED — … does not declare …` |

Feature capabilities (`FEATURE_CAPABILITIES` in `src/capabilities/game-capabilities.ts`): `normalModeMultiplier`, `freeSpins`, `scatterTrigger`, `freeSpinRetrigger`, `tumble`, `multiplierWild`, `scatterMode`, `reelValidation`, `symbolCatalog`, `maxWin`. Resolution order, first hit wins:

1. `metadata.<feature>: "false"` in the game manifest → unsupported.
2. Config-backed features are supported only when their data exists: `reelValidation` = a `reelValidation` block in the manifest; `symbolCatalog` = symbols in the package profile or `config/symbols/<gameId>/catalog.json`.
3. `metadata.<feature>: "true"`.
4. The package profile `config/packages/<packageId>.json` → `capabilities`.
5. Otherwise unmapped.

Only flip a package default to `true` with evidence (for Package 1, `freeSpinRetrigger` is backed by FS-008 observing a retrigger, which it asserts). Package 2 sets `freeSpinRetrigger: false` and `tumble: false` from its spec, so FS-008 / WD report N/A there instead of failing.

Specs declare what they need as the first line of their `describe`:

```ts
requireCapabilities('buyFeature', 'autoplay');   // tests/support/capabilities.ts
```

Inside a test, `sgapSession.supports('turbo')` answers the same question (AT-008 uses it for its optional controllers).

**Family baseline.** `config/qa-suites.json` → `families` gives each test folder a `scope` (`game` / `package` / `environment`) and the capabilities every case in it needs (e.g. `spin`, `bet` for AP…WD; `scratchCard` for SCG). The fixture `_sgapBaseline` applies that gate before the game opens, so no spec repeats it. The lane generator (`scripts/lib/qa-suites.mjs`) runs `game` families on every lane, `package` families on the first game of each package, and `environment` families (PEN) once per queue.

**Package profile.** `config/packages/<packageId>.json` holds what every title in a package shares: symbol catalog, reel payload paths (`areaPath`, `tumblesPath`, `featureItemsPath`, `rowOrder` — merged into a manifest's `reelValidation` when it omits them), capability defaults, and spec values such as `multiplierValues` (AT-001). Leave a payload path out until a staging `/bet` has shown it; a missing path is NOT CONFIGURED, a guessed one is a false pass.

**Engine adapter.** `src/engine/` puts the scene-graph primitives (`listInteractive`, `listTexts`) behind `engineFor(manifest)` — `metadata.engine`, else `phaser` for canvas titles, else `dom`. Band picking stays in surface profiles and is engine-neutral. Call sites still import `src/runtime/phaser-locate.ts` directly; migrating them is listed in [NEXT_STEPS.md](./NEXT_STEPS.md).

"Unmapped fails" is deliberate: the package 2+ manifests map only the scratch card. Their slot controllers are real but not configured yet, so BF/AP cases on them must not quietly turn N/A.

## Controlled self-healing

- **One spin path.** `SpinController.spinAndRead()` arms the bet watcher, clicks, reads `/bet`. Retries are bounded (`maxAttempts`) and each retry goes through the healer's `recover`.
- **ActionHealer** (`src/controllers/strategy/action-healer.ts`) is the only place recovery lives. Canvas games get `createCanvasActionHealer` (`tests/support/canvas-action-healer.ts`); DOM games get `NO_HEAL`. Healing may clear a blocker or re-locate the same control. It never substitutes a different action.
- **Server-side failures are not healed.** A `/bet` error is a failure, not a retry.
- **Eye-gated dismissal.** Overlay clearing (`clearCanvasOverlays`) and the error-dialog dismiss in `canvas-bet-control.ts` read the HUD first (`readHudState` / `settleHudState` in `src/eye/canvas-blocker.ts`): idle and unobstructed → no taps; a dialog button painted in the scene graph → tap that button; a recognised blocker → targeted tap; still covered after the settle window → the old fixed points, journaled as `point` / `low` and emitted as a Monitor Worker event. `SGAP_BLIND_OVERLAY_TAPS=1` restores the ungated taps for A/B runs.
- **Buy panel close.** `closeBuyPanel` (`src/eye/canvas-blocker.ts`) taps only when the eye sees the BUY FEATURE confirm, finds the close glyph as visible Phaser text (`hudLabels.buyPanelClose`, topmost layer — hidden layers keep interactive objects at the same spot, so position bands pick the wrong one), falls back to the manifest `buyFeatureCancel` point as a journaled fallback, and confirms the panel is gone. PROBE-002 writes `buy-panel.json` with the measured glyph.
- **Press anywhere.** The eye reports `press-anywhere` for a dark mid-panel (`pressAnywhere.maxLuma`) or, when that misses a bright award intro, for visible scene-graph text matching `hudLabels.pressAnywhere`.
- **Menu close.** `MenuController.close` presses Escape, clicks the manifest `menuClose` / `menuCloseAlt` actions, then taps `controls.menuClose.candidates` from the surface profile (base: six points around the hub X at 0.86,0.08). A package with a different hub overrides the candidates in its surface file.
- **Round-in-progress readiness.** A feature round answers `/bet` (or buy / initialize) with `unresolvedSpin: <id>`, reports progress with `PATCH /api/v1/unresolved-spin/<id>` and ends with `…/<id>/complete`; until then the game ignores spin taps even if the circle looks idle. `RoundTracker` (`src/network/round-tracker.ts`, installed per test by the fixture) follows that traffic. `waitForIdleHud` waits for the round first (gives up after 45 s without progress or 3 min total), logs a `round-wait` Monitor Worker event, and failure reports name an open round as the cause. The id field is `network.fields.unresolvedSpin` (default `unresolvedSpin`).

## Interaction journal

Every click records `{action, strategy, confidence, fallback, point, detail}` (`src/reporting/interaction-journal.ts`). After each test the fixture attaches `interactions.txt` / `interactions.json` and sets annotations `locatorStrategy`, `selfHealing`, `lowestConfidence`.

| Strategy | Confidence | Meaning |
|---|---|---|
| `phaser`, `dom` | high | found in the scene graph / DOM |
| `vision`, `manifest` | medium | colour blob, or the manifest ratio |
| `candidate`, `point` | low | profile candidate ladder, or an explicit point |

A `low` in a passing test is a calibration hint (usually a stale manifest ratio), not a failure.

## Monitor Worker (observability)

Every test records one ordered stream of what the page did (`src/observability/`, fixture `_sgapObserve`):

| Kind | What | Source |
|---|---|---|
| `network` | XHR / fetch / document: method, URL, status, timing, request + response body, headers on bet / buy / initialize / failures. `injected` = answered by a test route (`x-sgap-injected` header), not the backend. Successful static asset loads are only counted. | `page.on('request*')` |
| `console` | `console.*`, uncaught exceptions with stack, unhandled rejections | `page.on('console' / 'pageerror')` + init script |
| `websocket` | open / sent / received / error / close per socket; SignalR targets; keep-alives counted, not stored | `page.on('websocket')` |
| `event` | spin-started, bet-attempted, spin-completed, bet-failed, refund-received, server/HUD balance changed, modal opened/closed, insufficient-balance, buy-feature, scratch, game-initialized, recovery-attempt, plus test-emitted events (`observationFor(page)?.event(…)`) | derived from the above + interaction journal |
| `balance` | HUD (surface `hudLabels.balance`), server (last bet/buy/initialize response), host launcher, Δ hud − server, trigger + related request | sampler every `SGAP_OBSERVE_BALANCE_MS` (500) + every bet response |

- **Live:** the parallel runner opens a second window at `<monitor>/observe` (tabs Timeline / Network / Console / WebSocket / Events / Balance, problems filter, search, expandable payloads). Link "Monitor Worker" in the main monitor bar.
- **Report:** each test attaches `monitor-summary.txt` (counts + merged timeline), `balance-timeline.txt`, and `monitor-worker.json`.
- **Safety:** tokens, cookies, auth headers, JWTs and secret query params are redacted before anything is stored or streamed; persisted websocket payloads are 300-character previews.
- **Switches:** `SGAP_OBSERVE=0` disables recording, `SGAP_OBSERVE_WINDOW=0` skips the extra window, `SGAP_OBSERVE_BALANCE_MS=0` disables HUD sampling.

Two places only:

| Place | Job | Example |
|---|---|---|
| **Host page** | Casino launcher | pick the game, set balance / bet limit |
| **Game iframe** | The slot itself | spin, buy, bet, canvas |

Sugar Wonderland paints buttons on a **canvas**. There are almost no DOM buttons inside the iframe. That is why we use ratios + vision + Phaser, not CSS locators, for HUD clicks.

---

## Three buckets (do not mix them)

| Bucket | Changes when… | Lives in |
|---|---|---|
| **Framework** | Never, for a new game on the same platform | `src/controllers`, `src/driver`, `src/network`, `src/core` |
| **Game config** | Every new game | `config/manifests/<gameId>.json`, `config/symbols/<gameId>/` |
| **Surface profile** | A new package or art style | `config/surfaces/base.json`, `config/surfaces/<packageId \| gameId>.json` (vision bands, Phaser bands, candidates, blockers) |
| **Heal / recovery** | Should follow config | `ActionHealer`, `tests/support/canvas-healing.ts`, `src/eye/`, `src/runtime/phaser-locate.ts` |

If you are about to type a game name, a colour, or a pixel ratio inside `src/controllers` or a spec, stop. Put it in the manifest or in [GAME_SPECIFIC.md](./GAME_SPECIFIC.md)'s "known leaks" list and fix it there.

---

## What "green" means

A case passes only when the **observable** is true (usually a `/bet` response), not because a click "looked right".

Vision and Phaser are for **finding the button**. They are not the pass/fail.

---

## Current game

| Item | Value |
|---|---|
| Game id | `sugar-wonderland` |
| How to select it | `SGAP_GAME_ID=sugar-wonderland` |
| Manifest | `config/manifests/sugar-wonderland.json` |
| Package | Package 1 (same family as Beelze Bop, Felice, Mars) |
| Surface | Canvas inside `iframe[title="Game session"]` |

The same specs run unchanged on `beelze-bop`, `felice-in-space` and `mars-triumph` (`config/parallel-workers-refactor-verify.json`). Packages 2–11 have scratch-only manifests: SCG runs, slot cases report NOT CONFIGURED until their slot controllers are mapped. See [GAME_SPECIFIC.md](./GAME_SPECIFIC.md).
