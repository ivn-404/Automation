# 09 — Adaptive automation readiness

> Audit date: 2026-11-11.
> This file is an assessment and a set of documentation-only recommendations.
> Nothing here was implemented. Recommendations are not a commitment and not a design approval.

## What “adaptive” would mean for SGAP

The current constitution (`docs/architecture/README.md`) rejects discovery-by-clicking as a source of N/A, because a missed button becomes a false unsupported. Adaptive automation that silently rewrites capabilities would violate that rule. Any future adaptive layer has to **propose** config and evidence, and let a reviewed manifest decide support.

The reserved `src/ai/` folder is a README. It is not a runtime. The project history says the platform is AI-assisted and never AI-dependent. That constraint still matches the code: tests run without an AI package in `package.json`.

## Reusable components that already fit

| Component | Why it helps | Limit |
|---|---|---|
| `capabilityStatus` three-state gate | A learned profile can be merged and still fail closed when a feature is unmapped | Family baseline only requires `spin` and `bet`. Adaptive runs of BF/FS still depend on each spec calling `requireCapabilities` |
| Manifest + package + surface split | New title is data if it matches the Phaser iframe contract | Three files must agree. `winPattern` is a fourth field nothing reads |
| `GameRuntime` ladder and interaction journal | Every click already records strategy and confidence. A low-confidence cluster is a calibration queue | Healing is spin-only. Buy/autoplay retries bypass `ActionHealer` |
| `engineFor` | A non-Phaser engine could register an adapter | Call sites still import `phaser-locate`. Opaque canvas adapter returns empty lists |
| PROBE-002 calibration JSON | Measured Phaser point versus manifest | Probe is a staged tool, not an always-on learner. Output is under test-results, not auto-written back to git in the runner |
| `payload-learn.ts` and DISC-001 | Path candidates for balance, win, area, tumbles | Produces paths, not a verified pay model. Learned stores must stay free of tokens (`learned-secrets.mjs`) |
| `RoundTracker` | Feature-round id and progress | Id is not on `BetResponseSnapshot` or Allure |
| Observation recorder | Raw material for a later event model | `seq` is per test. Redaction must remain in front of any exporter |
| Package retrigger rules | The one mechanic with an explicit rule object | Only some packages have rules. Scatter id default 0 |

## Missing foundations

1. **A normalized gameplay event** with a stable id for one stake: request, response, `unresolvedSpin` if any, parsed win, stake, balance before/after, mechanic tags, and the test/game/run ids. Today these are split across the waiter snapshot, the recorder, and the spec’s local variables.
2. **A mechanic registry the code executes.** `winPattern`, hold-and-win reset, payline maps, and RTP are either unread JSON or absent. Adaptive discovery cannot “turn on” a checker that does not exist.
3. **A single correlation key** from the server if one exists in the payload. The client does not copy any bet-level id into the snapshot besides what `transactionState` happens to contain. Whether the backend already sends a round id on every spin is UNKNOWN (`11`).
4. **Execution evidence as data, not as folder totals.** Allure summaries do not identify the game for the large November runs without opening each result. An adaptive loop that retrains on “green” would learn from the wrong scope.
5. **Closed-loop wallet policy.** Adaptive hunts (more buys until a retrigger) need a default spend ceiling. FS-008’s cap is opt-in. A global ceiling does not exist.
6. **Migration of locate calls through `engineFor`** so a second engine does not fork `phaser-locate`.
7. **Authoritative expected-results store.** Smoke vs regression id collisions mean an adaptive oracle can satisfy the wrong sentence.

## Candidate capability registry (documentation sketch)

Keep `capabilityStatus` as the runtime gate. Add a **reviewed** registry document or JSON, generated as a proposal, never applied automatically:

```text
gameId
packageId
schemaVersion of the manifest
controllers[] as today
features[] as today
winPattern          (currently unread — either wire it or delete it from the contract)
normalModeMultiplierMode
freeSpinRetriggerRules | explicit "no-rules"
holdAndWin: unsupported | rules object | unmapped
evidence: last PROBE-002 drift, last CSF-001 run id, last date
status: draft | reviewed
```

