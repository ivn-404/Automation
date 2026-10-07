# PERSONAL TESTING — Adversarial & Stress Testing the Scratch Game

Exploratory security and robustness testing for the scratch-card game. This is
**not** part of the QA-owned regression catalog (`RegressionTestCases.md` / `SCG-###`).
It is a hardening checklist: things to try in order to *break* the game, prove the
backend is authoritative, and confirm a malicious or buggy client cannot cheat the
economy. IDs here use the `PEN-###` (penetration) and `STR-###` (stress) prefixes so
they never collide with the QA `SCG-###` cases.

> These are defensive tests: run them only against staging with test accounts.
> The goal is to find and close holes before someone else does.

---

## 1. How the game actually works (the real attack surface)

From the live staging captures, the game is driven almost entirely by one SignalR
JSON websocket, **not** the pixels on the canvas:

- Hub: `wss://stg-crashgame-api.dijoker.com/hubs/game`
- `JoinScratch` → returns `config` (pay table, `minBet` 0.1, `maxBet` 100, `maxWin`
  200, `maxWinMultiplier` 200, `maxLevels`, `rtp` 97, `mathModelVersion`) and
  `player.balance`.
- `StartRound(bet, gridIndex)` → *"Round started."* The server **deals the whole
  card up front**: the response already contains every cell, its symbol, `tier`,
  `isWin`, `winAmount`, and `winMultiplier`, and books the bet (`balance` drops).
  `round.status = 1`.
- `Cashout()` (no arguments) → *"Scratch complete …"* Settles the round,
  `status 1 → 2`, credits `winAmount`, `balance += win`.

**The single most important fact:** the outcome is decided server-side at
`StartRound`. The scratching gesture is cosmetic. So the whole security question is:
*can a client influence, replay, predict, or desync that server-decided outcome or
the balance?* Everything below probes that.

Because the truth lives on the socket, the highest-value tests are a **scripted hub
client** (raw SignalR frames) rather than clicking the canvas. The existing
`ScratchHubWatcher` (`src/network/scratch-hub-watcher.ts`) already parses these
frames and is the natural base for an active fuzzing client.

---

## 1a. Things already visible to any client (check these first)

These come straight from a real staging `StartRound` response (Sugar Wonderland).
They are not confirmed bugs, but each is worth a deliberate test.

- **The result is sent before the player scratches.** At `StartRound`
  (`status 1`, nothing revealed yet) the response already has `tier` (e.g. `"Lose"`),
  `isWin`, `winAmount`, `winMultiplier`, and all cells. Anyone with DevTools sees the
  outcome before scratching. That is harmless *only if* a bought card can never be
  refunded or abandoned for free — see PEN-017.
- **`demoScriptActive: false` is in the config.** A "demo script" mode suggests
  scripted/rigged outcomes exist server-side. Confirm it can never be switched on
  from a client or a player session (PEN-037).
- **Keyboard controls are published.** The response includes a `control` map:
  `space` = bet, `c` = cashout, `up` = max bet, `down` = min bet, `left`/`right` =
  bet −/+. Shortcuts can bypass UI locks that only guard the buttons (PEN-038).
- **Currency precision mismatch.** `currencyDecimalPlaces: 0`, yet `minBet` is `0.1`
  and bets like `1.2` are accepted. A classic source of rounding leaks (PEN-005,
  PEN-014).
- **Win cap vs pay table.** `maxBet` 100, Jackpot ×100, but `maxWin` 200 and
  `maxWinMultiplier` 200. Confirm which cap applies and that it's enforced
  (PEN-015).
- **Internal metrics exposed.** `currentSessionRtp`, `rtpMetrics`, `playerId`, and
  `operatorId` come back to the client. Check nothing sensitive leaks, and that
  `playerId` / `operatorId` can't be spoofed on requests (PEN-039).

---

## 2. Input validation & fuzzing — `StartRound(bet, gridIndex)`

The client sends `requestArgs: [bet, gridIndex]`. Fuzz both. For each, the expected
**safe** result is a rejected round (server error / clamped value) with **no balance
change and no card dealt**.

| ID | Input to send | What we're trying to break | Expected safe behavior |
| --- | --- | --- | --- |
| PEN-001 | `bet = 0` | Free plays | Rejected; no round, no card |
| PEN-002 | `bet < 0` (e.g. `-100`) | Negative bet that *credits* balance | Rejected; balance unchanged |
| PEN-003 | `bet` above `maxBet` (e.g. `1e9`, `Number.MAX_SAFE_INTEGER`) | Oversized stake / overflow | Rejected or clamped to `maxBet` |
| PEN-004 | `bet` below `minBet` (e.g. `0.0001`) | Sub-minimum stake | Rejected or clamped to `minBet` |
| PEN-005 | `bet` with extra precision (`0.123456789`) | Rounding/precision abuse in payout | Rounded to currency precision; win math consistent |
| PEN-006 | `bet` = `NaN`, `Infinity`, `"1"`, `"1e3"`, `null`, `true`, `{}` | Type confusion | Rejected; no crash |
| PEN-007 | `gridIndex` out of range (`-1`, `99`, `2.5`, `"0"`) | Undefined grid / index into server arrays | Rejected; no round |
| PEN-008 | `bet > balance` | Buying with insufficient funds | Rejected with an insufficient-funds error; balance unchanged |
| PEN-009 | Extra / missing arguments (`[]`, `[1]`, `[1,0,999]`) | Argument-count assumptions | Rejected; no crash |

