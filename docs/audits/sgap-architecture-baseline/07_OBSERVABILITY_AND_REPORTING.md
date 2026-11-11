# 07 — Observability and reporting

> Audit date: 2026-11-11. Read-only.

## What gets recorded per test

The fixture `_sgapObserve` (`tests/fixtures/sgap.fixture.ts`) starts `ObservationRecorder` unless `SGAP_OBSERVE=0`.

| Stream | Source | Persistence |
|---|---|---|
| `network` | `page` request events | Method, URL, status, timing, bodies and headers on bet/buy/initialize/failures. Successful static assets are counted, not stored in full. `injected` marks a Playwright route (`x-sgap-injected`), not the backend |
| `console` | `console`, `pageerror`, unhandled rejection | Stacks included for exceptions |
| `websocket` | `page.on('websocket')` | Open/sent/received/error/close. SignalR targets noted. Keep-alives counted, not stored. Payloads persisted as short previews (architecture README: 300 characters) |
| `event` | Derived from traffic plus the interaction journal, plus `observationFor(page)?.event(...)` | Names such as `spin-completed`, `bet-failed`, `refund-received`, `buy-feature`, `server-balance-changed`. Not the unused `GAME_EVENT_IDS` enum |
| `balance` | HUD label from the surface profile, server amount from the last bet/buy/initialize, host launcher, delta | Sampler every `SGAP_OBSERVE_BALANCE_MS` (default 500) and on each bet response |
| `resource` | Optional `AssetAudit` when `SGAP_RESOURCES=1` | MIME groups, hashes, wasted bytes |

Redaction (`src/observability/redact.ts`) runs before store or stream: tokens, cookies, auth headers, JWTs, secret query params. This audit did not print redacted samples and did not verify completeness against every header name. The module’s existence is IMPLEMENTED. Its coverage of every secret shape is UNVERIFIED.

Attachments after the test:

- `monitor-summary.txt` — counts and a merged timeline
- `balance-timeline.txt`
- `monitor-worker.json`
- `interactions.txt` / `interactions.json` from `src/reporting/interaction-journal.ts`
- Allure labels `locatorStrategy`, `selfHealing`, `lowestConfidence`

Interaction record shape: `{action, strategy, confidence, fallback, point, detail}`.

| Strategy | Confidence | Meaning |
|---|---|---|
| `phaser`, `dom` | high | Scene graph or DOM |
| `vision`, `manifest` | medium | Colour blob or manifest ratio |
| `candidate`, `point` | low | Surface ladder or an explicit point |

A low confidence on a passing test is defined as a calibration hint, not a failure (`docs/architecture/README.md`).

Click tracker (`src/driver/click-tracker.ts`) is a separate overlay, default on, panel off unless `SGAP_CLICK_TRACKER_PANEL=1`.

## Live monitor

`scripts/lib/sgap-worker-monitor-server.mjs`:

| Route | Role |
|---|---|
| `/` | Worker board (`sgap-worker-monitor.html`) |
| `/reader` | Backend reader HTML |
| `/observe` | Timeline / network / console / websocket / events / balance |
| `GET /api/status` | Lane status |
| `GET /api/observe`, `GET /api/observe/session` | Observation pull |
| `POST /api/observe`, `POST /api/event` | Push from workers |
| `POST /api/stop` | Cancel lanes |

Default bind `127.0.0.1:3847`, or the next free port up to +20. The lane reporter (`tests/support/parallel-lane-reporter.ts`) posts through `tests/support/worker-monitor-client.ts`. The in-page HUD (`installWorkerMonitorOverlay`) stays off unless `SGAP_INPAGE_MONITOR=1`.

`SGAP_MONITOR_URL` must be set for the fixture to push. The parallel runner sets it when it starts the server. A bare `playwright test` does not, so those runs have no live board unless something else exported the URL.

Backend reader (`SGAP_BACKEND_READER`) turns on when the monitor URL is set, unless disabled. It is a debugging view of responses. `SGAP_READER_KEEP` default 50. This audit did not open reader storage and did not copy payloads.

