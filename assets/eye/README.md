# SGAP Eye catalog

Canonical **scenario library**, not a dump of test-run screenshots.

```
assets/eye/
  catalog.json                          policies + detectors (all games)
  scenarios/<scenario-id>/references/
    sugar-wonderland.png                golden crop for that game
    felice-in-space.png                 add more games here
```

Runtime captures (gitignored):

```
test-results/eye/<scenario-id>/<gameId>-<time>.png
test-results/eye/unknown/<gameId>-<time>.png
```

How to add another game: drop `<gameId>.png` into the matching `references/` folder. Host-text scenarios (session timeout, ongoing round) auto-save a golden the first time they match, so you usually only need a PNG for canvas-only popups with no readable text.

Do not copy Allure/test-results screenshots into this tree — those are per-run debug, not the library.
