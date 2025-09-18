import { getByBarcode, searchByNameV1 } from './off-client.js';
import { mapOFFProductToPer100g } from './off-map.js';
import { hasUsefulNutriments } from './off/nutrients.js';
import { normalizeForMatch } from './off/text.js';
import { REQUIRE_BRAND } from './off/constants.js';

const DEFAULT_CONFIDENCE_FLOOR = 0.55;

function normalizeUPC(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function buildSearchTerm(item) {
  const direct = typeof item?.off_query === 'string' ? item.off_query.trim() : '';
  if (direct) return direct;

  const parts = new Set();
  if (item?.name) parts.add(item.name);
  if (item?.brand) parts.add(item.brand);
  if (item?.clean_name) parts.add(item.clean_name);
  if (Array.isArray(item?.required_tokens) && item.required_tokens.length > 0) {
    parts.add(item.required_tokens.join(' '));
  }

  const combined = Array.from(parts)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return combined || item?.name || '';
}

function normalizeToken(token) {
  return normalizeForMatch(token || '').replace(/\s+/g, ' ').trim();
}

function expandTokenVariants(token) {
  const normalized = normalizeToken(token);
  if (!normalized) return [];
  const variants = new Set([normalized]);
  if (normalized.includes('creme')) {
    variants.add(normalized.replace('creme', 'cream'));
  }
  if (normalized.includes('cream')) {
    variants.add(normalized.replace('cream', 'creme'));
  }
  if (normalized.includes('&')) {
    variants.add(normalized.replace(/&/g, 'and'));
  }
  return [...variants].filter(Boolean);
}

function buildProductCorpus(product) {
  const segments = [];
  if (product?.product_name) segments.push(product.product_name);
  if (product?.brands) segments.push(product.brands);
  if (Array.isArray(product?.brands_tags)) segments.push(product.brands_tags.join(' '));
  if (Array.isArray(product?.labels_tags)) segments.push(product.labels_tags.join(' '));
  if (Array.isArray(product?.categories_tags)) segments.push(product.categories_tags.join(' '));
  return normalizeForMatch(segments.join(' '));
}

function countTokenMatches(corpus, tokens = []) {
  if (!corpus) return 0;
  let matches = 0;
  for (const token of tokens) {
    const variants = expandTokenVariants(token);
    if (variants.some(variant => variant && corpus.includes(variant))) {
      matches += 1;
    }
  }
  return matches;
}

function hasBrandMatch(corpus, brandValue) {
  const normalized = normalizeToken(brandValue);
  if (!normalized) return false;
  if (!corpus) return false;
  if (corpus.includes(normalized)) return true;
  const parts = normalized.split(' ').filter(part => part.length > 2);
  if (parts.length === 0) return false;
  const hits = parts.filter(part => corpus.includes(part));
  return hits.length === parts.length || hits.length >= 1;
}

function toConfidence({ brandMatch, tokenMatchCount, hasNutrients }) {
  let confidence = DEFAULT_CONFIDENCE_FLOOR;
  if (brandMatch) confidence = Math.max(confidence, 0.82);
  if (tokenMatchCount > 0) confidence = Math.max(confidence, 0.86 + Math.min(0.08, tokenMatchCount * 0.04));
  if (hasNutrients) confidence = Math.max(confidence, 0.9);
  return Math.min(confidence, 0.97);
}

export async function resolveOneItemOFF(item, { signal } = {}) {
  if (!item) {
    return { item: null, reason: 'invalid_item' };
  }

  if (REQUIRE_BRAND && !item.off_candidate) {
    return { item, reason: 'skipped_no_brand' };
  }

  if (item?.upc) {
    const code = normalizeUPC(item.upc);
    if (code) {
      try {
        const byCode = await getByBarcode(code, { signal });
        if (byCode && hasUsefulNutriments(byCode)) {
          return { product: byCode, score: 1, confidence: 0.95 };
        }
      } catch (error) {
        console.log('[OFF] Barcode lookup failed', {
          code,
          error: error?.message || 'unknown'
        });
      }
    }
  }

  const searchTerm = buildSearchTerm(item);
  if (!searchTerm) {
    return { item, reason: 'empty_query' };
  }

  let searchResult;
  try {
    searchResult = await searchByNameV1(searchTerm, {
      signal,
      brand: item?.off_brand_filter || item?.brand || null,
      locale: item?.locale || null
    });
  } catch (error) {
    return {
      item,
      reason: 'http_or_json_error',
      canonical: searchTerm,
      error: error?.message || 'unknown'
    };
  }

  const products = Array.isArray(searchResult?.products) ? searchResult.products : [];
  if (products.length === 0) {
    return { item, reason: 'no_hits', canonical: searchTerm };
  }

  const brandPreference = item?.off_brand_filter || item?.brand || item?.brand_normalized || '';
  const tokenList = Array.isArray(item?.required_tokens) ? item.required_tokens : [];

  const ranked = products.map((product, index) => {
    const corpus = buildProductCorpus(product);
    const hasNutrients = hasUsefulNutriments(product);
    const tokenMatchCount = countTokenMatches(corpus, tokenList);
    const brandMatch = hasBrandMatch(corpus, brandPreference);
    const baseScore = hasNutrients ? 3 : 1;
    const score = baseScore + (brandMatch ? 3 : 0) + Math.min(3, tokenMatchCount) + Math.max(0, 2 - index * 0.3);
    return { product, score, brandMatch, tokenMatchCount, hasNutrients };
  });

  ranked.sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) {
    return { item, reason: 'no_candidates', canonical: searchTerm };
  }

  return {
    product: best.product,
    score: Math.round(best.score * 100) / 100,
    confidence: toConfidence(best)
  };
}

export function scalePerPortionOFF(prod, grams) {
  const per100 = mapOFFProductToPer100g(prod);
  const k = grams / 100;
  const round = (n, d = 0) => {
    const m = 10 ** d;
    return Math.round((n + Number.EPSILON) * m) / m;
  };
  return {
    calories: round((per100.ENERC_KCAL || 0) * k),
    protein_g: round((per100.PROCNT || 0) * k, 1),
    fat_g: round((per100.FAT || 0) * k, 1),
    carbs_g: round((per100.CHOCDF || 0) * k, 1),
    fiber_g: round((per100.FIBTG || 0) * k, 1),
    meta: per100.meta,
    serving_size_label: per100.serving_size
  };
}
