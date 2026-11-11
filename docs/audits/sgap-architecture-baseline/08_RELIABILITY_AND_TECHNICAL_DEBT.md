# 08 — Reliability and technical debt

> Audit date: 2026-11-11. Read-only.
> Historical defects are labeled with the document or the Allure folder that states them. They are not assumed still true.

## Five structural risks

1. **Stale control documents drive the wrong next change.** `NEXT_STEPS.md` still says packages 2–11 are scratch-only and Kobo Ass slot cases fail as NOT CONFIGURED. The manifest enables every slot controller. An engineer who follows “Now” item 2 will redo finished config or, worse, will distrust enabled flags that were never proven on staging. The folder map describes layers that are empty constants. The handbook constitution is an outline.

2. **Pass/fail evidence and product scope have diverged.** October gates of ~40 tests on Package 1 are green except AT-003. November labels “Regression Test” and “All Regression (packages 1-9, 11)” show 109 failures in 352 and a 0/430 run. Without a per-test breakdown, the platform’s current reliability is UNKNOWN. Shipping decisions cannot rest on the October table.

3. **Math is configured in prose fields the code ignores, and specified in code the config does not drive.** `winPattern` is unused. Buy-cost default 100 is a silent fallback. Retrigger rules exist only on some packages while the capability boolean is true on others. CSF-011 branches on `normalModeMultiplierMode`, not on `winPattern`. A package can claim `ways-3600` and never execute a ways check.

4. **Healing and timing still depend on fixed points and fixed waits.** Eye-gating reduced blind taps in the October measurement (299 → 14 on that verify run, as written in `NEXT_STEPS.md`). Leftover ratios remain in `canvas-session-primer.ts` (`0.5, 0.55`), `canvas-blocker.ts` (`0.5, 0.56` when a CONTINUE has no vision center), `discovery/panel-checks.ts` (`0.86, 0.08` and `0.86, 0.22`), and `learn-spins.ts`. `SGAP_BLIND_OVERLAY_TAPS=1` restores the old behavior. Round waits are 45s/180s. Spin `/bet` wait is 45s on staging. These are bounded, and they are still time-based.

5. **Wallet and retry policy can spend or double-count without a global ceiling.** Playwright retries once on staging. `spinAndRead` can click a second time if the late-bet window misses. FS-008 spend cap defaults to off (`SGAP_FS008_MAX_SPEND=0`). `minimumBetBalance` is not enforced. Lanes start all at once. A broad regression across packages 1–9 and 11 is a large number of concurrent staging sessions and feature buys.

## Flakes and failure modes (documented, not re-proven)

| Item | Source | Date / scope | Status in that source |
|---|---|---|---|
| AT-003 Sugar: after a failed `/bet`, the first successful spin is not applied to the HUD balance; the next spin corrects it. Mars stays in sync (PROBE-003). Sugar hub connects to `ws://localhost:5068` and is refused | `docs/architecture/NEXT_STEPS.md` “Now” item 1, tied to Monitor Worker and to gates `run-20261006-110811` and `run-20261006-120222` (35 pass / 1 fail / 4 skip) | October 2026, Sugar Wonderland | Called a **game** defect, not a framework defect. Not re-tested 2026-11-11 |
| Felice BF-003: spin after a mid-spin buy attempt sends no `/bet` for 90s | `NEXT_STEPS.md` item 6 | Undated in the “Now” list; file’s Done section is October 2026 | Documented flake. Not re-tested |
| AT-004 / AT-005: first session disconnects (“opened in another window”) before `/bet`, so the expected server refusal never happens | `NEXT_STEPS.md` item 3 | Same file | Documented product behavior vs test expectation |
| BF-004 Felice: balance 100 equals buy cost at bet 1.00 | same | Package 1 Felice | Setup/oracle collision |
| PEN-059 no max-bet ceiling; PEN-051 alg-none token accepted once | same | Security notes, scratch or platform as written. The file says the existing PEN suite stays on the scratch hub | Documented findings. This audit did not reproduce them and did not read exploit steps into the report |
| Hardcoded Package 1 thresholds in specs (FS-001 scatter constant, FS-008 wording, SCG-024 similarity, ES URL literals) | `NEXT_STEPS.md` item 5 | October 2026 debt list | May or may not still be in the spec. Not re-quoted here |
| AT-001 Help-screen order not captured for Felice and Mars | item 4 | — | AT-001 spec is unconditionally skipped as manual |

