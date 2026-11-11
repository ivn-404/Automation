/**
 * Resolve TypeScript ESM `from './x.js'` specifiers to sibling `x.ts` files and
 * transpile them. Used so queue scripts can import src/capabilities without a
 * second capability engine.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js') && context.parentURL) {
    const candidate = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier.replace(/\.js$/u, '.ts'));
    if (existsSync(candidate)) {
      return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:') || !url.endsWith('.ts')) {
    return nextLoad(url, context);
  }
  const source = readFileSync(fileURLToPath(url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: fileURLToPath(url),
  });
  return { format: 'module', source: outputText, shortCircuit: true };
}
