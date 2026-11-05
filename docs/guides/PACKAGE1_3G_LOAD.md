# Package 1 — 3G loading time

Measured on the staging launcher. These are not estimates.

The clock starts at the first child-frame document request (the game iframe navigation after the launcher Play click) and stops when the round green splash Play button is input-enabled. One click on that button must reveal the game HUD. The click is the splash control in the reference image. It is not a wager.

Launcher search time before that document request is not included. A visible canvas, a finished loading screen, or a Phaser hit that is not the splash button is not ready.

## Conditions

- Network: Chrome DevTools Fast 3G. Download 200000 B/s (1.6 Mbps), upload 93750 B/s (750 Kbps), latency 150 ms. Applied with `Network.emulateNetworkConditions` before each launch, and again after the iframe attached.
- Browser: Chromium 151.0.7922.34
- Viewport: 944×944, touch enabled, one worker, headed
- Cache: `Network.setCacheDisabled` true, a fresh browser context for every run, service workers blocked
- Iframe: site isolation disabled for this run so the 3G profile applies inside the game iframe
- Detection: Phaser poll every 200 ms. The recorded time can be up to one poll later than the button actually enabled. That lag is not subtracted.
- Games: the four released Package 1 titles. Unreleased titles were not loaded.

Observed transfer after the iframe document request sat just under the 200000 B/s cap on every measured run (about 195000–199000 B/s). The cap held.

Each page session also reported 5 `requestServedFromCache` events. That counter covers the whole page after throttling was armed, including the launcher. The game bytes below were still downloaded.

## Comparison, fastest to slowest

Median is the middle of the three raw millisecond values. Nothing was rounded before that.

| Game | Run 1 | Run 2 | Run 3 | Median | Status |
| --- | --- | --- | --- | --- | --- |
| Beelze-Bop | 116.741 s | 116.641 s | 116.463 s | 116.641 s | Measured |
| Sugar Wonderland | 125.740 s | 126.270 s | 125.958 s | 125.958 s | Measured |
| Mars Triumph | 139.098 s | 138.880 s | 139.235 s | 139.098 s | Measured |
| Felice in Space | 296.370 s | 293.902 s | 294.198 s | 294.198 s | Measured |

Fastest median: Beelze-Bop, 116.641 s. Slowest median: Felice in Space, 294.198 s.

Mars Triumph's third value is a replacement cold load. The original third attempt is not in the median. Felice in Space's three values are attempt 1, attempt 3, and a replacement cold load. Attempt 2 timed out and is not in the median.

## Raw milliseconds

- Beelze-Bop run 1: 116740.63180000003 ms. Iframe attached 22138.25589999999 ms. Portrait layout 23286.98509999999 ms. Button 0.500,0.770 114×102. 23202030 bytes.
- Beelze-Bop run 2: 116640.6901 ms. Iframe attached 22315.03760000004 ms. Portrait layout 23227.301399999997 ms. Button 0.500,0.770 115×103. 23200282 bytes.
- Beelze-Bop run 3: 116462.96400000004 ms. Iframe attached 21671.89320000005 ms. Portrait layout 23131.82660000003 ms. Button 0.500,0.770 138×132. 23200464 bytes. Median 116640.6901 ms.
- Sugar Wonderland run 1: 125739.9648 ms. Iframe attached 17828.5951 ms. Portrait layout 19295.399299999997 ms. Button 0.500,0.770 135×141. 24566469 bytes.
- Sugar Wonderland run 2: 126270.34939999998 ms. Iframe attached 18069.641799999983 ms. Portrait layout 19629.49369999999 ms. Button 0.500,0.770 139×143. 24567343 bytes.
- Sugar Wonderland run 3: 125958.4413 ms. Iframe attached 17672.25279999996 ms. Portrait layout 19124.793199999956 ms. Button 0.500,0.770 102×114. 24568639 bytes. Median 125958.4413 ms.
- Mars Triumph run 1: 139098.0704999999 ms. Iframe attached 18602.326499999966 ms. Portrait layout 20559.120799999917 ms. Button 0.500,0.770 143×145. 27241182 bytes.
- Mars Triumph run 2: 138880.16580000008 ms. Iframe attached 18081.4179 ms. Portrait layout 20235.17700000014 ms. Button 0.500,0.770 138×143. 27242394 bytes.
- Mars Triumph replacement: 139235.0085 ms. Iframe attached 18566.757899999968 ms. Portrait layout 20271.60440000001 ms. Button 0.500,0.770 108×119 Image. 27240916 bytes. Confirm 1962.2481999999727 ms, not included in the load time. Median 139098.0704999999 ms.
- Felice in Space run 1: 296370.4205 ms. Iframe attached 22496.84210000001 ms. Portrait layout 24096.87619999994 ms. Button 0.500,0.770 145×143. 58042800 bytes.
- Felice in Space run 3: 293901.97769999993 ms. Iframe attached 20710.897499999963 ms. Portrait layout 22280.688199999975 ms. Button 0.500,0.770 132×138. 58049280 bytes.
- Felice in Space replacement: 294198.0494 ms. Iframe attached 21675.4853 ms. Portrait layout 23376.670899999997 ms. Button 0.500,0.770 134×140 Image. 58045072 bytes. Confirm 2134.8230999999796 ms, not included in the load time. Median 294198.0494 ms.

## Not used as load times

- Felice in Space attempt 2: timeout at 300000 ms. The screenshot is still the DiJoker loader, not the splash button. Console added `net::ERR_QUIC_PROTOCOL_ERROR`. Iframe had attached at 23419.04420000012 ms and portrait layout at 24965.5784 ms. No load time is recorded for this attempt.
- Mars Triumph original attempt 3: 139417.3285999999 ms was recorded, then discarded. The screenshot at that moment is the DiJoker loader, not the green splash button. A loading-screen object in the splash band disappeared after the click, and that was wrongly treated as ready. The replacement above is the third measured cold load.

## What the time is spent on

The iframe is attached in about 18–23 s, and the portrait reload finishes within a few seconds of that. Both are inside the measured interval. Almost all of the remaining time is the throttled download.

Payload size lines up with the medians: Beelze-Bop about 23.2 MB, Sugar Wonderland about 24.6 MB, Mars Triumph about 27.2 MB, Felice in Space about 58.0 MB. Felice is slow because it is about twice the download, not because the button check waited longer.

## Console

Every measured run logged the same two host errors: a 404 on a resource, and `Cannot read properties of null (reading 'useState')`. They did not stop the splash button from becoming clickable. The Felice timeout added the QUIC error above.

Screenshots and the raw JSON are in `test-results/package1-3g/`.

## Four workers at once

One cold load of each game, all four windows open together. Each window still used Fast 3G. The timer at the top left of each window stopped on the splash button.

- BEELZE-BOP — finished at 1 minute 57 seconds (117326 ms)
- SUGAR WONDERLAND — finished at 2 minutes 8 seconds (127886 ms)
- MARS TRIUMPH — finished at 2 minutes 19 seconds (138969 ms)
- FELICE — finished at 4 minutes 55 seconds (294768 ms)

