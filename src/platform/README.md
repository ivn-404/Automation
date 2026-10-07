# Platform

**Responsibility:** Browser/session bootstrap and host/shell navigation entry.

| Module | Role |
|---|---|
| `environment/` | Load `config/environments/*.json` |
| `manifest/` | Load `config/manifests/*.json` |
| `playwright-platform.ts` | `openGameHost` + `openGame` (launcher tile click) |

In-game actions belong in Controllers. Canvas rendering is noted in manifest metadata.
