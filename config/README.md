# Config

**Responsibility:** Configuration over duplication.

| Subfolder | Role |
|---|---|
| `environments/` | Environment-specific settings |
| `manifests/` | Game Manifests (per-game config — not framework code) |
| `playwright/` | Playwright config notes / fragments |

Game differences belong in manifests — not in `src/` package-specific branches.
