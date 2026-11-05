/**
 * Opens a second staging launcher page and captures that player's scratch hub.
 * The caller closes the context. The player id is restored even when setup throws.
 */

import type { Page } from 'playwright';

import { ScratchHubClient, type HubCompletion } from '../../src/network/index.js';
import { PlaywrightPlatform } from '../../src/platform/index.js';

const RECORD_SEPARATOR = '\u001e';

export async function openSecondScratchPlayer(
  page: Page,
  environment: ConstructorParameters<typeof PlaywrightPlatform>[0]['environment'],
  manifest: ConstructorParameters<typeof PlaywrightPlatform>[0]['manifest'],
  ui: ConstructorParameters<typeof PlaywrightPlatform>[0]['ui'],
  playerId: string,
): Promise<{
  readonly client: ScratchHubClient;
  readonly hubUrl: string;
  readonly joinArgs: readonly unknown[];
  readonly playerId?: string;
  readonly close: () => Promise<void>;
}> {
  const browser = page.context().browser();
  if (browser === null) {
    throw new Error('No browser is available for a second scratch player');
  }
  const context = await browser.newContext({ viewport: { width: 960, height: 1032 } });
  const otherPage = await context.newPage();
  const previous = process.env.SGAP_PLAYER_ID;
  process.env.SGAP_PLAYER_ID = playerId;
  let hubUrl = '';
  let joinArgs: readonly unknown[] = [];
  otherPage.on('websocket', (socket) => {
    if (!socket.url().includes('/hubs/game')) {
      return;
    }
    hubUrl = socket.url();
    socket.on('framesent', (frame) => {
      const payload = String(frame.payload);
      if (!payload.includes('"JoinScratch"')) {
        return;
      }
      try {
        const message = JSON.parse(payload.split(RECORD_SEPARATOR)[0] ?? '{}') as { arguments?: unknown[] };
        if (Array.isArray(message.arguments)) {
          joinArgs = message.arguments;
        }
      } catch {
        // Ignore non-JSON frames.
      }
    });
  });
  const restore = (): void => {
    if (previous === undefined) {
      delete process.env.SGAP_PLAYER_ID;
    } else {
      process.env.SGAP_PLAYER_ID = previous;
    }
  };
  try {
    const platform = new PlaywrightPlatform({ page: otherPage, environment, manifest, ui });
    const timeoutMs = 90_000;
    await platform.openGameHost({ timeoutMs });
    await platform.openGame({ timeoutMs });
    await platform.prepareGameView('desktop', { timeoutMs });
    const deadline = Date.now() + 15_000;
    while ((hubUrl.length === 0 || joinArgs.length === 0) && Date.now() < deadline) {
      await otherPage.waitForTimeout(250);
    }
    if (hubUrl.length === 0) {
      throw new Error(`${playerId}: scratch hub socket never opened`);
    }
    const client = await ScratchHubClient.connect(hubUrl);
    const completion = await client
      .invoke('JoinScratch', joinArgs)
      .catch((error: Error): HubCompletion => ({ error: error.message }));
    if (completion.error !== undefined) {
      client.close();
      throw new Error(`${playerId}: JoinScratch failed (${completion.error})`);
    }
    const returned = (completion.result as { player?: { playerId?: unknown } } | undefined)?.player?.playerId;
    return {
      client,
      hubUrl,
      joinArgs,
      ...(typeof returned === 'string' ? { playerId: returned } : {}),
      close: async () => {
        client.close();
        await context.close();
      },
    };
  } catch (error: unknown) {
    await context.close();
    throw error;
  } finally {
    restore();
  }
}
