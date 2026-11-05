/**
 * A failed attempt is either the game or the automation.
 *
 * A defect is left as a failure: the server answered the action, or the
 * assertion is about game state. An automation miss (no request, the wrong
 * control, a control that was not on screen) may be re-located once.
 * Anything unrecognised is a defect, so a mystery is never clicked again.
 */

const DEFECT: readonly RegExp[] = [
  /NOT CONFIGURED/i,
  /not refunded/i,
  /free-spin|bonus feature payload/i,
  /server answered \/bet HTTP/i,
  /server rejected/i,
  /HTTP\s*[45]\d\d/,
  /status(?:Code)?["'\s:]+[45]\d\d/,
  /does not declare/i,
];

const AUTOMATION: readonly RegExp[] = [
  /Timeout/i,
  /waitForResponse/i,
  /not visible/i,
  /did not complete/i,
  /no \/bet/i,
  /tap never reached/i,
  /pill not visible/i,
  /no Phaser band/i,
  /automation miss/i,
  /produced one \/bet, not autoplay/i,
  /spin control not visible/i,
  /HUD not idle/i,
];

export class GameDefectError extends Error {
  readonly kind = 'defect' as const;

  constructor(message: string) {
    super(message);
    this.name = 'GameDefectError';
  }
}

export function failureKind(error: unknown): 'defect' | 'automation' {
  if (error instanceof GameDefectError) {
    return 'defect';
  }
  const message = error instanceof Error ? error.message : String(error);
  if (DEFECT.some((pattern) => pattern.test(message))) {
    return 'defect';
  }
  if (AUTOMATION.some((pattern) => pattern.test(message))) {
    return 'automation';
  }
  if (/expect\(|\btoBe\b|\btoEqual\b/i.test(message)) {
    return 'defect';
  }
  return 'defect';
}
