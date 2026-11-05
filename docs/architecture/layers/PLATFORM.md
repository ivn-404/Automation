# PLATFORM.md

> Platform layer — host / launcher bootstrap
> Version: 1.0.0
> Status: Implemented

---

## Purpose

`PlaywrightPlatform` opens the **game host** (DiJoker launcher) and selects a game tile.
It does **not** drive canvas spin/balance — that is Controllers + Game Driver (+ future canvas/network).

---

## Staging environment

`config/environments/staging.json`

| Field | Value |
|---|---|
| `baseUrl` | `https://stg-asset-tools.dijoker.com/game-launcher` |
| `defaultTimeoutMs` | `30000` |

---

## Sugar Wonderland manifest

`config/manifests/sugar-wonderland.json`

| Key | Value |
|---|---|
| `gameGrid` | `div.grid.grid-cols-2` |
| `gameIframe` | `iframe[title="Game session"]` |
| `searchGames` | `input[placeholder="Search games"]` |
| `launcherGameId` | `00010525` |
| `launcherGameLabel` | `Sugar Wonderland` |
| `playButtonAriaLabel` | `Play in modal` |
| `rendering` | `canvas` |

---

## Open game flow

```
openGameHost()  →  goto launcher URL
openGame()      →  optional search
                →  find tile by game ID (preferred) or img alt
                →  click button[aria-label="Play in modal"]
                →  wait for iframe[title="Game session"]
driver.attach() →  frame ready for canvas / future actions
```

---

## Usage

```ts
await sgapPlatform.openGameHost();
await sgapPlatform.openGame();
await sgapPlatform.prepareMobilePortraitSession();
await sgapDriver.attach();
await primeCanvasSession({ page, driver: sgapDriver, manifest });
```

`primeCanvasSession` lives in `src/platform/canvas-session-primer.ts` and is wired by the staging fixture path.

---

## Assumptions

1. Launcher is DOM; game session UI is **canvas** (`metadata.rendering=canvas`).
2. Smoke test uses a **local HTML fixture** — does not require staging auth.
3. Real staging runs need a valid launcher session (user Automation already logged in / SSO as required by your org).
4. No JWT / token URLs are stored in config.

---

## Staging session

DiJoker shows a **Set user** dialog when no player is selected.
Configure in `config/environments/staging.json`:

- `metadata.launcherPlayerId` (default used: `SgapCsf001`)
- `metadata.launcherBrandId` (default: `123`)

Or override with `SGAP_PLAYER_ID` / `SGAP_BRAND_ID`.

**Free Spin** must be **NO** before Play — `ensureFreeSpinGrantOff` toggles the launcher header and fails if YES remains.

After iframe attach, `primeCanvasSession()` runs manifest `preSpinActions` and dismisses overlay coords (Continue / close).

`getInitializeBalance()` exposes wallet balance from the last initialize response for CSF verification.

---

## Revision history

| Version | Change |
|---|---|
| 1.0.0 | Environment loader, PlaywrightPlatform, sugar-wonderland manifest |
| 1.1.0 | Free Spin OFF guard, initialize balance capture, canvas session primer |
