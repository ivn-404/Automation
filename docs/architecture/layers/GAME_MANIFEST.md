# GAME_MANIFEST.md

> Game Manifest schema and loader
> Version: 1.0.0
> Status: Implemented

---

## Purpose

Game Manifests hold **per-game configuration** so the framework stays reusable
(**Configuration Over Duplication**). Package differences do not belong in controller code.

---

## Schema version

`schemaVersion`: **`1.0.0`**

JSON Schema: `config/manifests/schema/game-manifest.schema.json`

---

## Document shape

| Field | Required | Description |
|---|---|---|
| `schemaVersion` | yes | Must be `1.0.0` |
| `gameId` | yes | Kebab-case id; must match `{gameId}.json` filename |
| `displayName` | yes | Human-readable name |
| `iframeSelectorKey` | yes | Logical key into `locatorKeys` for the game iframe |
| `controllers` | yes | List of `{ id, enabled }` for approved controllers |
| `locatorKeys` | yes | Map of logical key → selector string |
| `canvasActions` | no | Named canvas click points (required when `metadata.rendering` is `canvas`) |
| `network` | no | Bet URL pattern + JSON field paths |
| `reelValidation` | no | Backend↔canvas reel symbol comparison (area path, Help/Payout symbol catalog, reel region) |
| `metadata` | no | String map for non-behavioral notes |

### `reelValidation` (optional)

Used by CSF-006 to assert **backend `slot.area` = frontend canvas symbols**.

| Field | Description |
|---|---|
| `areaPath` | JSON path to column→row symbol matrix (e.g. `slot.area`) |
| `tumblesPath` | Optional tumble list; last tumble `area` is preferred when present |
| `symbols` | `{ id, name }[]` from Menu→Help→Payout order |
| `symbolTemplateDir` | Folder of `{id}.png` templates cropped from Help/Payout |
| `reelRegion` | Normalized `{x,y,width,height}` of the visible reel board on canvas |

Column and row counts are **never hardcoded** — they are read from the bet response matrix.

### Approved controller ids

`spin`, `autoplay`, `buyFeature`, `bet`, `amplifyBet`, `turbo`, `menu`, `settings`, `fullscreen`

---

## Loader

| Piece | Location |
|---|---|
| Contract | `IGameManifestLoader` in `src/core/contracts` |
| Parser | `parseGameManifest` in `src/platform/manifest` |
| Implementation | `FileGameManifestLoader` |

```ts
import { FileGameManifestLoader, defaultManifestsDir } from './platform/index.js';

const loader = new FileGameManifestLoader({ manifestsDir: defaultManifestsDir() });
const ids = await loader.listGameIds();
const manifest = await loader.load('example');
```

---

## Assumptions

1. Manifests live under `config/manifests/` relative to process cwd (repo root in local/CI).
2. Runtime validation is TypeScript-based; JSON Schema is for docs/IDE — not a runtime dependency.
3. `example.json` is a scaffold only; selectors are placeholders.
4. Adding a game means adding a JSON file — not forking controllers.

---

## Revision history

| Version | Change |
|---|---|
| 1.0.0 | Initial schema, parser, FileGameManifestLoader, example manifest |
