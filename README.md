# SGAP — Slot Game Automation Platform

Professional QA automation framework for iframe-based Phaser slot games.

## Documentation

Read before contributing:

1. [AI_PROJECT_CONTEXT.md](docs/AI_PROJECT_CONTEXT.md)
2. [SGAP_PROJECT_HISTORY.md](docs/SGAP_PROJECT_HISTORY.md)
3. [SGAP_ENGINEERING_HANDBOOK.md](docs/SGAP_ENGINEERING_HANDBOOK.md)
4. [REPOSITORY_STRUCTURE.md](docs/REPOSITORY_STRUCTURE.md) — folder responsibilities
5. [CORE_CONTRACTS.md](docs/CORE_CONTRACTS.md) — core ports / interfaces
6. [GAME_MANIFEST.md](docs/GAME_MANIFEST.md) — game manifest schema + loader
7. [UI_REGISTRY.md](docs/UI_REGISTRY.md) — how to resolve and use locators
8. [GAME_DRIVER.md](docs/GAME_DRIVER.md) — iframe attach and Playwright driver
9. [PLATFORM.md](docs/PLATFORM.md) — launcher host + open game flow
10. [FIXTURES.md](docs/FIXTURES.md) — Playwright test fixtures
11. [SPIN_CONTROLLER.md](docs/SPIN_CONTROLLER.md) — Spin controller (DOM + canvas)
12. [BET_CONTROLLER.md](docs/BET_CONTROLLER.md) — Bet controller (+/- stake)
13. [TURBO_CONTROLLER.md](docs/TURBO_CONTROLLER.md) — Turbo toggle
14. [AUTOPLAY_CONTROLLER.md](docs/AUTOPLAY_CONTROLLER.md) — Autoplay start/stop
15. [BUY_FEATURE_CONTROLLER.md](docs/BUY_FEATURE_CONTROLLER.md) — Buy feature panel/purchase
16. [MENU_CONTROLLER.md](docs/MENU_CONTROLLER.md) — Menu open/close
17. [CSF-001.md](docs/tests/CSF-001.md) — first manual ↔ automation mapping
18. [CSF-002.md](docs/tests/CSF-002.md) — consecutive spins
19. [BC-001.md](docs/tests/BC-001.md) — increase bet
20. [BC-002.md](docs/tests/BC-002.md) — decrease bet
21. [TM-001.md](docs/tests/TM-001.md) — turbo mode
22. [AP-001.md](docs/tests/AP-001.md) — autoplay
23. [BF-001.md](docs/tests/BF-001.md) — buy feature panel
24. [BF-002.md](docs/tests/BF-002.md) — buy feature confirm
25. [MN-001.md](docs/tests/MN-001.md) — menu
26. [ALLURE_REPORTING.md](docs/ALLURE_REPORTING.md) — Allure HTML reports
27. [NETWORK_BET.md](docs/NETWORK_BET.md) — bet response balance/win fields

## Stack

- TypeScript
- Playwright (Chrome + Edge)
- pnpm

## Shared QA server (one office PC for the whole team)

One always-on PC runs the panel; every QA opens it in a browser and signs in.
Each run is an independent execution (`RUN-0001`, `RUN-0002`, …) with its own
results folder, worker monitor and staging players (`<Game>_<suite>_<account>`).
Runs go side by side as far as the PC's CPU/RAM allow; when it is full, new runs
queue and show the actual reason (e.g. "needs 1.8 GB RAM, 1.2 GB free").
There is no limit on the number of accounts or runs in the code.

On the server PC (after the per-PC setup below):

```bash
npx pnpm qa:users add ivan --role admin       # prints a password once
npx pnpm qa:users add ana                     # tester (default role)
npx pnpm qa:server                            # listens on the network
```

Teammates open `http://<server-ip>:3850/` and sign in. Testers start runs and
stop their own; admins stop any run; viewers only watch. Manage accounts any time
with `npx pnpm qa:users list | passwd | role | disable | remove` (no restart needed).

### Run on: My PC (tests run on the tester's own computer)

A web page cannot start programs on the visitor's PC, so each tester installs the
small SGAP Agent once. After that they keep using the server's link: with
**Run on: My PC** the run goes to their agent, and the browsers, the worker monitor
windows, the terminal and the Allure report all open on their PC. The dashboard
still lists the run with its live log and worker status. **Server PC** runs it on
the server as before.

1. Sign in to the dashboard and click **Set up my PC** in the Test runner. This
   downloads `SGAP-setup.cmd` with the server address filled in.
