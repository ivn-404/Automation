# GAME_DRIVER.md

> Playwright Game Driver
> Version: 1.0.0
> Status: Implemented (skeleton)

---

## Purpose

`PlaywrightGameDriver` implements `IGameDriver` for iframe-hosted slot games.

It connects:

1. **Playwright `Page`** — host/shell page
2. **`UiRegistry`** — logical keys → selectors from manifest
3. **Game iframe** — where slot UI lives

---

## How locators reach Playwright

You do **not** pass Playwright `Locator` objects into SGAP config.

| Step | Who | What |
|---|---|---|
| 1 | QA / you | Find iframe + in-game elements (DevTools, codegen) |
| 2 | Config | Store in `config/manifests/{gameId}.json` → `locatorKeys` |
| 3 | `UiRegistry` | `resolve('spinButton')` → `{ selector: "..." }` |
| 4 | `PlaywrightGameDriver` | `frameLocator(iframe).locator(selector).click()` |

---

## API

| Method | Behavior |
|---|---|
| `attach()` | Wait for iframe on host, then wait for frame `body` |
| `isAttached()` | Whether driver completed attach and iframe is visible |
| `click(key)` | Click element inside iframe by logical key |
| `readText(key)` | Read visible text inside iframe by logical key |
| `detach()` | Release frame reference |
| `getFrame()` | Advanced: raw `FrameLocator` for network/events |

---

## Example (real test wiring — future fixtures)

```ts
import { PlaywrightGameDriver } from 'sgap';
import { UiRegistry, FileGameManifestLoader, defaultManifestsDir } from 'sgap';

const manifest = await new FileGameManifestLoader({
  manifestsDir: defaultManifestsDir(),
}).load('lucky-stars');

const ui = new UiRegistry(manifest);
const driver = new PlaywrightGameDriver({ page, ui });

await page.goto(process.env.SGAP_BASE_URL!);
await driver.attach();
await driver.click('spinButton');
```

---

## Iframe discovery checklist (for you)

1. Open game URL in browser.
2. Inspect host page → find `<iframe>` → note selector → manifest `gameIframe` key.
3. Switch context to iframe → inspect Spin/Balance → note selectors → manifest keys.
4. Send keys + selectors (or JSON manifest) — we do not hard-code in `src/`.

---

## Phaser / canvas limitation

If the game renders UI on **canvas only**, CSS locators inside the iframe will not find buttons.

Document `metadata.rendering: "canvas"` in manifest and plan:

- Studio-provided DOM overlay / test ids, or
- Network/event-based actions, or
- Coordinates (last resort, game-specific config)

This driver skeleton is **DOM-first**.

---

## Smoke test

Local HTML fixture (no live game URL):

```bash
pnpm driver:smoke
```

Uses `config/manifests/driver-smoke.json`.

---

## Revision history

| Version | Change |
|---|---|
| 1.0.0 | `PlaywrightGameDriver` skeleton + smoke fixture |
