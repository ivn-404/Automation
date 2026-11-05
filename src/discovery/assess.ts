/**
 * Discovery classification: inspection → controls → per-capability readiness → learned manifest.
 *
 * Layers (each control records which one found it):
 *   1 registry   — the game has a manifest, or its HUD matches a registered layout
 *   2 pattern    — scene-graph texture / name / label matches config/discovery/control-patterns.json
 *   3 runtime    — DOM controls, initialize traffic, engine globals
 *   4 vision     — colour signature of the idle spin (only when there is no scene graph)
 *   5 qa         — a tester's calibration decision (.sgap/learned/<gameKey>.json)
 *
 * Readiness after learning: HUD inspection, safe panel checks, and a few normal spins
 * that map /bet paths. Buy/start/confirm are never tapped during learning. A control
 * that still cannot be proven stays calibration — it never becomes a pass.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { PanelCheck } from './panel-checks.js';
import type { PayloadLearning } from './payload-learn.js';

import { capabilityStatus, FEATURE_CAPABILITIES, type Capability, type FeatureCapability } from '../capabilities/index.js';
import { CONTROLLER_IDS } from '../core/constants/index.js';
import type { CanvasPoint, GameManifest } from '../core/models/index.js';
import { surfaceProfileIdFor } from '../surfaces/load-surface-profile.js';
import type { RuntimeSnapshot, SceneObject } from './inspect.js';

export type Confidence = 'high' | 'medium' | 'low';
export type Readiness = 'ready' | 'calibration' | 'unsupported' | 'blocked';
export type CalibrationStatus = 'registry' | 'confirmed' | 'unconfirmed' | 'rejected' | 'not-found';
export type QaDecision = 'confirmed' | 'absent' | 'rejected';

export interface DiscoveredControl {
  readonly name: string;
  readonly capability?: string;
  readonly level: 1 | 2 | 3 | 4 | 5;
  readonly method: 'registry' | 'scene-graph' | 'scene-label' | 'dom' | 'vision' | 'qa';
  readonly confidence: Confidence;
  readonly calibration: CalibrationStatus;
  readonly point?: CanvasPoint;
  readonly evidence: readonly string[];
}

export interface CapabilityAssessment {
  readonly capability: Capability;
  readonly status: Readiness;
  readonly reason: string;
}

export interface LayoutMatch {
  readonly gameId: string;
  readonly meanDistance: number;
  readonly pairs: number;
}

interface ControlPattern {
  readonly capability?: string;
  readonly key?: string;
  readonly notKey?: string;
  readonly label?: string;
  readonly canonical?: readonly string[];
}

export interface DiscoveryPatterns {
  readonly startScenes: string;
  readonly labelReach: number;
  readonly controls: Readonly<Record<string, ControlPattern>>;
  readonly hudTexts: Readonly<Record<string, string>>;
  readonly featureHints: Readonly<Record<string, string>>;
}

export function loadDiscoveryPatterns(cwd = process.cwd()): DiscoveryPatterns {
  return JSON.parse(readFileSync(path.join(cwd, 'config', 'discovery', 'control-patterns.json'), 'utf8')) as DiscoveryPatterns;
}

export interface LearnedDecisions {
  readonly gameKey: string;
  readonly decisions: Readonly<Record<string, { readonly decision: QaDecision; readonly by?: string; readonly at?: string; readonly build?: string }>>;
}

export function learnedFile(gameKey: string, cwd = process.cwd()): string {
  return path.join(cwd, '.sgap', 'learned', `${gameKey.replace(/[^\w.-]+/gu, '_')}.json`);
}

export function loadLearnedDecisions(gameKey: string, cwd = process.cwd()): LearnedDecisions {
  const file = learnedFile(gameKey, cwd);
  if (!existsSync(file)) return { gameKey, decisions: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<LearnedDecisions>;
    return { gameKey, decisions: parsed.decisions ?? {} };
  } catch {
    return { gameKey, decisions: {} };
  }
}

interface LearnedStore {
  readonly gameKey?: string;
  readonly decisions?: LearnedDecisions['decisions'];
  readonly profile?: Record<string, unknown>;
  readonly payload?: PayloadLearning;
  readonly learnedAt?: string;
  readonly build?: string;
}

function readLearnedStore(gameKey: string, cwd = process.cwd()): LearnedStore {
  const file = learnedFile(gameKey, cwd);
  if (!existsSync(file)) return { gameKey, decisions: {} };
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as LearnedStore;
  } catch {
    return { gameKey, decisions: {} };
  }
}

/** Drop URL/token-shaped keys and strings so a learned file can never keep a session. */
export function stripLearnedSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripLearnedSecrets);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/token|refresh|password|secret|authorization|launchUrl/iu.test(key)) continue;
      if (typeof child === 'string' && /(?:^|[?&])(?:token|refresh_token)=/iu.test(child)) continue;
      out[key] = stripLearnedSecrets(child);
    }
    return out;
  }
  return value;
}

