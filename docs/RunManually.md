# Run tests manually (watch in the browser)

Use this guide when you want to **see the test run live** in Chrome — including the red hand click indicator on staging.

Shell: **Git Bash** (or any terminal) from the project root:

```bash
cd ~/Documents/SlotGameAutomation
```

> `npx pnpm` alone only prints help — always include a command after it (e.g. `npx pnpm test`).

---

## First time only

```bash
npx pnpm install
npx pnpm exec playwright install chromium
```

---

## Headless runs (no visible browser)

These are for CI-style runs. The browser runs in the background.

```bash
# Local (offline launcher, all specs)
npx pnpm test

# Staging (live game, still headless unless you add --headed)
SGAP_LAUNCHER_MODE=staging npx pnpm test:staging
```

---

## Manual run — watch in the browser (recommended)

Add **`--headed`** so Chrome opens and you can watch each step.

### One short demo (turbo + spin)

Good first test — a few clicks, finishes in ~30–60s on staging.

```bash
SGAP_LAUNCHER_MODE=staging npx pnpm exec playwright test tests/specs/tm/TM-001.spec.ts --project=chromium --headed --workers=1
```

**What you should see**

1. Chrome opens
2. DiJoker staging launcher loads
3. Sugar Wonderland opens in the game iframe
4. The **red hand pointer** appears at each automated click
5. Terminal prints `passed` or `failed` when done

> **Tip:** Do not close the browser yourself — let the test finish.

### Optional: click log panel (right side of screen)

```bash
SGAP_LAUNCHER_MODE=staging SGAP_CLICK_TRACKER_PANEL=1 npx pnpm exec playwright test tests/specs/tm/TM-001.spec.ts --project=chromium --headed --workers=1
```

### Run a different spec

Swap the file path:

```bash
# Core spin
SGAP_LAUNCHER_MODE=staging npx pnpm exec playwright test tests/specs/csf/CSF-001.spec.ts --project=chromium --headed --workers=1

# Menu
SGAP_LAUNCHER_MODE=staging npx pnpm exec playwright test tests/specs/mn/MN-001.spec.ts --project=chromium --headed --workers=1

# Bet control
SGAP_LAUNCHER_MODE=staging npx pnpm exec playwright test tests/specs/bc/BC-001.spec.ts --project=chromium --headed --workers=1
```

### Full controller walkthrough (many clicks in one session)

```bash
SGAP_LAUNCHER_MODE=staging npx pnpm demo:controllers:staging
```

### Interactive picker (Playwright UI)

Pick a test from a GUI, then run it with the browser visible:

```bash
SGAP_LAUNCHER_MODE=staging npx pnpm exec playwright test --ui
```

---

## Click indicator

The red hand pointer appears on **every click** (canvas spin, turbo, launcher buttons, etc.) by default.

| Variable | Effect |
|----------|--------|
| *(default)* | Hand pointer ON at each interaction |
| `SGAP_CLICK_TRACKER_PANEL=1` | Also show a click log panel on the right |
| `SGAP_CLICK_TRACKER=0` | Turn off the hand pointer |

Asset: `assets/click-indicator.png` (transparent red hand, overlay above the game iframe).

> Use **`--headed`** to watch the pointer in the browser. Headless runs still record clicks but you will not see them.

---

## Useful flags

| Flag | Purpose |
|------|---------|
| `--headed` | Show the browser window |
| `--workers=1` | One test at a time (easier to follow) |
| `--project=chromium` | Use Chromium (default project) |
| `--retries=0` | No retries (see the first failure immediately) |
| `SGAP_LAUNCHER_MODE=staging` | Live staging launcher + game (required for real game UI) |

Example with no retries:

```bash
SGAP_LAUNCHER_MODE=staging npx pnpm exec playwright test tests/specs/tm/TM-001.spec.ts --project=chromium --headed --workers=1 --retries=0
```

---

## Full regression / gate (headed on staging)

```bash
# Sugar wave-0 gate (40 specs, ordered, headed on staging)
SGAP_LAUNCHER_MODE=staging npx pnpm test:sugar:gate

# Full staging regression sweep
SGAP_LAUNCHER_MODE=staging npx pnpm test:regression:staging

# 4-worker parallel (CSF / AP / BF / TM — 2×2 window grid)
# Assignments: config/parallel-workers.json
SGAP_LAUNCHER_MODE=staging npx pnpm test:parallel:staging
```

> These run many tests back-to-back. Use a **single spec** first if you only want to watch one flow.

---

## Allure report (after a test run)

```bash
npx pnpm allure:generate
npx pnpm allure:open
```

---

## Optional: install pnpm globally

Skip the `npx` prefix:

```bash
npm install -g pnpm
pnpm test
```