2. Open it (if Windows warns: More info, then Run anyway). It installs Git,
   Node.js and Java with winget when missing, downloads the project to
   `%USERPROFILE%\SGAP-Automation`, installs packages and the test browser, then
   asks for the tester's SGAP name and password (about 10 minutes, once).
3. The **SGAP Agent** window opens and starts by itself at every Windows sign-in
   (it runs `git pull` first, so test cases stay current). Keep it open while testing.

The agent only accepts a test selection (suite or families, games, case, evidence
options) and plans it from its own copy of the repository; the server cannot send
it commands or files. Its token is stored hashed in `.sgap/qa-agents.json` on the
server and stops working when the account is removed, disabled, set to viewer or
given a new password. Manual use: `npx pnpm qa:agent setup --server http://<server-ip>:3850`,
`npx pnpm qa:agent` (run), `npx pnpm qa:agent remove`.

Capacity: `config/qa-server.json` (`maxBrowsers`, `maxConcurrentRuns`,
`memoryPerBrowserMB`, `reserveMemoryMB`, `cpuCoresPerBrowser`, `whenFull`).
Override per server in `.sgap/qa-server.json`; a bigger PC raises the limits
automatically. Reports for every run are under Reports (`/allure/`) with the
run id and who started it.

Keep the server PC awake, allow Node.js through Windows Firewall (Private
network), and start `npx pnpm qa:server` at logon (Task Scheduler) so it survives
reboots. Accounts and limits live only on the server in `.sgap/` (git-ignored).

## Setup (each QA PC)

Every tester can also run SGAP on their own PC: tests, browsers and reports stay
local, and everyone gets the same test cases from this repository.

Install once: [Git](https://git-scm.com/download/win), [Node.js 20+](https://nodejs.org/),
Google Chrome, Microsoft Edge and [Java 17+](https://adoptium.net/) (for Allure reports).

```bash
git clone https://github.com/ivn-404/Automation.git
cd Automation
npx pnpm install
npx playwright install chromium
```

Create a `.env` file in the project folder with your name (letters/digits only).
It is added to every staging player id, so testers on different PCs never share
a player, wallet or session:

```bash
SGAP_TESTER=Ana
```

Start the control panel (opens http://127.0.0.1:3850/):

```bash
npx pnpm qa
```

Get the latest test cases and fixes:

```bash
git pull
npx pnpm install
```

Optional — let someone else watch or drive your PC's panel over the LAN:
`npx pnpm qa:share` (control) or `npx pnpm qa:share:view` (watch only).

## Commands

```bash
pnpm typecheck    # Type-check framework, fixtures, and Playwright config
pnpm build        # Compile src/ to dist/
pnpm test         # Run all projects (fixture-smoke uses local launcher)
pnpm test:chrome  # Chrome project only
pnpm test:edge    # Edge project only
pnpm test:allure  # Run tests + generate Allure HTML report
pnpm allure:open  # Open generated Allure report in browser

# Live DiJoker staging (BF last; workers=1 — avoids free-spin pollution)
SGAP_LAUNCHER_MODE=staging pnpm test:staging
SGAP_LAUNCHER_MODE=staging pnpm test:chrome
```

## Structure

| Path | Purpose |
|------|---------|
| `config/environments/` | Environment-specific settings |
| `config/manifests/` | Per-game configuration (not framework code) |
| `config/playwright/` | Playwright config notes and future fragments |
| `docs/` | Project knowledge system (source of truth) |
| `src/core/` | Contracts, models, constants (inner ring) |
| `src/platform/` | Platform layer — browser/session bootstrap |
| `src/driver/` | Game driver — iframe/Phaser interaction |
| `src/controllers/` | Controller layer — reusable actions |
| `src/events/` | Game event observation |
| `src/data/` | Data sources (balance, bet response, etc.) |
| `src/verification/` | Verification library |
| `src/network/` | Network capture and validation |
| `src/state/` | State machine and controller locking |
| `src/readiness/` | Readiness detection guards |
| `src/reporting/` | Execution tracker and report outputs (JSON, CSV/Sheet append) |
| `src/traceability/` | Manual ↔ automation mapping |
| `src/ui/` | UI registry and locators |
| `src/ai/` | Reserved AI layer (not implemented) |
| `src/shared/` | Cross-cutting framework utilities |
| `tests/fixtures/` | Playwright custom fixtures |
| `tests/specs/` | Automated test specs (manual ID mapped) |
| `tests/support/` | Test-only helpers (not part of framework) |