/** Last learned manifest for this game key (no tokens). Undefined until discovery has persisted one. */
export function loadPersistedProfile(gameKey: string, cwd = process.cwd()): Record<string, unknown> | undefined {
  const store = readLearnedStore(gameKey, cwd);
  if (store.gameKey !== undefined && store.gameKey !== gameKey) return undefined;
  const profile = store.profile;
  if (profile === undefined || typeof profile !== 'object') return undefined;
  const metadata = (profile as { metadata?: Record<string, string> }).metadata;
  if (metadata?.launcherGameKey !== undefined && metadata.launcherGameKey !== gameKey) return undefined;
  return stripLearnedSecrets(profile) as Record<string, unknown>;
}

/** Writes the learned manifest next to QA decisions. Never stores a URL or token. */
export function persistLearnedProfile(
  gameKey: string,
  profile: Record<string, unknown>,
  extras?: { readonly payload?: PayloadLearning; readonly build?: string },
  cwd = process.cwd(),
): void {
  const file = learnedFile(gameKey, cwd);
  mkdirSync(path.dirname(file), { recursive: true });
  const existing = readLearnedStore(gameKey, cwd);
  const record = stripLearnedSecrets({
    gameKey,
    decisions: existing.decisions ?? {},
    learnedAt: new Date().toISOString(),
    ...(extras?.build ? { build: extras.build } : existing.build ? { build: existing.build } : {}),
    profile: { ...profile, metadata: { ...((profile.metadata as Record<string, string> | undefined) ?? {}), launcherGameKey: gameKey, discovery: 'learned' } },
    ...(extras?.payload !== undefined
      ? { payload: { fields: extras.payload.fields, features: extras.payload.features, spinsLearned: extras.payload.spinsLearned, evidence: extras.payload.evidence } }
      : existing.payload !== undefined
        ? { payload: existing.payload }
        : {}),
  });
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

const rx = (source: string | undefined): RegExp | undefined => (source ? new RegExp(source, 'iu') : undefined);
const pct = (value: number): string => value.toFixed(3);

export function isStartScene(scene: string, patterns: DiscoveryPatterns): boolean {
  return new RegExp(patterns.startScenes, 'iu').test(scene);
}

/** Visible texts drawn on an object or just below it (HUD captions sit under their icon). */
function labelsNear(object: SceneObject, snapshot: RuntimeSnapshot, reach: number): string[] {
  return snapshot.texts
    .filter(
      (text) =>
        text.scene === object.scene &&
        Math.abs(text.x - object.x) <= Math.max(object.w, text.w) / 2 + 0.02 &&
        text.y >= object.y - object.h / 2 - 0.01 &&
        text.y <= object.y + object.h / 2 + reach * object.h + 0.04,
    )
    .map((text) => text.text);
}

function describe(object: SceneObject): string {
  const id = [object.key && `texture "${object.key}"`, object.frame && `frame "${object.frame}"`, object.name && `name "${object.name}"`]
    .filter(Boolean)
    .join(', ');
  return `${object.type} ${id || '(no texture/name)'} in scene ${object.scene} at ${pct(object.x)},${pct(object.y)}`;
}

/** The interactive object on a start/splash scene, when no main scene is active yet. */
export function findStartControl(snapshot: RuntimeSnapshot, patterns: DiscoveryPatterns): SceneObject | undefined {
  if (snapshot.scenes.active.length === 0 || !snapshot.scenes.active.every((scene) => isStartScene(scene, patterns) || /chrome|overlay|transition/iu.test(scene))) {
    return undefined;
  }
  const play = /play|start|continue|spin|enter|tap/iu;
  const fullscreen = rx(patterns.controls.fullscreen?.key);
  return snapshot.objects
    .filter((object) => isStartScene(object.scene, patterns) && !(fullscreen?.test(`${object.key} ${object.name}`) ?? false))
    .sort((a, b) => Number(play.test(`${b.key} ${b.name}`)) - Number(play.test(`${a.key} ${a.name}`)) || b.w * b.h - a.w * a.h)[0];
}

/** Level 2: scene-graph objects matched against the shared control patterns. */
export function identifyControls(snapshot: RuntimeSnapshot, patterns: DiscoveryPatterns): {
  controls: DiscoveredControl[];
  unidentified: SceneObject[];
} {
  const main = snapshot.objects.filter((object) => !isStartScene(object.scene, patterns));
  const used = new Set<SceneObject>();
  const controls: DiscoveredControl[] = [];
  for (const [name, pattern] of Object.entries(patterns.controls)) {
    const key = rx(pattern.key);
    const notKey = rx(pattern.notKey);
    const label = rx(pattern.label);
    const canonical = new Set((pattern.canonical ?? []).map((value) => value.toLowerCase()));
    let best: { object: SceneObject; confidence: Confidence; evidence: string[]; method: DiscoveredControl['method'] } | undefined;
    for (const object of main) {
      const ids = [object.key, object.frame, object.name].filter(Boolean);
      const keyHit = key !== undefined && ids.some((id) => key.test(id)) && !ids.some((id) => notKey?.test(id) ?? false);
      const exact = ids.some((id) => canonical.has(id.toLowerCase()));
      const near = labelsNear(object, snapshot, patterns.labelReach);
      const labelHit = label !== undefined ? near.find((text) => label.test(text)) : undefined;
      if (!keyHit && !exact && labelHit === undefined) continue;
      const confidence: Confidence = exact || (keyHit && labelHit !== undefined) ? 'high' : 'medium';
      const evidence = [
        `${describe(object)}${object.cursor ? `, cursor ${object.cursor}` : ''}, input enabled`,
        ...(exact ? ['identifier is a canonical name for this control'] : keyHit ? [`identifier matches /${pattern.key}/`] : []),
        ...(labelHit !== undefined ? [`label "${labelHit}" drawn on/under it`] : []),
      ];
      const rank = (c: Confidence): number => (c === 'high' ? 2 : 1);
      if (best === undefined || rank(confidence) > rank(best.confidence) || (rank(confidence) === rank(best.confidence) && object.w * object.h > best.object.w * best.object.h)) {
        best = { object, confidence, evidence, method: keyHit || exact ? 'scene-graph' : 'scene-label' };
      }
    }
    if (best !== undefined) {
      used.add(best.object);
      controls.push({
        name,
        capability: pattern.capability,
        level: 2,
        method: best.method,
        confidence: best.confidence,
        calibration: 'unconfirmed',
        point: { x: Number(best.object.x.toFixed(3)), y: Number(best.object.y.toFixed(3)) },
        evidence: best.evidence,
      });
      continue;
    }
    const dom = label !== undefined ? snapshot.dom.find((control) => label.test(control.label)) : undefined;
    if (dom !== undefined) {
      controls.push({
        name,
        capability: pattern.capability,
        level: 3,
        method: 'dom',
        confidence: 'medium',
        calibration: 'unconfirmed',
        evidence: [`DOM <${dom.tag}> "${dom.label}" at ${pct(dom.x)},${pct(dom.y)} of the frame`],
      });
    }
  }
  return { controls, unidentified: main.filter((object) => !used.has(object)) };
}

/** HUD readouts (balance, bet, win): the value printed next to a caption. */
export function readHudTexts(snapshot: RuntimeSnapshot, patterns: DiscoveryPatterns): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, source] of Object.entries(patterns.hudTexts)) {
    const caption = snapshot.texts.find((text) => new RegExp(source, 'iu').test(text.text));
    if (caption === undefined) continue;
    const value = snapshot.texts
      .filter((text) => text !== caption && /\d/u.test(text.text) && Math.abs(text.x - caption.x) < 0.12 && Math.abs(text.y - caption.y) < 0.05)
      .sort((a, b) => Math.hypot(a.x - caption.x, a.y - caption.y) - Math.hypot(b.x - caption.x, b.y - caption.y))[0];
    out[name] = value?.text ?? '(caption only)';
  }
  return out;
}