`run-suite10-failures.mjs` names AP-002, BC-004, ES-006, BF-003, CSF-008 as a historical failure set and points at project names that no longer match the runner. Treat that script as stale tooling.

## RNG-dependent behavior

Slot outcomes are server RNG. Specs that need a win, a scatter, or a retrigger hunt (`CSF-005`, `CSF-008`, `SM-005`, `TM-004`, FS-008 buys, CAPTURE-00x). Hunts skip or loop with spend caps rather than seeding the server. There is no test-side RNG control in `src/`. A red hunt is not always a product bug. A green hunt is not a proof the mechanic always happens.

PEN-019 (RTP band) is skipped because the sample would be large. That is the correct limitation statement.

## Fixed delays and coordinates

Collected leaks still in shared code (paths confirmed by search or by reading the cited region):

| Location | What |
|---|---|
| `src/runtime/phaser-locate.ts` | `window.phaserGame`. Bands themselves are profile-driven |
| `src/network/bet-url.ts` `PLATFORM_ROUTES` | Default `/api/v1/slots/bet` and siblings. Manifest pattern overrides when it matches. Probes without a manifest still use the default |
| `src/controllers/menu-controller.ts` ~100 | Reads `surface.controls.menuClose.candidates`. **Not** a hardcoded `0.86, 0.08` anymore. `GAME_SPECIFIC.md` is wrong on this row |
| `src/discovery/panel-checks.ts` | Still has `{0.86, 0.08}` and `{0.86, 0.22}` |
| `src/platform/canvas-session-primer.ts` | Feature-spin advance tap `0.5, 0.55` |
| `src/eye/canvas-blocker.ts` | CONTINUE fallback `0.5, 0.56` |
| `src/discovery/learn-spins.ts` | Tap `0.5, 0.55` |
| `src/driver/calibrate-*-canvas.ts`, `probe-sugar-buy-*.ts` | Load `sugar-wonderland` by name |
| `playwright.config.ts`, `local-launcher-html.ts` | Default game id `sugar-wonderland` |
| `tests/support/buy-feature-verify.ts` `expectedBuyCost` | Multiplier default 100 |

`config/surfaces/base.json` is allowed to hold the six menu-close candidates. That is configuration, not a leak, as long as a package with a different hub overrides them. Packages 2 and 4 have no surface file, so they inherit `base.json`, which was calibrated around Package 1 art. Low-confidence clicks on those packages are the predicted symptom.

## Retry policy (reliability view)

Staging: Playwright retries the whole test once, **and** `spinAndRead` may click twice inside one attempt. A flake can therefore produce up to four spin attempts across two Playwright tries if each attempt uses both clicks. Each click that lands is a real stake. The late-bet 2s window is the mitigation for the inner retry, not for the Playwright retry. The outer retry starts a new test, a new page, and a new wallet top-up check.

Local launcher mode: Playwright retries 0 unless `CI` is set. The sample bet is fulfilled from `tests/fixtures/samples/dijoker-bet-response.json`. Green local runs do not prove staging.

## Resource and browser lifecycle

- Every lane is a headed Chromium when staging, unless `SGAP_PARALLEL_HEADLESS=1`. A 10-package queue is serial **per package** (`run-suite-queue.mjs` spawns the runner per package) and parallel **inside** the package (all lanes at once). `qa-suites.json` notes say “max 4 games at a time”. That cap is a comment on the QA page planner. The parallel runner itself does not enforce 4. If a hand-written lane file lists more than 4, all of them start.
- Private Playwright cache per lane (`PWTEST_CACHE_DIR`). Monitor Chrome shares one profile directory.
- Video and trace are off in parallel mode. Failure diagnosis falls back to screenshots (`only-on-failure`) and monitor JSON.
- `stop-sgap-browsers.mjs` is the explicit cleanup. Signal shutdown skips Allure. Monitor-button stop still publishes.
- Lockfile `sgap-parallel.lock.json` records the monitor URL. This audit did not test two overlapping runners.

Logging overhead: the observer stores bet bodies (redacted) and samples the HUD at 500 ms. PAD has a case whose title is collector overhead. Cost is real enough that the suite measures it. Default `SGAP_OBSERVE` is on.

## Security boundaries (defensive description only)

