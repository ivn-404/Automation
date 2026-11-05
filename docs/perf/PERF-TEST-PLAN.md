# SGAP — Performance (PERF) test plan

Status: **draft for review** — no code until this is approved.
Decisions taken (2026-10-28): objective is both build-to-build regression and root-cause help;
desktop Chrome on the reference machine first, mobile later; hybrid workflow (automated runs
flag, QA diagnoses from traces); pilot game **Gnome Mansland** (00290426, Package 6); monitor
fixed at **60 Hz**; Windows power plan kept at **Balanced**; a live **FPS counter** on every run.
Test cases: [`docs/catalogs/FPS_TestCase.md`](../catalogs/FPS_TestCase.md) (PAD-001…056).

## 1. Goal

Give QA a repeatable way to answer, for any game build:

1. Is it smooth enough on the reference machine? (pass / warn / fail)
2. Did it get worse than the last build? (regression)
3. When it stutters, what was happening at that moment, and what is the likely cause? (evidence)
4. Which assets waste memory or bandwidth, and what should developers change? (asset audit)

Out of scope for phase 1: mobile devices, Safari, Firefox, throttled networks (the 3G profile
stays separate), and judging visual quality.

## 1a. Reference machine

The QA workstation is the reference machine (fingerprint taken 2026-10-28):

| Item | Value |
| --- | --- |
| CPU | AMD Ryzen 5 4600G, 6 cores / 12 threads |
| GPU | AMD Radeon integrated graphics (shares system RAM), driver 31.0.21925.1001 |
| RAM | 32 GB |
| Displays | 2 × N2755 Pro, 1920×1080, running at 60 Hz (panel max 75 Hz) |
| Power plan | Balanced |
| Type | Desktop (no battery) |

The integrated GPU makes this a mid-to-low-end gaming target, close to a typical player PC: a game
that is smooth here is likely smooth for most desktop players; a stutter here is a real risk.

"Keeping the machine clean" means every run starts from the same conditions, so a change in the
numbers comes from the game build, not the PC. The PERF runner does a **pre-flight check** and
writes the result into the report; it warns (does not block) when:

- another SGAP lane, screen recorder, video call, or heavy app is running (CPU busy > 15% before start);
- the power plan is not **Balanced** (the agreed baseline — Balanced lets the CPU down-clock, so
  results are a little noisier than High performance, but it is how the PC is normally used and it
  is kept the same for every run);
- the monitor is not at **60 Hz**;
- the game window is not on the primary monitor, not in front, or partly covered;
- Chrome, GPU driver, refresh rate or resolution differ from the stored baseline.

Only runs with the same fingerprint are compared for regression.

## 2. What we measure

| Metric | Definition | Why |
| --- | --- | --- |
| Frame time | ms between consecutive **rendered** frames (Phaser `postrender`) | the raw signal everything else derives from |
| Browser FPS | rAF ticks ÷ window seconds, reported next to rendered FPS | shows page responsiveness; not scored |
| FPS cap | Phaser `fps.target` / `fps.limit` from the game config | a `limit` below 60 is reported as a finding against the 60 target |
| Average FPS | frames ÷ window seconds | headline number only |
| 1% low FPS | 1000 ÷ mean of the slowest 1% frame times in the window | what the player feels in stutters |
| P95 / P99 frame time | percentile of frame times | stable, comparable stutter measure |
| Long frames | count of frames > 2× budget (33 ms at 60 Hz) and > 100 ms ("hitches") | visible hitches |
| Long tasks | main-thread tasks > 50 ms (PerformanceObserver `longtask`) | JS blocking the frame |
| Main-thread busy % | CDP `Performance.getMetrics` TaskDuration delta ÷ wall time | CPU pressure |
| JS heap | CDP `JSHeapUsedSize` at window start / end, after forced GC between scenarios | leak indicator |
| Texture memory (est.) | Σ width × height × 4 over loaded Phaser textures | GPU memory pressure proxy |
| Draw load hints | renderer type (WebGL / Canvas), display-list object count, active particle emitters | overdraw / particle cost |

### Refresh rate — 60 Hz baseline, headroom measured separately

Chrome never draws faster than the monitor refreshes, so on the 60 Hz screen a game can show at
most 60 FPS, however light it is. The plan therefore measures in two modes:

- **Player mode (default):** normal Chrome at the agreed **60 Hz** (16.7 ms frame budget). This is
  what a player sees, and what pass/fail uses. The refresh rate is still detected each run; if it
  is not 60 Hz the run is flagged and not compared with the baseline.
