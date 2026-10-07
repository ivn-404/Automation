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

## Setup

```bash
pnpm install
```

Chrome and Edge must be installed on the host machine (Playwright uses `channel: 'chrome'` and `channel: 'msedge'`).

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
