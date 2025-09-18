import { getByBarcode, searchByNameV1 } from './off-client.js';
import { mapOFFProductToPer100g } from './off-map.js';
import { hasUsefulNutriments } from './off/nutrients.js';
import { normalizeForMatch } from './off/text.js';
import { REQUIRE_BRAND } from './off/constants.js';

const DEFAULT_CONFIDENCE_FLOOR = 0.65;
const MAX_PRODUCTS_CONSIDERED = 12;
const MAX_SEARCH_PAGES = Number(process.env.OFF_SEARCH_MAX_PAGES || 5);
const MAX_BRAND_VARIANT_PAGES = Number(process.env.OFF_BRAND_VARIANT_MAX_PAGES || 20); // Увеличенная глубина для brand+variant
const RESCUE_EXTRA_PAGES = Number(process.env.OFF_RESCUE_EXTRA_PAGES || 3);
const NAME_SIMILARITY_THRESHOLD = Number(process.env.OFF_NAME_SIM_THRESHOLD || 0.6);
const NEGATIVE_TOKEN_PENALTY = Number(process.env.OFF_NEGATIVE_TOKEN_PENALTY || 4);
const BRAND_BOOST_MULTIPLIER = Number(process.env.OFF_BRAND_BOOST_MULTIPLIER || 2.0); // Бонус за точное совпадение бренда

function getDynamicSearchDepth(attempt, hasVariantTokens = false) {
  // Динамическая глубина поиска на основе типа запроса
  if (attempt.brand && hasVariantTokens) {
    // Для brand + variant используем увеличенную глубину
    return MAX_BRAND_VARIANT_PAGES;
  } else if (attempt.brand) {
    // Для brand-only используем стандартную глубину + небольшой буфер
    return Math.min(MAX_SEARCH_PAGES + 5, 12);
  }
  // Для generic поиска используем стандартную глубину
  return MAX_SEARCH_PAGES;
}

function shouldContinueSearch(aggregated, page, maxPages, attempt) {
  // Продолжаем поиск если:
  // 1. Не достигли лимита страниц
  // 2. И либо нет хороших кандидатов, либо есть бренд и мало результатов
  if (page >= maxPages) return false;
  
  if (aggregated.length === 0) return true;
  
  // Для brand+variant запросов всегда ищем глубже
  if (attempt.brand && page < 3) return true;
  
  // Если есть бренд-фильтр, продолжаем поиск дольше
  if (attempt.brand && aggregated.length < 20) return true;
  
  // Для первых 2 страниц всегда продолжаем
  if (page <= 2) return true;
  
  // Проверяем качество топ-кандидатов только после 3 страниц
  const topCandidates = aggregated.slice(0, 10);
  const hasGoodMatches = topCandidates.some(prod => {
    const corpus = buildProductCorpus(prod);
    // Простая проверка на наличие ключевых токенов
    return corpus.length > 10; // Минимальная проверка качества
  });
  
  return !hasGoodMatches;
}

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
  
  // Build descriptive query: product name first, then variants
  const parts = [];
  
  // Приоритет: название продукта, а не бренд
  if (item?.clean_name) parts.push(item.clean_name);
  else if (item?.name) parts.push(item.name);
  
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
  addFromArray(item?.off_primary_tokens);

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

