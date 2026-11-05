# CORE_CONTRACTS.md

> Core contracts catalog
> Version: 1.1.0
> Status: Contracts implemented; Game Manifest loader implemented

---

## Purpose

Defines the Clean Architecture **ports** for SGAP.

- Location: `src/core/contracts/`
- Supporting types: `src/core/models/`, `src/core/constants/`
- **No Playwright** imports in `src/core/`
- **No business logic** — implementations live in outer layers

---

## Catalog

| Contract | File | Responsibility |
|---|---|---|
| `IController` + specialized controllers | `controller.ts` | Execute actions |
| `IControllerRegistry` | `controller.ts` | Single controller discovery |
| `IPlatform` (`openGameHost`, `openGame`) | `platform.ts` | Host/session bootstrap + launcher game open |
| `PlaywrightPlatform` | `src/platform/` | Playwright implementation of `IPlatform` |
| `IGameDriver` | `platform.ts` | iframe / game surface |
| `IGameEventObserver` / `IGameEventRegistry` | `events.ts` | Observe game events |
| `IDataSource*` / `IDataSourceRegistry` | `data.ts` | Ground-truth data |
| `IVerificationLibrary` | `verification.ts` | Validate outcomes |
| `IGameStateMachine` / `IControllerLock` | `state.ts` | State + locking |
| `IReadinessGuard` | `state.ts` | Pre-action readiness |
| `INetworkCapture` | `reporting.ts` | Network observation |
| `IUiRegistry` | `reporting.ts` | Locator resolution |
| `IGameManifestLoader` | `reporting.ts` | Load manifests from config |
| `FileGameManifestLoader` | `src/platform/manifest/` | File-based `IGameManifestLoader` implementation |
| `IExecutionTracker` | `reporting.ts` | Record by manual test ID |
| `IReporter` | `reporting.ts` | Publish execution reports |
| `ITraceabilityService` | `reporting.ts` | Manual ↔ automation map |

---

## Controllers (approved)

`spin`, `autoplay`, `buyFeature`, `bet`, `amplifyBet`, `turbo`, `menu`, `settings`, `fullscreen`

## Events (approved)

`initialize`, `offline`, `reconnect`, `sessionTimeout`, `betFailed`, `bonusStart`, `bonusEnd`, `maxWin`

## Verification kinds (approved)

`balance`, `bet`, `controllerLock`, `win`, `freeSpins`, `uiSynchronization`

---

## Assumptions

1. Monetary values are **strings** to protect currency precision (CP).
2. `ObservableWaitOptions.timeoutMs` is a **safety net only**, not primary sync.
3. `GAME_STATES` is a **minimal** set until the State Machine layer is fully specified.
4. `IGameDriver.click/readText` use **logical locator keys**, not raw CSS — UI Registry resolves them.
5. `IReporter` must never overwrite the manual Google Sheet.
6. `GameManifest.schemaVersion` is required (`1.0.0`).

---

## Revision history

| Version | Change |
|---|---|
| 1.0.0 | Initial core contracts, models, and constants |
| 1.1.0 | Game Manifest schema + `FileGameManifestLoader` |
