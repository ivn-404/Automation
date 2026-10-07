# ALLURE_REPORTING.md

> Allure Report integration for SGAP Playwright tests
> Version: 1.0.0

---

## Purpose

[Allure Report](https://allurereport.org/) is the primary HTML test report for SGAP. It complements (does not replace) the existing SGAP execution tracker outputs (JSON + append-only CSV/Sheet).

Playwright's built-in HTML report remains available via `pnpm test:report`.

---

## Setup

Dependencies are in `package.json`:

- `allure-playwright` — Playwright reporter (writes `allure-results/` after each run)
- `allure-commandline` — generates the static HTML report (**requires Java 17+** on `PATH`)

Install Java (Windows example):

```bash
winget install Microsoft.OpenJDK.21
```

Verify: `java -version`

---

## Run

```bash
# Local gate + Allure results
pnpm test

# Generate HTML from raw results
pnpm allure:generate

# Open in browser
pnpm allure:open

# One-shot: test + generate
pnpm test:allure
```

Staging:

```bash
SGAP_LAUNCHER_MODE=staging pnpm exec playwright test --project=chromium --headed --workers=1
pnpm allure:generate && pnpm allure:open
```

---

## Metadata

`tests/support/sgap-allure.ts` maps each manual test ID (e.g. `CSF-001`) to Allure labels:

| Allure field | SGAP source |
|---|---|
| `epic` | `SGAP` |
| `parentSuite` | `Regression` (from `docs/RegressionTestCases.md`) |
| `feature` / `suite` | Category name (e.g. Core Spin Flow) |
| `story` / `displayName` | Manual test ID (+ sheet title when known) |
| `manualTestId` label | Manual test ID |
| `automationStatus` | `automated` or `pending` |
| `gameId` label | Manifest game ID |
| `launcherMode` label | `SGAP_LAUNCHER_MODE` |

Pending catalog rows (not yet automated) are emitted by `tests/specs/regression/regression-pending.spec.ts` so the full Regression sheet appears in Allure.

---

## Regression (Sugar Wonderland)

```bash
# Staging regression + Allure HTML + open browser
SGAP_LAUNCHER_MODE=staging pnpm test:regression:allure

# Staging only (writes allure-results/)
SGAP_LAUNCHER_MODE=staging pnpm test:regression:staging
pnpm allure:generate && pnpm allure:open
```

Smoke sheet (`docs/SmokeTestingTestCases.md`) is separate — use it when the suite switches to smoke.

---

## Artifacts

| Path | Purpose |
|---|---|
| `allure-results/` | Raw result JSON (gitignored) |
| `allure-report/` | Generated HTML (gitignored) |
| `playwright-report/` | Playwright HTML (still available) |
| `test-results/` | JSON summary, CSV append, artifacts |

---

## CI note

In CI, run `pnpm test`, then `pnpm allure:generate`, then publish `allure-report/` as a build artifact.
