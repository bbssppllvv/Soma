import { DEFAULT_LANG } from './config.js';

const NOISE_WORDS = new Set([
  'tub', 'package', 'pack', 'photo', 'partially', 'visible', 'unopened', 'container', 'label',
  'fridge', 'door', 'shelf', 'background', 'image', 'top', 'bottom', 'middle', 'left', 'right',
  'open', 'inside', 'outside', 'front', 'rear', 'side', 'close', 'up', 'shot', 'in', 'of', 'with'
]);

export function canonicalizeQuery(raw = '') {
  const words = raw
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(word => !NOISE_WORDS.has(word));

  const unique = [];
  for (const word of words) {
    if (!unique.includes(word)) unique.push(word);
  }

  return unique.join(' ').trim();
}

export function limitSearchTerms(value = '', maxTokens = 6) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxTokens)
    .join(' ')
    .trim();
}

export function normalizeLocale(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (/^[a-z]{2}$/.test(trimmed)) {
      return trimmed;
    }
  }
  return DEFAULT_LANG;
}

export function buildLangsParam(locale) {
  const langs = new Set(['en', 'es']);
  const primary = normalizeLocale(locale);
  if (primary) langs.add(primary);
  return [...langs];
}
