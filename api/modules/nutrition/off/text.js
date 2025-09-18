export function limitTokens(value = '', maxTokens = 6) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxTokens)
    .join(' ')
    .trim();
}

export function normalizeText(value) {
  return (value || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function normalizeForMatch(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

export function stripLangPrefix(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/^[a-z]{2,3}:/i, '');
}

export function escapeRegex(value) {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

export function buildPhraseRegex(phrase) {
  const normalized = normalizeForMatch(phrase);
  if (!normalized) return null;
  const parts = normalized.split(/\s+/).filter(Boolean).map(escapeRegex);
  if (parts.length === 0) return null;
  return new RegExp(`\\b${parts.join('\\s+')}\\b`, 'i');
}