const LAYOUT_ACTIONS: Readonly<Record<string, string>> = {
  spin: 'spin',
  betMinus: 'betMinus',
  betPlus: 'betPlus',
  turbo: 'turbo',
  autoplay: 'autoplay',
  menu: 'menu',
  scratchCard: 'scratchCard',
  fullscreen: 'fullscreen',
};

/** Level 1: the registered manifest whose HUD points sit closest to the discovered ones. */
export function closestLayout(controls: readonly DiscoveredControl[], manifests: readonly GameManifest[]): LayoutMatch | undefined {
  let best: LayoutMatch | undefined;
  for (const manifest of manifests) {
    const actions = manifest.canvasActions?.actions;
    if (actions === undefined || manifest.metadata?.discovery !== undefined) continue;
    const distances = controls
      .filter((control) => control.point !== undefined && LAYOUT_ACTIONS[control.name] !== undefined && actions[LAYOUT_ACTIONS[control.name]!] !== undefined)
      .map((control) => {
        const target = actions[LAYOUT_ACTIONS[control.name]!]!;
        return Math.hypot(control.point!.x - target.x, control.point!.y - target.y);
      });
    if (distances.length < 3) continue;
    const meanDistance = distances.reduce((sum, value) => sum + value, 0) / distances.length;
    if (best === undefined || meanDistance < best.meanDistance) best = { gameId: manifest.gameId, meanDistance, pairs: distances.length };
  }
  return best;
}

