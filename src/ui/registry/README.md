# UI Registry

**Responsibility:** Resolve logical locator keys → Playwright-ready selector strings via the game manifest.

## How you get a locator you can use

### 1. Define keys in the game manifest (configuration)

In `config/manifests/{gameId}.json`:

```json
"locatorKeys": {
  "gameIframe": "iframe[data-sgap='game']",
  "spinButton": "[data-testid='spin']"
}
```

- **Key** (`spinButton`) — stable logical name used in framework code
- **Value** — selector string Playwright accepts in `page.locator(...)` / `frameLocator(...)`

### 2. Load manifest and create UiRegistry

```ts
const manifest = await loader.load('example');
const ui = new UiRegistry(manifest);
```

### 3. Resolve a key → selector

```ts
const spin = ui.resolve('spinButton');
// spin.selector === "[data-testid='spin']"
```

### 4. Use in Playwright (Game Driver — future)

Game UI lives inside the iframe:

```ts
const iframe = ui.resolveIframe();
const frame = page.frameLocator(iframe.selector);
await frame.locator(ui.resolve('spinButton').selector).click();
```

**Rule:** Specs and controllers use **logical keys** (`spinButton`). Only the manifest holds game-specific CSS.

## API

| Method | Returns |
|---|---|
| `resolve(key)` | `{ key, selector }` |
| `resolveIframe()` | Resolved iframe from `manifest.iframeSelectorKey` |
| `has(key)` / `listKeys()` | Discovery |

See `docs/UI_REGISTRY.md` for the full flow.
