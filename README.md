# SGAP — Slot Game Automation Platform

Professional QA automation framework for iframe-based Phaser slot games.

## Documentation

- [docs/README.md](docs/README.md) — folder map (handbook, architecture, catalogs, guides)
- [docs/architecture/README.md](docs/architecture/README.md) — start here before adding game logic

## Stack

- TypeScript
- Playwright (Chrome + Edge)
- pnpm

## Setup (each QA PC)

Every tester runs SGAP on their own PC: tests, browsers and reports stay local,
and everyone gets the same test cases from this repository.

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

The panel only listens on this PC. Each run (`RUN-0001`, `RUN-0002`, …) gets its
own results folder, worker monitor and staging players; runs go side by side as
far as the PC's CPU/RAM allow and queue when it is full. Limits are in
`config/qa-server.json` (`maxBrowsers`, `maxConcurrentRuns`, `memoryPerBrowserMB`,
`reserveMemoryMB`, `cpuCoresPerBrowser`, `whenFull`); override them in
`.sgap/qa-server.json`.

Get the latest test cases and fixes:

```bash
git pull
npx pnpm install
```
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
