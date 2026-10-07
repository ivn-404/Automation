# UI_REGISTRY.md

> UI Registry — locator resolution
> Version: 1.0.0
> Status: Implemented (skeleton)

---

## Purpose

The UI Registry is the **single place** framework code asks for selectors.
Game-specific CSS lives in **game manifests** — not in controllers, specs, or driver core.

---

## Flow

```
config/manifests/{gameId}.json   (locatorKeys map)
        ↓
FileGameManifestLoader.load()
        ↓
UiRegistry(manifest)
        ↓
ui.resolve('spinButton')  →  { key, selector }
        ↓
Game Driver (future)  →  page.frameLocator(...).locator(selector)
```

---

## Where selectors come from

| Source | Role |
|---|---|
| **Manual QA / game team** | Identify stable elements (data-testid, roles, iframe) |
| **Game manifest** | Store per-game selector strings under logical keys |
| **UI Registry** | Resolve key → selector at runtime |
| **Game Driver** | Apply selectors inside iframe via Playwright |

Adding a new game = add/update JSON in `config/manifests/` — **no framework code change**.

---

## Example

**Manifest** (`config/manifests/example.json`):

```json
"iframeSelectorKey": "gameIframe",
"locatorKeys": {
  "gameIframe": "iframe[data-sgap='game']",
  "spinButton": "[data-testid='spin']"
}
```

**Code:**

```ts
import { FileGameManifestLoader, defaultManifestsDir } from 'sgap';
import { UiRegistry } from 'sgap';

const manifest = await new FileGameManifestLoader({
  manifestsDir: defaultManifestsDir(),
}).load('example');

const ui = new UiRegistry(manifest);

// Playwright-ready strings:
ui.resolveIframe().selector;       // "iframe[data-sgap='game']"
ui.resolve('spinButton').selector; // "[data-testid='spin']"
```

**Playwright (driver layer — not implemented yet):**

```ts
const frame = page.frameLocator(ui.resolveIframe().selector);
await frame.locator(ui.resolve('spinButton').selector).click();
```

---

## Rules (SGAP)

1. **No hard-coded selectors** in `src/controllers/`, `tests/specs/`, or shared framework code.
2. **Logical keys** are stable across environments; selector strings may differ per game in manifest.
3. **`iframeSelectorKey`** must exist in `locatorKeys` (validated at manifest parse time).
4. Prefer **observable** locators (`data-testid`, roles) over brittle CSS when defining manifest values.

---

## Smoke test

```bash
pnpm ui:smoke
```

---

## Revision history

| Version | Change |
|---|---|
| 1.0.0 | `UiRegistry` + manifest-backed resolution |