## Allure

| Piece | Behavior |
|---|---|
| Reporter | `allure-playwright` in `playwright.config.ts` |
| Results dir | `SGAP_ALLURE_DIR`, default `allure-results`, or `resultsRoot()/allure-results` when `SGAP_RUN_DIR` is set. Parallel lanes use `allure-results/w{id}` |
| Generate | `scripts/generate-allure-report.mjs` |
| Publish | `scripts/publish-allure-report.mjs` calls `publishAllureReport`. Writes `allure-history/run-YYYYMMDD-HHmmss[-runId]/`, copies to `allure-report/`, writes `allure-history/index.html`, serves port **5055** (`SGAP_ALLURE_HISTORY_PORT`) |
| Skip | `SGAP_SKIP_ALLURE=1`. Open skipped by `SGAP_SKIP_ALLURE_OPEN=1` or `SGAP_ALLURE_OPEN=0` |
| Run metadata | Each folder gets `sgap-run.json` (`runId`, `owner`, `label`, `suiteType`) when the publisher is given those fields |

On 2026-11-11 the tree contained **326** `run-*` folders. They are historical evidence with unequal scope. See the dated table in `05_TEST_COVERAGE_AND_TRACEABILITY.md`. Publishing does not delete prior runs. Lane result dirs **are** wiped at the start of a parallel run (`resetAllureWorkerDirs`). That wipe is the current attempt’s raw results, not `allure-history/`.

SGAP does not set Allure `historyId` itself. The SDK computes it. `applySgapAllureMetadata` (`tests/support/sgap-allure.ts`) sets a **non-excluded** `gameId` parameter so the history id differs per game. `src/verification/smoke-at003-historyid.ts` checks `getTestResultHistoryId` from `allure-js-commons`. That file is a unit check of the id inputs, not a statement that production history is clean.

Retries: Playwright retry is a new result. Monitor session id includes `testInfo.retry`. Allure’s default history grouping follows the history id, which does not include the retry index. Two attempts of the same test on the same game collapse in history trends and remain separate results inside one launch. Exact Allure retry presentation depends on the allure-playwright version (`^3.2.2`). This audit did not open a retried result JSON to confirm the attempt parameter. UNKNOWN at the JSON-field level (F-035).

## Other reporters

| Symbol | Output |
|---|---|
| `InMemoryExecutionTracker` | In-process records. See key question F-032 |
| `JsonFileReporter` | `test-results/execution-report.json` with `overwritesManualSheet: false` |
| `SheetAppendReporter` | Always writes local CSV `test-results/sheet-execution-append.csv`. Columns from `config/reporting/sheet-execution.json`: manualTestId, status, startedAt, finishedAt, browserProject, errorMessage, verificationSummary |
| Google append | POST `spreadsheets.values.append` with `INSERT_ROWS` only when spreadsheet id and access token are set. Throws if the execution tab name equals the manual tab name |
| `createDefaultExecutionReporters` | Composite of JSON + sheet |
| Playwright HTML | `playwright-report` unless parallel mode, which uses the lane reporter instead |
| Playwright JSON | `SGAP_RESULTS_JSON` or `resultsRoot()/results.json`. Lanes write `w{id}-results.json` |

`pnpm test:report` is `playwright show-report` (HTML), not Allure.

Screenshots: default `only-on-failure` (`SGAP_SCREENSHOT`). Video off in parallel, else `retain-on-failure`. Trace off in parallel, else `on-first-retry` (`SGAP_TRACE`). Parallel runs therefore drop trace and video unless env overrides. That is a deliberate cost tradeoff and a forensic gap for lane failures.

`SGAP_SCREENSHOT_TOAST=1` is set by the parallel runner when headed and visible (`stable-screenshot.ts` only acts when the flag is `1`).

## Dashboard

`scripts/qa-testing-page.mjs` (package script `qa`), default port **3850**.

