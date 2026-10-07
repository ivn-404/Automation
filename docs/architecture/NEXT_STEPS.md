# Next steps (keep current progress)

> Do not rewrite the suite. Move leaked numbers into config, one cluster at a time.
> Trusted runs stay in place until a step is proven.

---

## Done (game-agnostic refactor, October 2026)

| Step | What changed | Proof |
|---|---|---|
| Capabilities | `requireCapabilities` / `sgapSession.supports`; supported / N/A / NOT CONFIGURED from the manifest | N/A cases skip in 0–2 s before launch; Kobo Ass slot cases fail as NOT CONFIGURED, not N/A |
| One spin path | `SpinController.spinAndRead` + `ActionHealer` (canvas healer in `tests/support/canvas-action-healer.ts`) | CSF-001/002, BC-001 green on all four Package 1 games |
| Interaction journal | strategy / confidence / fallback per click, attached to every Allure result | `interactions.txt` / `.json` on every test, labels `selfHealing`, `lowestConfidence` |
| Shared locator | `clickCanvasControl` for bet, autoplay, menu, turbo, amplify; `autoplay` / `menu` Phaser bands in `config/surfaces/base.json` | Same spec found autoplay at four different layouts (Sugar 0.926, Beelze 0.917, Mars 0.879, Felice 0.843) |
| Surfaces | Vision / Phaser bands, candidates, blockers, portrait aspect → `config/surfaces/` | Sugar buy-confirm branch removed |
| Package keys | `metadata.packageId` and `normalModeMultiplier` on all 28 game manifests (`config/qa-suites.json`) | CSF-011 N/A on packages 1 and 4 |
| Monitor Worker | Network / console / WebSocket / game events / balance timeline per test, live at `http://127.0.0.1:3847/observe` | AT-003 Sugar root cause found (game HUD skips one balance update after a failed `/bet`) |
| Recalibrated Package 1 | PROBE-002 writes `calibration.json` (live Phaser vs manifest per control); Sugar / Felice / Mars `canvasActions` updated from it | Drift 0.02–0.05 → 0 on all controls; Beelze already matched |
| Eye-gated dismissal | `readHudState` / `settleHudState` / `clickDialogButton` in `src/eye`; `clearCanvasOverlays` and `dismissCanvasBlockingModal` only tap when the eye sees a blocker; splash Play recognised via the scene graph. `SGAP_BLIND_OVERLAY_TAPS=1` restores the old taps | Eye-gate verify (`config/parallel-workers-eye-gate-verify.json`): 23 passed / 11 failed / 2 broken → 35 / 1 (AT-003 Sugar, game bug) / 4 N/A; dismiss taps 299 → 14 (11 of them AT-003 error recovery); fixed-point `errorOk+probe` sprays 45 → 0 |
| Buy panel close | `closeBuyPanel` taps only when the panel is seen, finds the "×" glyph as visible Phaser text (`hudLabels.buyPanelClose`), confirms it closed; Mars / Felice `buyFeatureCancel` fallback 0.5,0.9 → 0.921,0.248 (measured by PROBE-002 `buy-panel.json`); failure reports name an open buy panel / blocker | `run-20261006-120222`: BF-001 cancel taps Mars 29 → 1, Felice 13 → 1, Beelze 4 → 1, all `phaser`; Mars BF-001 227 s → 77 s, Felice 205 s → 114 s; 35 / 1 (AT-003 Sugar, game bug) / 4 N/A |
| Round-in-progress readiness | `RoundTracker` follows `unresolvedSpin` → `/unresolved-spin/<id>/complete`; `waitForIdleHud` waits for it; failure reports name it | Verify run `run-20261006-110811`: 35 / 1 (AT-003 Sugar, game bug on both attempts — no more "never sent /bet") / 4 N/A; three feature rounds waited out and completed (Sugar BC-004 120 s, Felice BF-001 117 s, Mars BF-001 60 s) |

