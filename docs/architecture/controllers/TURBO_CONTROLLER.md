# TURBO_CONTROLLER.md

> Turbo Controller
> Version: 1.0.0

---

## Purpose

`TurboController` toggles fast-play mode via canvas `turbo` action (toggle).

```ts
await sgapSession.turbo.enable();
await sgapSession.spin.spin();
await sgapSession.turbo.disable();
```

Sugar Wonderland: `{ x: 0.92, y: 0.88 }` — bottom bar, right of spin.

`isTurboEnabled()` is local click-tracking only. Package 1 `/bet` has no turbo
field. Do not assert `isEnhancedBet` after a lightning tap — that flag follows
Amplify. TM-002 (reel speed) is Manual. Remaining TM/AP cases prove a following
spin or autoplay still returns `/bet`.