/** A layout this close is the same HUD family: recovery points and surface bands carry over. */
export const LAYOUT_FAMILY_DISTANCE = 0.04;

export interface SharedScratchDrawer {
  readonly config: NonNullable<GameManifest['scratchCard']>;
  readonly games: readonly string[];
}

/**
 * Level 2: the scratch drawer layout most registered games share (the provider's drawer widget).
 * Only offered when a clear majority uses one identical layout.
 */
export function sharedScratchDrawer(manifests: readonly GameManifest[]): SharedScratchDrawer | undefined {
  const groups = new Map<string, { config: NonNullable<GameManifest['scratchCard']>; games: string[] }>();
  let total = 0;
  for (const manifest of manifests) {
    if (manifest.scratchCard === undefined || manifest.metadata?.discovery !== undefined) continue;
    total += 1;
    const key = JSON.stringify(manifest.scratchCard);
    const group = groups.get(key) ?? { config: manifest.scratchCard, games: [] };
    group.games.push(manifest.gameId);
    groups.set(key, group);
  }
  const best = [...groups.values()].sort((a, b) => b.games.length - a.games.length)[0];
  return best !== undefined && best.games.length >= 3 && best.games.length * 2 > total ? best : undefined;
}

export interface AssessInput {
  readonly controls: readonly DiscoveredControl[];
  readonly decisions: LearnedDecisions;
  readonly blocked?: string;
  readonly initializeSeen: boolean;
  readonly registered?: GameManifest;
  readonly scratchDrawer?: SharedScratchDrawer;
  readonly panelChecks?: readonly PanelCheck[];
  readonly payload?: PayloadLearning;
}

const PANEL_NOTE: Partial<Record<Capability, string>> = {
  autoplay: 'the autoplay panel (spin count, start) opens on click and was not inspected',
  menu: 'the menu opens on click; its close control was not inspected',
  settings: 'settings live inside the menu, which discovery does not open',
  buyFeature: 'buying spends balance; the purchase panel and tiers need a tester to confirm',
  amplifyBet: 'amplify changes the stake; its toggle state needs a tester to confirm',
  scratchCard: 'the scratch drawer layout (sizes, buy, scratch area) is not calibrated',
};

