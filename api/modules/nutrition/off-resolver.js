import { getByBarcode, searchByNameV1 } from './off-client.js';
import { mapOFFProductToPer100g } from './off-map.js';
import { hasUsefulNutriments } from './off/nutrients.js';
import { normalizeForMatch } from './off/text.js';
import { REQUIRE_BRAND } from './off/constants.js';

const DEFAULT_CONFIDENCE_FLOOR = 0.65;
const MAX_PRODUCTS_CONSIDERED = 12;
const MAX_SEARCH_PAGES = Number(process.env.OFF_SEARCH_MAX_PAGES || 3);

function toBrandSlug(value) {
  if (!value) return '';
  
  // Normalize brand for OFF brands_tags format
  const normalized = value
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/&/g, '-')
    .replace(/["'''`´]/g, '')
    .replace(/_/g, '-')
    .replace(/[^a-z0-9\s-]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim();

  return normalized || '';
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

function quoteForQuery(value) {
  const str = typeof value === 'string' ? value.trim() : '';
  if (!str) return null;
  return `"${str.replace(/"/g, '\\"')}"`;
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

function collectFallbackPhrases(item) {
  const phrases = [];
  const seen = new Set();

  const addPhrase = (phrase) => {
    if (phrase == null) return;
    const trimmed = phrase.toString().trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    phrases.push(trimmed);
  };

  const addFromArray = (source) => {
    if (!Array.isArray(source)) return;
    source.forEach(addPhrase);
  };

  addFromArray(item?.off_primary_tokens);
  addFromArray(item?.off_alt_tokens);

  if (phrases.length === 0) {
    const variantArray = Array.isArray(item?.off_variant_tokens) ? item.off_variant_tokens : [];
    const multiWordVariant = variantArray.filter(token => typeof token === 'string' && token.trim().includes(' '));
    addFromArray(multiWordVariant);
  }

  if (phrases.length === 0) {
    const requiredArray = Array.isArray(item?.required_tokens) ? item.required_tokens : [];
    const multiWordRequired = requiredArray.filter(token => typeof token === 'string' && token.trim().includes(' '));
    addFromArray(multiWordRequired);
  }

  if (phrases.length === 0) {
    addPhrase(item?.clean_name);
    addPhrase(item?.name);
  }

  return phrases.slice(0, 6);
}

function buildOrQuery(phrases) {
  if (!Array.isArray(phrases) || phrases.length === 0) return null;
  const quoted = phrases.map(quoteForQuery).filter(Boolean);
  if (quoted.length === 0) return null;
  return quoted.join(' OR ');
}

function buildSearchAttempts(item) {
  const attempts = [];
  const baseQuery = buildSearchTerm(item);
  const brandCandidates = [item?.off_brand_filter, item?.brand, item?.brand_normalized]
    .map(value => value ? value.toString().trim() : '')
    .filter(Boolean);
  const brandSlug = brandCandidates.length > 0 ? toBrandSlug(brandCandidates[0]) : '';
  const canonicalBrand = typeof item?.brand_canonical === 'string' ? item.brand_canonical.trim() : '';
  const brandFilters = [canonicalBrand, brandSlug].filter(Boolean);
  const brandFilterObject = brandFilters.length > 0 ? { brands_tags: brandFilters } : null;
  const brandPageSize = Number(process.env.OFF_BRAND_PAGE_SIZE || 40);
  const fallbackOrPageSize = Number(process.env.OFF_FALLBACK_PAGE_SIZE || 20);
  
  // STRATEGY FROM GUIDE: Hard brand filter + soft text matching
  // 1. Strict: brand filter + full query (highest precision)
  if (baseQuery && brandSlug) {
    attempts.push({
      query: baseQuery,
      brand: brandSlug,
      reason: 'brand_filtered_search',
      pageSize: brandPageSize,
      filters: brandFilterObject
    });
  }
  
  // 2. Medium: brand filter + product type + variants  
  if (item?.clean_name && item?.required_tokens?.length > 0 && brandSlug) {
    const productQuery = `${item.clean_name} ${item.required_tokens.join(' ')}`;
    if (productQuery !== baseQuery) {
      attempts.push({
        query: productQuery,
        brand: brandSlug,
        reason: 'brand_product_variant',
        pageSize: brandPageSize,
        filters: brandFilterObject
      });
    }
  }
  
  // 3. Fallback: no brand filter (when brand filtering fails)
  if (baseQuery) {
    attempts.push({ query: baseQuery, brand: null, reason: 'fulltext_no_brand', pageSize: brandPageSize });
  }

  const fallbackPhrases = collectFallbackPhrases(item);
  const fallbackOrQuery = buildOrQuery(fallbackPhrases);
  if (fallbackOrQuery && fallbackOrQuery !== baseQuery) {
    attempts.push({
      query: fallbackOrQuery,
      brand: null,
      reason: 'fallback_or_tokens',
      pageSize: fallbackOrPageSize
    });
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
  const preferredBrand = normalizeValue(item?.off_brand_filter || item?.brand || item?.brand_normalized || '');
  const variantTokens = collectVariantTokens(item);
  const attemptSummaries = [];

  if (attempts.length > 0) {
    console.log('[OFF] search attempts planned', attempts.map(attempt => ({
      reason: attempt.reason,
      query: attempt.query,
      brand: attempt.brand,
      pageSize: attempt.pageSize,
      filters: attempt.filters || null
    })));
  }

  const debugTokens = [...variantTokens];

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
    const nameMatch = productNameMatches(product);
    const catMatch = categoryMatches(product);
    
    // DEBUG: Log why each product passes/fails
    if (product?.code === '0850027880501') { // Mr beast cookies
      console.log('[DEBUG] Mr beast cookies token check', {
        variantTokens,
        nameMatch,
        catMatch,
        product_name: product?.product_name,
        normalized_name: normalizeValue(product?.product_name)
      });
    }
    
    return nameMatch || catMatch;
  };

  const evaluateCandidates = (products, attempt) => {
    const candidates = products;
    let selection = null;
    let selectionInsight = null;

    const requireBrand = Boolean(preferredBrand && attempt.brand);

    if (variantTokens.length > 0) {
      const variantNameMatch = (product) => {
        const brand = isBrandMatch(product);
        const nameMatch = productNameMatches(product);
        if (requireBrand) {
          if (brand && nameMatch) {
            selectionInsight = { brand, variant: true, reason: 'brand_and_variant_name' };
            return true;
          }
          return false;
        }
        if (nameMatch) {
          selectionInsight = { brand, variant: brand, reason: brand ? 'variant_name_brand_optional' : 'variant_name' };
          return true;
        }
        return false;
      };

      selection = findFirstMatch(candidates, variantNameMatch);

      if (!selection) {
        selection = findFirstMatch(candidates, product => {
          const brand = isBrandMatch(product);
          const categoryMatch = categoryMatches(product);
          if (requireBrand) {
            if (brand && categoryMatch) {
              selectionInsight = { brand, variant: true, reason: 'brand_and_variant_category' };
              return true;
            }
            return false;
          }
          if (categoryMatch) {
            selectionInsight = { brand, variant: Boolean(categoryMatch), reason: brand ? 'variant_category_brand_optional' : 'variant_category' };
            return true;
          }
          return false;
        });
      }

      if (!selection) {
        return {
          success: false,
          failure: { item, reason: 'variant_mismatch', canonical: attempt.query || searchTerm }
        };
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
      return { success: false, failure: { item, reason: 'no_candidates', canonical: attempt.query || searchTerm } };
    }

    const hasNutrients = hasUsefulNutriments(selection);
    const brandMatch = Boolean(selection && isBrandMatch(selection));
    const tokenMatch = Boolean(selection && isTokenMatch(selection));

    if (variantTokens.length > 0 && !tokenMatch) {
      return { success: false, failure: { item, reason: 'variant_mismatch', canonical: attempt.query || searchTerm } };
    }

    if (!brandMatch && preferredBrand && attempt.brand) {
      return { success: false, failure: { item, reason: 'brand_mismatch', canonical: attempt.query || searchTerm } };
    }

    if (selectionInsight) {
      console.log('[OFF] selected candidate', {
        query: attempt.query || searchTerm,
        reason: selectionInsight.reason,
        code: selection?.code || null,
        name: selection?.product_name || null,
        brandMatch,
        tokenMatch,
        hasNutrients
      });
    }

    return {
      success: true,
      result: {
        product: selection,
        score: brandMatch || tokenMatch ? 1 : 0.5,
        confidence: toConfidence({ brandMatch, tokenMatch, hasNutrients })
      }
    };
  };

  let selected = null;
  let selectedAttempt = null;
  let lastFailure = null;

  for (const attempt of attempts) {
    try {
      const seenCodes = new Set();
      const aggregated = [];
      let aggregatedCount = 0;
      let pagesUsed = 0;
      let successThisAttempt = false;

      for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
        const response = await searchByNameV1(attempt.query, {
          signal,
          brand: attempt.brand,
          locale: item?.locale || null,
          page,
          pageSize: attempt.pageSize,
          filters: attempt.filters
        });

        pagesUsed = page;
        const products = Array.isArray(response?.products) ? response.products : [];
        const pageCodes = products.map(prod => prod?.code).filter(Boolean).slice(0, 10);
        const responseCount = Number(response?.count);
        if (Number.isFinite(responseCount) && responseCount > aggregatedCount) {
          aggregatedCount = responseCount;
        }

        for (const prod of products) {
          const code = typeof prod?.code === 'string' ? prod.code : null;
          if (code && seenCodes.has(code)) continue;
          if (code) seenCodes.add(code);
          aggregated.push(prod);
        }

        console.log('[OFF] detailed candidate analysis', {
          attempt: attempt.reason,
          page,
          looking_for_tokens: debugTokens,
          candidates: products.slice(0, 3).map(prod => {
            const corpus = buildProductCorpus(prod);

            return {
              code: prod?.code,
              name: prod?.product_name,
              corpus_normalized: corpus,
              contains_tokens: debugTokens.map(token => ({
                token,
                found_in_corpus: corpus.includes(normalizeValue(token))
              })),
              why_status: debugTokens.some(token => corpus.includes(normalizeValue(token))) ? 'should_match' : 'no_token_match'
            };
          })
        });

        const brandPassed = aggregated.filter(isBrandMatch).length;
        const variantPassed = aggregated.filter(isTokenMatch).length;
        const evaluation = evaluateCandidates(aggregated, attempt);

        if (evaluation.success) {
          console.log('[OFF] page result', {
            attempt: attempt.reason,
            page,
            aggregated_candidates: aggregated.length,
            brand_passed: brandPassed,
            variant_passed: variantPassed,
            result_code: evaluation.result?.product?.code || null,
            page_codes: pageCodes
          });
          selected = evaluation.result;
          selectedAttempt = attempt;
          successThisAttempt = true;
          break;
        }

        lastFailure = evaluation.failure;

        console.log('[OFF] page result', {
          attempt: attempt.reason,
          page,
          aggregated_candidates: aggregated.length,
          brand_passed: brandPassed,
          variant_passed: variantPassed,
          next_page: page < MAX_SEARCH_PAGES ? page + 1 : null,
          page_codes: pageCodes
        });

        const pageSizeUsed = Number(response?.page_size) || attempt.pageSize || null;
        const noMorePages = (pageSizeUsed && products.length < pageSizeUsed)
          || (aggregatedCount > 0 && pageSizeUsed && page * pageSizeUsed >= aggregatedCount);

        if (noMorePages) {
          break;
        }
      }

      if (successThisAttempt) {
        attemptSummaries.push({
          attempt: attempt.reason,
          query: attempt.query,
          brand: attempt.brand,
          result: `success_pages_${pagesUsed}`
        });
        break;
      }

      if (aggregated.length === 0) {
        attemptSummaries.push({ attempt: attempt.reason, query: attempt.query, brand: attempt.brand, result: 'no_hits' });
      } else {
        attemptSummaries.push({
          attempt: attempt.reason,
          query: attempt.query,
          brand: attempt.brand,
          result: `exhausted_pages_${pagesUsed}_candidates_${aggregated.length}`
        });
      }
    } catch (error) {
      attemptSummaries.push({ attempt: attempt.reason, query: attempt.query, brand: attempt.brand, result: error?.message || 'unknown_error' });
      lastFailure = { item, reason: 'http_or_json_error', canonical: attempt.query || searchTerm, error: error?.message };
    }
  }

  if (attemptSummaries.length > 1) {
    console.log('[OFF] search attempts summary', {
      total_attempts: attemptSummaries.length,
      attempts: attemptSummaries,
      selected: selectedAttempt?.reason || null
    });
  }

  if (!selected) {
    if (lastFailure) {
      console.log('[OFF] all search attempts failed', { attempts: attemptSummaries, canonical: searchTerm, last_reason: lastFailure.reason || null });
      return lastFailure;
    }
    console.log('[OFF] all search attempts failed', { attempts: attemptSummaries, canonical: searchTerm, last_reason: null });
    return { item, reason: 'no_hits', canonical: searchTerm };
  }

  return selected;
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
