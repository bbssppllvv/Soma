import { getByBarcode, searchByNameV1 } from './off-client.js';
import { mapOFFProductToPer100g } from './off-map.js';
import { hasUsefulNutriments } from './off/nutrients.js';
import { normalizeForMatch } from './off/text.js';
import { REQUIRE_BRAND } from './off/constants.js';

const DEFAULT_CONFIDENCE_FLOOR = 0.65;

function normalizeUPC(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function buildSearchTerm(item) {
  const direct = typeof item?.off_query === 'string' ? item.off_query.trim() : '';
  if (direct) return direct;
  return typeof item?.name === 'string' ? item.name.trim() : '';
}

function normalizeValue(value) {
  return normalizeForMatch(value || '').replace(/\s+/g, ' ').trim();
}

function buildProductCorpus(product) {
  const fields = [product?.product_name, product?.brands];
  if (Array.isArray(product?.brands_tags)) fields.push(product.brands_tags.join(' '));
  if (Array.isArray(product?.labels_tags)) fields.push(product.labels_tags.join(' '));
  if (Array.isArray(product?.categories_tags)) fields.push(product.categories_tags.join(' '));
  return normalizeForMatch(fields.filter(Boolean).join(' '));
}

function findFirstMatch(products, predicate) {
  for (const product of products) {
    if (predicate(product)) return product;
  }
  return null;
}

function toConfidence({ brandMatch, tokenMatch, hasNutrients }) {
  if (brandMatch && tokenMatch) return 0.95;
  if (brandMatch) return 0.9;
  if (tokenMatch) return 0.85;
  if (hasNutrients) return 0.75;
  return DEFAULT_CONFIDENCE_FLOOR;
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

  const preferredBrand = normalizeValue(item?.off_brand_filter || item?.brand || item?.brand_normalized || '');
  const preferredTokens = Array.isArray(item?.off_variant_tokens)
    ? item.off_variant_tokens
    : Array.isArray(item?.required_tokens)
      ? item.required_tokens
      : [];
  const normalizedTokens = preferredTokens.map(normalizeValue).filter(Boolean);

  const isBrandMatch = (product) => {
    if (!preferredBrand) return false;
    const corpus = buildProductCorpus(product);
    return corpus.includes(preferredBrand);
  };

  const isTokenMatch = (product) => {
    if (normalizedTokens.length === 0) return false;
    const corpus = buildProductCorpus(product);
    return normalizedTokens.some(token => token && corpus.includes(token));
  };

  const brandHit = findFirstMatch(products, isBrandMatch);
  const tokenHit = brandHit || findFirstMatch(products, isTokenMatch);
  const fallback = tokenHit || products[0];

  if (!fallback) {
    return { item, reason: 'no_candidates', canonical: searchTerm };
  }

  const hasNutrients = hasUsefulNutriments(fallback);
  const brandMatch = Boolean(fallback && (brandHit === fallback || isBrandMatch(fallback)));
  const tokenMatch = Boolean(fallback && isTokenMatch(fallback));

  return {
    product: fallback,
    score: brandMatch || tokenMatch ? 1 : 0.5,
    confidence: toConfidence({ brandMatch, tokenMatch, hasNutrients })
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