- **Headroom mode (diagnostic, PAD-053):** Chrome launched with its frame-rate cap removed
  (`--disable-gpu-vsync --disable-frame-rate-limit`). The game then runs as fast as the PC allows,
  showing how far above 60 it *could* go — e.g. "Gnome idles at 240 FPS but drops to 70 during a
  long tumble chain" means a 144 Hz player would see stutter even though a 60 Hz player would not.
  This keeps the "60 and above" view without changing the monitor. Never used for pass/fail.

Variable refresh (AMD FreeSync on this AMD setup, G-Sync on NVIDIA) lets the monitor follow the
game's frame rate. It is left as the player would have it, but its state is recorded in the
fingerprint; runs with different settings are not compared.

## 3. How we measure (two layers)

**Layer 1 — always on during PERF runs (cheap).**

- Inside the game iframe (same hook SGAP already uses: `window.phaserGame` / `Phaser.GAMES`):
  - rendered frames: a `game.events` `postrender` listener timestamps every frame Phaser draws;
    rAF ticks are kept alongside as browser frames, and `actualFps` is sampled per drain
    (no per-frame round trips to Node; the buffers are pulled every 500 ms). Windows score on
    rendered frames and fall back to rAF (`frameSource: browser`) when no Phaser game is found.
  - Why not rAF or `actualFps`: both count loop ticks, including the ones a game's `fps.limit`
    skips. FPS Phase 0 (2026-10-30, `tests/specs/probe/FPS-PHASE0.spec.ts`) measured the local
    Gnome build (`fps.limit` 15) at rAF 59.9 / `actualFps` 59.4 while `postrender` and Chrome
    trace frames were both 15.0; on staging (no cap) all agreed at 59.9. The sampler costs
    0 rendered FPS.
  - texture list (`game.textures.list`): key, source size, frame count.
  - display-list size and particle emitter count per scene, sampled once per second.
- Browser: `PerformanceObserver` for `longtask`; CDP `Performance.getMetrics` once per second.
- SGAP events already recorded: clicks (`interactions.json`), `/bet` responses with tumble count,
  free-spin rounds, dialogs dismissed. Every sample and event shares one clock
  (`performance.timeOrigin` + `now()`), so a dip lines up with "tumble 3 of spin 7".

**Layer 2 — on demand (expensive).** When Layer 1 flags a window, the same scenario is rerun with a
Chrome performance trace (`Tracing.start` with the `devtools.timeline` and `disabled-by-default-devtools.timeline.frame`
categories) and attached to Allure for QA to open in DevTools. Never during Layer 1 measurements.

**Machine fingerprint** on every report: CPU, RAM, GPU and driver (CDP `SystemInfo.getInfo`),
Chrome version, window size, device pixel ratio, refresh rate, power plan, hardware acceleration
on/off.

### 3b. Live FPS counter

Every PERF run shows the current FPS while it plays, so QA can watch it instead of reading numbers
afterwards:

- **On the game page:** a small badge in the launcher page corner, **outside the game iframe**
  (the game itself is never modified), showing current FPS (last 1 s), 1% low (last 10 s) and the
  band colour — green ≥ 60, light green 40–59, yellow 30–39, orange 24–29, red < 24. It also shows the current PAD
  case and window ("PAD-003 · spin 4/10").
- **In the worker monitor tab:** the same numbers per lane plus a 60-second sparkline, fed by the
  status server on port 3847 that already drives the monitor.
- **Data source:** the same frame samples the collector records, so the counter and the report can
  never disagree. PAD-054 checks the badge against the recorded average (±2 FPS).
- **Cost:** the badge redraws its text twice a second (no canvas, no animation). PAD-042 measures
  the run with the counter and collector on vs off; if the counter costs more than 1 FPS it is
  moved to the monitor tab only.
- Can be turned off with `SGAP_PERF_COUNTER=0`, and is also available (read-only) during normal
  functional runs as an extra signal.

## 4. Controlling our own overhead

The SGAP functional runner does things that cost frames. Inside a measurement window:

- no screenshots, no vision healing, no canvas captures, no Playwright video or trace;
- worker-monitor overlay hidden (status server keeps running); the FPS counter badge stays (§3b);
- one game window, headed, foreground, on the primary monitor, not occluded — background or
  covered windows are throttled by Chrome;
- **headless is forbidden** (it renders on SwiftShader, a CPU rasteriser; numbers are meaningless).

Acceptance check before any threshold is trusted (PAD-042): run the idle scenario with and without
the collector and FPS counter; together they may move average FPS by ≤ 1 FPS and P95 frame time
by ≤ 1 ms.