Do not infer `enabled: true` from a successful click. The October design note is still the right failure mode.

Package 8 and 11 should get real package files if scratch rules become capabilities. Today they have manifests and no profile, so only controller flags exist.

## Candidate normalized event (documentation sketch)

One record per accepted HTTP exchange, not per click:

```text
eventId            local uuid
runId              allure folder or SGAP_RUN_ID
gameId
manualTestId
retry
kind               spin | buy | initialize | unresolved-progress | unresolved-complete | scratch-hub
requestStake
requestFlags       isEnhancedBet, buyFeat, action (names only)
httpStatus
balanceAfter       from manifest path
totalWin           from manifest path
transactionState
unresolvedSpinId   if present
parsed             optional checker verdicts (balanceDelta, retrigger, ways)
observationSeq     link into monitor-worker.json
locatorStrategy    from the journal entry that preceded the response
```

This is enough to ask “did this stake’s win match the checker?” later. It is not an RTP model. It must store amounts as decimal strings, not binary floats (`toAmountString` currently stringifies a JS number).

HUD samples stay a side series keyed by `eventId` of the nearest server event, with an explicit `unmatched` state when the 500 ms sample cannot be joined. Forcing a join is how AT-003-class HUD lag becomes a false balance bug, or how a real HUD bug gets averaged away.

## Network and visual correlation gaps

- High-confidence locate (`phaser`) does not prove the button that was clicked is the one that produced the next `/bet`. A queued round can answer a previous tap. `RoundTracker` waits before spin when a feature round is open. It does not tag the `/bet` with the click’s journal entry. The recorder’s `relatedSeq` is the closest existing link and it is easy to drop because it lives only in the attachment.
- Vision and manifest clicks are medium confidence. Adaptive code that treats them as confirmed coordinates will calcify a wrong ratio. The journal already marks that. Consumers must not promote `point` to `manifest` without a human or a PROBE-002 drift of 0.
- Reel vision (`image-match.ts`) compares cells to templates. Template coverage is partial (Sugar PNGs 0–9). A learned template from a live canvas is a possible future input and a possible way to learn the wrong symbol if the board is mid-tumble. The current reader uses backend area as the source of ids. Keep that order: server grid first, pixels second.
- No slot replay API was found. Visual `replay.html` from the capture hunt is a clip, not an oracle.

## Autonomous discovery feasibility

`DISC-001` and `payload-learn.ts` show the team already tried a pasted-URL learner. Feasible next steps that stay inside the current safety rule:

- Discover **paths** (where is balance, where is area) and emit a manifest diff for review.
- Discover **ratios** via PROBE-002 and emit a calibration diff for review.
- Discover **unsupported** only when the server payload lacks a feature that rules require, and record `insufficient_evidence` the way retrigger already does. Do not record N/A from a failed click.

Not feasible without new oracles:

- Payline maps, RTP, “correct” bonus choice, audio mix, art compliance.
- Hold-and-win reset rules. The reader can see a number. It cannot know the design rule unless the package says so.
- Whether an enabled controller on package 2 was copied from package 1. Discovery can show a click did not resolve a `/bet`. It cannot show the product never had the button if the button is merely off-screen.

## Game-specific rule limitations

- Retrigger award math is package data. A learner that copies Package 1’s “4 / 3 / +5” onto Package 7 will create false failures or false passes.
- `expectedBuyCost` default 100 is Sugar-shaped.
- Scatter id default `{0}` is a convention. A game that uses another id and omits the rule will under-count.
- Portrait lock and `base.json` bands assume the DiJoker HUD. A landscape or DOM title needs `orientationLock` and a surface, which is supported, and still needs someone to set them.
- Scratch hub and slots share a launcher and must not share oracles. PEN-005 precision is not CP-001.

