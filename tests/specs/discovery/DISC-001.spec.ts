/**
 * DISC-001 — Game discovery for a pasted Game URL.
 *
 * Runs first in every Game URL run (scripts/run-suite-queue.mjs). Opens the exact URL, waits
 * for the game to become interactive, inspects it without betting, and classifies every
 * capability as ready / calibration / unsupported / blocked. Writes discovery.json (audit)
 * and, for an unregistered game, learned-manifest.json (what the selected cases run against).
 *
 * After the HUD is up it learns the game: opens panels that cost nothing (scratch, autoplay,
 * menu, buy-to-cancel), plays up to three normal spins to map /bet paths, then writes the
 * learned profile the selected cases run against. It never taps start-autoplay, buy-confirm
 * or amplify.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Response } from '@playwright/test';

import { test } from '../../fixtures/index.js';
import {
  assessCapabilities,
  browserMetrics,
  checkAutoplayPanel,
  checkBuyPanel,
  checkMenuPanel,
  checkScratchDrawer,
  type PanelCheck,
  closestLayout,
  idleFrameTiming,
  learnBySpinning,
  learnPayload,
  loadTiming,
  persistLearnedProfile,
  loadPersistedProfile,
  sharedScratchDrawer,
  findStartControl,
  identifyControls,
  inspectRuntime,
  frameTree,
  LAYOUT_FAMILY_DISTANCE,
  learnedFile,
  learnedManifest,
  loadDiscoveryPatterns,
  loadLearnedDecisions,
  overallReadiness,
  readHudTexts,
  renderFrame,
  type DiscoveredControl,
  type RuntimeSnapshot,
} from '../../../src/discovery/index.js';
import { findIdleSpinInPng } from '../../../src/eye/canvas-vision.js';
import { redactText, redactUrl } from '../../../src/observability/redact.js';
import { defaultManifestsDir, FileGameManifestLoader } from '../../../src/platform/index.js';
import { parseGameManifest } from '../../../src/platform/manifest/parse-game-manifest.js';
import { UrlPlatform } from '../../../src/platform/url-platform.js';
import { loadSurfaceProfileById } from '../../../src/surfaces/load-surface-profile.js';
import type { GameManifest } from '../../../src/core/models/index.js';
import { discoveryDir, fetchLaunchUrl, isLaunchUrlRun, launchDevice } from '../../support/launch-url.js';

const INTERACTIVE_TIMEOUT_MS = 90_000;
/** Splash at 100% with only boot/preload scenes — usually a hidden worker window at 1 FPS. */
const SPLASH_STALL_MS = 25_000;
const MAX_START_TAPS = 2;

