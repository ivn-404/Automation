/**
 * Rank locator strategies from a clicked DOM snapshot (RECORDER.MD §5).
 * Coordinates are last-resort — never assumed preferred.
 */

import type { ElementSnapshot, LocatorCandidates } from './types.js';

const ATTR_KEYS = ['data-testid', 'data-test', 'aria-label', 'name', 'placeholder', 'title', 'type'] as const;

export function buildLocatorCandidates(raw: {
  readonly tagName: string;
  readonly id?: string;
  readonly className?: string;
  readonly text?: string;
  readonly role?: string;
  readonly name?: string;
  readonly attributes: Record<string, string>;
}): LocatorCandidates {
  const tag = raw.tagName.toLowerCase();
  const text = raw.text?.replace(/\s+/gu, ' ').trim().slice(0, 80);
  const testId = raw.attributes['data-testid'] ?? raw.attributes['data-test'];
  const id = raw.id && /^[A-Za-z][\w-]*$/u.test(raw.id) ? raw.id : undefined;
  const role = raw.role ?? implicitRole(tag, raw.attributes);
  const name = raw.name ?? raw.attributes['aria-label'] ?? text;

  const semantic =
    role !== undefined && name !== undefined && name.length > 0
      ? `getByRole(${JSON.stringify(role)}, { name: ${JSON.stringify(name.slice(0, 60))} })`
      : undefined;
  const roleLocator = role !== undefined ? `getByRole(${JSON.stringify(role)})` : undefined;
  const textLocator =
    text !== undefined && text.length > 0 && text.length < 48
      ? `getByText(${JSON.stringify(text)})`
      : undefined;
  const testIdLocator = testId !== undefined ? `getByTestId(${JSON.stringify(testId)})` : undefined;
  const idLocator = id !== undefined ? `#${id}` : undefined;

  const attrParts = ATTR_KEYS.map((key) => {
    const value = raw.attributes[key];
    if (value === undefined || value.length === 0) {
      return undefined;
    }
    return `${tag}[${key}=${JSON.stringify(value)}]`;
  }).filter((part): part is string => part !== undefined);

  const css =
    idLocator ??
    attrParts[0] ??
    (raw.className !== undefined && raw.className.trim().length > 0
      ? `${tag}.${raw.className.trim().split(/\s+/u)[0]}`
      : tag);

  let preferred: LocatorCandidates['preferred'] = 'coordinates';
  if (semantic !== undefined) {
    preferred = 'semantic';
  } else if (testIdLocator !== undefined || idLocator !== undefined) {
    preferred = 'dom';
  } else if (roleLocator !== undefined) {
    preferred = 'role';
  } else if (textLocator !== undefined) {
    preferred = 'text';
  } else if (attrParts.length > 0) {
    preferred = 'attribute';
  }

  return {
    ...(semantic !== undefined ? { semantic } : {}),
    ...(roleLocator !== undefined ? { role: roleLocator } : {}),
    ...(textLocator !== undefined ? { text: textLocator } : {}),
    ...(testIdLocator !== undefined ? { testId: testIdLocator } : {}),
    ...(idLocator !== undefined ? { id: idLocator } : {}),
    css,
    preferred,
  };
}

function implicitRole(tag: string, attributes: Record<string, string>): string | undefined {
  if (tag === 'button') {
    return 'button';
  }
  if (tag === 'a' && attributes.href !== undefined) {
    return 'link';
  }
  if (tag === 'input') {
    const type = (attributes.type ?? 'text').toLowerCase();
    if (type === 'submit' || type === 'button') {
      return 'button';
    }
    if (type === 'checkbox') {
      return 'checkbox';
    }
    return 'textbox';
  }
  if (tag === 'select') {
    return 'combobox';
  }
  if (tag === 'textarea') {
    return 'textbox';
  }
  return undefined;
}

export function snapshotFromRaw(raw: {
  readonly tagName: string;
  readonly id?: string;
  readonly className?: string;
  readonly text?: string;
  readonly role?: string;
  readonly name?: string;
  readonly attributes: Record<string, string>;
  readonly boundingBox?: { x: number; y: number; width: number; height: number };
}): ElementSnapshot {
  return {
    tagName: raw.tagName,
    ...(raw.id !== undefined && raw.id.length > 0 ? { id: raw.id } : {}),
    ...(raw.className !== undefined && raw.className.length > 0 ? { className: raw.className } : {}),
    ...(raw.text !== undefined && raw.text.length > 0 ? { text: raw.text } : {}),
    ...(raw.role !== undefined ? { role: raw.role } : {}),
    ...(raw.name !== undefined ? { name: raw.name } : {}),
    attributes: raw.attributes,
    ...(raw.boundingBox !== undefined ? { boundingBox: raw.boundingBox } : {}),
    locators: buildLocatorCandidates(raw),
  };
}
