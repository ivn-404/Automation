# SPIN_CONTROLLER.md

> Spin Controller
> Version: 1.1.0
> Status: Implemented

---

## Purpose

`SpinController` executes spin actions with **observable** start/complete synchronization.
It is **not** a test case. Specs call it through the Controller Registry / fixtures.

No package-specific or game-specific logic — DOM vs canvas and network URLs come from the game manifest.

---

## API

| Method | Role |
|---|---|
| `clickSpin(options?)` | Clicks spin (canvas action `spin` or DOM `spinButton`) |
| `waitForSpinStart(options?)` | Waits for bet/spin **request** (`manifest.network.betUrlPattern`) |
| `waitForSpinComplete(options?)` | Waits for bet/spin **response** (same pattern, OK status) |
| `isSpinLocked()` | Whether this controller holds the in-progress lock |
| `spin(options?)` | Arms start+complete → `clickSpin` → awaits both (canvas may clear config-driven overlays first) |

Arm `waitForSpinStart` / `waitForSpinComplete` **before** or **concurrent with** `clickSpin` so the network events are not missed.

```ts
await Promise.all([
  sgapSession.spin.waitForSpinStart(),
  sgapSession.spin.waitForSpinComplete(),
  sgapSession.spin.clickSpin(),
]);
```

Or:

```ts
await sgapSession.spin.spin();
```

Do **not** use `waitForTimeout` — timeouts are only safety nets on `waitForRequest` / `waitForResponse`.

---

## Behavior

| Manifest `metadata.rendering` | `clickSpin` |
|---|---|
| `canvas` | `driver.clickCanvas('spin')` |
| `dom` / omitted | `driver.click('spinButton')` |

Network observation requires `page` + `manifest.network` (wired by fixtures).

---

## Fixture usage

```ts
import { test, expect } from '../fixtures/index.js';

test('CSF-001', async ({ sgapSession }) => {
  expect(await sgapSession.spin.isSpinLocked()).toBe(false);
  await sgapSession.spin.spin({ timeoutMs: 45_000 });
});
```

---

## Assumptions

1. Spin start/complete are observed via network (config URL pattern), not hardcoded sleeps.
2. Controller lock is in-memory on the Spin instance (shared State Machine is a later layer).
3. Canvas coordinates live in the manifest — calibrate per game/device.

---

## Revision history

| Version | Change |
|---|---|
| 1.1.0 | `clickSpin`, `waitForSpinStart`, `waitForSpinComplete`, `isSpinLocked` |
| 1.0.0 | SpinController + canvas click path |
