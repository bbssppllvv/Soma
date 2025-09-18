import { getByBarcode, searchByNameV1 } from './off-client.js';
import { mapOFFProductToPer100g } from './off-map.js';
import { hasUsefulNutriments } from './off/nutrients.js';
import { normalizeForMatch } from './off/text.js';
import { REQUIRE_BRAND } from './off/constants.js';

const DEFAULT_CONFIDENCE_FLOOR = 0.65;
const MAX_PRODUCTS_CONSIDERED = 12;

function toBrandSlug(value) {
  // Simplified: just return the brand as-is for SAL full-text search
  // SAL is smart enough to handle brand matching without strict filtering
  return null; // Disable brand filtering - let SAL find everything
}

function normalizeUPC(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function buildSearchTerm(item) {
  const direct = typeof item?.off_query === 'string' ? item.off_query.trim() : '';
  if (direct) return direct;
  
  // Build descriptive query: brand + product type + variants
  const parts = [];
  if (item?.brand) parts.push(item.brand);
  if (item?.clean_name) parts.push(item.clean_name);
  if (Array.isArray(item?.required_tokens) && item.required_tokens.length > 0) {
    parts.push(item.required_tokens.join(' '));
  }
  
  const combined = parts.join(' ').trim();
  return combined || item?.name || '';
}

function normalizeValue(value) {
  return normalizeForMatch(value || '').replace(/\s+/g, ' ').trim();
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
  const tokens = new Set();

  const addPhrase = (phrase) => {
    if (!phrase) return;
    expandVariantToken(phrase).forEach(value => {
      if (value.length > 2) tokens.add(value);
    });
  };

  const addFromArray = (source) => {
    if (!Array.isArray(source) || source.length === 0) return;
    source.forEach(token => addPhrase(token));
    const joined = source.join(' ').trim();
    if (joined) addPhrase(joined);
  };

  addFromArray(item?.off_variant_tokens);
  addFromArray(item?.required_tokens);

  const name = typeof item?.name === 'string' ? item.name : '';
  if (name) {
    const normalizedName = normalizeValue(name);
    if (normalizedName) {
      const brandValues = [item?.off_brand_filter, item?.brand, item?.brand_normalized]
        .map(normalizeValue)
        .filter(Boolean);
      const brandWords = new Set();
      brandValues.forEach(value => {
        value.split(' ').forEach(word => {
          if (word.length > 1) brandWords.add(word);
        });
      });

      const availableWords = normalizedName
        .split(' ')
        .filter(word => word.length > 1 && !brandWords.has(word));

      if (availableWords.length > 0) {
        addPhrase(availableWords.join(' '));
      }
    }
  }

  return [...tokens];
}

function buildSearchAttempts(item) {
  const attempts = [];
  const baseQuery = buildSearchTerm(item);
  
  // KISS: Keep It Simple, Stupid
  // Just try the GPT query as-is - SAL is smart enough to handle everything
  if (baseQuery) {
    attempts.push({ query: baseQuery, brand: null, reason: 'simple_fulltext' });
  }
  
  // Fallback: try just the product name without brand
  if (item?.clean_name && item?.required_tokens?.length > 0) {
    const simpleQuery = `${item.clean_name} ${item.required_tokens.join(' ')}`;
    if (simpleQuery !== baseQuery) {
      attempts.push({ query: simpleQuery, brand: null, reason: 'product_and_variant' });
    }
  }
  
  // Last resort: just the item name
  if (item?.name && item.name !== baseQuery) {
    attempts.push({ query: item.name, brand: null, reason: 'raw_name' });
  }

  return attempts;
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

  const attempts = buildSearchAttempts(item);
  let attemptResult = null;
  let attemptUsed = null;
  const attemptSummaries = [];

  for (const attempt of attempts) {
    try {
      const response = await searchByNameV1(attempt.query, {
        signal,
        brand: attempt.brand,
        locale: item?.locale || null
      });

      const products = Array.isArray(response?.products) ? response.products : [];
      
      // Accept result if we have enough candidates OR this is our last attempt
      const isLastAttempt = attempts.indexOf(attempt) === attempts.length - 1;
      const hasEnoughCandidates = products.length >= 3;
      
      if (products.length > 0 && (hasEnoughCandidates || isLastAttempt)) {
        attemptResult = response;
        attemptUsed = attempt;
        attemptSummaries.push({ attempt: attempt.reason, query: attempt.query, brand: attempt.brand, result: `accepted_${products.length}_hits` });
        break;
      }
      
      if (products.length > 0) {
        attemptSummaries.push({ attempt: attempt.reason, query: attempt.query, brand: attempt.brand, result: `too_few_hits_${products.length}` });
      } else {
        attemptSummaries.push({ attempt: attempt.reason, query: attempt.query, brand: attempt.brand, result: 'no_hits' });
      }
    } catch (error) {
      attemptSummaries.push({ attempt: attempt.reason, query: attempt.query, brand: attempt.brand, result: error?.message || 'unknown_error' });
    }
  }

  if (!attemptResult) {
    console.log('[OFF] all search attempts failed', { attempts: attemptSummaries, canonical: searchTerm });
    return { item, reason: 'no_hits', canonical: searchTerm };
  }

  // Log all attempts for debugging
  if (attemptSummaries.length > 1) {
    console.log('[OFF] search attempts summary', { 
      total_attempts: attemptSummaries.length,
      attempts: attemptSummaries,
      selected: attemptUsed?.reason
    });
  }

  const products = Array.isArray(attemptResult?.products) ? attemptResult.products : [];
  console.log('[OFF] raw candidates', {
    query: attemptUsed?.query || searchTerm,
    brand: attemptUsed?.brand || null,
    attempt: attemptUsed?.reason || 'unknown',
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

  const candidates = products.slice(0, MAX_PRODUCTS_CONSIDERED);

  const productNameMatches = (product) => {
    if (variantTokens.length === 0) return false;
    const multiWordTokens = variantTokens.filter(token => token.includes(' '));
    const tokensToUse = multiWordTokens.length > 0 ? multiWordTokens : variantTokens;
    const names = [];
    if (product?.product_name) names.push(normalizeValue(product.product_name));
    for (const key of Object.keys(product || {})) {
      if (key.startsWith('product_name_') && typeof product[key] === 'string') {
        names.push(normalizeValue(product[key]));
      }
    }
    return names.some(name => tokensToUse.some(token => token && name.includes(token)));
  };

  const categoryMatches = (product) => {
    if (variantTokens.length === 0) return false;
    const multiWordTokens = variantTokens.filter(token => token.includes(' '));
    const tokensToUse = multiWordTokens.length > 0 ? multiWordTokens : variantTokens;
    const categories = Array.isArray(product?.categories_tags)
      ? product.categories_tags.map(normalizeValue)
      : [];
    return categories.some(category => tokensToUse.some(token => token && category.includes(token)));
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
        query: attemptUsed?.query || searchTerm,
        tokens: variantTokens,
        preferredBrand
      });
      return { item, reason: 'variant_mismatch', canonical: attemptUsed?.query || searchTerm };
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
    return { item, reason: 'no_candidates', canonical: attemptUsed?.query || searchTerm };
  }

  const hasNutrients = hasUsefulNutriments(selection);
  const brandMatch = Boolean(selection && isBrandMatch(selection));
  const tokenMatch = Boolean(selection && isTokenMatch(selection));

  if (variantTokens.length > 0 && !tokenMatch) {
    return { item, reason: 'variant_mismatch', canonical: attemptUsed?.query || searchTerm };
  }

  if (!brandMatch && preferredBrand) {
    return { item, reason: 'brand_mismatch', canonical: attemptUsed?.query || searchTerm };
  }

  if (selectionInsight) {
    console.log('[OFF] selected candidate', {
      query: attemptUsed?.query || searchTerm,
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
