# Game Manifests

**Responsibility:** Per-game configuration (capabilities, locator keys, controller availability).

## Layout

| Path | Purpose |
|---|---|
| `*.json` | One manifest per game (`{gameId}.json`) |
| `schema/game-manifest.schema.json` | JSON Schema (documentation / IDE validation) |
| `example.json` | Scaffold sample — not a real game |

## Rules

- Configuration only — no framework or package-specific logic in `src/`
- `gameId` must match the filename
- `iframeSelectorKey` must exist in `locatorKeys`
- Controller `id` values must be from the approved controller set
- Selectors are data; UI Registry resolves logical keys at runtime

See `docs/GAME_MANIFEST.md` for the full schema reference.
