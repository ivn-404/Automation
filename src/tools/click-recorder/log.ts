/**
 * Terminal evidence log (RECORDER.MD §4 / §8). Never writes automation.
 */

import type { ClickEvidence } from './types.js';

export function logClick(click: ClickEvidence): void {
  console.log('');
  console.log(`[RECORDER] Click #${click.seq}`);
  console.log(`[RECORDER] Page: ${click.pageUrl}`);
  console.log(`[RECORDER] Frame: ${click.inGameIframe ? 'Game iframe' : 'Host / lobby'}${click.frameUrl ? ` (${click.frameUrl})` : ''}`);
  console.log(`[RECORDER] Surface: ${click.surface}`);
  console.log(`[RECORDER] Coordinates: client=(${click.clientX}, ${click.clientY}) page=(${click.pageX}, ${click.pageY})`);
  if (click.normalizedX !== undefined && click.normalizedY !== undefined) {
    console.log(`[RECORDER] Normalized: x=${click.normalizedX}, y=${click.normalizedY}`);
  }
  if (click.element !== undefined) {
    console.log(`[RECORDER] Element: <${click.element.tagName}> ${click.element.text ?? click.element.name ?? ''}`.trim());
    console.log(`[RECORDER] Preferred strategy: ${click.element.locators.preferred}`);
    if (click.element.locators.semantic !== undefined) {
      console.log(`[RECORDER] Selector: ${click.element.locators.semantic}`);
    } else if (click.element.locators.testId !== undefined) {
      console.log(`[RECORDER] Selector: ${click.element.locators.testId}`);
    } else if (click.element.locators.css !== undefined) {
      console.log(`[RECORDER] Selector: ${click.element.locators.css}`);
    } else {
      console.log('[RECORDER] Selector: unavailable (use coordinates)');
    }
  } else {
    console.log('[RECORDER] Element: none (canvas / WebGL)');
    console.log('[RECORDER] DOM locator: unavailable');
    console.log('[RECORDER] Canvas interaction: detected');
  }
  if (click.overlay?.detected === true) {
    console.log('[RECORDER] Possible interaction overlay detected.');
    console.log(`[RECORDER] Element: ${click.overlay.selector ?? 'unknown'}`);
    console.log(`[RECORDER] Visibility: ${click.overlay.visibility ?? 'n/a'} opacity=${click.overlay.opacity ?? 'n/a'}`);
    console.log(`[RECORDER] Click interception: ${click.overlay.interceptPossible ? 'possible' : 'unlikely'}`);
  }
  console.log(`[RECORDER] Timestamp: ${click.timestamp}`);
}

export function logCommand(message: string): void {
  console.log(`[RECORDER] ${message}`);
}
