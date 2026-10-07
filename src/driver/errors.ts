/**
 * Game Driver errors.
 */

export class GameDriverNotAttachedError extends Error {
  readonly gameId: string;

  constructor(gameId: string) {
    super(`Game driver is not attached for game "${gameId}"`);
    this.name = 'GameDriverNotAttachedError';
    this.gameId = gameId;
  }
}