## Safe execution boundaries for any adaptive runner

- Keep the capability gate fail-closed.
- Default `SGAP_FS008_MAX_SPEND` style caps on every buy or hunt loop. Do not hunt retriggers on an uncapped wallet.
- Do not enable `SGAP_PLAYER_ID_LOCK` in an unattended sweep.
- Do not persist raw monitor JSON to a shared store without the existing redaction step.
- Do not let an adaptive process write `config/manifests` or `config/packages` on its own. Write a proposal under a review folder.
- Do not run PEN or STR as part of adaptation. Those suites are authorized security tests with a different risk profile, and several are skipped on purpose.
- Keep parallel lane count inside the host budget the QA notes already state (4). The runner does not enforce it.
- Treat Playwright retry plus `spinAndRead` second attempt as spend, and count it in the cap.
- Local fixture mode (`dijoker-bet-response.json`) must not be used as evidence for a learned production manifest.

## Migration risks

| Change | Risk if done carelessly |
|---|---|
| Start failing when `winPattern` is unread | Every package suddenly NOT CONFIGURED or newly failing with no oracle |
| Put `spinAndRead`’s round id into Allure `historyId` | Splits historical trends. Use a parameter or an attachment instead |
| Auto-enable package 2 `reelValidation` from one captured bet | A single payload shape becomes the contract. README already forbids guessed paths |
| Move healer into `src/` and delete test-support hooks in one step | Specs and probes share that support. Split only with the smoke scripts (`registry:smoke`, `bet:smoke`, `verify:smoke`) |
| Delete empty layers (`src/state`, `src/events`) | Public barrel and any external importer of `STATE_LAYER` break. Grep before deleting. This audit found re-exports, not behavioral callers |
| Re-number smoke catalog ids to match regression | Breaks any sheet or dashboard keyed on the old sentence |
| Turn WD describes back on without a package rule | Workers will start buying or spinning for a mechanic the skip comment says must not run unattended |

## Recommended future priorities (documentation only)

Ordered by how much they reduce false confidence, not by feature glamour:

1. Reconcile `NEXT_STEPS.md` “Now” with the manifests, and mark October gates as historical. Stop using Kobo Ass NOT CONFIGURED as a current fact.
2. Pick one catalog (regression) as the id authority and record the smoke collisions in that file’s header. Do not silently edit QA case text; the catalogs say QA owns them. The reconciliation is a QA decision (`11`).
3. Define the normalized stake event and attach it from the fixture without changing Allure history ids. Include `unresolvedSpin` when present.
4. Either implement `winPattern` checkers or mark the field as documentary so adaptive tools do not treat it as executable.
5. Require `freeSpinRetriggerRules` whenever `freeSpinRetrigger` is true. Today the boolean and the rules can diverge. The evaluator already returns `insufficient_evidence`. The gap is reporting that as configuration debt rather than a flaky skip.
6. Add a default hunt spend ceiling at the runner, not only inside FS-008.
7. Finish engine call-site migration and extend `HealableAction` only after the journal shows buy/autoplay retries. That is NEXT_STEPS steps E and C, still accurate.
8. Publish per-game pass/fail from Allure parameters into `sgap-run.json` so the next audit can say VERIFIED for a named game and date without opening hundreds of result files.
9. Leave `src/ai` empty until the event record exists. An assistant that clicks to discover features will violate the N/A rule.

## Readiness judgement

SGAP is **ready for config-driven execution of a known DiJoker canvas title** whose manifest, surface, and package rules are filled in and whose proof is a `/bet` body.

SGAP is **not ready for unattended adaptive automation** that discovers mechanics, writes manifests, or decides N/A from the UI. The pieces that look adaptive (eye, learned ratios, payload learn, discovery spec) are assistants around a human-reviewed config. The missing join key, the unread `winPattern`, the wallet cap, and the stale docs are the blockers. They are architectural, not a lack of more click strategies.
