# BET_CONTROLLER.md

> Bet Controller
> Version: 1.0.0
> Status: Implemented

---

## Purpose

`BetController` changes stake (`increase` / `decrease` / `setBet`). It is **not** a test case.

---

## Behavior

| Manifest `metadata.rendering` | Action |
|---|---|
| `canvas` | `clickCanvas('betPlus' \| 'betMinus')` |
| `dom` | `click('betPlus' \| 'betMinus')` via UI Registry |

`getBet()` returns the last observed/tracked amount (seed with `observeBet()` from initialize or bet request).

`metadata.betStep` (default `0.2`) updates the tracked amount after +/- clicks.

---

## Sugar Wonderland

```json
"betMinus": { "x": 0.72, "y": 0.78 },
"betPlus": { "x": 0.9, "y": 0.78 }
```

Calibrate with `pnpm calibrate:bet` (confirms via spin request `bet` field).

---

## Fixture usage

```ts
await sgapSession.bet.increase();
const stake = await sgapSession.bet.getBet();
```