/** Per-capability readiness. Unknown never becomes ready, and absence is never assumed. */
export function assessCapabilities(input: AssessInput): CapabilityAssessment[] {
  const all = [...CONTROLLER_IDS, ...FEATURE_CAPABILITIES] as Capability[];
  if (input.blocked !== undefined) {
    return all.map((capability) => ({ capability, status: 'blocked', reason: input.blocked! }));
  }
  if (input.registered !== undefined) {
    const manifest = input.registered;
    return all.map((capability) => {
      const status = capabilityStatus(manifest, capability);
      return status === 'supported'
        ? { capability, status: 'ready', reason: `registered manifest ${manifest.gameId} declares it` }
        : status === 'unsupported'
          ? { capability, status: 'unsupported', reason: `registered manifest ${manifest.gameId} declares it absent` }
          : { capability, status: 'calibration', reason: `registered manifest ${manifest.gameId} does not declare it` };
    });
  }
  const high = (name: string): DiscoveredControl | undefined =>
    input.controls.find((control) => control.name === name && control.confidence === 'high');
  const any = (capability: string): DiscoveredControl | undefined => input.controls.find((control) => control.capability === capability);
  const spinReady = high('spin') !== undefined && input.initializeSeen;
  return all.map((capability): CapabilityAssessment => {
    const decision = input.decisions.decisions[capability]?.decision;
    if (decision === 'absent') return { capability, status: 'unsupported', reason: 'a tester confirmed the game does not have it' };
    if ((FEATURE_CAPABILITIES as readonly string[]).includes(capability)) {
      const learned = input.payload?.features[capability as FeatureCapability];
      if (capability === 'reelValidation' || capability === 'symbolCatalog') {
        return {
          capability,
          status: 'calibration',
          reason: learned ?? 'needs this title\'s symbol catalog and reel art — paths alone are not enough',
        };
      }
      if (learned !== undefined) return { capability, status: 'ready', reason: `learned from this game's initialize/bet payload: ${learned}` };
      return decision === 'confirmed'
        ? { capability, status: 'calibration', reason: 'confirmed present, but its payload paths / symbol data still need a probe' }
        : { capability, status: 'calibration', reason: 'learning spins did not expose this feature in initialize or /bet — Confirm if it exists, or Absent if it does not' };
    }
    const found = any(capability);
    if (capability === 'spin') {
      if (!high('spin')) return { capability, status: 'calibration', reason: found ? `spin found with ${found.confidence} confidence only` : 'no spin control identified' };
      if (!input.initializeSeen) return { capability, status: 'calibration', reason: 'spin found, but the game made no initialize call, so its bet endpoint is unverified (demo or dev build?)' };
      return { capability, status: 'ready', reason: 'spin identified in the scene graph and the game uses the slots initialize/bet API' };
    }
    if (capability === 'bet') {
      if (high('betMinus') && high('betPlus') && spinReady) return { capability, status: 'ready', reason: 'bet − / + identified next to a BET readout; stake changes are read from /bet' };
      return { capability, status: 'calibration', reason: !spinReady ? 'needs a ready spin to read the stake from /bet' : 'bet − / + not both identified with high confidence' };
    }
    if (capability === 'turbo' || capability === 'fullscreen') {
      if (high(capability) && (capability === 'fullscreen' || spinReady)) return { capability, status: 'ready', reason: `${capability} toggle identified in the scene graph` };
      return { capability, status: 'calibration', reason: found ? `${capability} found with ${found.confidence} confidence` : `no ${capability} control identified — confirm absent (N/A) or calibrate` };
    }
    if (capability === 'scratchCard' && found) {
      const drawer = input.scratchDrawer;
      if (drawer === undefined) return { capability, status: 'calibration', reason: `found (${found.confidence}), but no shared scratch drawer layout exists to borrow; calibrate it with a probe` };
      const check = input.panelChecks?.find((entry) => entry.target === 'scratchCard');
      if (decision === 'confirmed' && spinReady) {
        return { capability, status: 'ready', reason: `a tester confirmed the scratch card; drawer layout is the shared pattern of ${drawer.games.length} registered games` };
      }
      if (check?.verified === true && spinReady) {
        return { capability, status: 'ready', reason: `discovery opened the drawer and it matches the shared layout of ${drawer.games.length} registered games (${check.evidence.length} checks, closed again, nothing bought)` };
      }
      return {
        capability,
        status: 'calibration',
        reason: check !== undefined
          ? `found (${found.confidence}); the drawer check did not match the shared layout (${check.evidence.filter((line) => /not matched|still open|already visible/u.test(line)).join('; ') || 'see discovery report'}) — compare it by eye, then Confirm "scratchCard" in the discovery panel`
          : `found (${found.confidence}); the drawer layout shared by ${drawer.games.length} registered games is assumed but unverified — Confirm "scratchCard" in the discovery panel and run again`,
      };
    }
    const check = input.panelChecks?.find((entry) => entry.target === capability);
    if ((capability === 'autoplay' || capability === 'menu' || capability === 'buyFeature' || capability === 'settings') && found) {
      const menuCheck = input.panelChecks?.find((entry) => entry.target === 'menu');
      if (capability === 'settings' && menuCheck?.verified === true && menuCheck.measured?.settingsTab !== undefined) {
        return { capability, status: 'ready', reason: 'the menu panel showed a Settings item; discovery closed the menu without changing settings' };
      }
      if (decision === 'confirmed' && (capability === 'menu' || capability === 'settings' || spinReady)) {
        return { capability, status: 'ready', reason: 'a tester confirmed the discovered control' };
      }
      if (check?.verified === true && (capability === 'menu' || spinReady)) {
        return { capability, status: 'ready', reason: `discovery opened ${capability} and it matched the expected panel (${check.evidence.length} checks, closed again, nothing started or bought)` };
      }
      return {
        capability,
        status: 'calibration',
        reason: check !== undefined
          ? `found (${found.confidence}); the panel check did not verify it (${check.evidence.filter((line) => /not matched|still open|already visible/u.test(line)).join('; ') || 'see discovery report'})`
          : `found (${found.confidence}), but ${PANEL_NOTE[capability] ?? 'it needs a tester to confirm'}`,
      };
    }
    if (decision === 'confirmed' && found) return { capability, status: 'ready', reason: 'a tester confirmed the discovered control' };
    if (!found) return { capability, status: 'calibration', reason: `not found in the HUD scene graph, labels or DOM — confirm absent (N/A) or calibrate` };
    return { capability, status: 'calibration', reason: `found (${found.confidence}), but ${PANEL_NOTE[capability] ?? 'it needs a tester to confirm'}` };
  });
}