- HTML: `scripts/lib/sgap-dashboard.html`
- Routes include `/dashboard`
- Analytics: `scripts/lib/test-analytics.mjs` reads published history
- The Allure history index links to `http://127.0.0.1:3850` when served on 5055
- Access rules: `scripts/lib/qa-access.mjs` (local bind). This audit did not review that file for every header. It is a localhost panel, not an authenticated multi-tenant service, based on the module name and the architecture of the runner. Confirm before exposing it. Assumption, not a pentest.

Execution manager (`scripts/lib/execution-manager.mjs`) plans suite-queue runs and PAD runs. It can set `SGAP_MONITOR_PORT=0`.

## Identity

| Identity | Where | Stable across history? |
|---|---|---|
| Manual test id | Spec title and `manualTestId` | Yes, if catalogs do not renumber. Smoke vs regression already collide (see `05`) |
| gameId | Manifest, Allure parameter | Yes per title. Required for per-game history |
| packageId | Manifest metadata | Yes as a string `package-N`. Suite file uses numeric keys. Join them explicitly |
| Worker / lane | `SGAP_WORKER_ID`, project name `w{id}-{category}` | **No.** Lane ids are layout, not games. Do not use worker id as a historical key |
| Player | Lane `playerId` + tester suffix | Session isolation key. Not a test identity |
| Run folder | `run-YYYYMMDD-HHmmss[-runId]` | Unique per publish |
| Spin / round | `unresolvedSpin` only for feature rounds, and not on the Allure result as a first-class field | Not a reporting key |

## Can reporting support per-game, per-session, and per-mechanic analytics without changing historical identity?

**Per-game:** yes for Allure launches that included the `gameId` parameter. Launches from before that parameter existed will not split the same way. This audit did not find the commit that introduced the parameter, so the cutoff date is UNKNOWN. Do not rewrite old results to add it. New analytics should treat missing `gameId` as its own bucket.

**Per-session:** a session in SGAP is a Playwright test (one browser context) plus optional retry. The monitor session id is test-scoped. There is no durable session id in `sgap-run.json` (that file has `runId`, `owner`, `label`, `suiteType` only, on the sample `run-20261110-202542-regr`). Wallet player id is in the lane config and in runtime logs, not in the Allure summary widget. Per-session analytics would need the result JSON parameters or the monitor attachment. Attachments are inside the run folder. They are not a query API.

**Per-mechanic:** there is no mechanic dimension on the Allure result. Mechanics are implied by the test id (FS-008 means retrigger **if** the spec still tests retrigger). A passing CSF-001 is not a passing ways-win. Building per-mechanic analytics by parsing test ids will inherit catalog collisions and the gap between `AUTOMATED_REGRESSION_IDS` and real files. The observation JSON has event names (`buy-feature`, `spin-completed`) that could be aggregated, but only for runs that attached `monitor-worker.json`, and only with `seq` correlation inside one test. Historical identity of the **test** can stay stable while a new analytics job reads attachments. Changing Allure `historyId` to include a mechanic would **split** history. The safe approach is a side index, not a new history id.

**Gameplay statistics that already exist:** balance timeline deltas, bet/fail/refund event counts, FPS verdicts inside PAD attachments, asset duplicate groups, interaction confidence. They are per test artifact, not a warehouse. `test-analytics.mjs` is the dashboard reader. This audit did not execute it and did not inventory every chart it draws.

## Error classification

`failureKind` / `GameDefectError` live under `src/controllers/strategy/`. A defect is not retried by `spinAndRead`. Allure categories are the Allure default plus whatever `categories.json` the generator writes. This audit did not open `allure-report/data/categories.json` to list custom regexes. If a custom category file exists in the generator, it should be read before relying on category trends. Marked UNKNOWN (F-036) rather than inventing category names.

Failure reports in `tests/support/failure-report.ts` still know the platform bet URL (listed as a leak in `GAME_SPECIFIC.md`). They name open rounds and open buy panels when the eye says so (`NEXT_STEPS` Done rows). That naming is a reporting feature from October 2026. Whether every current failure path uses it was not re-audited line by line.
