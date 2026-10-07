/**
 * Environment config parse / validate.
 */

import type { EnvironmentConfig } from '../../core/models/index.js';

export const ENVIRONMENT_SCHEMA_VERSION = '1.0.0' as const;

const ENV_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class EnvironmentValidationError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`Environment validation failed at "${path}": ${message}`);
    this.name = 'EnvironmentValidationError';
    this.path = path;
  }
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new EnvironmentValidationError(path, 'expected a plain object');
  }
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new EnvironmentValidationError(path, 'expected a non-empty string');
  }
}

function parseMetadata(value: unknown, path: string): Readonly<Record<string, string>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  assertObject(value, path);
  const metadata: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    assertNonEmptyString(entry, `${path}.${key}`);
    metadata[key] = entry;
  }
  return metadata;
}

export function parseEnvironmentConfig(input: unknown): EnvironmentConfig {
  assertObject(input, '$');

  assertNonEmptyString(input.schemaVersion, '$.schemaVersion');
  if (input.schemaVersion !== ENVIRONMENT_SCHEMA_VERSION) {
    throw new EnvironmentValidationError(
      '$.schemaVersion',
      `unsupported version "${input.schemaVersion}"; expected "${ENVIRONMENT_SCHEMA_VERSION}"`,
    );
  }

  assertNonEmptyString(input.name, '$.name');
  if (!ENV_NAME_PATTERN.test(input.name)) {
    throw new EnvironmentValidationError('$.name', 'must be kebab-case alphanumeric');
  }

  assertNonEmptyString(input.baseUrl, '$.baseUrl');

  if (typeof input.defaultTimeoutMs !== 'number' || !Number.isFinite(input.defaultTimeoutMs)) {
    throw new EnvironmentValidationError('$.defaultTimeoutMs', 'expected a finite number');
  }
  if (input.defaultTimeoutMs < 1000) {
    throw new EnvironmentValidationError('$.defaultTimeoutMs', 'must be >= 1000');
  }

  const metadata = parseMetadata(input.metadata, '$.metadata');

  const allowedKeys = new Set(['schemaVersion', 'name', 'baseUrl', 'defaultTimeoutMs', 'metadata']);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      throw new EnvironmentValidationError(`$.${key}`, 'unknown property');
    }
  }

  return {
    schemaVersion: ENVIRONMENT_SCHEMA_VERSION,
    name: input.name,
    baseUrl: input.baseUrl,
    defaultTimeoutMs: input.defaultTimeoutMs,
    ...(metadata !== undefined ? { metadata } : {}),
  };
}
