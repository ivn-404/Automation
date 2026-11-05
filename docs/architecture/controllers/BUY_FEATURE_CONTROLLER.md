# BUY_FEATURE_CONTROLLER.md

> Buy Feature Controller
> Version: 1.0.0

---

## Purpose

`BuyFeatureController` opens the buy-bonus panel and optionally confirms purchase.

```ts
await sgapSession.buyFeature.openPanel();
// dismiss without purchase
await sgapDriver.clickCanvas('buyFeatureCancel');

// or full purchase when confirm is configured
await sgapSession.buyFeature.buy();
```

When `metadata.buyFeatureNeedsConfirm` is `"true"`, `buy()` taps `buyFeatureConfirm` after opening the panel.

Sugar Wonderland provisional coords:

| Action | Relative |
|---|---|
| `buyFeature` | `{ x: 0.38, y: 0.72 }` |
| `buyFeatureConfirm` | `{ x: 0.5, y: 0.82 }` |
| `buyFeatureCancel` | `{ x: 0.5, y: 0.9 }` |

`buyFeatureForBet` retries center-bottom confirm candidates until a bet response arrives. Calibrate with `pnpm calibrate:buy`.
