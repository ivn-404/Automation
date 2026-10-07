/**
 * Collect page/console errors during a spec. Ignores common host-shell noise.
 */

import type { Page } from 'playwright';

const IGNORE =
  /favicon|net::ERR_|Download the React DevTools|ResizeObserver loop|Failed to load resource/iu;

export function installConsoleErrorCollector(page: Page): {
  readonly errors: string[];
} {
  const errors: string[] = [];

  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`);
  });

  page.on('console', (msg) => {
    if (msg.type() !== 'error') {
      return;
    }
    const text = msg.text();
    if (IGNORE.test(text)) {
      return;
    }
    errors.push(`console: ${text}`);
  });

  return { errors };
}
