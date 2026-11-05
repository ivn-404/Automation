# MENU_CONTROLLER.md

> Menu Controller
> Version: 1.0.0

---

## Purpose

`MenuController` opens and closes the in-game hamburger menu.

```ts
await sgapSession.menu.open();
await sgapSession.menu.close();
```

Sugar Wonderland coords:

| Action | Relative |
|---|---|
| `menu` | `{ x: 0.1, y: 0.88 }` |
| `menuClose` | `{ x: 0.86, y: 0.08 }` (staging-calibrated panel X) |
| `menuCloseAlt` | `{ x: 0.84, y: 0.1 }` |
