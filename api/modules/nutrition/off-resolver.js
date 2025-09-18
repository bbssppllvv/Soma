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

  const parts = [];
  if (item?.brand) parts.push(item.brand);
  if (item?.clean_name) parts.push(item.clean_name);
  if (Array.isArray(item?.required_tokens) && item.required_tokens.length > 0) {
    parts.push(item.required_tokens.join(' '));
  }
  if (parts.length === 0 && item?.name) {
    parts.push(item.name);
  }
  return parts
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectQueryTokens(term) {
  const normalized = normalizeForMatch(term);
  if (!normalized) return new Set();
  return new Set(normalized.split(/\s+/).filter(Boolean));
}

function scoreCandidate(item, product, queryTokens) {
  let score = 0;

  const productName = normalizeForMatch(product?.product_name);
  const productBrand = normalizeForMatch(product?.brands);
  const productLabels = (product?.labels_tags || []).map(normalizeForMatch).join(' ');
  const productCategories = (product?.categories_tags || []).map(normalizeForMatch).join(' ');
  const productCorpus = `${productName} ${productLabels} ${productCategories}`.trim();

  const itemBrand = normalizeForMatch(item?.brand || item?.brand_normalized);
  if (itemBrand) {
    if (productBrand.includes(itemBrand)) {
      score += 400;
    } else {
      const brandParts = itemBrand.split(' ').filter(Boolean);
      const matches = brandParts.filter(part => part.length > 2 && (productBrand.includes(part) || productCorpus.includes(part)));
      if (matches.length > 0) {
        score += 160 + matches.length * 30;
      } else {
        score -= 120;
      }
    }
  }

  const variantTokens = Array.isArray(item?.required_tokens) ? item.required_tokens : [];
  for (const rawToken of variantTokens) {
    const token = normalizeForMatch(rawToken);
    if (!token) continue;
    if (productCorpus.includes(token)) {
      score += 180;
    } else {
      score -= 60;
    }
  }

  for (const token of queryTokens) {
    if (token.length <= 2) continue;
    if (productName.includes(token)) {
      score += 20;
    }
  }

  if (item?.canonical_category) {
    const categoryToken = normalizeForMatch(item.canonical_category);
    if (categoryToken && productCategories.includes(categoryToken)) {
      score += 60;
    }
  }

  if (hasUsefulNutriments(product)) {
    score += 120;
  } else {
    score -= 200;
  }

  return score;
}

function toConfidence(score) {
  if (!Number.isFinite(score)) {
    return DEFAULT_CONFIDENCE_FLOOR;
  }
  const normalized = score / 500;
  return Math.max(DEFAULT_CONFIDENCE_FLOOR, Math.min(0.98, normalized));
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

  const queryTokens = collectQueryTokens(searchTerm);
  const scored = products
    .filter(hasUsefulNutriments)
    .map(product => ({
      product,
      score: scoreCandidate(item, product, queryTokens)
    }))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { item, reason: 'no_useful_nutrients', canonical: searchTerm };
  }

  const positive = scored.find(entry => entry.score > 0);
  const best = positive || scored[0];

  if (!best || best.score <= 0) {
    return { item, reason: 'low_score', canonical: searchTerm, score: best?.score ?? null };
  }

  return {
    product: best.product,
    score: best.score,
    confidence: toConfidence(best.score)
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