function gameKeyOf(url: URL): string {
  const segment = url.pathname.split('/').find((part) => part.length > 0);
  return segment ?? `${url.hostname}-${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
}

/** Key paths in the initialize body that hint at features; values only when boolean/number. */
function featureKeys(body: unknown, hints: Record<string, string>): string[] {
  const out: string[] = [];
  const patterns = Object.values(hints).map((source) => new RegExp(source, 'iu'));
  const walk = (node: unknown, trail: string, depth: number): void => {
    if (node === null || typeof node !== 'object' || depth > 4 || out.length > 40) return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const at = trail ? `${trail}.${key}` : key;
      if (patterns.some((pattern) => pattern.test(key))) {
        out.push(typeof value === 'boolean' || typeof value === 'number' ? `${at}=${value}` : `${at} (${Array.isArray(value) ? 'array' : typeof value})`);
      }
      walk(value, at, depth + 1);
    }
  };
  walk(body, '', 0);
  return out;
}

test.describe('DISC-001 Game discovery (Game URL)', () => {
  test('DISC-001 Learn the pasted game and assess which cases can run', async ({
    page,
    browser,
    sgapPlatform,
    sgapManifest,
    sgapView,
  }, testInfo) => {
    test.skip(!isLaunchUrlRun(), 'DISC-001 runs only in a Game URL run.');
    test.setTimeout(420_000);
    const outDir = discoveryDir() ?? testInfo.outputPath('discovery');
    await mkdir(outDir, { recursive: true });
    const patterns = loadDiscoveryPatterns();
    const raw = new URL(await fetchLaunchUrl());
    const gameKey = gameKeyOf(raw);
    const started = Date.now();
    const timeline: Array<{ step: string; ms: number }> = [];
    const mark = (step: string): void => {
      timeline.push({ step, ms: Date.now() - started });
      console.log(`[disc] +${((Date.now() - started) / 1000).toFixed(1)}s ${step}`);
    };

    const endpoints = new Map<string, { method: string; status: number; count: number }>();
    let initialize: { path: string; status: number; ms: number } | undefined;
    const consoleErrors: string[] = [];
    page.on('response', (response: Response) => {
      const type = response.request().resourceType();
      if (type !== 'xhr' && type !== 'fetch' && type !== 'document') return;
      let url: URL;
      try {
        url = new URL(response.url());
      } catch {
        return;
      }
      if (url.pathname === '/__sgap_host__') return;
      const key = `${response.request().method()} ${url.host}${url.pathname}`;
      const entry = endpoints.get(key) ?? { method: response.request().method(), status: response.status(), count: 0 };
      endpoints.set(key, { ...entry, status: response.status(), count: entry.count + 1 });
      if (/\/initialize$/iu.test(url.pathname) && initialize === undefined) {
        initialize = { path: url.pathname, status: response.status(), ms: Date.now() - started };
      }
    });
    page.on('pageerror', (error) => consoleErrors.push(redactText(error.message).slice(0, 200)));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(redactText(message.text()).slice(0, 200));
    });

    let blocked: string | undefined;
    await sgapPlatform.openGameHost();
    mark('host page ready');
    try {
      await sgapPlatform.openGame({ timeoutMs: 60_000 });
      mark('game frame loaded');
      await sgapPlatform.prepareGameView(sgapView, { timeoutMs: 60_000 });
      mark(`game view prepared (${sgapView} host, portrait iframe)`);
    } catch (error) {
      blocked = `the game did not load: ${redactText(error instanceof Error ? error.message : String(error))}`;
    }
    if (blocked === undefined && initialize !== undefined && (initialize.status === 401 || initialize.status === 403)) {
      blocked = `the game rejected the session (initialize HTTP ${initialize.status}). The URL's credentials have expired or are invalid — request a new authorized testing session.`;
    }

    let snapshot: RuntimeSnapshot | undefined;
    const startTaps: Array<{ at: number; control: string; point: { x: number; y: number } }> = [];
    let interactive = false;
    let startPoint: { x: number; y: number } | undefined;
    let lastStartSeen = 0;
    let splashStuckSince = 0;
    const deadline = Date.now() + INTERACTIVE_TIMEOUT_MS;
    while (blocked === undefined && Date.now() < deadline) {
      const frame = await renderFrame(page);
      snapshot = await inspectRuntime(frame).catch(() => snapshot);
      if (snapshot === undefined) {
        await page.waitForTimeout(1_000);
        continue;
      }
      const start = findStartControl(snapshot, patterns);
      const mainObjects = snapshot.objects.filter((object) => !/boot|preload|loading|loader|splash|intro|title|chrome/iu.test(object.scene));
      if (start === undefined && mainObjects.length >= 2) {
        interactive = true;
        mark(`interactive: scenes ${snapshot.scenes.active.join(', ')} (${mainObjects.length} input objects)`);
        break;
      }
      if (start !== undefined) {
        startPoint = { x: Number(start.x.toFixed(3)), y: Number(start.y.toFixed(3)) };
        const loaded = snapshot.loaderProgress === undefined || snapshot.loaderProgress >= 1;
        lastStartSeen ||= Date.now();
        const settled = Date.now() - lastStartSeen > 1_500;
        const spaced = startTaps.length === 0 || Date.now() - startTaps[startTaps.length - 1]!.at > 8_000;
        if (loaded && settled && spaced && startTaps.length < MAX_START_TAPS) {
          const box = await frame.locator('canvas').first().boundingBox();
          if (box !== null) {
            await page.mouse.click(box.x + start.x * box.width, box.y + start.y * box.height);
            startTaps.push({ at: Date.now(), control: `${start.type} "${start.key || start.name}" in ${start.scene}`, point: startPoint });
            mark(`start control tapped (${start.key || start.name || start.type} in ${start.scene}, loader ${snapshot.loaderProgress ?? 'n/a'})`);
          }
        }
      } else {
        lastStartSeen = 0;
      }
      const splashOnly = (snapshot.scenes.active.length === 0 && snapshot.objects.length === 0)
        || (snapshot.scenes.active.length > 0
          && snapshot.scenes.active.every((scene) => /boot|preload|loading|loader|splash|intro/iu.test(scene))
          && mainObjects.length === 0);
      const loaded = snapshot.loaderProgress === undefined || snapshot.loaderProgress >= 1;
      if (splashOnly && loaded) {
        splashStuckSince ||= Date.now();
        if (Date.now() - splashStuckSince > SPLASH_STALL_MS) {
          blocked = `the game stayed on the splash (${snapshot.scenes.active.join(', ') || 'none'}, loader ${snapshot.loaderProgress ?? 'n/a'}) for ${SPLASH_STALL_MS / 1000}s. Keep the worker browser visible (do not minimize); a hidden window often stays at 1 FPS and never leaves the splash.`;
          break;
        }
      } else {
        splashStuckSince = 0;
      }
      await page.waitForTimeout(750);
    }
    if (blocked === undefined && !interactive) {
      const hidden = snapshot !== undefined && (snapshot.loaderProgress === undefined || snapshot.loaderProgress >= 1)
        ? ' Keep the worker browser visible (do not minimize); a hidden window often stays on the splash.'
        : '';
      blocked = snapshot === undefined
        ? 'no game frame with a canvas appeared'
        : `the game never became interactive within ${INTERACTIVE_TIMEOUT_MS / 1000}s (scenes: ${snapshot.scenes.active.join(', ') || 'none'}, loader ${snapshot.loaderProgress ?? 'n/a'}${startTaps.length ? `, ${startTaps.length} start tap(s) sent` : ''}${snapshot.orientationGate ? ', orientation gate visible' : ''}).${hidden}`;
    }
    if (interactive) {
      await page.waitForTimeout(1_500);
      snapshot = await inspectRuntime(await renderFrame(page)).catch(() => snapshot);
    }

    const { controls, unidentified } = snapshot !== undefined && interactive ? identifyControls(snapshot, patterns) : { controls: [] as DiscoveredControl[], unidentified: [] };
    if (interactive && snapshot !== undefined && snapshot.engine.gameSize === undefined && !controls.some((control) => control.name === 'spin')) {
      const png = await (await renderFrame(page)).locator('canvas').first().screenshot().catch(() => undefined);
      const spin = png ? findIdleSpinInPng(png, loadSurfaceProfileById('base')) : undefined;
      if (spin !== undefined) {
        controls.push({
          name: 'spin',
          capability: 'spin',
          level: 4,
          method: 'vision',
          confidence: 'low',
          calibration: 'unconfirmed',
          evidence: [`no scene graph; green spin signature (base surface) at ${JSON.stringify(spin).slice(0, 120)}`],
        });
      }
    }

    const gameFrame = await renderFrame(page);
    const readBrowserMetrics = snapshot === undefined ? undefined : await browserMetrics(page);
    const diagnostics = snapshot === undefined
      ? null
      : {
          load: await loadTiming(gameFrame),
          idle: await idleFrameTiming(gameFrame, 8_000),
          browser: (await readBrowserMetrics?.()) ?? null,
        };
    if (diagnostics !== null) mark(`idle diagnostics: ${diagnostics.idle.frameSource} ${diagnostics.idle.avgFps ?? '—'} FPS`);

    const decisions = loadLearnedDecisions(gameKey);
    if (loadPersistedProfile(gameKey) !== undefined) {
      mark(`reusing .sgap/learned/${gameKey.replace(/[^\w.-]+/gu, '_')}.json (${Object.keys(decisions.decisions).length} QA decision(s))`);
    }
    const audited: DiscoveredControl[] = controls.map((control) => {
      const decision = decisions.decisions[control.name]?.decision ?? (control.capability ? decisions.decisions[control.capability]?.decision : undefined);
      return decision === 'confirmed'
        ? { ...control, calibration: 'confirmed', evidence: [...control.evidence, `tester confirmed (${decisions.decisions[control.name]?.by ?? decisions.decisions[control.capability ?? '']?.by ?? 'QA'})`] }
        : decision === 'rejected'
          ? { ...control, calibration: 'rejected', confidence: 'low', evidence: [...control.evidence, 'tester rejected this mapping'] }
          : control;
    });

    const loader = new FileGameManifestLoader({ manifestsDir: defaultManifestsDir() });
    const registeredManifests: GameManifest[] = [];
    for (const id of await loader.listGameIds()) {
      const manifest = await loader.load(id).catch(() => undefined);
      if (manifest !== undefined && manifest.metadata?.discovery === undefined) registeredManifests.push(manifest);
    }
    const registered = sgapManifest.metadata?.discovery === undefined ? sgapManifest : undefined;
    const layout = closestLayout(audited, registeredManifests);
    const family = layout !== undefined && layout.meanDistance <= LAYOUT_FAMILY_DISTANCE ? registeredManifests.find((manifest) => manifest.gameId === layout.gameId) : undefined;
    const initializeSeen = initialize !== undefined && initialize.status >= 200 && initialize.status < 300;
    const scratchDrawer = sharedScratchDrawer(registeredManifests);
    const panelChecks: PanelCheck[] = [];
    const scratchControl = audited.find((control) => control.name === 'scratchCard' && control.confidence === 'high' && control.calibration !== 'rejected' && control.point !== undefined);
    if (blocked === undefined && interactive && registered === undefined && scratchDrawer !== undefined && scratchControl !== undefined && decisions.decisions.scratchCard?.decision !== 'absent') {
      const check = await checkScratchDrawer(page, scratchControl.point!, scratchDrawer);
      panelChecks.push(check);
      mark(`scratch drawer check: ${check.verified ? 'matched the shared layout' : 'not verified'} — ${check.evidence.join('; ')}`);
    }
    const autoplayControl = audited.find((control) => control.name === 'autoplay' && control.confidence !== 'low' && control.calibration !== 'rejected' && control.point !== undefined);
    if (blocked === undefined && interactive && registered === undefined && autoplayControl !== undefined && decisions.decisions.autoplay?.decision !== 'absent') {
      const check = await checkAutoplayPanel(page, autoplayControl.point!, family?.canvasActions?.actions.autoplayStop ?? autoplayControl.point);
      panelChecks.push(check);
      mark(`autoplay panel check: ${check.verified ? 'verified' : 'not verified'} — ${check.evidence.join('; ')}`);
    }
    const menuControl = audited.find((control) => control.name === 'menu' && control.confidence !== 'low' && control.calibration !== 'rejected' && control.point !== undefined);
    if (blocked === undefined && interactive && registered === undefined && menuControl !== undefined && decisions.decisions.menu?.decision !== 'absent') {
      const check = await checkMenuPanel(page, menuControl.point!, family?.canvasActions?.actions.menuClose);
      panelChecks.push(check);
      mark(`menu panel check: ${check.verified ? 'verified' : 'not verified'} — ${check.evidence.join('; ')}`);
    }
    const buyControl = audited.find((control) => control.name === 'buyFeature' && control.confidence !== 'low' && control.calibration !== 'rejected' && control.point !== undefined);
    if (blocked === undefined && interactive && registered === undefined && buyControl !== undefined && decisions.decisions.buyFeature?.decision !== 'absent') {
      const check = await checkBuyPanel(page, buyControl.point!, family?.canvasActions?.actions.buyFeatureCancel);
      panelChecks.push(check);
      mark(`buy panel check: ${check.verified ? 'verified (closed, nothing bought)' : 'not verified'} — ${check.evidence.join('; ')}`);
    }

    const panelLeftOpen = panelChecks.some((check) => check.closed === false);
    const spinControl = audited.find((control) => control.name === 'spin' && control.confidence === 'high' && control.point !== undefined);
    let payload = learnPayload([sgapPlatform.getInitializeBody()].filter((body) => body !== undefined), 0);
    if (blocked === undefined && interactive && registered === undefined && initializeSeen && spinControl !== undefined && !panelLeftOpen && decisions.decisions.spin?.decision !== 'absent') {
      const spins = await learnBySpinning(page, spinControl.point!, 2);
      if (spins.blocked !== undefined) blocked = spins.blocked;
      for (const line of spins.evidence) mark(line);
      payload = learnPayload([sgapPlatform.getInitializeBody(), ...spins.bodies].filter((body) => body !== undefined), spins.bodies.length);
      mark(`payload learned from ${payload.spinsLearned} spin(s): ${payload.evidence.join('; ') || 'no field paths'}`);
    } else if (panelLeftOpen) {
      mark('skipped learning spins — a panel was left open');
    }

    const assessments = assessCapabilities({ controls: audited, decisions, blocked, initializeSeen, registered, scratchDrawer, panelChecks, payload });
    const classification = overallReadiness(assessments);
    const build = snapshot?.texts.find((text) => /^v\d+(\.\d+){1,3}$/u.test(text.text))?.text;
    const title = snapshot?.title ?? '';

    const engine = snapshot?.engine;
    const renderer = engine?.phaserRenderer === '2' ? 'WebGL' : engine?.phaserRenderer === '1' ? 'Canvas 2D' : engine?.webgl ? 'WebGL' : snapshot?.canvases.length ? 'canvas (renderer not exposed)' : 'none';
    const viewport = page.viewportSize();
    const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => '');
    const device = sgapPlatform instanceof UrlPlatform ? sgapPlatform.launchDevice() : { mode: launchDevice(), device: raw.searchParams.get('device') ?? undefined };
    const report = {
      schema: 1,
      generatedAt: new Date().toISOString(),
      game: {
        gameKey,
        title,
        build: build ?? null,
        registered: registered !== undefined ? registered.gameId : null,
        classification,
        blocked: blocked ?? null,
      },
      environment: {
        url: redactUrl(raw.toString()),
        host: raw.host,
        parameters: [...raw.searchParams.keys()],
        device: { fromUrl: raw.searchParams.get('device') ?? null, loaded: device.device ?? null, mode: device.mode },
        browser: { name: testInfo.project.use.browserName ?? 'chromium', version: browser.version(), channel: testInfo.project.use.channel ?? null, userAgent },
        viewport,
        hostView: sgapView,
        devicePixelRatio: snapshot?.devicePixelRatio ?? null,
        canvases: snapshot?.canvases ?? [],
        gameSize: engine?.gameSize ?? null,
        network: process.env.SGAP_NETWORK_PROFILE ?? 'unthrottled',
        session: raw.searchParams.has('token') ? 'session token in URL (kept out of logs and reports)' : raw.searchParams.has('demo') ? 'demo build (no session)' : 'no session parameter',
        initialize: initialize ?? null,
      },
      load: { timeline, startTaps: startTaps.map(({ at, ...rest }) => ({ ...rest, ms: at - started })) },
      frames: await frameTree(page),
      runsInIframe: (await renderFrame(page)) !== page.mainFrame(),
      rendering: {
        renderer,
        phaser: engine?.phaserVersion ?? null,
        spine: engine?.spine ?? false,
        pixi: engine?.pixi ?? false,
        scenes: snapshot?.scenes ?? null,
        orientationGate: snapshot?.orientationGate ?? false,
      },
      controls: audited,
      unidentifiedInputs: unidentified.map((object) => ({ scene: object.scene, type: object.type, key: object.key, name: object.name, x: Number(object.x.toFixed(3)), y: Number(object.y.toFixed(3)) })),
      hud: snapshot !== undefined ? readHudTexts(snapshot, patterns) : {},
      domControls: snapshot?.dom ?? [],
      featureHints: featureKeys(sgapPlatform.getInitializeBody(), patterns.featureHints),
      network: { endpoints: [...endpoints.entries()].map(([key, value]) => ({ endpoint: redactUrl(`https://${key.split(' ')[1]}`).replace(/^https:\/\//u, ''), ...value })) },
      diagnostics,
      panelChecks,
      payload,
      consoleErrors: consoleErrors.slice(0, 20),
      consoleErrorCount: consoleErrors.length,
      registry: {
        level1: registered !== undefined ? `registered manifest ${registered.gameId}` : 'not registered',
        closestLayout: layout ?? null,
        layoutFamily: family?.gameId ?? null,
      },
      capabilities: assessments,
      calibrationFile: path.relative(process.cwd(), learnedFile(gameKey)).replace(/\\/gu, '/'),
    };

    await writeFile(path.join(outDir, 'discovery.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await testInfo.attach('discovery.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    const learnable = blocked === undefined && (sgapManifest.gameId === 'unregistered' || sgapManifest.metadata?.discovery === 'runtime' || sgapManifest.metadata?.discovery === 'learned');
    if (learnable) {
      const learned = learnedManifest({
        template: sgapManifest,
        gameKey,
        title,
        build,
        controls: audited.filter((control) => control.calibration !== 'rejected'),
        start: startPoint,
        assessments,
        family,
        initializePath: initializeSeen ? initialize!.path : undefined,
        engine: engine?.phaserVersion ? 'phaser' : undefined,
        scratchDrawer,
        panelChecks,
        payload,
      });
      parseGameManifest(learned);
      await writeFile(path.join(outDir, 'learned-manifest.json'), `${JSON.stringify(learned, null, 2)}\n`, 'utf8');
      await testInfo.attach('learned-manifest.json', { body: JSON.stringify(learned, null, 2), contentType: 'application/json' });
      const previous = loadPersistedProfile(gameKey);
      if (previous !== undefined && !initializeSeen) {
        mark(`kept previous learned profile for ${gameKey} — this session had no initialize (demo or expired token)`);
      } else {
        persistLearnedProfile(gameKey, learned, { payload, build });
      }
    }
    const shot = await page.screenshot().catch(() => undefined);
    if (shot) await testInfo.attach('game-at-discovery.png', { body: shot, contentType: 'image/png' });

    testInfo.annotations.push({ type: 'classification', description: classification });
    testInfo.annotations.push({ type: 'gameUrl', description: redactUrl(raw.toString()) });
    console.log(`[disc] ${gameKey}${build ? ` ${build}` : ''}: ${classification.toUpperCase()} · renderer ${renderer}${engine?.phaserVersion ? ` (Phaser ${engine.phaserVersion}${engine.spine ? ' + Spine' : ''})` : ''}`);
    for (const control of audited) {
      console.log(`[disc]   control ${control.name.padEnd(11)} ${control.confidence.padEnd(6)} L${control.level} ${control.method}${control.point ? ` @ ${control.point.x},${control.point.y}` : ''}`);
    }
    for (const entry of assessments) console.log(`[disc]   ${entry.capability.padEnd(20)} ${entry.status.padEnd(11)} ${entry.reason}`);
    if (blocked !== undefined) throw new Error(`BLOCKED — ${blocked}`);
  });
});
