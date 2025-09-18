import { matchVariantRules } from '../../variant-rules.js';
import { normalizeBrandForSearch } from '../brand.js';
import { canonicalizeQuery, limitSearchTerms, normalizeLocale, buildLangsParam } from './text.js';

export function buildLuceneQuery({ term, brand, primaryCategory = null, excludeCategories = [], variantTokens = [] }) {
  const searchTerms = [];

  if (brand) {
    const normalizedBrand = normalizeBrandForSearch(brand);
    if (normalizedBrand) {
      searchTerms.push(normalizedBrand);
    }
  }

  if (term) {
    const cleanTerm = canonicalizeQuery(term);
    if (cleanTerm) {
      searchTerms.push(cleanTerm);
    }
  }

  if (variantTokens.length > 0) {
    searchTerms.push(...variantTokens);
  }

  const allWords = searchTerms
    .filter(Boolean)
    .join(' ')
    .split(' ')
    .filter(Boolean)
    .map(word => word.toLowerCase().trim());

  const uniqueWords = [];
  const seen = new Set();
  for (const word of allWords) {
    if (!seen.has(word) && word.length > 0) {
      uniqueWords.push(word);
      seen.add(word);
    }
  }

  const prioritizedWords = uniqueWords.slice(0, 4);
  const finalQuery = prioritizedWords.join(' ');

  console.log(`[OFF] Optimized query: "${finalQuery}" (from ${allWords.length} → ${prioritizedWords.length} words)`);
  return finalQuery;
}

export function buildSearchQueries(cleanQuery, brand) {
  const queries = new Set();
  const trimmedQuery = limitSearchTerms(cleanQuery);
  const trimmedBrand = limitSearchTerms(brand ?? '');

  const queryWords = new Set(trimmedQuery.toLowerCase().split(' ').filter(Boolean));
  const brandWords = new Set(trimmedBrand.toLowerCase().split(' ').filter(Boolean));
  const cleanedQueryWords = [...queryWords].filter(word => !brandWords.has(word));
  const cleanedQuery = cleanedQueryWords.join(' ');

  if (trimmedBrand && cleanedQuery) {
    queries.add(`${trimmedBrand} ${cleanedQuery}`.trim());
  }
  if (trimmedQuery) {
    queries.add(trimmedQuery);
  }
  if (cleanedQuery && cleanedQuery !== trimmedQuery) {
    queries.add(cleanedQuery);
  }
  if (queries.size === 0 && trimmedBrand) {
    queries.add(trimmedBrand);
  }

  return [...queries];
}

export function collectVariantLabelFilters(tokens = []) {
  const rules = matchVariantRules(tokens);
  const labels = new Set();
  for (const rule of rules) {
    if (Array.isArray(rule.labelTerms)) {
      rule.labelTerms.forEach(term => labels.add(term));
    }
  }
  return [...labels];
}

export function toBrandSlug(value) {
  if (!value) return '';
  const lower = value.toString().toLowerCase();
  const normalized = lower
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/&/g, ' ')
    .replace(/["'’‘`´]/g, '')
    .replace(/_/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return '';

  return normalized
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export { buildLangsParam, normalizeLocale };