Automate PEN-001…009 by invoking `StartRound` directly through a hub client and
asserting on the completion frame + a follow-up `JoinScratch`/balance read.

---

## 3. Economy & balance integrity

The money tests. Expected safe behavior in all cases: **the server balance is the
only source of truth, and it only ever moves by exactly one booked bet or one paid
win.**

- **PEN-010 Double-spend / replay.** Capture a winning `Cashout` completion and
  replay the raw frame (same `invocationId`, then a fresh one). The win must be
  credited **at most once**.
- **PEN-011 Cashout without StartRound.** Call `Cashout` with no round in play.
  Expected: *"No active round."*, no credit.
- **PEN-012 Double Cashout.** `StartRound` → `Cashout` → `Cashout` again. Second
  must be a no-op; balance must not be credited twice.
- **PEN-013 Cashout a losing card repeatedly.** Confirm a losing card can never be
  turned into a win by re-settling.
- **PEN-014 Balance reconciliation.** After N random rounds, assert
  `finalBalance == initialBalance − Σbets + Σwins` exactly (no drift, no rounding
  leak). Run with fractional bets to catch precision errors.
- **PEN-015 Win cap.** Force/seek the top tier and confirm the payout never exceeds
  `bet × maxWinMultiplier` (200) or `maxWin`, even if the client claims a higher
  `winMultiplier`.
- **PEN-016 Client-declared outcome.** Modify the `Cashout`/settle frame the client
  sends (if it carries any card/win data) to claim a jackpot. The server must ignore
  client-supplied outcome and pay only what it dealt at `StartRound`.

---

## 4. RNG & outcome integrity

The card is predetermined at buy time, so the risks are *prediction* and
*re-rolling*.

- **PEN-017 Outcome re-roll ("buy until win").** `StartRound`, inspect the dealt
  card, and if it's a loss try to abandon/cancel and re-buy *without* paying — e.g.
  disconnect before `Cashout`, then reconnect. Expected: the abandoned round is
  still charged/settled server-side; you cannot peek-then-discard.
- **PEN-018 Predictability.** Collect a large sample of dealt cards and check the
  outcome is not derivable from anything the client controls (bet, gridIndex,
  timestamp, sessionId, a visible seed). If a seed is exposed, that's a finding.
- **PEN-019 RTP / distribution sanity.** Over a large scripted sample per grid size,
  the empirical RTP should track the configured `rtp` (97%, range 93–99). A large
  deviation means either a math bug or a manipulable outcome.
- **PEN-020 Pay-table vs payout consistency.** For every win, assert the paid
  `winMultiplier` exists in the `scratchPayTable` returned by `JoinScratch` for that
  grid size (catches the legend ×200 vs paytable ×100 discrepancy already noted).
- **PEN-021 Match logic.** Assert a win always has ≥3 matching symbols (matches
  SCG-022 intent) and that `matchCount` and `cells` agree with `isWin` — a card
  can't be flagged `isWin` with fewer matches.

---

## 5. Session, auth & isolation

- **PEN-022 Token replay / expiry.** Reuse an old access token and an old refresh
  token (the launcher exposes *Copy Token* / *Copy Refresh Token*). Expired or
  rotated tokens must be rejected.
- **PEN-023 Cross-session play.** Take player A's `sessionId` and try to
  `StartRound`/`Cashout` on it from player B's socket. Must be rejected; you can only
  act on your own session.
- **PEN-024 Balance/bet-limit tampering.** The launcher shows *Bet limit* and
  *Balance*; confirm neither can be raised from the client and that a disabled bet
  limit still enforces `maxBet`.
- **PEN-025 Concurrent sessions.** Open the same session in two tabs and buy in both.
  Confirm no balance duplication and a coherent single round state.
- **PEN-026 TTL expiry.** Let the session TTL lapse mid-round and confirm the round
  settles safely (no orphaned, uncharged, or double-charged round).

---

## 6. State-machine & concurrency abuse

The round has a small state machine (`idle → status 1 (in play) → status 2
(settled)`). Try every illegal transition and every race.

- **PEN-027 Buy while a round is in play.** `StartRound` twice without a `Cashout`.
  Expected: the second is rejected; you can't hold two live cards on one bet, and the
  first isn't silently dropped uncharged.
