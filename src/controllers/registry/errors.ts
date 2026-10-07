/**
 * Controller registry errors.
 */

import type { ControllerId } from '../../core/constants/index.js';

export class ControllerAlreadyRegisteredError extends Error {
  readonly controllerId: ControllerId;

  constructor(controllerId: ControllerId) {
    super(`Controller "${controllerId}" is already registered`);
    this.name = 'ControllerAlreadyRegisteredError';
    this.controllerId = controllerId;
  }
}

export class ControllerNotRegisteredError extends Error {
  readonly controllerId: ControllerId;

  constructor(controllerId: ControllerId) {
    super(`Controller "${controllerId}" is not registered`);
    this.name = 'ControllerNotRegisteredError';
    this.controllerId = controllerId;
  }
}

export class ControllerDisabledError extends Error {
  readonly controllerId: ControllerId;

  constructor(controllerId: ControllerId) {
    super(`Controller "${controllerId}" is disabled in the game manifest`);
    this.name = 'ControllerDisabledError';
    this.controllerId = controllerId;
  }
}