## 5. Scenarios

The test cases, with their measurement windows, run counts and expected results, are in
[`docs/catalogs/FPS_TestCase.md`](../catalogs/FPS_TestCase.md): PAD-001…048 (QA draft, revised) and PAD-049…056
(additions). Each case is a measurement window with a fixed start and end trigger.

**Comparable workload (no debug build).** QA tests the game exactly as a player does — no fixed
outcomes. So:

- every spin's workload is read from its own `/bet` response (tumble count, win size, multiplier,
  feature trigger) and results are reported per workload bucket ("0 tumbles", "1–2", "3+",
  "big win") — a build is never blamed for drawing a heavier spin;
- cases that need a rare outcome (PAD-007 big win, PAD-012 scatter/wild/multiplier, PAD-049 long
  tumble chain) keep spinning until they collect the required number of qualifying spins, with a
  spin cap, like FS-008's retrigger hunt;
- Buy Feature is the repeatable way into the bonus for PAD-008, 009, 017;
- more repetitions than a fixed-outcome build would need (the run counts are minimums).

## 6. Procedure per run

1. Close other apps and other SGAP lanes; power plan stays Balanced; monitor at 60 Hz.
2. Launch the PERF lane (one worker) through the worker monitor.
3. Warm-up: load the game once, discard.
4. Run the cases in priority order (FPS_TestCase.md §7, calibration first); force GC (`HeapProfiler.collectGarbage`) and 5 s idle
   between scenarios.
5. Pull Layer 1 data; compute metrics per window and per workload bucket.
6. Compare with the stored baseline of the same game + machine fingerprint.
7. Flag windows that breach thresholds (§7); rerun only those with a Layer 2 trace.
8. Publish Allure: timeline charts, metric tables, flagged windows, trace files, asset audit.

## 7. Pass / warn / fail

QA target (agreed 2026-10-28): games should reach **60 FPS or more**. Below that, the lower the
FPS, the higher the priority. FPS bands, applied to each measurement window's average FPS and,
separately, to its 1% low:

| Band | FPS | Result | Action |
| --- | --- | --- | --- |
| Pass | ≥ 60 | pass | none |
| Passable | 40–59 | pass | recorded and trended only |
| Investigate | 30–39 | warn | investigate why the game cannot reach 60 |
| Needs optimization | 24–29 | fail | performance defect; optimization required |
| Priority | < 24 | fail | performance defect, fixed first |

Bands agreed with QA on 2026-10-28.

Other limits stay **provisional** until the pilot calibrates them (§10):

| Metric | Pass | Warn | Fail |
| --- | --- | --- | --- |
| P95 frame time (60 Hz) | ≤ 25 ms | 25–33 ms | > 33 ms (below 30 FPS pacing) |
| Hitches (> 100 ms) per spin | 0 | 1 | ≥ 2 |
| Heap after long session vs. start (after GC) | ≤ +10% | +10–25% | > +25% and not recovering after idle |
| Long load (PAD-043) | ≤ 8 s | 8–15 s | > 15 s |

