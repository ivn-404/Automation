# PAD — Performance & Asset Diagnostics test cases

Companion to [`docs/perf/PERF-TEST-PLAN.md`](../perf/PERF-TEST-PLAN.md) (how we measure, environment, thresholds).
Pilot game: **Gnome Mansland** (00290426, Package 6). Cross-check games: Zero Law, Boobie Trap.

## How to read this document

**Reference setup.** QA workstation: Ryzen 5 4600G with integrated Radeon graphics, 32 GB RAM,
1920×1080 monitor at **60 Hz**, Windows power plan **Balanced**, Chrome (headed, game window in
front on the primary monitor). Results are only compared with runs on the same setup.

**FPS bands** (applied to a window's average FPS and, separately, to its 1% low FPS):

| Band | FPS | Result | Action |
| --- | --- | --- | --- |
| Pass | ≥ 60 | pass | none |
| Passable | 40–59 | pass | logged and trended only |
| Investigate | 30–39 | warn | find out why the game cannot reach 60 |
| Needs optimization | 24–29 | fail | performance defect; optimization required |
| Priority | < 24 | fail | performance defect, fixed first |

(Agreed with QA 2026-10-28.) In the tables below, **"Pass band"** means ≥ 40 FPS (Pass or Passable)
on both the average and the 1% low.

**Other limits** (provisional until the Gnome calibration run):
P95 frame time ≤ 25 ms (pass), 25–33 ms (warn), > 33 ms (fail, below 30 FPS pacing); no frame
over 100 ms ("hitch") in a spin; JS heap after a long session ≤ +10% of start after garbage
collection; cold load ≤ 8 s.

**Columns.**

- *Window* — when measuring starts and stops.
- *Runs* — minimum repetitions. Random outcomes: spins are grouped by how heavy they were (tumbles,
  win size, read from the `/bet` response) and only like is compared with like.
- *Mode* — **Auto**: SGAP measures and judges. **Hybrid**: SGAP measures and flags, QA confirms
  by eye or in the Chrome trace. **Manual**: QA performs with the tools; SGAP records.

**Every run shows a live FPS counter** on screen and in the worker monitor (see the plan, §3b), so
QA can watch the number while the automation plays.

---

## 1. FPS & frame stability

| ID | Test case | Window | Runs | Expected result | Mode |
| --- | --- | --- | --- | --- | --- |
| PAD-001 | FPS while the game is idle for 60 s | 60 s after the spin button is ready | 3 | Pass band; no hitches. Becomes the idle baseline | Auto |
| PAD-002 | FPS during the first spin after the game loads | spin click → round complete, first spin of a fresh session | 3 sessions | Pass band; first spin not slower than a warm spin by more than 10% P95 | Auto |
| PAD-003 | FPS during normal reel spins | spin click → round complete | 10 | Pass band per workload group | Auto |
| PAD-004 | FPS across 20 consecutive spins | 1st → 20th spin | 3 | No downward trend: spin 16–20 P95 within 10% of spin 1–5 | Auto |
| PAD-005 | FPS in Turbo Mode | as PAD-003, turbo on | 10 | Pass band; reels and tumbles stay in sync (QA check on recording) | Hybrid |
| PAD-006 | FPS during continuous Autoplay | 50 autoplay spins | 3 | Pass band throughout; no downward trend | Auto |
| PAD-007 | FPS during Big Win / coin animations | big-win start → dismissed | 5 qualifying wins | Pass band; no hitch over 100 ms | Hybrid |
| PAD-008 | FPS during Free Spins | first → last free spin of a bought round | 5 rounds | Pass band | Auto |
| PAD-009 | FPS on Normal → Bonus and Bonus → Normal transitions | buy confirm → first free spin ready; last free spin → base spin ready | 5 each | No freeze; no hitch over 100 ms | Auto |
| PAD-010 | FPS while repeatedly skipping spin animations (click / Space spam) | 10 spins, skip tapped every 150 ms | 3 | No freeze; P95 not worse than PAD-003 | Auto |
| PAD-011 | FPS while opening and closing Menu / Help | open → scroll → close | 5 | Pass band; FPS returns to idle baseline within 2 s of closing | Auto |
| PAD-012 | FPS during Scatter, Wild and multiplier animations | spins where the `/bet` response shows scatters, wilds or a multiplier > 1 | 5 qualifying | Pass band | Hybrid |

## 2. CPU, GPU & memory

| ID | Test case | Window | Runs | Expected result | Mode |
| --- | --- | --- | --- | --- | --- |
| PAD-013 | CPU use while idle | as PAD-001 | 3 | Main-thread busy ≤ idle baseline + 5 points; recorded as the baseline on first run | Auto |
| PAD-014 | CPU use during consecutive spins | as PAD-004 | 3 | No sustained main-thread busy above 80%; no long task over 200 ms | Auto |
| PAD-015 | GPU load during complex animations | as PAD-007 / PAD-012 | 5 | No hitch caused by GPU work (Chrome trace shows GPU or raster task in the slow frame). *Limited: Chrome gives no GPU utilisation %; we use frame timing, texture memory and the trace* | Hybrid |
| PAD-016 | JS heap during continuous gameplay | 100 spins | 3 | Heap (after GC) settles; ≤ +10% from spin 20 to spin 100 | Auto |
| PAD-017 | Memory cleanup after Free Spins | heap and texture count before buy → after return to base | 5 rounds | No step-up per round: round 5 ≤ round 1 + 5% | Auto |
| PAD-018 | Resources after repeated reloads | 5 reloads in the same tab | 3 | Heap and texture count after reload 5 ≤ reload 1 + 5% | Auto |
| PAD-019 | 30-minute continuous session | 30 min autoplay, then 60 s idle | 2 | No downward FPS trend; heap ≤ +10%; no tab crash; idle FPS back to PAD-001 baseline | Auto |
| PAD-020 | Resources after repeated Menu / Help use | 20 open/close cycles | 3 | Heap and object count do not grow per cycle | Auto |
| PAD-021 | Recovery to idle after animations | 30 s idle after a big win or bonus | 5 | FPS and CPU return to the PAD-001 / PAD-013 baseline within 5 s | Auto |

## 3. Asset loading & duplicates

| ID | Test case | Window | Runs | Expected result | Mode |
| --- | --- | --- | --- | --- | --- |
| PAD-022 | Duplicate downloaded files (identical content) | cold load + 20 spins + one bonus | 1 cold, 1 warm | Every duplicate listed with size, URLs and wasted bytes | Auto |
| PAD-023 | Same file downloaded more than once in a session | as PAD-022 | 1 | Repeated downloads listed; none expected | Auto |
| PAD-024 | Oversized textures and sprite sheets | texture list after the bonus has played | 1 | Lists atlases > 4096 px, mostly-empty atlases, and textures ≥ 2× their largest on-screen size | Auto |
| PAD-025 | Spine assets redundant or unused | as PAD-024 | 1 | Spine files listed by size; loaded-but-never-shown animations flagged as *candidates* only. *Limited: depends on what the Spine runtime exposes* | Hybrid |
| PAD-026 | Asset loading during the first spin | as PAD-002, with network log | 3 | No download or image decode inside a slow frame of the first spin | Auto |
| PAD-027 | Asset loading on entering the bonus | as PAD-009 (Normal → Bonus) | 5 | No download or decode inside a hitch | Auto |
| PAD-028 | Audio files: duplicates and size | as PAD-022 | 1 | Duplicate or oversized (> 1 MB per clip) audio listed | Auto |
| PAD-029 | Browser caching of reusable assets | warm reload after PAD-022 | 3 | ≥ 95% of asset bytes served from cache on warm load | Auto |
| PAD-030 | Cleanup after leaving the game | close the game modal in the launcher, then GC | 3 | Launcher page heap returns to within 10% of before the game opened | Auto |

## 4. Rendering & animation

| ID | Test case | Window | Runs | Expected result | Mode |
| --- | --- | --- | --- | --- | --- |
| PAD-031 | Renderer in use | once per load | 3 | Reports WebGL (Canvas fallback is a finding on its own). Spin frame cost is covered by PAD-003 | Auto |
| PAD-032 | Several Spine animations at once | spins with ≥ 3 animated wins on the board | 5 qualifying | Pass band | Hybrid |
| PAD-033 | Particle-heavy animations | windows where the particle count is in the top 10% of the session | 5 | Pass band; frame time does not rise with particle count beyond the budget | Hybrid |
| PAD-034 | Reel drops and tumbles stay smooth | each tumble of PAD-003 spins | 10 spins | Pass band; reels in sync (QA check on recording) | Hybrid |
| PAD-035 | Several effects at once (win + multiplier + tumble) | qualifying spins from the `/bet` response | 5 | No freeze; no hitch over 100 ms | Hybrid |
| PAD-036 | After resizing the window | 3 sizes (1920×1080, 1280×720, portrait 390×844) during idle and a spin | 3 | Pass band at each size; no blank or stretched canvas | Hybrid |
| PAD-037 | Different device pixel ratios | DPR 1, 1.5, 2 (Chrome emulation) | 3 | Report FPS per DPR; Pass band at DPR 1 | Auto |
| PAD-038 | Tab hidden then shown again | hide 30 s → show → 3 spins | 3 | Game resumes; FPS back to baseline within 2 s; no stuck animation | Auto |

## 5. Regression & measurement reliability

| ID | Test case | Window | Runs | Expected result | Mode |
| --- | --- | --- | --- | --- | --- |
| PAD-039 | Current build vs previous build | PAD-001…012 on both builds | as each case | No case worse than the previous build by more than the measured run-to-run noise (expected ~10%) | Auto |
| PAD-040 | Chrome vs Edge | PAD-001, 003, 008 | 3 | Each browser compared with its own baseline; differences documented. *Phase 2* | Auto |
| PAD-041 | Repeatability of a scenario | PAD-003 five times | 5 | P95 spread ≤ 10%; otherwise the result is marked inconclusive | Auto |
| PAD-042 | Overhead of the measuring tools | PAD-001 with the collector and FPS counter on vs off | 3 each | Average FPS changes ≤ 1; P95 frame time ≤ 1 ms | Auto |
| PAD-043 | Cold load | page load → spin ready, cache cleared | 3 | ≤ 8 s; frame stability during load reported separately from gameplay | Auto |
| PAD-044 | Warm load (cached) | as PAD-043, cache kept | 3 | Faster than cold load; within warm baseline | Auto |
| PAD-045 | Browser loses focus or is covered | focus moved away during a spin | 3 | Throttled samples flagged and excluded from results | Auto |
| PAD-046 | Slow frames line up with game events | every flagged window | all | Each hitch is tagged with the nearest event (click, `/bet`, tumble, dialog) | Auto |
| PAD-047 | Reproducing a found FPS problem | the flagged scenario | 5 | Reproduced ≥ 3/5 → defect; 1–2/5 → intermittent; 0/5 → inconclusive | Hybrid |
| PAD-048 | Recovery after a complex sequence | 10 s after PAD-035 / PAD-007 windows | 5 | Covered with PAD-021; kept for traceability | Auto |

## 6. Suggested additions

| ID | Test case | Window | Runs | Expected result | Mode |
| --- | --- | --- | --- | --- | --- |
| PAD-049 | Long tumble chains (Gnome ladder x1 → x1024) | spins with ≥ 5 tumbles | 5 qualifying | Pass band; frame time does not grow tumble by tumble | Auto |
| PAD-050 | Amplify Bet on | as PAD-003, Amplify on | 10 | Same band as PAD-003 | Auto |
| PAD-051 | Buy Feature panel open / tier select / close | panel open → close | 5 | Pass band; no hitch | Auto |
| PAD-052 | Scratch card | open → scratch → close | 3 | Pass band; no hitch | Hybrid |
| PAD-053 | Headroom (frame-rate limit removed) | PAD-001, 003, 008, 049 in headroom mode | 3 | Diagnostic only: report how far above 60 FPS each moment can run and which moments have least headroom | Auto |
| PAD-054 | FPS counter accuracy | PAD-001 and PAD-003 | 3 | On-screen counter within ±2 FPS of the recorded average | Auto |
| PAD-055 | Resume an unfinished bonus after reload | reload mid free-spins → resumed round complete | 3 | Pass band; no hitch on the resume dialog or replayed spins | Auto |
| PAD-056 | Second monitor busy | PAD-003 with another SGAP lane on monitor 2 vs none | 3 | Documents the slowdown from sharing the integrated GPU; confirms PERF runs must run alone | Auto |

## 7. Execution priority

| Priority | Cases | Purpose |
| --- | --- | --- |
| P0 — Calibration | PAD-041, 042, 054, 001, 002, 003, 046 | Prove the numbers are trustworthy before judging the game |
| P1 — Gameplay | PAD-004…012, 034, 035, 049, 050 | Visible stutter during play |
| P1 — Resources | PAD-013, 014, 016…021 | CPU and memory problems |
| P2 — Assets | PAD-022…030 | Optimisation opportunities |
| P2 — Rendering | PAD-015, 031…033, 036…038, 051, 052, 053 | Find rendering bottlenecks |
| P2 — Regression | PAD-039, 040, 043…045, 047, 048, 055, 056 | Builds, browsers and environment |

## 8. Changes from the original draft

- **Measurable results.** "Approved threshold / baseline" replaced with the FPS bands and limits above; every case now has a window, a run count and a mode.
- **Overlaps.**
  - PAD-031 (WebGL during spins) duplicated PAD-003, so it now checks which renderer is in use.
  - PAD-048 overlaps PAD-021. It is kept for traceability and runs in the same window.
  - PAD-019 (30 min) and PAD-016 (heap) now have different lengths and different checks.
- **Honest limits.** PAD-015 (GPU) and PAD-025 (Spine) state what the browser can and cannot measure.
- **Random outcomes.** Cases that need a rare outcome (big win, scatters, multipliers, long tumble chains) say "qualifying". SGAP keeps spinning until it has collected enough of them.
- **PAD-037.** Now varies the device pixel ratio. The game controls its own canvas resolution, so that can't be set directly.
- **PAD-040 (Edge).** Moved to phase 2 because phase 1 is Chrome only.
- **New cases PAD-049…056.** These cover the Gnome tumble ladder, Amplify Bet, the buy panel, the scratch card, headroom mode, FPS counter accuracy, resuming a bonus after reload, and the second-monitor effect.
- **Known Gnome defect.** Free-spin rounds currently end early at a 30.00 "max win" (regression report 2026-10-27). PAD-008, 017 and 009 will see short bonus rounds until it is fixed; the rounds still count, but each report notes how many spins each round had.
