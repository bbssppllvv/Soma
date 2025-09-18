import { getByBarcode, searchByNameV1 } from './off-client.js';
import { mapOFFProductToPer100g } from './off-map.js';
import { hasUsefulNutriments } from './off/nutrients.js';
import { normalizeForMatch } from './off/text.js';
import { REQUIRE_BRAND } from './off/constants.js';

const DEFAULT_CONFIDENCE_FLOOR = 0.65;
const MAX_PRODUCTS_CONSIDERED = 12;

function toBrandSlug(value) {
  if (!value) return '';
  const lower = value
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/&/g, ' ')
    .replace(/["'’‘`´]/g, '')
    .replace(/_/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!lower) return '';

  return lower
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeUPC(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function buildSearchTerm(item) {
  const direct = typeof item?.off_query === 'string' ? item.off_query.trim() : '';
  if (direct) return direct;
  const brandValue = item?.off_brand_filter || item?.brand || item?.brand_normalized || '';
  const brandSlug = toBrandSlug(brandValue);
  const variantPhrases = collectVariantPhrases(item);

  const clauses = [];
  if (brandSlug) {
    clauses.push(`brands_tags:"${brandSlug}"`);
  }

  if (variantPhrases.length > 0) {
    const phraseClauses = variantPhrases
      .map(phrase => phrase?.trim())
      .filter(Boolean)
      .map(phrase => `product_name:"${escapeLucenePhrase(phrase)}"`);

    if (phraseClauses.length > 0) {
      clauses.push(`(${phraseClauses.join(' OR ')})`);
    }
  }

  if (clauses.length > 0) {
    return clauses.join(' AND ');
  }

  return typeof item?.name === 'string' ? item.name.trim() : '';
}

function normalizeValue(value) {
  return normalizeForMatch(value || '').replace(/\s+/g, ' ').trim();
}

function escapeLucenePhrase(value) {
  return value.replace(/["\\]/g, match => `\\${match}`);
}

function expandVariantToken(token) {
  const variants = new Set();
  const raw = (token || '').toString().toLowerCase().trim();
  if (!raw) return variants;

  const rawCandidates = new Set([raw]);

  if (raw.includes('&')) {
    rawCandidates.add(raw.replace(/&/g, 'and'));
  }
  if (raw.includes(' and ')) {
    rawCandidates.add(raw.replace(/\sand\s/g, ' & '));
  }
  if (raw.includes('creme')) {
    rawCandidates.add(raw.replace(/creme/g, 'cream'));
  }
  if (raw.includes('cream')) {
    rawCandidates.add(raw.replace(/cream/g, 'creme'));
  }

  for (const candidate of rawCandidates) {
    const normalized = normalizeValue(candidate);
    if (normalized) {
      variants.add(normalized);
    }
  }

  return variants;
}

function collectVariantTokens(item) {
  const tokenSources = [];
  if (Array.isArray(item?.off_variant_tokens) && item.off_variant_tokens.length > 0) {
    tokenSources.push(item.off_variant_tokens);
  } else if (Array.isArray(item?.required_tokens) && item.required_tokens.length > 0) {
    tokenSources.push(item.required_tokens);
  }

  const tokens = new Set();

  for (const source of tokenSources) {
    if (!Array.isArray(source)) continue;
    // Add individual tokens
    source.forEach(token => {
      expandVariantToken(token).forEach(value => tokens.add(value));
    });

    // Add combined phrase
    const phrase = normalizeValue(source.join(' '));
    if (phrase) {
      expandVariantToken(phrase).forEach(value => tokens.add(value));
    }
  }

  return [...tokens].filter(token => token.length > 2);
}

function collectVariantPhrases(item) {
  const phrases = new Set();

  if (Array.isArray(item?.off_variant_tokens) && item.off_variant_tokens.length > 0) {
    const joined = item.off_variant_tokens.join(' ').trim();
    if (joined) phrases.add(joined);
    item.off_variant_tokens.forEach(token => {
      if (typeof token === 'string' && token.trim().includes(' ')) {
        phrases.add(token.trim());
      }
    });
  }

  if (phrases.size === 0 && Array.isArray(item?.required_tokens) && item.required_tokens.length > 0) {
    const joinedRequired = item.required_tokens.join(' ').trim();
    if (joinedRequired) phrases.add(joinedRequired);
  }

  return [...phrases].filter(Boolean);
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
      brand: toBrandSlug(item?.off_brand_filter || item?.brand || item?.brand_normalized || '') || item?.off_brand_filter || item?.brand || null,
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

  console.log('[OFF] raw candidates', {
    query: searchTerm,
    brand: item?.off_brand_filter || item?.brand || null,
    hits: products.map(prod => ({
      code: prod?.code || null,
      name: prod?.product_name || null,
      brands: prod?.brands || null,
      labels: prod?.labels_tags || null,
      categories: prod?.categories_tags || null
    }))
  });

  const preferredBrand = normalizeValue(item?.off_brand_filter || item?.brand || item?.brand_normalized || '');
  const variantTokens = collectVariantTokens(item);
  const normalizedSearchTerm = normalizeValue(searchTerm);

  if (variantTokens.length > 0 && preferredBrand && normalizedSearchTerm === preferredBrand) {
    console.log('[OFF] query too generic for variant product', {
      query: searchTerm,
      preferredBrand,
      variantTokens
    });
    return { item, reason: 'query_too_generic', canonical: searchTerm };
  }

  const candidates = products.slice(0, MAX_PRODUCTS_CONSIDERED);

  const productNameMatches = (product) => {
    if (variantTokens.length === 0) return false;
    const names = [];
    if (product?.product_name) names.push(normalizeValue(product.product_name));
    for (const key of Object.keys(product || {})) {
      if (key.startsWith('product_name_') && typeof product[key] === 'string') {
        names.push(normalizeValue(product[key]));
      }
    }
    return names.some(name => variantTokens.some(token => token && name.includes(token)));
  };

  const categoryMatches = (product) => {
    if (variantTokens.length === 0) return false;
    const categories = Array.isArray(product?.categories_tags)
      ? product.categories_tags.map(normalizeValue)
      : [];
    return categories.some(category => variantTokens.some(token => token && category.includes(token)));
  };

  const isBrandMatch = (product) => {
    if (!preferredBrand) return false;
    const corpus = buildProductCorpus(product);
    return corpus.includes(preferredBrand);
  };

  const isTokenMatch = (product) => {
    if (variantTokens.length === 0) return false;
    return productNameMatches(product) || categoryMatches(product);
  };

  let selection = null;
  let selectionInsight = null;

  if (variantTokens.length > 0) {
    selection = findFirstMatch(candidates, product => {
      const brand = isBrandMatch(product);
      const nameMatch = productNameMatches(product);
      if (brand && nameMatch) {
        selectionInsight = { brand, variant: true, reason: 'brand_and_variant_name' };
        return true;
      }
      return false;
    });

    if (!selection) {
      selection = findFirstMatch(candidates, product => {
        const brand = isBrandMatch(product);
        const categoryMatch = categoryMatches(product);
        if (brand && categoryMatch) {
          selectionInsight = { brand, variant: true, reason: 'brand_and_variant_category' };
          return true;
        }
        return false;
      });
    }

    if (!selection) {
      console.log('[OFF] no variant match among top candidates', {
        query: searchTerm,
        tokens: variantTokens,
        preferredBrand
      });
      return { item, reason: 'variant_mismatch', canonical: searchTerm };
    }
  } else {
    selection = findFirstMatch(candidates, product => {
      const brand = isBrandMatch(product);
      if (brand) {
        selectionInsight = { brand, variant: false, reason: 'brand_only' };
        return true;
      }
      return false;
    }) || candidates[0];
  }

  if (!selection) {
    return { item, reason: 'no_candidates', canonical: searchTerm };
  }

  const hasNutrients = hasUsefulNutriments(selection);
  const brandMatch = Boolean(selection && isBrandMatch(selection));
  const tokenMatch = Boolean(selection && isTokenMatch(selection));

  if (variantTokens.length > 0 && !tokenMatch) {
    return { item, reason: 'variant_mismatch', canonical: searchTerm };
  }

  if (!brandMatch && preferredBrand) {
    return { item, reason: 'brand_mismatch', canonical: searchTerm };
  }

  if (selectionInsight) {
    console.log('[OFF] selected candidate', {
      query: searchTerm,
      reason: selectionInsight.reason,
      code: selection?.code || null,
      name: selection?.product_name || null,
      brandMatch,
      tokenMatch,
      hasNutrients
    });
  }

  return {
    product: selection,
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
