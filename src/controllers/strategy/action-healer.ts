/**
 * Healing strategy a controller runs around one game action.
 *
 * Controllers own the action (click + observable verification); the healer owns
 * readiness and recovery, which differ by rendering (canvas eye gate, overlay
 * dismissal, vision re-locate). A healer must never perform the action itself or
 * substitute a different one — it only gets the game ready, or explains why not.
 */

export type HealableAction = 'spin';

export interface ActionHealer {
  /** Bring the game to a state where `action` can be performed. Throws with the reason when it cannot. */
  prepare(action: HealableAction): Promise<void>;
  /** Wait until the game is idle again after the verified action. */
  settle(action: HealableAction): Promise<void>;
  /**
   * After a failed attempt: dismiss what blocked it and remember a re-located
   * point for the next attempt. Must not retry the action.
   */
  recover(action: HealableAction, error: unknown): Promise<void>;
}

export const NO_HEAL: ActionHealer = {
  async prepare(): Promise<void> {},
  async settle(): Promise<void> {},
  async recover(): Promise<void> {},
};