export function overallReadiness(assessments: readonly CapabilityAssessment[]): Readiness {
  if (assessments.some((entry) => entry.status === 'blocked')) return 'blocked';
  return assessments.find((entry) => entry.capability === 'spin')?.status === 'ready' ? 'ready' : 'calibration';
}

const RECOVERY_ACTIONS = ['acknowledge', 'acknowledgeAlt', 'dismiss', 'skip', 'closeOverlay', 'errorOk', 'errorOkAlt', 'menuClose', 'menuCloseAlt'];
const FAMILY_METADATA = ['gridSpamActions', 'skipAction', 'portraitViewport', 'orientationLock'];

export interface LearnedManifestInput {
  readonly template: GameManifest;
  readonly gameKey: string;
  readonly title: string;
  readonly build?: string;
  readonly controls: readonly DiscoveredControl[];
  readonly start?: CanvasPoint;
  readonly assessments: readonly CapabilityAssessment[];
  readonly family?: GameManifest;
  readonly initializePath?: string;
  readonly engine?: string;
  readonly scratchDrawer?: SharedScratchDrawer;
  readonly panelChecks?: readonly PanelCheck[];
  readonly payload?: PayloadLearning;
}

function withoutRendering(metadata: Record<string, string>): Record<string, string> {
  const { rendering: _rendering, ...rest } = metadata;
  return rest;
}

