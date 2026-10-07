/**
 * Environment config module — parse/validate + file loader.
 */

export {
  ENVIRONMENT_SCHEMA_VERSION,
  EnvironmentValidationError,
  parseEnvironmentConfig,
} from './parse-environment.js';

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { EnvironmentConfig } from '../../core/models/index.js';
import { EnvironmentValidationError, parseEnvironmentConfig } from './parse-environment.js';

export class EnvironmentNotFoundError extends Error {
  readonly environmentName: string;

  constructor(environmentName: string, environmentsDir: string) {
    super(`Environment "${environmentName}" not found in ${environmentsDir}`);
    this.name = 'EnvironmentNotFoundError';
    this.environmentName = environmentName;
  }
}

export interface FileEnvironmentLoaderOptions {
  readonly environmentsDir: string;
}

export class FileEnvironmentLoader {
  private readonly environmentsDir: string;

  constructor(options: FileEnvironmentLoaderOptions) {
    this.environmentsDir = path.resolve(options.environmentsDir);
  }

  async listEnvironmentNames(): Promise<readonly string[]> {
    const entries = await readdir(this.environmentsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name.replace(/\.json$/u, ''))
      .sort();
  }

  async load(environmentName: string): Promise<EnvironmentConfig> {
    if (!environmentName || environmentName.trim().length === 0) {
      throw new EnvironmentValidationError('name', 'environment name must be a non-empty string');
    }

    const filePath = path.join(this.environmentsDir, `${environmentName}.json`);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        throw new EnvironmentNotFoundError(environmentName, this.environmentsDir);
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new EnvironmentValidationError(filePath, 'invalid JSON');
    }

    const environment = parseEnvironmentConfig(parsed);
    if (environment.name !== environmentName) {
      throw new EnvironmentValidationError(
        '$.name',
        `file "${environmentName}.json" declares name "${environment.name}"; they must match`,
      );
    }

    return environment;
  }
}

export function defaultEnvironmentsDir(cwd: string = process.cwd()): string {
  return path.join(cwd, 'config', 'environments');
}
