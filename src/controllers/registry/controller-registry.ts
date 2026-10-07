/**
 * In-memory Controller Registry.
 *
 * Single discovery surface for controller implementations.
 * Prevents duplicate registrations. Optional manifest binding gates enabled controllers.
 */

import type {
  ControllerMap,
  IControllerRegistry,
} from '../../core/contracts/index.js';
import type { ControllerId } from '../../core/constants/index.js';
import type { GameManifest } from '../../core/models/index.js';
import {
  ControllerAlreadyRegisteredError,
  ControllerDisabledError,
  ControllerNotRegisteredError,
} from './errors.js';

export class ControllerRegistry implements IControllerRegistry {
  private readonly controllers = new Map<ControllerId, ControllerMap[ControllerId]>();
  private manifest: GameManifest | undefined;

  /** Bind a game manifest to gate controller availability by `controllers[].enabled`. */
  setManifest(manifest: GameManifest): void {
    this.manifest = manifest;
  }

  /** Clear manifest binding (all registered controllers treated as enabled). */
  clearManifest(): void {
    this.manifest = undefined;
  }

  register<K extends ControllerId>(controller: ControllerMap[K]): void {
    if (this.controllers.has(controller.id)) {
      throw new ControllerAlreadyRegisteredError(controller.id);
    }
    this.controllers.set(controller.id, controller);
  }

  get<K extends ControllerId>(id: K): ControllerMap[K] {
    const controller = this.controllers.get(id);
    if (controller === undefined) {
      throw new ControllerNotRegisteredError(id);
    }
    return controller as ControllerMap[K];
  }

  tryGet<K extends ControllerId>(id: K): ControllerMap[K] | undefined {
    const controller = this.controllers.get(id);
    return controller as ControllerMap[K] | undefined;
  }

  has(id: ControllerId): boolean {
    return this.controllers.has(id);
  }

  list(): readonly ControllerId[] {
    return [...this.controllers.keys()].sort();
  }

  /** Whether the controller is enabled in the bound manifest (true if no manifest). */
  isEnabled(id: ControllerId): boolean {
    if (this.manifest === undefined) {
      return true;
    }
    const capability = this.manifest.controllers.find((entry) => entry.id === id);
    return capability?.enabled ?? false;
  }

  /** Registered controllers that are enabled in the bound manifest. */
  listEnabled(): readonly ControllerId[] {
    return this.list().filter((id) => this.isEnabled(id));
  }

  /** Returns a registered controller only if enabled in the manifest. */
  getEnabled<K extends ControllerId>(id: K): ControllerMap[K] {
    if (!this.isEnabled(id)) {
      throw new ControllerDisabledError(id);
    }
    return this.get(id);
  }
}
