/**
 * Local launcher HTML fixture for offline Playwright tests.
 * Canvas regions simulate spin, bet+/-, turbo toggle, and autoplay bursts.
 */
export const LOCAL_LAUNCHER_HTML = `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="utf-8"><title>SGAP Local Launcher</title></head>
  <body>
    <input placeholder="Search games" />
    <div class="grid grid-cols-2 gap-3">
      <div class="rounded-lg border p-3">
        <div class="group relative">
          <img alt="Other Game" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" />
          <div>Other Game</div>
          <div>99999999</div>
          <button type="button" aria-label="Play in modal" title="Play in modal">Play</button>
        </div>
      </div>
      <div class="rounded-lg border p-3">
        <div class="group relative">
          <img alt="Sugar Wonderland" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" />
          <div>Sugar Wonderland</div>
          <div>00010525</div>
          <button type="button" aria-label="Grant free spins for 00010525">FS</button>
          <button type="button" aria-label="Play in modal" title="Play in modal">Play</button>
        </div>
      </div>
      <div class="rounded-lg border p-3">
        <div class="group relative">
          <img alt="Felice in Space" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" />
          <div>Felice in Space</div>
          <div>00030525</div>
          <button type="button" aria-label="Play in modal" title="Play in modal">Play</button>
        </div>
      </div>
      <div class="rounded-lg border p-3">
        <div class="group relative">
          <img alt="Beelze-Bop" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" />
          <div>Beelze-Bop</div>
          <div>00120925</div>
          <button type="button" aria-label="Play in modal" title="Play in modal">Play</button>
        </div>
      </div>
      <div class="rounded-lg border p-3">
        <div class="group relative">
          <img alt="Mars Triumph" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" />
          <div>Mars Triumph</div>
          <div>00220126</div>
          <button type="button" aria-label="Play in modal" title="Play in modal">Play</button>
        </div>
      </div>
    </div>
    <div id="modal"></div>
    <script>
      const gameDoc = \`<!DOCTYPE html>
<html>
<body style="margin:0">
<canvas id="game" width="400" height="600" style="display:block;width:400px;height:600px;background:#222"></canvas>
<script>
window.__sgapSpinClicks = 0;
window.__sgapBetLevels = [0.2,0.4,0.6,0.8,1,1.2,1.6,2,2.4,2.8,3.2,3.6,4,5,6,8,10,14,18,24,32,40];
window.__sgapBetIndex = 4;
window.__sgapBet = window.__sgapBetLevels[window.__sgapBetIndex];
window.__sgapSpinning = false;
window.__sgapTurbo = false;
window.__sgapAmplify = false;
window.__sgapFullscreen = false;
window.__sgapSettingsView = false;
window.__sgapAutoplay = false;
window.__sgapAutoplayTimer = null;
window.__sgapAutoplayPanelOpen = false;
window.__sgapAutoplayTarget = 10;
window.__sgapAutoplayRemaining = 0;
window.__sgapBuyPanelOpen = false;
window.__sgapMenuOpen = false;

function postBet() {
  fetch('https://stg-game-launcher.dijoker.com/api/v1/slots/bet', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'spin',
      bet: String(window.__sgapBet),
      line: 1,
      turbo: window.__sgapTurbo,
      amplify: window.__sgapAmplify,
      autoplay: window.__sgapAutoplay
    })
  });
}

function startAutoplay() {
  if (window.__sgapAutoplayTimer !== null) return;
  window.__sgapAutoplay = true;
  window.__sgapAutoplayRemaining = window.__sgapAutoplayTarget || 10;
  window.__sgapAutoplayTimer = setInterval(function () {
    if (window.__sgapAutoplayRemaining <= 0) {
      stopAutoplay();
      return;
    }
    window.__sgapAutoplayRemaining -= 1;
    postBet();
  }, 250);
}

function stopAutoplay() {
  window.__sgapAutoplay = false;
  if (window.__sgapAutoplayTimer !== null) {
    clearInterval(window.__sgapAutoplayTimer);
    window.__sgapAutoplayTimer = null;
  }
}

document.getElementById('game').addEventListener('click', function (event) {
  const rect = this.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;

  if (y >= 0.72 && y <= 0.84 && x >= 0.86 && x <= 0.96) {
    if (window.__sgapSpinning || window.__sgapAutoplay) return;
    window.__sgapBetIndex = Math.min(window.__sgapBetLevels.length - 1, window.__sgapBetIndex + 1);
    window.__sgapBet = window.__sgapBetLevels[window.__sgapBetIndex];
    return;
  }
  if (y >= 0.72 && y <= 0.84 && x >= 0.68 && x <= 0.86) {
    if (window.__sgapSpinning || window.__sgapAutoplay) return;
    window.__sgapBetIndex = Math.max(0, window.__sgapBetIndex - 1);
    window.__sgapBet = window.__sgapBetLevels[window.__sgapBetIndex];
    return;
  }
  if (y >= 0.02 && y <= 0.14 && x >= 0.88 && x <= 0.98) {
    window.__sgapFullscreen = !window.__sgapFullscreen;
    return;
  }
  if (y >= 0.84 && y <= 0.94 && x >= 0.86 && x <= 0.98) {
    window.__sgapTurbo = !window.__sgapTurbo;
    return;
  }
  if (y >= 0.84 && y <= 0.94 && x >= 0.18 && x <= 0.34) {
    if (window.__sgapAutoplay) {
      stopAutoplay();
    } else {
      window.__sgapAutoplayPanelOpen = true;
    }
    return;
  }
  if (window.__sgapAutoplayPanelOpen && y >= 0.45 && y <= 0.58 && x >= 0.12 && x <= 0.32) {
    window.__sgapAutoplayTarget = 10;
    return;
  }
  if (window.__sgapAutoplayPanelOpen && y >= 0.74 && y <= 0.86 && x >= 0.35 && x <= 0.65) {
    window.__sgapAutoplayPanelOpen = false;
    startAutoplay();
    return;
  }
  if (window.__sgapAutoplayPanelOpen) {
    return;
  }
  // Confirm / cancel must be checked before open — y=0.78 is on both edges.
  if (window.__sgapBuyPanelOpen && y >= 0.76 && y <= 0.86 && x >= 0.30 && x <= 0.70) {
    if (window.__sgapSpinning || window.__sgapAmplify || window.__sgapAutoplay) return;
    window.__sgapBuyPanelOpen = false;
    fetch('https://stg-game-launcher.dijoker.com/api/v1/slots/bet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'buy',
        bet: '100',
        line: 1,
        buyFeat: 1,
        turbo: window.__sgapTurbo,
        autoplay: window.__sgapAutoplay
      })
    });
    return;
  }
  if (window.__sgapBuyPanelOpen && y >= 0.86 && y <= 0.96 && x >= 0.30 && x <= 0.70) {
    window.__sgapBuyPanelOpen = false;
    return;
  }
  if (window.__sgapBuyPanelOpen) {
    return;
  }
  if (y >= 0.66 && y <= 0.78 && x >= 0.28 && x <= 0.48) {
    if (window.__sgapSpinning || window.__sgapAmplify || window.__sgapAutoplay) return;
    window.__sgapBuyPanelOpen = true;
    return;
  }
  if (y >= 0.84 && y <= 0.94 && x >= 0.62 && x <= 0.78) {
    if (window.__sgapAutoplay) return;
    window.__sgapAmplify = !window.__sgapAmplify;
    return;
  }
  if (window.__sgapMenuOpen) {
    if (y >= 0.08 && y <= 0.18 && x >= 0.62 && x <= 0.82) {
      window.__sgapSettingsView = true;
      return;
    }
    if (
      (y >= 0.14 && y <= 0.28 && x >= 0.82 && x <= 0.98) ||
      (y >= 0.84 && y <= 0.94 && x >= 0.04 && x <= 0.16)
    ) {
      window.__sgapMenuOpen = false;
      window.__sgapSettingsView = false;
    }
    return;
  }
  if (y >= 0.84 && y <= 0.94 && x >= 0.04 && x <= 0.16) {
    window.__sgapMenuOpen = true;
    return;
  }

  // Spin only in the spin button region (do not treat every miss as spin).
  if (y >= 0.84 && y <= 0.96 && x >= 0.40 && x <= 0.60) {
    window.__sgapSpinClicks += 1;
    window.__sgapSpinning = true;
    postBet();
    if (window.__sgapSpinUnlockTimer) clearTimeout(window.__sgapSpinUnlockTimer);
    window.__sgapSpinUnlockTimer = setTimeout(function () { window.__sgapSpinning = false; }, 400);
  }
});
</scr\` + \`ipt>
</body>
</html>\`;

      const playableIds = ['00010525', '00030525', '00120925', '00220126'];
      document.querySelectorAll('button[aria-label="Play in modal"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const tile = btn.closest('.rounded-lg');
          const text = tile ? tile.textContent || '' : '';
          if (!playableIds.some((id) => text.includes(id))) return;
          const iframe = document.createElement('iframe');
          iframe.title = 'Game session';
          iframe.srcdoc = gameDoc;
          const modal = document.getElementById('modal');
          modal.innerHTML = '';
          modal.appendChild(iframe);
        });
      });
    </script>
  </body>
</html>`;

export type SgapLauncherMode = 'local' | 'staging';

export function getLauncherMode(): SgapLauncherMode {
  const mode = process.env.SGAP_LAUNCHER_MODE ?? 'local';
  if (mode === 'local' || mode === 'staging') {
    return mode;
  }
  throw new Error(`Invalid SGAP_LAUNCHER_MODE "${mode}"; expected "local" or "staging"`);
}

export function getSgapEnvName(): string {
  return process.env.SGAP_ENV ?? 'staging';
}

export function getSgapGameId(projectGameId?: string): string {
  return projectGameId || process.env.SGAP_GAME_ID || 'sugar-wonderland';
}

/** Games in the shared DiJoker package (wave-0 canvas coords). */
export const SGAP_PACKAGE_GAME_IDS = [
  'sugar-wonderland',
  'felice-in-space',
  'beelze-bop',
  'mars-triumph',
] as const;