- **PEN-028 Change bet mid-round.** Buy, then try to change the dimension/bet before
  settling. The locked bet (SCG-005) must hold on the server too, not just the UI.
- **PEN-029 Parallel StartRound race.** Fire many `StartRound` invocations back to
  back on one socket. Exactly the intended number of bets should be booked; no
  interleaving that yields a free or double round.
- **PEN-030 Interleaved Cashout race.** `StartRound` then two `Cashout` frames in the
  same tick. Only one settlement, one credit.
- **PEN-031 Out-of-order frames.** Send `Cashout` before the `StartRound` completion
  arrives. Server must not settle a not-yet-created round.

---

## 7. Protocol & transport hardening

- **PEN-032 Malformed SignalR frames.** Send frames missing the `\u001e` record
  separator, wrong `type`, missing `invocationId`, or non-JSON. Server should reject
  cleanly (no 500 storm, no dropped auth).
- **PEN-033 Oversized payload.** Send a multi-MB `arguments` array / string. Expected:
  bounded and rejected, not an OOM or hang.
- **PEN-034 Unknown targets.** Invoke methods that don't exist or admin-sounding ones
  (`SetBalance`, `AdminStart`, `Debug*`). All must be rejected/absent.
- **PEN-035 Compression/format abuse.** If MessagePack or compression is negotiable,
  try forcing an unexpected transport and malformed content.
- **PEN-036 Reconnect / resume abuse.** Kill and re-establish the socket mid-round
  repeatedly; confirm the round can't be duplicated or replayed on resume.
- **PEN-037 Demo-script activation.** Try to enable `demoScriptActive` (extra
  `JoinScratch`/`StartRound` args, query params on the game URL, tampered config).
  It must stay off for player sessions.
- **PEN-038 Keyboard shortcut abuse.** With the drawer open, hold or spam `space`
  (double buy), press `c` with no card, and press `up`/`right` while a card is in
  play (change a locked bet). The server must enforce every rule the buttons enforce.
- **PEN-039 Identity field spoofing.** Add or alter `playerId`, `operatorId`, or
  `sessionId` in outgoing frames. The server must take identity only from the
  authenticated session, never from the payload.

> The 11:58–12:18 outage where `JoinScratch` threw *"An unexpected error occurred"*
> for every game is a reminder to also assert the **failure** path: on a backend
> error the client must fail closed (no phantom round, no local balance change),
> which the `ScratchHubServerError` handling now enforces on our side.

---

## 8. Stress & load testing

| ID | Scenario | What it proves | Suggested load |
| --- | --- | --- | --- |
| STR-001 | Sustained buy/settle loop on one session | No memory/balance drift over time | 10k+ rounds |
| STR-002 | Many concurrent sessions buying at once | Backend concurrency & DB integrity | 100–1000 virtual players |
| STR-003 | `StartRound` flood on one socket | Rate limiting / anti-spam | as fast as possible |
| STR-004 | Rapid connect/disconnect churn | Connection pool exhaustion, orphaned rounds | high reconnect rate |
| STR-005 | Spike then idle then spike | Autoscaling & recovery | burst pattern |
| STR-006 | Largest grid (5×5) at `maxBet` under load | Worst-case payload/compute path | sustained |
| STR-007 | Long-running soak (hours) | Slow leaks, session TTL handling | overnight |

Watch during load: server error rate, `JoinScratch`/`StartRound`/`Cashout` latency
percentiles, balance-reconciliation errors, dropped/duplicated rounds, and
DB-vs-hub balance consistency.

Tooling: [k6](https://k6.io/) or [Artillery](https://www.artillery.io/) with a
websocket/SignalR scenario for STR-002…005; a small Node script built on top of
`ScratchHubWatcher` for the single-session loops (STR-001, STR-006) and for all the
`PEN-###` frame-level fuzzing.

---

## 9. What "solid" looks like (acceptance)

The scratch game is well-hardened when **all** of the following hold under every test
above:

1. The server is the only authority on outcome and balance; no client input changes
   the dealt card or the paid amount.
2. Every illegal or malformed request fails closed — rejected, no crash, no balance
   move, no orphaned round.
3. Balance always reconciles exactly: `final = initial − Σbets + Σwins`.
4. No round is ever double-charged, double-paid, replayed, or re-rolled.
5. Payouts never exceed `bet × maxWinMultiplier` / `maxWin`, and every paid
   multiplier exists in the pay table.
6. Empirical RTP over a large sample tracks the configured value.
7. The service degrades gracefully under load and recovers after an outage without
   leaving rounds in a bad state.

---

## 10. Notes

- Run only on staging with disposable test accounts; never against production or real
  balances.
- Prefer the socket over the canvas: it is faster, deterministic, and exercises the
  real trust boundary.
- Any finding here should be filed for the backend/game team; the QA `SCG-###`
  catalog stays owned by QA and is not modified by this document.
