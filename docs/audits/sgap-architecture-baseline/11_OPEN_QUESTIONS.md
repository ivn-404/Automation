# 11 — Open questions

> Audit date: 2026-11-11.
> These cannot be answered from the repository without a QA decision, a backend contract, or a run this audit was not allowed to start.

## Requirements and catalogs

1. Which document is the signed manual source when `docs/catalogs/RegressionTestCases.md`, `docs/catalogs/SmokeTestingTestCases.md`, and Google Sheets disagree? Sheets are not downloaded by SGAP. CSF-010, CSF-011, and AT-002 already differ between the two markdown catalogs (F-030).
2. Are BF-011, BF-012, and PEN-073 accepted cases or experiments? They have specs and no regression/pentest catalog line.
3. Should MN-001 be added to `RegressionTestCases.md`? It is in `AUTOMATED_REGRESSION_IDS` and has a spec, and it has no catalog heading.
4. Is the AS family (AS-001–009) still in scope? The suite file includes it. There is no spec directory (F-080).
5. Why are WD-001–003 skipped with “workers must not run these specs” while `qa-suites.json` offers a WD family for packages 7 and 11? Is the skip a safety hold or an abandoned mechanic?
6. Is SCG-024 in the regression set? The spec exists. The automated-id set stops at SCG-023. The pending generator will keep calling SCG-024 manual.
7. CSF-006 (reel match) is implemented and excluded from `AUTOMATED_REGRESSION_IDS`. Is that intentional because only Package 1 has `reelValidation`?

## Backend payload semantics

8. Does every successful slot stake include a stable server id (round, transaction, or bet id) that SGAP should copy? The client stores `transactionState` only when the manifest path returns a string, and stores `unresolvedSpin` only for feature rounds (F-016). The field list inside a live `/bet` was not captured in this audit.
9. What does `transactionState` mean per package? No enum was found in `src/data`.
10. Are `slot.base.win` and `slot.bonus.win` required for balance proofs? The manifest can name them. `parseBetResponseBody` ignores them (F-014).
11. For Package 2, have `network` area/tumble paths been filled since the October note that they were deliberately absent? Controllers are enabled (F-009). `reelValidation` was reported absent. A staging payload was not opened.
12. Is scatter id `0` true for every package that sets `freeSpinRetrigger: true` without a rules object? The evaluator will not guess an award, and it will still default the id set when rules exist and omit ids.
13. What is the hold-and-win reset rule per game? Package 9 text mentions 3 respins. Nothing in TypeScript asserts it (F-020).
14. Does Package 1 `/bet` gain a turbo flag in later builds? The turbo controller comment says it does not, and that `isEnhancedBet` is Amplify (F-024). A current payload would confirm.
15. Is `buyFeat` ever a price rather than a 0/1 flag on any package? The cost helper assumes it is a flag (F-026 area).

## Product behavior not re-tested

16. Is the Sugar AT-003 HUD lag still present after 2026-10-06 (F-061, NEXT_STEPS item 1)?
17. Does Felice BF-003 still stall 90s with no `/bet` (NEXT_STEPS item 6)?
18. Do AT-004 and AT-005 still fail because the first session is disconnected before `/bet` (item 3)?
19. What failed in `allure-history/run-20261106-182629-regression` (109 failed / 352) and in `run-20261107-165618` (0 passed / 430 failed, label all packages)? Infrastructure versus assertions is UNKNOWN (F-050).
20. Which game and which case is the single failure in `run-20261110-202542-regr` (F-052)? The summary widget does not name it. The result JSON was not opened.
21. Are package 2–7 and 9 slot controllers actually wired to working HUD ratios, or were flags copied from Package 1? Surface files are missing for packages 2 and 4 (F-070). No November per-game score was extracted.

## Platform and process

22. Does the QA page enforce “max 4 games” before writing a lane file, or is that only a comment (F-038, `qa-suites.json` line 2)?
23. Does the unref’d monitor Chrome exit when the HTTP server closes? Not executed.
24. Does `InMemoryExecutionTracker` key by manual id alone, and can two games in one process overwrite each other (F-032)? Parallel mode uses one process per lane, which may hide the bug.
25. When was the non-excluded Allure `gameId` parameter introduced? History before that date cannot be split per game without rewriting results. The commit was not identified.
26. Are soft assertion failures in PAD treated as test failures by the Allure category config (F-034, F-036)?
27. Does UIDS-012 read a history API, the HUD, or the bet body (F-033)?
28. Is a live token stored in `scripts/pen/hub-probe.mjs`? Not opened, to avoid printing secrets. A human should check.
29. Do `docs/` and `docs/catalogs/` copies of the case lists still match byte for byte (F-060)? Lengths matched at explore time. They were not re-hashed.
30. What do the PDFs in `docs/packages/` require that JSON does not? PDF text was not extracted.

## Game client source

31. The slot client source is not in this repository. Phaser global name `window.phaserGame`, hub URL `ws://localhost:5068` on Sugar, and portrait-only layout are observed from the automation side only. Confirming whether those are build bugs or environment wiring requires the game repo or a staging owner.
32. Initialize `maxWin` versus package `maxWinMultiplier` (2100, 5000, 20000, 2000, and Package 1’s flag) — which one is contractual when they disagree? ES specs exist. Their oracles were not compared to initialize samples in this audit.

## Evidence this audit refused to create

33. No spec was executed, so every “VERIFIED on staging” question for 2026-11-11 is open by design. Stored Allure folders remain the only execution evidence, and they must be cited with their date and total.