function normalizeNegativeToken(token) {
  const normalized = normalizeValue(token || '');
  if (!normalized) return null;
  if (normalized.length <= 1) return null;
  return normalized;
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

function splitOrQuery(phrases, maxChunkSize = 3) {
  if (!Array.isArray(phrases) || phrases.length === 0) return [];
  
  const quoted = phrases.map(quoteForQuery).filter(Boolean);
  if (quoted.length === 0) return [];
  
  // If small enough, return as single query
  if (quoted.length <= maxChunkSize) {
    return [quoted.join(' OR ')];
  }
  
  // Split into chunks
  const chunks = [];
  for (let i = 0; i < quoted.length; i += maxChunkSize) {
    const chunk = quoted.slice(i, i + maxChunkSize);
    if (chunk.length > 0) {
      chunks.push(chunk.join(' OR '));
    }
  }
  
  return chunks;
}

async function searchWithRetry(query, options, signal, maxRetries = 2) {
  let lastError = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await searchByNameV1(query, { ...options, signal });
      
      // Log successful retry if this wasn't the first attempt
      if (attempt > 0) {
        console.log(`[OFF] Search succeeded on retry ${attempt} for query: ${query.substring(0, 50)}...`);
      }
      
      return response;
    } catch (error) {
      lastError = error;
      
      // Check if this is a retryable error (500, 502, 503, 504, 429)
      const isRetryable = error?.status >= 500 || error?.status === 429;
      
      if (!isRetryable || attempt === maxRetries) {
        console.log(`[OFF] Search failed (non-retryable or max retries reached): ${error.message} for query: ${query.substring(0, 50)}...`);
        throw error;
      }
      
      // Log retry attempt
      console.log(`[OFF] Search failed with ${error.status || 'unknown'}, retrying attempt ${attempt + 1} for query: ${query.substring(0, 50)}...`);
      
      // Exponential backoff with jitter
      const baseDelay = Math.min(1000 * Math.pow(2, attempt), 5000);
      const jitter = Math.random() * 500;
      await new Promise(resolve => setTimeout(resolve, baseDelay + jitter));
    }
  }
  
  throw lastError;
}

function tokenizeNormalized(value) {
  const normalized = normalizeValue(value || '');
  if (!normalized) return [];
  return normalized.split(' ').filter(token => token.length > 1);
}

function gatherCandidateNames(product) {
  const names = [];
  const pushName = (name) => {
    const normalized = normalizeValue(name);
    if (normalized) names.push(normalized);
  };

  if (product?.product_name) pushName(product.product_name);
  if (product?.generic_name) pushName(product.generic_name);

  for (const key of Object.keys(product || {})) {
    if (key.startsWith('product_name_') && typeof product[key] === 'string') {
      pushName(product[key]);
    }
    if (key.startsWith('generic_name_') && typeof product[key] === 'string') {
      pushName(product[key]);
    }
  }

  return [...new Set(names)];
}

function computeNameMetrics(names, targetNormalized, targetTokenSet) {
  let bestJaccard = 0;
  let exact = false;
  let contains = false;
  const hasTargetTokens = targetTokenSet && targetTokenSet.size > 0;

  for (const name of names) {
    if (!name) continue;
    if (targetNormalized && name === targetNormalized) {
      exact = true;
    }
    if (targetNormalized && name.includes(targetNormalized)) {
      contains = true;
    }

    if (!hasTargetTokens) continue;

    const tokens = tokenizeNormalized(name);
    if (tokens.length === 0) continue;

    let intersection = 0;
    for (const token of tokens) {
      if (targetTokenSet.has(token)) intersection += 1;
    }
    if (intersection === 0) continue;

    const unionSize = new Set([...tokens, ...targetTokenSet]).size;
    if (unionSize === 0) continue;

    const jaccard = intersection / unionSize;
    if (jaccard > bestJaccard) {
      bestJaccard = jaccard;
    }
  }

  return { bestJaccard, exact, contains };
}

function determineSelectionReason(info) {
  if (info.brandMatch && info.tokenMatch && info.exactMatch) return 'brand_variant_exact';
  if (info.brandMatch && info.tokenMatch) return 'brand_variant';
  if (info.brandMatch && info.containsTarget) return 'brand_contains';
  if (info.brandMatch) return 'brand_only';
  if (info.tokenMatch && info.exactMatch) return 'variant_exact';
  if (info.tokenMatch) return 'variant_only';
  return 'best_available';
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
  
  // Use split-OR strategy for large fallback queries (Nutella case)
  if (fallbackPhrases.length > 3) {
    const splitQueries = splitOrQuery(fallbackPhrases, 3);
    console.log(`[OFF] Using split-OR strategy: ${fallbackPhrases.length} phrases → ${splitQueries.length} queries`);
    
    splitQueries.forEach((splitQuery, index) => {
      if (splitQuery && splitQuery !== baseQuery) {
        attempts.push({
          query: splitQuery,
          brand: null,
          reason: `fallback_split_or_${index + 1}`,
          pageSize: fallbackOrPageSize,
          isSplitOr: true,
          splitIndex: index
        });
      }
    });
  } else {
    // Use traditional OR query for smaller sets
    const fallbackOrQuery = buildOrQuery(fallbackPhrases);
    if (fallbackOrQuery && fallbackOrQuery !== baseQuery) {
      attempts.push({
        query: fallbackOrQuery,
        brand: null,
        reason: 'fallback_or_tokens',
        pageSize: fallbackOrPageSize
      });
    }
  }

  return attempts;
}

