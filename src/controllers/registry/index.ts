/**
 * Controller Registry — single discovery surface for controllers.
 * Prevents duplicate controller implementations.
 */

export const CONTROLLER_REGISTRY = 'controller-registry' as const;

export { ControllerRegistry } from './controller-registry.js';
export {
  ControllerAlreadyRegisteredError,
  ControllerDisabledError,
  ControllerNotRegisteredError,
} from './errors.js';
