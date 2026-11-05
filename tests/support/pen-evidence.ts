/**
 * Puts each pentest exchange into the Allure report as a step:
 * the redacted request, the server response, and a screenshot of that pair.
 * Tokens are stripped before anything is attached.
 */

import type { Page } from '@playwright/test';

import { allure } from 'allure-playwright';
import { clip, redactText } from '../../src/observability/redact.js';

let boundPage: Page | undefined;

export function bindPenPage(page: Page | undefined): void {
  boundPage = page;
}

export async function recordPenExchange(input: {
  readonly page?: Page;
  readonly title: string;
  readonly request: unknown;
  readonly response: unknown;
}): Promise<void> {
  const page = input.page ?? boundPage;
  const requestText = present(input.request);
  const responseText = present(input.response);
  try {
    await allure.step(input.title, async () => {
      await allure.attachment('request.txt', requestText, 'text/plain');
      await allure.attachment('response.txt', responseText, 'text/plain');
      if (page !== undefined && !page.isClosed()) {
        const card = await renderExchangeCard(page, input.title, requestText, responseText);
        if (card !== undefined) {
          await allure.attachment('exchange.png', card, 'image/png');
        }
        const screen = await page.screenshot({ timeout: 5_000 }).catch(() => undefined);
        if (screen !== undefined) {
          await allure.attachment('screen.png', screen, 'image/png');
        }
      }
    });
  } catch (error) {
    console.log('[pen] evidence step skipped:', (error as Error).message);
  }
}

function present(value: unknown): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return clip(redactText(raw ?? ''), 6_000);
}

async function renderExchangeCard(
  page: Page,
  title: string,
  request: string,
  response: string,
): Promise<Buffer | undefined> {
  const dataUrl = await page
    .evaluate(
      ({ title, request, response }) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 1800;
        const ctx = canvas.getContext('2d');
        if (ctx === null) {
          return '';
        }
        ctx.fillStyle = '#161616';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = '22px Consolas, monospace';
        const lines = [`${title}`, '', 'REQUEST', request, '', 'RESPONSE', response];
        let y = 48;
        for (const line of lines) {
          ctx.fillStyle = line === 'REQUEST' || line === 'RESPONSE' ? '#8fd18f' : '#f4f4f4';
          const chunks = line.length === 0 ? [''] : (line.match(/.{1,92}/g) ?? [line]);
          for (const chunk of chunks) {
            ctx.fillText(chunk, 28, y);
            y += 28;
            if (y > canvas.height - 24) {
              return canvas.toDataURL('image/png');
            }
          }
        }
        return canvas.toDataURL('image/png');
      },
      { title, request, response },
    )
    .catch(() => '');
  if (!dataUrl.startsWith('data:image/png;base64,')) {
    return undefined;
  }
  return Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
}
