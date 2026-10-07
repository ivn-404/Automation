/**
 * QA accounts for the shared control panel. Stored on the host only, in
 * .sgap/qa-users.json (git-ignored); passwords are scrypt hashes.
 *
 * Roles:
 *   admin   start runs, stop anyone's run
 *   tester  start runs, stop their own
 *   viewer  watch runs and reports only
 *
 * Manage with: npx pnpm qa:users add <name> [--role tester|admin|viewer]
 *
 * SGAP agents (scripts/qa-agent.mjs on a tester's own PC) sign in once with the
 * tester's name and password and get a token; .sgap/qa-agents.json keeps only its
 * hash. A token dies with its account: removal, disable, viewer role or a new password.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { sanitizeTester } from './sgap-tester.mjs';

export const ROLES = ['admin', 'tester', 'viewer'];
const NAME = /^[A-Za-z][A-Za-z0-9._-]{1,31}$/u;
const SESSION_COOKIE = 'sgap_session';

export function usersFile(cwd = process.cwd()) {
  return path.join(cwd, '.sgap', 'qa-users.json');
}

export function loadUsers(cwd = process.cwd()) {
  const file = usersFile(cwd);
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return Array.isArray(parsed.users) ? parsed.users : [];
}

export function saveUsers(users, cwd = process.cwd()) {
  const file = usersFile(cwd);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ users }, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}

function hash(password, salt) {
  return scryptSync(String(password), salt, 64).toString('base64');
}

export function validateNewUser(users, name, role, password) {
  if (!NAME.test(name)) return 'Name: 2-32 characters, start with a letter; letters, digits, dot, dash, underscore.';
  if (!ROLES.includes(role)) return `Role must be one of ${ROLES.join(', ')}.`;
  if (String(password).length < 8) return 'Password must be at least 8 characters.';
  const tag = sanitizeTester(name).toLowerCase();
  const clash = users.find((user) => user.name.toLowerCase() === name.toLowerCase() || sanitizeTester(user.name).toLowerCase() === tag);
  if (clash) return `"${name}" is too close to the existing account "${clash.name}" (staging player ids would collide).`;
  return undefined;
}

export function makeUser(name, role, password) {
  const salt = randomBytes(16).toString('base64');
  return { name, role, salt, hash: hash(password, salt), createdAt: new Date().toISOString() };
}

export function setPassword(user, password) {
  const salt = randomBytes(16).toString('base64');
  return { ...user, salt, hash: hash(password, salt) };
}

export function verifyPassword(user, password) {
  if (!user || user.disabled) return false;
  const expected = Buffer.from(user.hash, 'base64');
  const actual = Buffer.from(hash(password, user.salt), 'base64');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function agentsFile(cwd = process.cwd()) {
  return path.join(cwd, '.sgap', 'qa-agents.json');
}

const tokenHash = (token) => createHash('sha256').update(String(token)).digest('base64');
const MACHINE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/u;

export function cleanMachine(raw) {
  const name = String(raw ?? '').trim().slice(0, 63);
  return MACHINE.test(name) ? name : undefined;
}

function loadAgents(cwd) {
  const file = agentsFile(cwd);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed.agents) ? parsed.agents : [];
  } catch {
    return [];
  }
}

function saveAgents(agents, cwd) {
  const file = agentsFile(cwd);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ agents }, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}

/** In-memory sessions + login throttling. Restarting the panel signs everyone out. */
export function createAuth({ cwd = process.cwd(), sessionHours = 12 } = {}) {
  const sessions = new Map();
  const failures = new Map();
  const ttl = Math.max(1, Number(sessionHours) || 12) * 3600_000;

  function users() {
    return loadUsers(cwd);
  }

  function cookieValue(req) {
    for (const part of (req.headers.cookie ?? '').split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
    }
    return undefined;
  }

  function throttled(ip, now) {
    const recent = (failures.get(ip) ?? []).filter((at) => now - at < 10 * 60_000);
    return { recent, blocked: recent.length >= 10 };
  }

  return {
    enabled() {
      return users().length > 0;
    },
    /**
     * Registers an agent PC for a tester: { ok, token, user, machine } | { ok: false, status, error }.
     * One token per account and PC; registering again replaces it.
     */
    registerAgent(req, name, password, machineRaw) {
      const ip = req.socket.remoteAddress ?? '';
      const now = Date.now();
      const { recent, blocked } = throttled(ip, now);
      if (blocked) return { ok: false, status: 429, error: 'Too many failed sign-ins from this PC. Try again in a few minutes.' };
      const machine = cleanMachine(machineRaw);
      if (!machine) return { ok: false, status: 400, error: 'Invalid PC name.' };
      const user = users().find((entry) => entry.name.toLowerCase() === String(name ?? '').trim().toLowerCase());
      if (!verifyPassword(user, password ?? '')) {
        failures.set(ip, [...recent, now]);
        return { ok: false, status: 401, error: 'Wrong name or password.' };
      }
      if (user.role === 'viewer') return { ok: false, status: 403, error: 'View-only accounts cannot run tests, so they need no agent.' };
      failures.delete(ip);
      const token = randomBytes(32).toString('base64url');
      const agents = loadAgents(cwd).filter((entry) => !(entry.user === user.name && entry.machine === machine));
      agents.push({ user: user.name, machine, hash: tokenHash(token), salt: user.salt, createdAt: new Date().toISOString() });
      saveAgents(agents, cwd);
      return { ok: true, token, user: { name: user.name, role: user.role }, machine };
    },
    /** The agent behind `Authorization: Bearer …`, or undefined. */
    agent(req) {
      const header = String(req.headers.authorization ?? '');
      const match = header.match(/^Bearer ([A-Za-z0-9_-]{20,})$/u);
      if (!match) return undefined;
      const wanted = Buffer.from(tokenHash(match[1]), 'base64');
      const entry = loadAgents(cwd).find((candidate) => {
        const have = Buffer.from(candidate.hash, 'base64');
        return have.length === wanted.length && timingSafeEqual(have, wanted);
      });
      if (!entry) return undefined;
      const user = users().find((candidate) => candidate.name === entry.user && !candidate.disabled);
      if (!user || user.role === 'viewer' || user.salt !== entry.salt) return undefined;
      return { user: { name: user.name, role: user.role }, machine: entry.machine };
    },
    /** The signed-in user for this request, re-read from disk so role changes and removals apply at once. */
    current(req) {
      const token = cookieValue(req);
      const session = token ? sessions.get(token) : undefined;
      if (!session) return undefined;
      if (session.expires < Date.now()) {
        sessions.delete(token);
        return undefined;
      }
      const user = users().find((entry) => entry.name === session.name && !entry.disabled);
      if (!user) {
        sessions.delete(token);
        return undefined;
      }
      return { name: user.name, role: user.role };
    },
    login(req, name, password) {
      const ip = req.socket.remoteAddress ?? '';
      const now = Date.now();
      const { recent, blocked } = throttled(ip, now);
      if (blocked) {
        return { ok: false, status: 429, error: 'Too many failed sign-ins from this PC. Try again in a few minutes.' };
      }
      const user = users().find((entry) => entry.name.toLowerCase() === String(name ?? '').trim().toLowerCase());
      if (!verifyPassword(user, password ?? '')) {
        failures.set(ip, [...recent, now]);
        return { ok: false, status: 401, error: 'Wrong name or password.' };
      }
      failures.delete(ip);
      const token = randomBytes(32).toString('base64url');
      sessions.set(token, { name: user.name, expires: now + ttl });
      return {
        ok: true,
        user: { name: user.name, role: user.role },
        cookie: `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(ttl / 1000)}`,
      };
    },
    logout(req) {
      const token = cookieValue(req);
      if (token) sessions.delete(token);
      return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
    },
  };
}
