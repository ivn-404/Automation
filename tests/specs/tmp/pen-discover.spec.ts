/**
 * TEMP discovery probe (not a QA case). Captures everything needed to drive the
 * scratch hub ourselves for PERSONALTESTING: the hub URL (with query), the
 * SignalR handshake + JoinScratch/StartRound frames in full, how the socket
 * authenticates (negotiate call + Authorization header + access_token param),
 * and where a reusable access token lives in the page.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { test } from '../../fixtures/index.js';
import { startScratchCase } from '../../support/scratch-flow.js';

interface Frame {
  readonly dir: 'in' | 'out';
  readonly at: number;
  readonly payload: string;
}

const OUT_DIR = path.join('test-results', 'tmp');
const MAX_FRAME_CHARS = 20_000;

test.describe('PEN discovery', () => {
  test('capture hub url + frames + auth', async ({ sgapSession, sgapDriver, page }, testInfo) => {
    test.setTimeout(300_000);

    const frames: Frame[] = [];
    const httpCalls: { url: string; method: string; authorization?: string }[] = [];
    let hubUrl = '';

    // SignalR negotiates over HTTP first; the bearer token rides that request's headers.
    page.on('request', (req) => {
      const url = req.url();
      if (!/\/hubs\/game/u.test(url)) {
        return;
      }
      const headers = req.headers();
      httpCalls.push({
        url,
        method: req.method(),
        ...(headers.authorization ? { authorization: headers.authorization } : {}),
      });
    });

    page.on('websocket', (ws) => {
      if (!ws.url().includes('/hubs/game')) {
        return;
      }
      hubUrl = ws.url();
      ws.on('framesent', (f) =>
        frames.push({ dir: 'out', at: Date.now(), payload: String(f.payload).slice(0, MAX_FRAME_CHARS) }),
      );
      ws.on('framereceived', (f) =>
        frames.push({ dir: 'in', at: Date.now(), payload: String(f.payload).slice(0, MAX_FRAME_CHARS) }),
      );
    });

    let joinError: string | undefined;
    const scratch = await startScratchCase({
      sgapSession,
      sgapDriver,
      page,
      testInfo,
      manualTestId: 'PEN-DISCOVER',
    });
    try {
      await scratch.open();
      // Buy + settle one 3x3 card so we capture a full StartRound and Cashout round-trip.
      await scratch.selectSize(3);
      await scratch.buyCard();
      await scratch.scratchAll();
      await page.waitForTimeout(2_000);
    } catch (error) {
      // The point of discovery is the captured frames/auth, not a green pass. A
      // JoinScratch server error is itself a finding (fail-closed path); record it.
      joinError = (error as Error).message;
      console.log('[pen] open/buy during discovery threw:', joinError);
    } finally {
      // Token-bearing storage keys — SignalR access_token / launcher Copy Token source.
      const storage = await page
        .evaluate(() => {
          const pick = (store: Storage): Record<string, string> => {
            const out: Record<string, string> = {};
            for (let i = 0; i < store.length; i += 1) {
              const key = store.key(i);
              if (key === null) continue;
              if (/token|auth|jwt|session|bearer/iu.test(key)) {
                out[key] = String(store.getItem(key)).slice(0, 4_000);
              }
            }
            return out;
          };
          return { local: pick(window.localStorage), session: pick(window.sessionStorage) };
        })
        .catch(() => ({ local: {}, session: {} }));

      mkdirSync(OUT_DIR, { recursive: true });
      const out = {
        hubUrl,
        joinError: joinError ?? null,
        joinServerError: sgapSession.scratchCard.hubWatcher().latestServerError('JoinScratch') ?? null,
        httpCalls,
        storage,
        joinScratch: sgapSession.scratchCard.hubWatcher().latestResult('JoinScratch')?.raw ?? null,
        frameCount: frames.length,
        frames,
      };
      writeFileSync(path.join(OUT_DIR, 'pen-discover.json'), JSON.stringify(out, null, 2));
      console.log('[pen] hubUrl=', hubUrl);
      console.log('[pen] httpCalls=', httpCalls.length, 'frames=', frames.length);
      console.log('[pen] storage keys:', Object.keys(storage.local), Object.keys(storage.session));
      console.log('[pen] wrote', path.join(OUT_DIR, 'pen-discover.json'));
    }
  });
});