| Capability model v2 | `freeSpins`, `scatterTrigger`, `freeSpinRetrigger`, `tumble`, `multiplierWild`, `scatterMode`, `reelValidation`, `symbolCatalog`, `maxWin`; package defaults in `config/packages/<packageId>.json`; family scope + baseline gate in `config/qa-suites.json` → fixture `_sgapBaseline` | Kobo Ass: FS-008 / WD N/A (Package 2 has no retrigger / tumble), slot cases NOT CONFIGURED |
| Reel data Felice / Mars | `reelValidation` blocks; package catalog fills payload paths; PROBE-004 reel contract | PROBE-004 green on all four Package 1 games |
| Phase 1 P1 gate | Full suite on all four games (`config/generated/parallel-workers-full-pkg1.json`), rerun, confirm pass | 141 cases; 105 / 106 applicable fully implemented; 24 automation hard failures → 0; report canvas `p1-completion-gate-coverage` |
| Sugar BUY | Stale `buyFeature` 0.77 → 0.83; Sugar surface Phaser band (`maxW` keeps the 121×54 pill, not the 378 px bar); vision accept window → `controls.<name>.vision.accept` | 22 Sugar buy cases green in rerun; buy located `phaser` in confirm pass |
| Press anywhere | `hudLabels.pressAnywhere` scene-graph text fallback in `detectCanvasBlocker` | SCG-024 Sugar green (was 0.19 vs 0.25 because every frame showed the intro) |
| Menu close (step B) | `MENU_CLOSE_POINTS` → `config/surfaces/base.json` `controls.menuClose.candidates` (same six points) | MN-001 / ES-013 green on all four games (run-20261007-112403) |

Lane configs: `config/parallel-workers-refactor-verify.json` (8 specs × 4 games + Kobo Ass), `config/parallel-workers-refactor-rerun.json`, `config/parallel-workers-na-proof.json`, `config/parallel-workers-calibrate-p1.json`, `config/parallel-workers-eye-gate-verify.json`.

## Now

1. **Raise AT-003 Sugar with QA / the game team.** After a failed `/bet` (refund itself works), the first successful spin is played but never applied to the game's balance display; it corrects on the next spin. Proven by the Monitor Worker timeline and PROBE-003 (Mars stays in sync). Also: Sugar staging connects its game hub to `ws://localhost:5068` (refused). Game-side, not framework.
2. **Map slot controllers for packages 2–11.** Their manifests are scratch-only; slot cases report NOT CONFIGURED. CSF-011 also needs `reelValidation` multiplier symbols and `metadata.normalModeMultiplierPath` per game. Package 2 profile exists (`config/packages/package-2.json`, from the spec); its `/bet` payload paths are deliberately absent until a staging bet is captured.
3. **QA decisions.** AT-004 / AT-005: the build now disconnects the first session ("opened in another window") before any `/bet`, so the server refusal the cases expect never happens. BF-004 Felice: balance 100 equals the buy cost at bet 1.00. Security: PEN-059 (no max-bet ceiling), PEN-051 (alg-none token accepted once).
4. **AT-001 Felice / Mars.** Capture the real Help-screen order; do not copy Sugar's.
5. **Hardcoded P1 rules in specs** → package profile: FS-001 `SCATTER_TRIGGER_AT`, FS-008 "≥4 scatters" retrigger, SCG-024 `SIMILARITY_MIN`; ES-001 / ES-009 URL literals → `src/network/bet-url.ts`.
6. **Felice BF-003** flaky in every run (spin after the mid-spin buy attempt sends no `/bet` for 90 s).

## Next (architecture, small diffs)

| Step | Change | Done when |
|---|---|---|
| A2 | Gate the press-anywhere point taps in `waitForIdleHud` / `clearCanvasBlockers` (mostly Beelze) the same way | No `point` clicks outside error-recovery specs |
| E | Migrate Phaser call sites (`listPhaserInteractive` / `listPhaserTexts` in eye, runtime, support, AT-002 / SCG-001 / PROBE-002) to `engineFor(manifest)` | No direct `phaser-locate` import outside `src/engine/adapters.ts` |
| C | `HealableAction` beyond `spin` (buy, autoplay) so their retries go through the healer too | BF/AP retries show `recover` in the journal |
| D | Run PROBE-002 + CSF-001 on one package 2 game after its slot controllers are mapped | Second package proves config-only |

## Not now

- Do not split controllers per game.
- Do not copy `tests/specs` into `tests/specs/<game>`.
- Do not go back to host-only clicks for game HUD.
- Do not commit unless asked.