function buildRescueAttempts(item, originalAttempts) {
  const rescueAttempts = [];
  const brandCandidates = [item?.off_brand_filter, item?.brand, item?.brand_normalized]
    .map(value => value ? value.toString().trim() : '')
    .filter(Boolean);
  const brandSlug = brandCandidates.length > 0 ? toBrandSlug(brandCandidates[0]) : '';
  const canonicalBrand = typeof item?.brand_canonical === 'string' ? item.brand_canonical.trim() : '';
  const brandFilters = [canonicalBrand, brandSlug].filter(Boolean);
  const brandFilterObject = brandFilters.length > 0 ? { brands_tags: brandFilters } : null;
  
  // Strategy 1: Brand filter without problematic attributes (if OFF supports exclusion)
  if (brandSlug && Array.isArray(item?.off_neg_tokens) && item.off_neg_tokens.length > 0) {
    const baseQuery = buildSearchTerm(item);
    if (baseQuery) {
      // Remove negative tokens from query for rescue attempt
      let cleanQuery = baseQuery;
      for (const negToken of item.off_neg_tokens) {
        const regex = new RegExp(`\\b${negToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        cleanQuery = cleanQuery.replace(regex, '').replace(/\s+/g, ' ').trim();
      }
      
      if (cleanQuery && cleanQuery !== baseQuery) {
        rescueAttempts.push({
          query: cleanQuery,
          brand: brandSlug,
          reason: 'rescue_clean_query',
          pageSize: Number(process.env.OFF_BRAND_PAGE_SIZE || 40),
          filters: brandFilterObject
        });
      }
    }
  }
  
  // Strategy 2: Exact phrase search without brand (like browser search)
  const primaryTokens = Array.isArray(item?.off_primary_tokens) ? item.off_primary_tokens : [];
  if (primaryTokens.length >= 2) {
    const exactPhrase = primaryTokens.slice(0, 2).join(' ');
    rescueAttempts.push({
      query: `"${exactPhrase}"`,
      brand: null,
      reason: 'rescue_exact_phrase_no_brand',
      pageSize: Number(process.env.OFF_FALLBACK_PAGE_SIZE || 30),
      filters: { categories_tags: ['whipped-creams', 'dairy-products', 'creams'] }
    });
  }
  
  // Strategy 3: Core tokens only with brand (simplified query)
  if (brandSlug && primaryTokens.length > 0) {
    const coreQuery = primaryTokens.slice(0, 2).join(' ');
    if (coreQuery) {
      rescueAttempts.push({
        query: coreQuery,
        brand: brandSlug,
        reason: 'rescue_core_tokens_with_brand',
        pageSize: Number(process.env.OFF_BRAND_PAGE_SIZE || 40),
        filters: brandFilterObject
      });
    }
  }

  // Strategy 4: Fallback without brand filter but with strong anchor tokens
  const fallbackPhrases = collectFallbackPhrases(item);
  if (fallbackPhrases.length > 0) {
    if (primaryTokens.length > 0) {
      const anchorQuery = primaryTokens.slice(0, 2).map(token => `"${token}"`).join(' ');
      if (anchorQuery) {
        rescueAttempts.push({
          query: anchorQuery,
          brand: null,
          reason: 'rescue_anchor_only',
          pageSize: Number(process.env.OFF_FALLBACK_PAGE_SIZE || 20)
        });
      }
    }
  }
  
  // Strategy 3: Brand-only search (most permissive)
  if (brandSlug) {
    rescueAttempts.push({
      query: brandSlug,
      brand: brandSlug,
      reason: 'rescue_brand_only',
      pageSize: Number(process.env.OFF_BRAND_PAGE_SIZE || 40),
      filters: brandFilterObject
    });
  }
  
  return rescueAttempts;
}

function shouldTriggerRescue(selected, selectedMeta) {
  if (!selected) return false;
  
  // Trigger rescue if the selected candidate has negative matches (penalties)
  if (selected.negativeMatch) {
    console.log('[OFF] Rescue triggered: selected candidate has negative matches');
    return true;
  }
  
  // Trigger rescue if the selected candidate has avoided attributes
  if (selected.avoidedAttrMatch) {
    console.log('[OFF] Rescue triggered: selected candidate has avoided attributes');
    return true;
  }
  
  // Trigger rescue if confidence is low and we have negative tokens
  if (selected.nameSimilarity < 0.4 && selected.score < 3) {
    console.log('[OFF] Rescue triggered: low confidence score');
    return true;
  }
  
  return false;
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

  let targetNameNormalized = normalizeValue(item?.name || '');
  if (!targetNameNormalized) targetNameNormalized = normalizeValue(item?.clean_name || '');
  if (!targetNameNormalized) targetNameNormalized = normalizeValue(searchTerm);

  const targetTokenSet = new Set(tokenizeNormalized(targetNameNormalized));
  if (targetTokenSet.size === 0 && Array.isArray(item?.required_tokens)) {
    for (const token of item.required_tokens) {
      tokenizeNormalized(token).forEach(val => targetTokenSet.add(val));
    }
  }

  const negativeTokens = new Set();
  if (Array.isArray(item?.off_neg_tokens)) {
    for (const token of item.off_neg_tokens) {
      const normalized = normalizeNegativeToken(token);
      if (normalized) negativeTokens.add(normalized);
    }
  }

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

  const evaluateCandidates = (products, attempt) => {
    if (!Array.isArray(products) || products.length === 0) {
      return {
        success: false,
        failure: { item, reason: 'no_candidates', canonical: attempt.query || searchTerm },
        meta: { totalCandidates: 0, brandMatchCount: 0, tokenMatchCount: 0, candidateRanking: [] }
      };
    }

    const requireBrand = Boolean(preferredBrand && attempt.brand);
    const requireVariant = variantTokens.length > 0;

    const candidateInfos = [];

    for (const product of products) {
      const brandMatch = isBrandMatch(product);
      const nameMatch = productNameMatches(product);
      const categoryMatch = categoryMatches(product);
      const tokenMatch = variantTokens.length === 0
        ? Boolean(nameMatch || categoryMatch || brandMatch)
        : Boolean(nameMatch || categoryMatch);
      const names = gatherCandidateNames(product);
      const { bestJaccard, exact, contains } = computeNameMetrics(names, targetNameNormalized, targetTokenSet);
      const negativeMatches = negativeTokens.size > 0
        ? names.some(name => {
            const tokens = tokenizeNormalized(name);
            return tokens.some(token => negativeTokens.has(token));
          })
        : false;

      // Check for wanted/avoided attributes
      const wantedAttrs = Array.isArray(item?.off_attr_want) ? item.off_attr_want : [];
      const avoidedAttrs = Array.isArray(item?.off_attr_avoid) ? item.off_attr_avoid : [];
      
      let wantedAttrMatch = false;
      let avoidedAttrMatch = false;
      
      if (wantedAttrs.length > 0 || avoidedAttrs.length > 0) {
        const corpus = buildProductCorpus(product);
        
        for (const attr of wantedAttrs) {
          if (corpus.includes(normalizeValue(attr))) {
            wantedAttrMatch = true;
            break;
          }
        }
        
        for (const attr of avoidedAttrs) {
          if (corpus.includes(normalizeValue(attr))) {
            avoidedAttrMatch = true;
            break;
          }
        }
      }

      let score = 0;
      if (brandMatch) {
        // Базовый бонус за бренд
        score += 5;
        
        // Дополнительный boost для точного совпадения бренда при brand+variant запросах
        if (attempt.brand && variantTokens.length > 0) {
          score += 3 * BRAND_BOOST_MULTIPLIER;
          console.log('[OFF] Brand boost applied', {
            product_code: product?.code,
            brand_boost: 3 * BRAND_BOOST_MULTIPLIER,
            reason: 'exact_brand_match_with_variant'
          });
        }
      }
      if (tokenMatch) score += 4;
      if (nameMatch) score += 1;
      if (categoryMatch) score += 0.5;
      if (exact) score += 3;
      else if (contains) score += 2;
      score += bestJaccard * 3;
      
      // Attribute scoring
      if (wantedAttrMatch) score += 2; // Boost for wanted attributes
      if (avoidedAttrMatch) score -= 3; // Penalty for avoided attributes
      if (negativeMatches) score -= NEGATIVE_TOKEN_PENALTY;

      candidateInfos.push({
        product,
        brandMatch,
        nameMatch,
        categoryMatch,
        tokenMatch,
        nameSimilarity: bestJaccard,
        exactMatch: exact,
        containsTarget: contains,
        negativeMatch: negativeMatches,
        wantedAttrMatch,
        avoidedAttrMatch,
        score
      });
    }

    if (candidateInfos.length === 0) {
      return {
        success: false,
        failure: { item, reason: 'no_candidates', canonical: attempt.query || searchTerm },
        meta: { totalCandidates: 0, brandMatchCount: 0, tokenMatchCount: 0, candidateRanking: [] }
      };
    }

    const sortedCandidates = [...candidateInfos].sort((a, b) => b.score - a.score);
    const overallTop = sortedCandidates.slice(0, 5).map(info => ({
      code: info.product?.code || null,
      score: Number(info.score.toFixed(3)),
      brand: info.brandMatch,
      variant: info.tokenMatch,
      name_similarity: Number(info.nameSimilarity.toFixed(3)),
      negative_penalty: info.negativeMatch
    }));

    const brandMatchCount = candidateInfos.filter(info => info.brandMatch).length;
    const tokenMatchCount = candidateInfos.filter(info => info.tokenMatch).length;

    const brandEligible = candidateInfos.filter(info => !requireBrand || info.brandMatch);
    if (brandEligible.length === 0) {
      return {
        success: false,
        failure: { item, reason: 'brand_mismatch', canonical: attempt.query || searchTerm },
        meta: {
          totalCandidates: candidateInfos.length,
          brandMatchCount,
          tokenMatchCount,
          candidateRanking: overallTop
        }
      };
    }

    const variantEligible = brandEligible.filter(info => !requireVariant || info.tokenMatch);
    if (variantEligible.length === 0) {
      return {
        success: false,
        failure: { item, reason: 'variant_mismatch', canonical: attempt.query || searchTerm },
        meta: {
          totalCandidates: candidateInfos.length,
          brandMatchCount,
          tokenMatchCount,
          candidateRanking: overallTop
        }
      };
    }

    const sortedEligible = [...variantEligible].sort((a, b) => b.score - a.score);
    const best = sortedEligible.find(info => !info.negativeMatch) || sortedEligible[0];
    const hasNutrients = hasUsefulNutriments(best.product);
    const insightReason = determineSelectionReason(best);
    const eligibleTop = sortedEligible.slice(0, 5).map(info => ({
      code: info.product?.code || null,
      score: Number(info.score.toFixed(3)),
      brand: info.brandMatch,
      variant: info.tokenMatch,
      name_similarity: Number(info.nameSimilarity.toFixed(3)),
      negative_penalty: info.negativeMatch
    }));

    return {
      success: true,
      selection: {
        product: best.product,
        brandMatch: best.brandMatch,
        tokenMatch: best.tokenMatch,
        hasNutrients,
        nameSimilarity: best.nameSimilarity,
        exactMatch: best.exactMatch,
        containsTarget: best.containsTarget,
        negativeMatch: best.negativeMatch,
        score: best.score,
        insightReason
      },
      meta: {
        totalCandidates: candidateInfos.length,
        brandMatchCount,
        tokenMatchCount,
        brandEligibleCount: brandEligible.length,
        variantEligibleCount: variantEligible.length,
        candidateRanking: eligibleTop
      }
    };
  };

  let selected = null;
  let selectedMeta = null;
  let selectedAttempt = null;
  let lastFailure = null;

  for (const attempt of attempts) {
    try {
      const seenCodes = new Set();
      const aggregated = [];
      let aggregatedCount = 0;
      let pagesUsed = 0;
      let successThisAttempt = false;

      // Определяем динамическую глубину поиска
      const hasVariantTokens = Array.isArray(debugTokens) && debugTokens.length > 1;
      const maxPages = getDynamicSearchDepth(attempt, hasVariantTokens);
      
      for (let page = 1; page <= maxPages; page += 1) {
        const response = await searchWithRetry(attempt.query, {
          brand: attempt.brand,
          locale: item?.locale || null,
          page,
          pageSize: attempt.pageSize,
          filters: attempt.filters
        }, signal);

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

        // Проверяем, стоит ли продолжать поиск на основе качества результатов
        if (!shouldContinueSearch(aggregated, page, maxPages, attempt)) {
          console.log('[OFF] Early termination: sufficient quality results found', {
            page,
            aggregated: aggregated.length,
            reason: 'quality_threshold_met'
          });
          break;
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

        const evaluation = evaluateCandidates(aggregated, attempt);

        if (evaluation.success) {
          const successLog = {
            attempt: attempt.reason,
            page,
            aggregated_candidates: aggregated.length,
            brand_passed: evaluation.meta?.brandMatchCount ?? 0,
            variant_passed: evaluation.meta?.tokenMatchCount ?? 0,
            result_code: evaluation.selection?.product?.code || null,
            ranking: evaluation.meta?.candidateRanking || [],
            page_codes: pageCodes
          };
          console.log('[OFF] page result', successLog);
          selected = evaluation.selection;
          selectedMeta = evaluation.meta;
          selectedAttempt = attempt;
          successThisAttempt = true;
          
          const shouldFinalize = Boolean(
            evaluation.selection?.exactMatch
            || (evaluation.selection?.nameSimilarity ?? 0) >= NAME_SIMILARITY_THRESHOLD
            || (evaluation.selection?.brandMatch && evaluation.selection?.containsTarget)
          );
          
          // For split-OR queries, also finalize if we found a good candidate without negative matches
          const isSplitOrSuccess = attempt.isSplitOr && !evaluation.selection?.negativeMatch && evaluation.selection?.score > 3;
          
          if (shouldFinalize || isSplitOrSuccess) {
            if (isSplitOrSuccess) {
              console.log('[OFF] Split-OR early success - good candidate found without penalties');
            }
            break;
          }
        } else {
          lastFailure = evaluation.failure;

          console.log('[OFF] page result', {
            attempt: attempt.reason,
            page,
            aggregated_candidates: aggregated.length,
            brand_passed: evaluation.meta?.brandMatchCount ?? 0,
            variant_passed: evaluation.meta?.tokenMatchCount ?? 0,
            next_page: page < MAX_SEARCH_PAGES ? page + 1 : null,
            reason: evaluation.failure?.reason || null,
            ranking: evaluation.meta?.candidateRanking || [],
            page_codes: pageCodes
          });
        }

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
        
        // For split-OR queries, break early if we found an excellent candidate
        const isExcellentSplitOrResult = attempt.isSplitOr && selected && 
          !selected.negativeMatch && selected.score > 5 && selected.nameSimilarity > 0.7;
        
        if (isExcellentSplitOrResult) {
          console.log('[OFF] Excellent split-OR result found, skipping remaining attempts');
          break;
        }
        
        // Always break for non-split-OR successful attempts
        if (!attempt.isSplitOr) {
          break;
        }
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

  // RESCUE QUERIES: Check if we need to trigger rescue search
  if (shouldTriggerRescue(selected, selectedMeta)) {
    const rescueAttempts = buildRescueAttempts(item, attempts);
    
    if (rescueAttempts.length > 0) {
      try {
        let bestRescue = null;
        let bestRescueMeta = null;
        let bestRescueAttempt = null;
        
        console.log('[OFF] Starting rescue search with', rescueAttempts.length, 'rescue attempts');
        
        for (const rescueAttempt of rescueAttempts) {
          try {
            console.log('[OFF] Rescue attempt:', {
              reason: rescueAttempt.reason,
              query: rescueAttempt.query,
              brand: rescueAttempt.brand
            });
            
            const seenCodes = new Set();
            const aggregated = [];
            let pagesUsed = 0;
            
            // Use extended page limit for rescue
            const maxRescuePages = Math.min(MAX_SEARCH_PAGES + RESCUE_EXTRA_PAGES, 8);
            
            for (let page = 1; page <= maxRescuePages; page += 1) {
              const response = await searchWithRetry(rescueAttempt.query, {
                brand: rescueAttempt.brand,
                locale: item?.locale || null,
                page,
                pageSize: rescueAttempt.pageSize,
                filters: rescueAttempt.filters
              }, signal);
              
              pagesUsed = page;
              const products = Array.isArray(response?.products) ? response.products : [];
              
              for (const prod of products) {
                const code = typeof prod?.code === 'string' ? prod.code : null;
                if (code && seenCodes.has(code)) continue;
                if (code) seenCodes.add(code);
                aggregated.push(prod);
              }
              
              // Early termination if we have enough candidates
              if (aggregated.length >= MAX_PRODUCTS_CONSIDERED) break;
              
              const pageSizeUsed = Number(response?.page_size) || rescueAttempt.pageSize || null;
              const noMorePages = (pageSizeUsed && products.length < pageSizeUsed);
              if (noMorePages) break;
            }
            
            // Evaluate rescue candidates using the same logic
            const evaluation = evaluateCandidates(aggregated, rescueAttempt);
            
            if (evaluation.success) {
              const candidate = evaluation.selection;
              
              // Accept rescue candidate if it's better (no negative matches or higher score)
              if (!candidate.negativeMatch || (bestRescue && candidate.score > bestRescue.score)) {
                bestRescue = candidate;
                bestRescueMeta = evaluation.meta;
                bestRescueAttempt = rescueAttempt;
                
                console.log('[OFF] Rescue candidate found:', {
                  attempt: rescueAttempt.reason,
                  code: candidate.product?.code,
                  score: candidate.score,
                  negative_match: candidate.negativeMatch,
                  pages_used: pagesUsed
                });
                
                // If we found a clean candidate, stop rescue search
                if (!candidate.negativeMatch) {
                  break;
                }
              }
            }
          } catch (error) {
            console.log('[OFF] Rescue attempt failed:', rescueAttempt.reason, error.message);
            continue;
          }
        }
        
        // Use rescue result if it's better than original
        if (bestRescue && (!bestRescue.negativeMatch || bestRescue.score > selected.score)) {
          console.log('[OFF] Using rescue result instead of original:', {
            original_score: selected.score,
            original_negative: selected.negativeMatch,
            rescue_score: bestRescue.score,
            rescue_negative: bestRescue.negativeMatch
          });
          
          selected = bestRescue;
          selectedMeta = bestRescueMeta;
          selectedAttempt = bestRescueAttempt;
        } else {
          console.log('[OFF] Rescue search completed but original candidate is still better');
        }
        
      } catch (rescueError) {
        console.log('[OFF] Rescue search failed:', rescueError.message);
        // Continue with original selected candidate
      }
    }
  }

  const finalConfidence = toConfidence({
    brandMatch: selected.brandMatch,
    tokenMatch: selected.tokenMatch,
    hasNutrients: selected.hasNutrients
  });

  console.log('[OFF] selected candidate', {
    attempt: selectedAttempt?.reason || null,
    code: selected.product?.code || null,
    name: selected.product?.product_name || null,
    brandMatch: selected.brandMatch,
    tokenMatch: selected.tokenMatch,
    nameSimilarity: Number((selected.nameSimilarity || 0).toFixed(3)),
    reason: selected.insightReason,
    confidence: Number(finalConfidence.toFixed(3)),
    ranking: selectedMeta?.candidateRanking || []
  });

  return {
    product: selected.product,
    score: selected.brandMatch || selected.tokenMatch ? 1 : 0.5,
    confidence: finalConfidence
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