This audit did not perform penetration testing and does not repeat attack procedures.

- PEN specs exist and are excluded from `@regression`. Many target the **scratch hub**. Slot files are PEN-070–073. STR stress cases are skipped.
- Network interception is Playwright’s normal `page.route` / request events for assertions and for local fixture fulfillment. Staging tests are not described as a general proxy for third-party traffic.
- Secrets: env names for a Google token and for launch URLs exist. Values were not read. Learned-profile merging is supposed to drop token-shaped keys (`scripts/lib/learned-secrets.mjs`, `scripts/verify-learned-store.mjs`). The verify script was not executed here.
- Redaction module exists before observation persist. Completeness UNVERIFIED.
- QA panel and monitor bind to localhost ports 3850 and 3847. They are not described as authenticated. Do not expose them off-machine without a separate review.
- `scripts/pen/hub-probe.mjs` is commented as a temporary probe that reuses a previously captured token. The file’s presence is a handling risk if a token was ever written beside it. This audit did not open the script body and did not search the worktree for token literals. Recommendation: a human should confirm no live token is stored in that script. Not done here, to avoid printing secrets.
- Player ids are per lane so sessions do not share a wallet by accident. `SGAP_PLAYER_ID_LOCK=1` forces one id. That lock is the opposite of isolation and exists for a reason (repro). It is easy to leave on.
- AT-003’s injected HTTP 500 is a Playwright route. It does not prove the operator’s refund implementation (`at003-evidence.ts` comment).

## Duplicated responsibilities

| Concern | Copies |
|---|---|
| “Is this a bet URL?” | `matchesUrlPattern` + `PLATFORM_ROUTES` + string `includes('/api/v1/slots/bet')` inside the watcher predicate |
| Free-spin detection | `spin-payload-discovery.ts`, `backend-reader.ts` group labels, `buy-feature-verify.ts` `featureEnteredFromBody`, capture `readScatter` |
| Balance math | `verifyBalanceDelta`, observation `cents()`, `roundCents`, buy cost `before - after + win` |
| Traceability | `src/traceability` constant, `test-catalog.ts`, `docs/tests/*.md`, two copies of catalogs under `docs/` and `docs/catalogs/` |
| Readiness | Empty `src/readiness`, healer, `RoundTracker`, `waitForIdleHud`, `waitForBetQuiet` |
| Events | `GAME_EVENT_IDS` versus observation event strings |
| Rerun | `run-suite10-failures.mjs`, `isolate-gate-failures.mjs`, dozens of `*rerun*` lane files, suite queue `--case` |

## Technical debt that blocks scale

- Empty architectural layers left in the public barrel (`STATE_LAYER`, `READINESS_LAYER`, `TRACEABILITY_LAYER`, `EVENTS_LAYER`) look implemented to a reader of `src/index.ts`.
- `ISpinController` does not include `spinAndRead`, which is the method specs actually use.
- `IScratchCardController` types only `open`/`close`. The class has the real scratch API.
- Engine migration (NEXT_STEPS step E) is unfinished: direct `phaser-locate` imports remain.
- `HealableAction` is only `spin` (step C unfinished).
- AS family has config and catalog entries and no specs.
- WD family is skipped in code and described as package 7 and 11 in the suite file.
- Smoke and regression catalogs disagree on ids.
- Default turbo-on can invalidate “normal mode” assumptions.
- Package 2+ slot controllers enabled without `reelValidation` means CSF-006 style checks NOT CONFIGURED while spin checks run. That split is correct and easy to misread as “the package is fully automated”.

## Performance measurement reliability

FPS uses Phaser `postrender` plus a tolerance that rounds 59.x up to 60. A pass at “60” may be 59.5. Hitch threshold is 100 ms. Soft expects are used on at least PAD-001. Parallel lanes are headed and share the GPU with the monitor window and with each other. PAD’s own catalog says the PAD panel runs one game with nothing else running. A PAD result collected inside a multi-lane regression would not meet that condition. `qa-suites.json` puts PAD on a separate panel (`panel: pad`). The runner does not refuse a lane file that mixes PAD with other games. `config/parallel-workers` files include experiment configs; whether any mixes PAD was not fully enumerated.

Load time is annotated more often than asserted. Asset audits skip bet URLs, which is correct for static weight and wrong if someone uses them to explain spin latency.
