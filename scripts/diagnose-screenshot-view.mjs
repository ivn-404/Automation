/**
 * Records what the tester sees while Playwright takes canvas screenshots.
 *
 * Opens a headed lane-sized window with a cross-origin iframe (out-of-process,
 * like the game) holding an animating WebGL canvas, grabs the real screen with
 * System.Drawing every ~60 ms, and takes element screenshots in between. Each
 * screen frame reports where the magenta canvas is drawn, so a jump or resize
 * that coincides with a screenshot shows up as a changed box on a SHOT row.
 *
 *   node scripts/diagnose-screenshot-view.mjs [--mode element|clip|viewport|stable] [--viewport WxH]
 *
 * `stable` uses src/platform/stable-screenshot.ts (run `npx pnpm build` first) and
 * also checks its PNG against Playwright's element screenshot of the same canvas.
 *
 * Windows only (uses powershell.exe for the screen grab).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const WINDOW = { left: 0, top: 0, width: 960, height: 1032 };
const viewportArg = process.argv[process.argv.indexOf('--viewport') + 1];
const [vw, vh] = (process.argv.includes('--viewport') ? viewportArg : '944x944').split('x').map(Number);
/** element = locator.screenshot, clip = page.screenshot({ clip }), viewport = page.screenshot(), stable = captureLocator */
const mode = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'element';
const stable = mode === 'stable' ? await import('../dist/platform/stable-screenshot.js') : undefined;

const GAME_HTML = `<html><body style="margin:0;background:#000"><canvas id="c" style="display:block;width:100vw;height:100vh"></canvas><script>
const c = document.getElementById('c');
function fit() { c.width = Math.max(1, innerWidth); c.height = Math.max(1, innerHeight); }
fit();
addEventListener('resize', () => { fit(); window.__resizes = (window.__resizes || 0) + 1; });
const gl = c.getContext('webgl');
(function frame() { gl.viewport(0, 0, c.width, c.height); gl.clearColor(1, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT); requestAnimationFrame(frame); })();
</script></body></html>`;
const HOST_HTML = `<html><body style="margin:0;background:#fff"><div style="padding:40px">
<iframe title="Game session" src="http://127.0.0.1:4591/game" style="width:390px;height:780px;border:0"></iframe>
</div></body></html>`;

const hostServer = http.createServer((_req, res) => res.end(HOST_HTML)).listen(4590);
const gameServer = http.createServer((_req, res) => res.end(GAME_HTML)).listen(4591);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgap-shot-'));

function grabScreen(frames) {
  const target = dir.replace(/\\/g, '/');
  const script = [
    'Add-Type -AssemblyName System.Drawing;',
    `for ($i = 0; $i -lt ${frames}; $i++) {`,
    `  $b = New-Object System.Drawing.Bitmap ${WINDOW.width},${WINDOW.height};`,
    '  $g = [System.Drawing.Graphics]::FromImage($b);',
    `  $g.CopyFromScreen(${WINDOW.left},${WINDOW.top},0,0,$b.Size);`,
    '  $t = [DateTimeOffset]::Now.ToUnixTimeMilliseconds();',
    `  $b.Save("${target}/f$i-$t.png");`,
    '  $g.Dispose(); $b.Dispose(); Start-Sleep -Milliseconds 60',
    '}',
  ].join(' ');
  const child = spawn('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore' });
  return new Promise((resolve) => child.on('exit', resolve));
}

function magentaBox(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < png.height; y += 2) {
    for (let x = 0; x < png.width; x += 2) {
      const i = (y * png.width + x) * 4;
      if (png.data[i] > 200 && png.data[i + 1] < 60 && png.data[i + 2] > 200) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return maxX < 0 ? 'none' : `${minX},${minY} ${maxX - minX}x${maxY - minY}`;
}

const browser = await chromium.launch({
  headless: false,
  args: [`--window-position=${WINDOW.left},${WINDOW.top}`, `--window-size=${WINDOW.width},${WINDOW.height}`],
});
const context = await browser.newContext({ viewport: { width: vw, height: vh }, hasTouch: true });
const page = await context.newPage();
await page.goto('http://localhost:4590/');
await page.waitForTimeout(1500);

const recording = grabScreen(45);
await page.waitForTimeout(1200);
const shots = [];
const canvas = page.frameLocator('iframe[title="Game session"]').locator('canvas');
const box = await canvas.boundingBox();
for (let i = 0; i < 8; i += 1) {
  const started = Date.now();
  if (mode === 'element') await canvas.screenshot({ type: 'png' });
  else if (mode === 'clip') await page.screenshot({ type: 'png', clip: box });
  else if (stable) await stable.captureLocator(canvas, { label: 'diagnostic' });
  else await page.screenshot({ type: 'png' });
  shots.push([started, Date.now()]);
  await page.waitForTimeout(300);
}
await recording;
const resizes = await page.frames()[1].evaluate(() => window.__resizes ?? 0);
if (stable) {
  const ours = PNG.sync.read(await stable.captureLocator(canvas));
  const theirs = PNG.sync.read(await canvas.screenshot({ type: 'png' }));
  const same = ours.width === theirs.width && ours.height === theirs.height && ours.data.equals(theirs.data);
  console.log(`stable crop ${ours.width}x${ours.height} vs element screenshot ${theirs.width}x${theirs.height} · pixels identical: ${same}`);
  const toastInShot = await page.evaluate(() => Boolean(document.getElementById('sgap-screenshot-toast')));
  console.log(`notice element present on host page: ${toastInShot} (SGAP_SCREENSHOT_TOAST=${process.env.SGAP_SCREENSHOT_TOAST ?? 'unset'})`);
}
await browser.close();
hostServer.close();
gameServer.close();

const frames = fs
  .readdirSync(dir)
  .map((name) => ({ name, at: Number(name.split('-')[1].replace('.png', '')) }))
  .sort((a, b) => a.at - b.at);
for (const frame of frames) {
  const during = shots.some(([start, end]) => frame.at >= start - 30 && frame.at <= end + 30);
  console.log(`${during ? 'SHOT' : '    '} ${frame.at} canvas on screen: ${magentaBox(path.join(dir, frame.name))}`);
}
const moved = frames.filter((frame) => magentaBox(path.join(dir, frame.name)) !== magentaBox(path.join(dir, frames[0].name))).length;
console.log(`mode ${mode} · frames where the canvas moved/resized on screen: ${moved}/${frames.length}`);
console.log(`viewport ${vw}x${vh} · screenshot ms ${shots.map(([a, b]) => b - a).join(', ')} · resize events in game frame: ${resizes}`);
fs.rmSync(dir, { recursive: true, force: true });
