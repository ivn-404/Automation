# Reusable framework

> These files are shared by every game.
> Do not put a game name, a pixel guess, or a Sugar colour in them.

If a new title on the same platform needs a change here, the design is wrong. Change config or add a capability flag instead.

---

## What each folder is for

| Folder | Reuse rule | You may change it when… |
|---|---|---|
| `src/core/` | Contracts and types only. No Playwright. No game names. | A new **kind** of fact is needed (example: a new network field name in the model). |
| `src/controllers/` | One action API per capability (spin, bet, buy, turbo, …). Reads the manifest. | A capability is missing for **all** games, not for one title. |
| `src/controllers/registry/` | Finds controllers. No second copy of Spin. | A new controller id is registered once. |
| `src/driver/` | Attach iframe, click canvas or DOM by **manifest key**. | The click mechanism itself is broken for every canvas game. |
| `src/ui/` | Turns manifest locator keys into selectors. | Never hard-code `sugar-wonderland` here. |
| `src/platform/` | Open the launcher, set host balance / bet limit, wait for the game iframe. | The **host** (DiJoker) changes, not one slot. |
| `src/network/` | Watch responses using the manifest URL pattern and field paths. | A new shared response shape is added to the platform. |
| `src/verification/` | Check outcomes (balance, win, reel grid) from parsed data. | The check is true for every game that exposes that data. |
| `src/state/` | Lock controllers while a spin is in progress. | Shared state rules change. |
| `src/reporting/` | Execution tracker, Allure labels, interaction journal. | Reporting format changes. |
| `src/capabilities/` | Supported / unsupported (N/A) / unmapped, from the manifest only. | A new game-level feature flag is needed by a case. |
| `src/surfaces/` | Loads `config/surfaces/*.json` for vision, Phaser and blocker hints. | A new kind of visual hint is needed for every game. |
| `tests/specs/` | Scenarios. They call controllers / shared helpers. They do not embed coordinates. | The **manual case** behaviour changes for every title. |
| `tests/fixtures/sgap.fixture.ts` | Loads whichever manifest `SGAP_GAME_ID` points at. | Fixture wiring changes for all games. |

---

## How a spec stays game-independent

Specs should say **what** to do:

- spin
- raise bet
- buy feature
- read `/bet`

They should not say **where** the button is. The manifest and driver own that.

Game id in a spec is only a label (`sgapSession.manifest.gameId`), not a branch like `if (gameId === 'sugar-wonderland')`.

---

## Shared building blocks (names)

| You want to… | Use |
|---|---|
| Click a named HUD control | `clickCanvasControl(driver, manifest, 'autoplay')` — Phaser band first, manifest ratio as a journaled fallback (`src/controllers/strategy/click-control.ts`). Plain `driver.clickCanvas(…)` only for controls with no Phaser band (panel buttons). |
| Click a DOM node inside the iframe | `driver.click('someLocatorKey')` |
| Know which game is running | `sgapSession.manifest` |
| Know if Buy / Turbo exists | `requireCapabilities(…)` in the describe, `sgapSession.supports(…)` in a test (`src/capabilities/`) |
| Spin and get the `/bet` | `sgapSession.spin.spinAndRead({ timeoutMs })` (healer + watcher + bounded retry) |
| Recover from a blocker / missed click | an `ActionHealer` (`src/controllers/strategy/action-healer.ts`), not ad-hoc taps in a spec |
| Say how a control was found | `recordInteraction` / `clickCanvasAt(…, { strategy, fallback, detail })` (`src/reporting/interaction-journal.ts`) |
| Prove a spin happened | network watcher on `manifest.network.betUrlPattern` |
| Screenshot the canvas or a region | `captureLocator(locator)` / `captureViewportRegion(page, box)` (`src/platform/stable-screenshot.ts`). Not `locator.screenshot()` or `page.screenshot({ clip })`: in a headed window those briefly redraw the game at the window's top-left. Same pixels; watched lanes show a "Screenshot captured" notice instead. |
| Prove Amplify | `/bet` field `isEnhancedBet` (Package 1). Turbo is **not** that field. |

---

## Allowed differences without code changes

These already live in JSON, not in controllers:

- button ratios (`canvasActions`)
- iframe selector (`locatorKeys.gameIframe`)
- bet URL and JSON paths (`network`)
- which controllers are on (`controllers`)
- symbol names and reel crop (`reelValidation`, `config/symbols/<gameId>/`)

See [GAME_SPECIFIC.md](./GAME_SPECIFIC.md) for the pieces that **should** be config but are still in code.
