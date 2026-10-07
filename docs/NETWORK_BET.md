# NETWORK_BET.md

> Network-first bet response (balance / win)
> Version: 1.0.0
> Status: Implemented

---

## What “response fields for balance/win” means

When the game spins, the backend returns JSON on:

`POST https://stg-game-launcher.dijoker.com/api/v1/slots/bet`

SGAP does **not** read balance/win from the canvas. It reads them from that JSON.

### Your sample (`response.json`)

| Field | Path | Example | SGAP use |
|---|---|---|---|
| Wallet after spin | `balance` | `9721.85` | **Balance verification** |
| Total win this spin | `slot.totalWin` | `0` | **Win verification** |
| Transaction done? | `transactionState` | `"completed"` | Spin settled |
| Base win | `slot.base.win` | `0` | Optional detail |
| Bonus win | `slot.bonus.win` | `0` | Optional detail |
| Reels | `slot.area` | matrix | Future (not CSF-001) |

So “balance/win fields” = those JSON keys, not UI text on the canvas.

---

## Manifest mapping (configuration)

```json
"network": {
  "betUrlPattern": "**/api/v1/slots/bet",
  "fields": {
    "balance": "balance",
    "totalWin": "slot.totalWin",
    "transactionState": "transactionState",
    "baseWin": "slot.base.win",
    "bonusWin": "slot.bonus.win"
  }
}
```

Optional `fields.unresolvedSpin` (default `unresolvedSpin`) names the id of a feature round the game still has to play out; the round ends with `PATCH /api/v1/unresolved-spin/<id>/complete`. See "Round-in-progress readiness" in `docs/architecture/README.md`.

---

## CSF-001 flow

```
arm BetResponseWatcher
  → SpinController.spin()          (canvas click)
  → wait for **/api/v1/slots/bet
  → parse balance + slot.totalWin
  → verify shape + completed
```

---

## Devices

`metadata.devices`: `mobile,desktop`

Canvas coordinates may differ by device — calibrate separately if needed.
Network field paths are the same for both.

---

## Local vs staging

| Mode | Bet response source |
|---|---|
| `local` | Mock route + sample JSON (`tests/fixtures/samples/dijoker-bet-response.json`) |
| `staging` | Real launcher bet API |

---

## Revision history

| Version | Change |
|---|---|
| 1.0.0 | BetResponseWatcher + field mapping from DiJoker sample |
