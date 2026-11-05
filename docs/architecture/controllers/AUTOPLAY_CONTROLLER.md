# AUTOPLAY_CONTROLLER.md

> Autoplay Controller
> Version: 1.0.0

---

## Purpose

`AutoplayController` starts and stops automated spins.

```ts
await sgapSession.autoplay.start();
// observe multiple /api/v1/slots/bet responses
await sgapSession.autoplay.stop();
```

When `metadata.autoplayNeedsConfirm` is `"true"`, `start()` opens the autoplay panel, then taps confirm candidates until a `/api/v1/slots/bet` response arrives (observable sync — no fixed sleeps).

Sugar Wonderland staging coords:

| Action | Relative |
|---|---|
| `autoplay` / `autoplayStop` | `{ x: 0.26, y: 0.88 }` |
| `autoplayConfirm` | `{ x: 0.42, y: 0.78 }` |

Calibrate with `pnpm calibrate:autoplay`.
