# REPOSITORY_STRUCTURE.md

> Framework folder map
> Version: 1.0.0
> Status: Approved (Option 1 — no Page Object `pages/` layer)

**Start here for day-to-day architecture:** [docs/architecture/README.md](./architecture/README.md)

---

## Purpose

Defines the responsibility of every SGAP folder.

This document maps common automation terms to the **approved** architecture.
It does **not** introduce Page Objects. Controllers execute actions; UI Registry holds locators;
host/iframe entry lives in Platform and Game Driver.

---

## Terminology map

| Common term | SGAP location | Notes |
|---|---|---|
| controllers | `src/controllers/` | Action API — not test cases |
| locators | `src/ui/` + `src/ui/registry/` | UI Registry — not hard-coded in tests |
| verification | `src/verification/` | Outcome validation |
| reporting | `src/reporting/` | Execution Tracker + report outputs |
| state-machine | `src/state/` | Game state + controller locking |
| game-manifest | `config/manifests/` | Configuration only |
| utils | `src/shared/` | Cross-cutting framework helpers |
| config | `config/` | Environments, manifests, Playwright notes |
| pages (POM) | **Not used** | Rejected — would duplicate Controllers |
| host / shell entry | `src/platform/` + `src/driver/` | Navigate, iframe attach, bootstrap |

---

## Folder responsibilities

### `config/`

Configuration over duplication. Game and environment variance live here — not in framework code.

| Path | Responsibility |
|---|---|
| `config/environments/` | Per-environment settings (URLs, timeout profiles, env references). No secrets in git. |
| `config/manifests/` | **Game Manifests** — per-game capabilities, locator keys, controller availability. Data, not logic. |
| `config/playwright/` | Playwright config notes / future fragments. Global runner stays in root `playwright.config.ts`. |

### `docs/`

Knowledge system (source of truth). Constitution, history, handbook, and this structure map.

### `src/core/`

Clean Architecture inner ring. No Playwright imports. Outer layers depend on this; this depends on nothing framework-specific.

| Path | Responsibility |
|---|---|
| `src/core/contracts/` | Interfaces/ports (`IController`, `IGameDriver`, etc.) |
| `src/core/models/` | Domain types (bet, balance, session, test metadata) |
| `src/core/constants/` | Shared enums and test category codes (CSF, BF, AP, …) |

### `src/platform/`

Platform Layer. Browser/session bootstrap, environment loading, framework lifecycle entry.
Host navigation starts here — **not** a Page Object model.

### `src/driver/`

Game Driver. iframe attach, Phaser/WebGL interaction surface, game-agnostic driver API.
Uses manifests and UI Registry — no package-specific branches in core.

### `src/controllers/`

Controller Layer. Reusable actions: Spin, Autoplay, Buy Feature, Bet, Amplify Bet, Turbo, Menu, Settings, Fullscreen.

| Path | Responsibility |
|---|---|
| `src/controllers/` | Controller implementations (one per capability) |
| `src/controllers/registry/` | **Controller Registry** — single discovery surface; no duplicate controllers |

Controllers execute actions. They are not test cases.

### `src/events/`

Game Events observation: Initialize, Offline, Reconnect, Session Timeout, Bet Failed, Bonus Start/End, Max Win.

| Path | Responsibility |
|---|---|
| `src/events/` | Event observers / handlers |
| `src/events/registry/` | **Event Registry** |

### `src/data/`

Data Sources: bet response, balance, history, session, wallet.
Ground truth for verification — not UI scraping when network/session data is available.

### `src/verification/`

Verification Library. Validates outcomes: balance, bet, controller lock, win, free spins, UI synchronization.
Reusable assertions only — no controller action logic.

### `src/network/`

Network Layer. Request/response capture and validation supporting data sources and verification.

### `src/state/`

State Machine and controller locking. Game states, allowed/blocked transitions, lock/unlock rules, spam protection.

### `src/readiness/`

Readiness Detection. Init guards, controller availability, network/frame stability before actions.

### `src/ui/`

UI Registry and locator definitions. Locator *keys* resolve via registry + game manifest.
Tests and controllers must not hard-code game-specific selectors.

| Path | Responsibility |
|---|---|
| `src/ui/` | Locator definitions and helpers |
| `src/ui/registry/` | **UI Registry** — central lookup |

### `src/reporting/`

Reporting Layer. Execution Tracker and outputs: Playwright HTML, JSON summary, Google Sheet execution report (never overwrite the manual Sheet), evidence (screenshots, video, traces, logs).

### `src/traceability/`

Manual ↔ automation mapping. One automated test ↔ one manual test ID. Traceability Matrix support.

### `src/shared/`

Cross-cutting framework utilities (logging helpers, small pure helpers).
Must not become a dumping ground for game logic or controllers.

### `src/ai/`

Reserved AI Intelligence Layer. Observation/recommendation only. Not autonomous. Not a runtime dependency.

### `src/index.ts`

Public framework entry. Re-exports approved layers only. Tests and game-specific code are not exported here.

### `tests/`

Automation specs and wiring — not framework core.

| Path | Responsibility |
|---|---|
| `tests/fixtures/` | Playwright fixtures that wire platform, driver, controllers |
| `tests/specs/` | Specs mapped to manual test IDs (CSF-001, …) |
| `tests/support/` | Test-only helpers — must not leak into `src/` |

### `.github/workflows/`

CI/CD placeholders (typecheck, test, report upload).

---

## Explicitly out of scope

- Classic Page Object `pages/` folder
- Package-specific framework logic
- Duplicate controllers
- Hardcoded waits as the primary sync strategy
- Business / game logic in this structure milestone

---

## Revision history

| Version | Change |
|---|---|
| 1.0.0 | Initial approved structure map (Option 1 — no POM pages) |