**Relative (regression vs. the previous build's baseline, same machine):** warn when P95 frame time
or 1% low worsens by more than the run-to-run noise measured in calibration (expected ~10%); fail
at twice that.

A single breach is never a defect on its own: it must reproduce in ≥ 3 of 5 repetitions of the
same workload bucket.

## 8. Asset audit (PAD-022…030)

**Network inventory** (CDP `Network` events in the game frame): URL, type, transfer size, decoded
size, cache status, timing. Bodies are hashed (SHA-256) to find:

- the same content under different URLs (true duplicates — strong evidence);
- the same URL downloaded more than once in a session (cache misses);
- assets loaded but never used as a texture or audio key (load-but-unused, best effort).

**Texture inventory** (Phaser texture manager):

- each texture's dimensions, estimated GPU bytes, frame count;
- atlases larger than 4096 px on a side, non-power-of-two atlases, low fill (many empty pixels);
- textures loaded at far higher resolution than ever displayed (max displayed size from the
  display list during the run);
- the same image hash under several texture keys.

**Cross-game view:** run the audit on every game in a package and list assets shared by hash —
candidates for a shared bundle.

Audio, fonts and Spine files are listed by size and type; Spine skeleton complexity (bones, slots)
is reported only if the runtime exposes it — otherwise marked "not measurable".

## 9. Optimization advisor (rules, evidence-first)

Each tip states the observation, the evidence, a confidence level and what to check. Initial rules:

| Observation | Tip | Confidence |
| --- | --- | --- |
| Identical hashes under different URLs/keys | Load once, reference by one key | High |
| Texture ≥ 2× its largest displayed size | Downscale or ship a lower-resolution variant | High |
| Atlas > 4096 px or low fill | Split / repack the atlas | Medium |
| Hitches only on the first spin | Pre-warm (upload textures, compile shaders) during load | Medium |
| Frame-time spikes coincide with particle emitter count spikes | Cap particles / pool emitters | Medium |
| Heap grows per bonus round and does not recover | Check destroy() of scenes, listeners, Spine objects | Medium |
| Long tasks during tumble resolution | Spread work across frames | Medium |
| Same asset downloaded twice | Fix cache headers / loader keys | High |

Anything not backed by a measurement in the run is labelled **hypothesis**.

## 10. Pilot and calibration (Gnome Mansland)

Gnome is the newest Package 6 release and has the heaviest moments in the package (tumble ladder
up to x1024, marked-symbol wilds, four buy tiers, scratch card), and SGAP already runs it reliably.

1. Measure collector + FPS counter overhead (PAD-042) and counter accuracy (PAD-054) — must pass
   before anything else.
2. Run the P0 cases 3 times on the same build on the same day → run-to-run noise per metric (PAD-041).
3. Set relative thresholds from that noise; sanity-check the FPS bands against what QA sees on
   screen (does an "Investigate" spin look rough to a person?).
4. Repeat on Zero Law and Boobie Trap (same package, different art) to check the thresholds hold
   within a package.
5. Store baselines per game + machine fingerprint.

Gnome caveats: free-spin rounds currently end early at a 30.00 "max win" (regression report
2026-10-27), so bonus cases see short rounds until it is fixed — reports note spins per round.
Autoplay cannot be stopped reliably, so autoplay cases use a fixed spin count and let it finish.

Exit criteria for the pilot: noise < 10% on P95 frame time for PAD-001/003; overhead within limits;
at least one heavy moment (a long tumble chain or big win) visibly located on the timeline.

### 10a. First full quick pass — Gnome Mansland, 2026-10-28 (RUN-0014…0017)

Quick mode (fewer repeats), bundled Chromium, screen 2. Candidate findings to confirm with a full
(non-quick) run before reporting to the game team:

| Case | Observation |
| --- | --- |
| PAD-020 | One display object is left behind per menu open/close: 37 → 43 and 39 → 44 over 6 cycles, in both attempts. Heap stays flat (27.5 → 27.6 MB). |
| PAD-023 | `symbols/MagicM_GL.webp` (227 KB) is fetched from the network 3 times in one cold session; `help_screen/.../enhanced_bet.png` twice in one attempt. |
| PAD-017 | Heap after GC grows about 1.5–3.5 MB per bought bonus round (24 → 29 → 33 MB). Two rounds are not enough to tell warm-up from retention; the full run plays 5. |
| PAD-055 | Resuming an unfinished bonus after reload: one 250 ms frame 1.5–1.9 s into the resumed game, both attempts. |
| PAD-011 | One attempt had a 284 ms frame on menu open, starting after SGAP's capture had ended; the retry stayed at 50 ms. |
| PAD-022 | 4 groups of identical images under different URLs (base and bonus backgrounds, firefly, smoke); 65 KB in total. |

Measured and within limits: cold load 5.9 s (spin ready, including SGAP's splash tap, 11–12 s),
warm load 5.2 s, warm reload 100% of game bytes from cache, 30-minute-style autoplay session with
steady 59.9 FPS. Skipped on luck in quick mode: PAD-007, 012, 033, 035, 049. PAD-012 can only use
multipliers on Gnome because its manifest has no `reelValidation` symbol kinds (no scatter/wild
detection). PAD-053 needs a Headroom run.

## 11. SGAP integration

- New spec folder `tests/specs/pad/`, category `PAD`, capability gate per case (e.g. no
  PAD-008/009/017 without Buy Feature).
- **PAD Tester** page in the control panel (`pnpm qa` → `http://127.0.0.1:3850/pad`), separate from
  the Test runner: pick one game, the PAD cases and the screen (screen 2 by default), then Run. It
  shows the live FPS, 1% low, band and a 60 s sparkline, the per-case results, and the drop log. PAD
  is hidden from the Test runner, a PAD run is refused while any other run is active, and Test
  runner runs are refused while a PAD run is measuring.
  - **Browser:** bundled Chromium (default), installed Chrome, or installed Edge (PAD-040 is run
    once per browser; each run is stored and compared in `perf-baselines/<gameId>.json`).
  - **Headroom:** starts the browser with `--disable-gpu-vsync --disable-frame-rate-limit` for
    PAD-053. FPS verdicts of other cases in the same run are not comparable to 60 Hz baselines.
  - **Quick pass:** `SGAP_PAD_QUICK=1` — fewer repeats and shorter windows, for checking the
    automation; not a verdict run.
  - **PAD-056** adds a second lane (`tests/specs/pad-load/BUSY-056.spec.ts`) on the other screen.
    It waits on a blank page and only spins while PAD-056 asks for load (hand-off files in
    `runs/<id>/pad-busy/`).
- SGAP's own screen checks (vision helpers used to dismiss overlays and wait for an idle HUD
  during bonus rounds, menus and autoplay) capture the page. Each capture is recorded as an
  excluded span and its frames do not count, as are periods when the page was hidden
  (minimised window, hidden tab). Every window reports how much time was excluded and why.
- Baselines kept between runs (`perf-baselines/<gameId>.json`, append-only): idle CPU (PAD-013),
  build profile (PAD-039), browser profile (PAD-040), warm load (PAD-044). The game build label is
  `SGAP_GAME_BUILD`, else a version field from `/initialize`, else Phaser's game config.
- Cases that need luck (big wins PAD-007, effects PAD-012/035, Spine PAD-032, long tumbles
  PAD-049) spin up to a budget and are marked skipped with the reason when nothing qualifies;
  PAD-033 is skipped when the game shows no Phaser particles.
- Cache use comes from CDP (`Network.requestServedFromCache`, `fromDiskCache`): Playwright's
  request sizes report a body size for cache hits too. Repeated downloads are scored for files the
  game iframe loads; the launcher's own repeats are listed but not scored.
- Load time (PAD-043/044) is iframe start → the last game asset fetched before SGAP's first tap has
  arrived and frames run under 34 ms for 0.5 s. Time to a ready spin button, which includes SGAP
  noticing and tapping the splash, is reported next to it.
- `settle` plays out a feature round the game resumes into (from `/initialize` `unresolvedSpin`)
  before measuring, and autoplay batches play out a feature the last autoplay spin entered.
- Long-session heap (PAD-019) is scored against the heap after the first batch; growth from load to
  the first batch (first-use warm-up) is reported, not scored.
- Terminal runs use `config/parallel-workers-perf.json`: **one worker**, screen 2; never mixed with
  functional lanes. Lanes accept `channel` (e.g. `msedge`) and `browserArgs`.
- Collector code under `src/perf/` (in-frame sampler, CDP sampler, metric maths, asset audit,
  advisor rules); game-specific knowledge stays in manifests / surfaces as today — no per-game
  branches.
- Results: Allure attachments per window (JSON + chart), plus a per-run `perf-summary.json` used as
  the next baseline.
- Dashboard (later): a Performance page reading the same summaries — trend per game across builds.

## 12. Risks and open questions

- **Resolved 2026-10-28:** reference machine = QA workstation (§1a); target 60 FPS, 40–59 passable, below 30 needs optimization, below 24 priority (§7);
  baselines at 60 Hz with a separate uncapped headroom mode (§2); power plan Balanced, kept fixed;
  no debug build — QA plays the game as a player, workload taken from `/bet` (§5); live FPS counter
  (§3b); pilot game Gnome Mansland (§10).
- **Two monitors:** PAD runs use the primary one only; the second must not host another SGAP lane
  during a PAD run (shared integrated GPU) — PAD-056 measures how much it matters.
- **Phaser version differences** across packages may change field names (`actualFps`, texture source
  layout); the sampler must degrade gracefully and report "not available".
- **WebGL context info** (draw calls) is not exposed by Phaser without patching the renderer; we
  will not inject code that changes game behaviour, so draw calls stay out of phase 1.

## 13. Rollout

| Phase | Deliverable | Depends on |
| --- | --- | --- |
| 0 | This plan approved (reference machine and target FPS agreed 2026-10-28) | QA lead |
| 1 | Layer 1 collector + live FPS counter; P0 cases (PAD-001…003, 041, 042, 046, 054) on Gnome Mansland; calibration | phase 0 |
| 2 | Remaining scenarios, workload buckets, Layer 2 traces, Allure charts | phase 1 exit criteria |
| 3 | Asset audit + advisor rules; run across Package 6 | phase 2 |
| 4 | All packages, baselines per build, dashboard trend page | phase 3 |
| 5 | Mobile (real Android Chrome first) | separate plan |