/** The manifest the selected cases run against. Not written to config/manifests. */
export function learnedManifest(input: LearnedManifestInput): Record<string, unknown> {
  const actions: Record<string, CanvasPoint> = {};
  const familyActions = input.family?.canvasActions?.actions ?? {};
  for (const name of RECOVERY_ACTIONS) if (familyActions[name] !== undefined) actions[name] = familyActions[name]!;
  for (const control of input.controls) {
    if (control.point !== undefined && control.confidence !== 'low') actions[control.name] = control.point;
  }
  for (const check of input.panelChecks ?? []) {
    if (!check.verified) continue;
    for (const [name, point] of Object.entries(check.measured ?? {})) {
      if (point !== undefined) actions[name] = point;
    }
  }
  if (actions.autoplay !== undefined) actions.autoplayStop = actions.autoplay;
  const start = input.start ?? familyActions.enter;
  if (start !== undefined) {
    actions.enter = start;
    actions.attractPlay = start;
  }
  const controllers = input.assessments
    .filter((entry) => (CONTROLLER_IDS as readonly string[]).includes(entry.capability) && (entry.status === 'ready' || entry.status === 'unsupported'))
    .filter((entry) => entry.capability !== 'spin' || actions.spin !== undefined)
    .map((entry) => ({ id: entry.capability, enabled: entry.status === 'ready' }));
  const metadata: Record<string, string> = {
    ...(input.template.metadata ?? {}),
    discovery: 'learned',
    launcherGameKey: input.gameKey,
    rendering: 'canvas',
  };
  delete metadata.notes;
  if (input.build) metadata.build = input.build;
  if (input.engine) metadata.engine = input.engine;
  if (input.family !== undefined) {
    metadata.surfaceProfile = surfaceProfileIdFor(input.family.gameId, input.family.metadata);
    metadata.layoutFamily = input.family.gameId;
    for (const key of FAMILY_METADATA) {
      const value = input.family.metadata?.[key];
      if (value !== undefined) metadata[key] = value;
    }
  }
  for (const entry of input.assessments) {
    if (entry.status !== 'ready' && entry.status !== 'unsupported') metadata[`assessment.${entry.capability}`] = `${entry.status}|${entry.reason}`;
    if ((FEATURE_CAPABILITIES as readonly string[]).includes(entry.capability)) {
      if (entry.status === 'unsupported') metadata[entry.capability] = 'false';
      if (entry.status === 'ready') metadata[entry.capability] = 'true';
    }
  }
  const scratchReady = input.assessments.some((entry) => entry.capability === 'scratchCard' && entry.status === 'ready');
  if (scratchReady && input.scratchDrawer !== undefined) metadata.scratchDrawerFrom = input.scratchDrawer.games.slice(0, 3).join(',');
  const network = { ...(input.template.network ?? {}) } as Record<string, unknown>;
  if (input.initializePath !== undefined) {
    network.initializeUrlPattern = `**${input.initializePath}`;
    network.betUrlPattern = `**${input.initializePath.replace(/\/initialize$/u, '/bet')}`;
  }
  const learnedFields = input.payload?.fields;
  if (learnedFields !== undefined) {
    const current = (network.fields ?? {}) as Record<string, string>;
    network.fields = {
      ...current,
      ...(learnedFields.balance ? { balance: learnedFields.balance } : {}),
      ...(learnedFields.totalWin ? { totalWin: learnedFields.totalWin } : {}),
      ...(learnedFields.transactionState ? { transactionState: learnedFields.transactionState } : {}),
      ...(learnedFields.baseWin ? { baseWin: learnedFields.baseWin } : {}),
      ...(learnedFields.bonusWin ? { bonusWin: learnedFields.bonusWin } : {}),
      ...(learnedFields.unresolvedSpin ? { unresolvedSpin: learnedFields.unresolvedSpin } : {}),
    };
  }
  return {
    schemaVersion: input.template.schemaVersion,
    gameId: input.template.gameId,
    displayName: `${input.title || input.gameKey} (unregistered)`,
    iframeSelectorKey: input.template.iframeSelectorKey,
    controllers: controllers.length > 0 ? controllers : [{ id: 'fullscreen', enabled: false }],
    locatorKeys: input.template.locatorKeys,
    ...(Object.keys(actions).length > 0 ? { canvasActions: { canvasSelector: 'canvas', actions } } : {}),
    ...(scratchReady && input.scratchDrawer !== undefined
      ? {
          scratchCard: {
            ...input.scratchDrawer.config,
            actions: { ...input.scratchDrawer.config.actions, ...(input.panelChecks?.find((check) => check.target === 'scratchCard')?.measured ?? {}) },
          },
        }
      : {}),
    network,
    metadata: Object.keys(actions).length > 0 ? metadata : withoutRendering(metadata),
  };
}
