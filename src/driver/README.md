# Game Driver

**Responsibility:** Attach to the game iframe and interact using **logical locator keys** from `UiRegistry`.

## Flow

```
Page (host)  →  iframe on host  →  elements inside iframe
     ↑              ↑                        ↑
  Platform      resolveIframe()         resolve('spinButton')
```

## Usage

```ts
const manifest = await loader.load('my-game');
const ui = new UiRegistry(manifest);
const driver = new PlaywrightGameDriver({ page, ui });

await driver.attach();
await driver.click('spinButton');
const balance = await driver.readText('balanceDisplay');
await driver.detach();
```

## Rules

- Never hard-code selectors in the driver — always use `UiRegistry` keys.
- Uses Playwright observable waits (`waitFor`, `click` auto-wait) — no `waitForTimeout`.
- **DOM inside iframe** is supported in this skeleton.
- **Canvas-only Phaser UI** needs a future strategy (not CSS locators).

See `docs/GAME_DRIVER.md`.
