const PRODUCT_BASE = process.env.OFF_BASE_URL || 'https://world.openfoodfacts.org';
const SEARCH_BASE = process.env.OFF_SEARCH_BASE_URL || 'https://search.openfoodfacts.org';
const UA   = process.env.OFF_USER_AGENT || 'SomaDietTracker/1.0 (support@yourdomain.com)';
const LANG = (process.env.OFF_LANG || 'en').toLowerCase();
const TIMEOUT = Number(process.env.OFF_TIMEOUT_MS || 6000);
const TTL = Number(process.env.OFF_CACHE_TTL_MS || 10800000);
const SEARCH_BUCKET_CAPACITY = Number(process.env.OFF_SEARCH_MAX_TOKENS || 3);
const SEARCH_BUCKET_REFILL_MS = Number(process.env.OFF_SEARCH_REFILL_MS || 15000);
const SEARCH_BUCKET_POLL_MS = Number(process.env.OFF_SEARCH_POLL_MS || 1000);
const SEARCH_PAGE_SIZE = Number(process.env.OFF_SEARCH_PAGE_SIZE || 40); // Larger window to capture variants
const SAL_TIMEOUT_MS = Number(process.env.OFF_SAL_TIMEOUT_MS || 800);
const V2_STRICT_TIMEOUT_MS = Number(process.env.OFF_V2_STRICT_TIMEOUT_MS || 1200);
const V2_RELAX_TIMEOUT_MS = Number(process.env.OFF_V2_RELAX_TIMEOUT_MS || 1000);
const V2_BRANDLESS_TIMEOUT_MS = Number(process.env.OFF_V2_BRANDLESS_TIMEOUT_MS || 700);
const LEGACY_TIMEOUT_MS = Number(process.env.OFF_LEGACY_TIMEOUT_MS || 600);
const GLOBAL_BUDGET_MS = Number(process.env.OFF_GLOBAL_BUDGET_MS || 5000);
const HEDGE_DELAY_MS = Number(process.env.OFF_HEDGE_DELAY_MS || 350);
const HEDGE_TIMEOUT_MS = Number(process.env.OFF_HEDGE_TIMEOUT_MS || 400);

import { getCache, setCache } from './simple-cache.js';
import { matchVariantRules, isVariantToken } from './variant-rules.js';
import { Agent } from 'undici';

function buildHeaders() {
  return { 'User-Agent': UA, 'Accept': 'application/json', 'Accept-Language': LANG };
}

function emitMetric(name, labels = {}) {
  console.log(`[METRIC] ${name}`, labels);
}

const NOISE_WORDS = [
  'tub',
  'package',
  'pack',
  'photo',
  'partially',
  'visible',
  'unopened',
  'container',
  'label',
  'fridge',
  'door',
  'shelf',
  'background',
  'image',
  'top',
  'bottom',
  'middle',
  'left',
  'right',
  'open',
  'inside',
  'outside',
  'front',
  'rear',
  'side',
  'close',
  'up',
  'shot',
  'in',
  'of',
  'with'
];

// Normalize free-form text for search queries
export function canonicalizeQuery(raw = '') {
  const words = raw
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(word => !NOISE_WORDS.includes(word));

  const unique = [];
  for (const word of words) {
    if (!unique.includes(word)) unique.push(word);
  }

  return unique.join(' ').trim();
}

function limitSearchTerms(value = '', maxTokens = 6) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxTokens)
    .join(' ')
    .trim();
}

function escapeLuceneValue(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function makeTerm(value, { boost, proximity } = {}) {
  let term = `"${escapeLuceneValue(value)}"`;
  if (typeof proximity === 'number') {
    term += `~${Math.max(0, proximity)}`;
  }
  if (typeof boost === 'number' && Number.isFinite(boost)) {
    term += `^${boost}`;
  }
  return term;
}

function joinOr(terms = []) {
  return terms.filter(Boolean).join(' OR ');
}

function canonicalTokens(value) {
  return canonicalizeQuery(value || '')
    .split(' ')
    .filter(Boolean);
}

function buildBrandClause(brand) {
  if (!brand) return null;
  // Normalize brand for better matching
  const normalizedBrand = brand
    .replace(/&/g, 'and')
    .replace(/'/g, '')
    .replace(/-/g, ' ')
    .trim();
  return `brands:${makeTerm(normalizedBrand, { boost: 4 })}`;
}

function buildCategoryClauses(primary, excludes = []) {
  const clauses = [];
  if (primary) {
    clauses.push(`categories_tags:${makeTerm(primary)}`);
  }
  // Simplified: skip negative categories for now to reduce query complexity
  // for (const term of excludes) {
  //   clauses.push(`NOT categories_tags:${makeTerm(term)}`);
  // }
  return clauses;
}

function buildVariantClause(tokens = []) {
  const rules = matchVariantRules(tokens);
  if (rules.length === 0) {
    console.log(`[OFF] No variant rules matched for tokens: ${JSON.stringify(tokens)}`);
    return null;
  }

  console.log(`[OFF] Matched variant rules: ${rules.map(r => r.id).join(', ')} for tokens: ${JSON.stringify(tokens)}`);

  // Ultra-simplified: just use the first token directly in product_name
  const token = tokens[0];
  if (token) {
    return `product_name:${makeTerm(token, { boost: 3 })}`;
  }
  
  return null;
}

function buildProductNameClause(term, brandTokens = new Set(), variantTokens = new Set()) {
  const tokens = canonicalTokens(term)
    .filter(token => !brandTokens.has(token))
    .filter(token => !variantTokens.has(token));

  if (tokens.length === 0) return null;

  const uniqueTokens = [...new Set(tokens)];
  
  // Simplified: just use phrase search with minimal proximity
  if (uniqueTokens.length > 1) {
    const phrase = uniqueTokens.join(' ');
    return `product_name:${makeTerm(phrase, { proximity: 1, boost: 2 })}`;
  } else {
    // Single token
    return `product_name:${makeTerm(uniqueTokens[0], { boost: 2 })}`;
  }
}

function buildFallbackNameClause(term) {
  if (!term) return null;
  return `product_name:${makeTerm(term, { proximity: 3 })}`;
}

export function normalizeBrandForSearch(value) {
  if (!value) return '';
  
  // MINIMAL NORMALIZATION based on A/B test results
  // API handles &, ', -, dots, numbers well - don't over-normalize!
  
  const normalized = value
    .toString()
    .toLowerCase()
    .trim()
    .normalize('NFKD') // Handle accents: Häagen-Dazs → haagen-dazs
    .replace(/\p{M}/gu, '') // Remove combining marks
    .replace(/\s+/g, ' '); // Multiple spaces to single

  // Only remove single character tokens (main issue: "Ben & Jerry's" → "ben jerry s")
  const tokens = normalized.split(' ')
    .filter(Boolean)
    .filter(token => token.length > 1); // Remove single chars like "s"

  // Special case: if all original tokens were single chars, join them
  // Example: "M&M's" → "m" "m" "s" → "mms"
  if (tokens.length === 0) {
    const allTokens = normalized.split(' ').filter(Boolean);
    if (allTokens.length > 1 && allTokens.every(t => t.length === 1)) {
      return allTokens.join('');
    }
    return value.toLowerCase(); // Return original if normalization failed
  }

  return tokens.join(' ');
}

function buildLuceneQuery({ term, brand, primaryCategory = null, excludeCategories = [], variantTokens = [] }) {
  // CRITICAL FIX: SaL API breaks on AND operators
  // Use simple queries instead of complex Lucene syntax
  
  const searchTerms = [];
  
  // Add brand to search terms (not as Lucene clause)
  if (brand) {
    const normalizedBrand = normalizeBrandForSearch(brand);
    if (normalizedBrand) {
      searchTerms.push(normalizedBrand);
    }
  }
  
  // Add product terms
  if (term) {
    const cleanTerm = canonicalizeQuery(term);
    if (cleanTerm) {
      searchTerms.push(cleanTerm);
    }
  }
  
  // Add variant tokens
  if (variantTokens && variantTokens.length > 0) {
    searchTerms.push(...variantTokens);
  }
  
  // IMPROVEMENT: Deduplicate terms to avoid redundancy
  const allWords = searchTerms
    .filter(Boolean)
    .join(' ')
    .split(' ')
    .filter(Boolean);
  
  const uniqueWords = [...new Set(allWords)]; // Remove duplicates
  const finalQuery = uniqueWords.join(' ');
  
  console.log(`[OFF] Deduplicated query: "${finalQuery}" (from ${allWords.length} → ${uniqueWords.length} words)`);
  return finalQuery;
}

function normalizeLocale(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (/^[a-z]{2}$/.test(trimmed)) {
      return trimmed;
    }
  }
  return LANG;
}

function stripLangPrefix(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/^[a-z]{2,3}:/i, '');
}

function buildLangsParam(locale) {
  const langs = new Set(['en', 'es']);
  const primary = normalizeLocale(locale);
  if (primary) langs.add(primary);
  return [...langs];
}

function buildSearchQueries(cleanQuery, brand) {
  const queries = new Set();
  const trimmedQuery = limitSearchTerms(cleanQuery);
  const trimmedBrand = limitSearchTerms(brand ?? '');

  // Avoid duplicate brand terms in query
  const queryWords = new Set(trimmedQuery.toLowerCase().split(' ').filter(Boolean));
  const brandWords = new Set(trimmedBrand.toLowerCase().split(' ').filter(Boolean));
  
  // Remove brand words from query to avoid duplication
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

function toBrandSlug(value) {
  if (!value) return '';
  const lower = value.toString().toLowerCase();
  const normalized = lower
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/&/g, ' ')
    .replace(/["'’‘`´]/g, '')
    .replace(/[_]/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return '';

  return normalized
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function collectVariantLabelFilters(tokens = []) {
  const rules = matchVariantRules(tokens);
  const labels = new Set();
  for (const rule of rules) {
    if (Array.isArray(rule.labelTerms)) {
      rule.labelTerms.forEach(term => labels.add(term));
    }
  }
  return [...labels];
}

async function runSearchV3(term, { signal, locale, categoryTags = [], negativeCategoryTags = [], brandFilter = null, variantTokens = [] } = {}) {
  const queryTerm = term?.trim();
  if (!queryTerm && !brandFilter && variantTokens.length === 0) {
    return null;
  }

  await acquireSearchToken(signal);

  const primaryCategory = Array.isArray(categoryTags) ? categoryTags[0] : categoryTags;

  const luceneQuery = buildLuceneQuery({
    term: queryTerm,
    brand: brandFilter,
    primaryCategory,
    excludeCategories: negativeCategoryTags,
    variantTokens
  });

  if (!luceneQuery) {
    return null;
  }

  const requestBody = {
    q: luceneQuery,
    page_size: Math.max(1, Math.min(SEARCH_PAGE_SIZE, 50)),
    fields: SEARCH_V3_FIELDS,
    langs: buildLangsParam(locale),
    boost_phrase: true
  };

  // Add structured filters if we have them (alternative to complex Lucene)
  if (brandFilter) {
    const normalizedBrand = normalizeBrandForSearch(brandFilter);
    if (normalizedBrand) {
      requestBody.brands = [normalizedBrand];
    }
  }
  if (primaryCategory) {
    requestBody.categories = [primaryCategory];
  }

  const url = `${SEARCH_BASE}/search`;
  const startedAt = Date.now();
  
  try {
    const response = await fetchWithBackoffPost(url, requestBody, {
      signal,
      timeoutMs: SAL_TIMEOUT_MS,
      maxAttempts: 1,
      retryOnServerError: false,
      logBodyOnError: true
    });
    const duration = Date.now() - startedAt;

    const hits = Array.isArray(response?.hits) ? response.hits : [];
    const products = hits.map(hit => normalizeV3Product(hit, locale)).filter(Boolean);
    const count = typeof response?.count === 'number' ? response.count : hits.length;

    console.log(`[OFF] search v3 POST q="${luceneQuery}" term="${queryTerm || '∅'}" brand="${brandFilter || 'none'}" hits=${products.length}`, {
      count,
      ms: duration
    });

    emitMetric('off_fallback_step_used', { step: 'sal', hits: products.length });

    return {
      count,
      products,
      query_term: queryTerm,
      brand_filter: brandFilter,
      lucene_q: luceneQuery
    };
  } catch (error) {
    console.log(`[OFF] search v3 POST error q="${luceneQuery}" term="${queryTerm || '∅'}" brand="${brandFilter || 'none'}"`, {
      status: error?.status || null,
      request_id: error?.requestId || null,
      body: error?.responseBody || null,
      error: error?.message || 'unknown',
      ms: Date.now() - startedAt
    });
    if (error?.status >= 500) {
      emitMetric('off_sal_5xx', {
        status: error.status,
        brand: brandFilter || 'none',
        category: primaryCategory || 'none'
      });
      // For 5xx errors, return null instead of throwing to allow fallback to v2/legacy
      console.log(`[OFF] SaL 5xx error, allowing fallback to v2/legacy`);
      return null;
    }
    throw error;
  }
}

async function runSearchV2({
  signal,
  locale,
  stage,
  brandSlug = null,
  primaryCategory = null,
  labelFilters = [],
  timeoutMs = V2_STRICT_TIMEOUT_MS,
  negativeCategoryTags = []
} = {}) {
  const controller = new AbortController();
  const onTimeout = new Error('stage_timeout');
  const timer = setTimeout(() => controller.abort(onTimeout), timeoutMs);

  try {
    const stageSignal = combineSignals(signal, controller.signal);
    await acquireSearchToken(stageSignal);

    const params = new URLSearchParams();
    params.set('page', '1');
    params.set('page_size', String(Math.max(1, Math.min(SEARCH_PAGE_SIZE, 50))));
    params.set('fields', SEARCH_V2_FIELDS);
    params.set('sort_by', 'product_name');

    const langs = buildLangsParam(locale);
    if (langs.length > 0) {
      params.set('languages_tags', langs.join(','));
    }

    if (brandSlug) {
      params.set('brands_tags', brandSlug);
    }

    if (primaryCategory) {
      const categorySlug = stripLangPrefix(primaryCategory || '').toLowerCase();
      if (categorySlug) {
        params.set('categories_tags_en', categorySlug);
      } else {
        params.set('categories_tags', primaryCategory);
      }
    }

    labelFilters.forEach(label => {
      if (label) params.append('labels_tags', label);
    });

    const url = `${PRODUCT_BASE}/api/v2/search?${params.toString()}`;
    const startedAt = Date.now();

    const response = await fetchWithBackoff(url, {
      signal: stageSignal,
      timeoutMs,
      maxAttempts: 1,
      retryOnServerError: false,
      logBodyOnError: true
    });

    const duration = Date.now() - startedAt;
    const rawProducts = Array.isArray(response?.products) ? response.products : [];
    const products = rawProducts
      .map(hit => normalizeV3Product(hit, locale))
      .filter(Boolean)
      .filter(prod => {
        if (!negativeCategoryTags?.length) return true;
        const categories = Array.isArray(prod.categories_tags) ? prod.categories_tags : [];
        return !categories.some(cat => {
          const normalizedCat = stripLangPrefix(cat || '').toLowerCase();
          return negativeCategoryTags.some(neg => {
            const normalizedNeg = stripLangPrefix(neg || '').toLowerCase();
            return cat === neg || normalizedCat.includes(normalizedNeg);
          });
        });
      });

    const count = typeof response?.count === 'number' ? response.count : products.length;

    console.log(`[OFF] search v2 stage=${stage} brand="${brandSlug || 'none'}" category="${primaryCategory || 'none'}" hits=${products.length}`, {
      count,
      ms: duration,
      labels: labelFilters
    });

    if (stage) {
      emitMetric('off_fallback_step_used', { step: stage, hits: products.length });
    }

    return {
      count,
      products,
      stage,
      brand_filter: brandSlug,
      category: primaryCategory,
      source: 'v2'
    };
  } catch (error) {
    const reason = controller.signal.aborted ? controller.signal.reason : null;
    const stageError = reason === onTimeout ? 'timeout' : error?.message || 'unknown';
    console.log(`[OFF] search v2 error stage=${stage} brand="${brandSlug || 'none'}" category="${primaryCategory || 'none'}"`, {
      status: error?.status || null,
      request_id: error?.requestId || null,
      body: error?.responseBody || null,
      error: stageError
    });
    if (reason === onTimeout) {
      emitMetric('off_v2_timeout', {
        stage,
        brand: brandSlug || 'none',
        category: primaryCategory || 'none'
      });
      const timeoutError = new Error('OFF v2 timeout');
      timeoutError.code = 'timeout';
      throw timeoutError;
    }
    if (error?.code === 'rate_limit_wait_aborted') {
      emitMetric('off_rate_limit_aborts', {
        stage,
        brand: brandSlug || 'none',
        category: primaryCategory || 'none'
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeV3Product(hit, locale) {
  if (!hit || (!hit.code && !hit.product_name)) return null;

  const normalized = { ...hit };

  const brands = Array.isArray(hit.brands)
    ? hit.brands.filter(Boolean).join(', ')
    : (typeof hit.brands === 'string' ? hit.brands : null);

  const productName = hit.product_name
    || (locale ? hit[`product_name_${locale}`] : null)
    || hit.product_name_en
    || hit.product_name_fr
    || null;

  normalized.code = hit.code != null ? String(hit.code) : null;
  normalized.product_name = productName;
  normalized.brands = brands;
  normalized.nutriments = hit.nutriments || {};
  normalized.brands_tags = Array.isArray(hit.brands_tags)
    ? hit.brands_tags
    : typeof hit.brands_tags === 'string'
      ? hit.brands_tags.split(',').map(x => x.trim()).filter(Boolean)
      : [];
  normalized.categories_tags = Array.isArray(hit.categories_tags)
    ? hit.categories_tags
    : typeof hit.categories_tags === 'string'
      ? hit.categories_tags.split(',').map(x => x.trim()).filter(Boolean)
      : [];
  normalized.languages_tags = Array.isArray(hit.languages_tags)
    ? hit.languages_tags
    : hit.lang
      ? [hit.lang]
      : [];
  normalized.countries_tags = Array.isArray(hit.countries_tags)
    ? hit.countries_tags
    : typeof hit.countries_tags === 'string'
      ? hit.countries_tags.split(',').map(x => x.trim()).filter(Boolean)
      : [];
  normalized.data_quality_score = typeof hit.data_quality_score === 'number' ? hit.data_quality_score : null;

  return normalized;
}

async function searchByNameLegacy(query, { signal, categoryTags = [], brand = null, maxPages = 1, locale = LANG, timeoutMs = LEGACY_TIMEOUT_MS } = {}) {
  const sanitizedQuery = query.trim();
  if (!sanitizedQuery) {
    return { count: 0, products: [], query_term: '', brand_filter: brand || null };
  }

  const searchLocale = locale || LANG;

  async function runSearch(term, brandFilter) {
    const limitedTerm = limitSearchTerms(term);
    if (!limitedTerm) return null;

    await acquireSearchToken(signal);

    for (let page = 1; page <= maxPages; page++) {
      const params = new URLSearchParams({
        action: 'process',
        search_terms: limitedTerm,
        search_simple: '1',
        json: '1',
        page_size: '5',
        page: String(page),
        lc: searchLocale,
        sort_by: 'unique_scans_n',
        fields: LEGACY_SEARCH_FIELDS
      });

      let tagIndex = 0;
      if (brandFilter) {
        params.set(`tagtype_${tagIndex}`, 'brands');
        params.set(`tag_contains_${tagIndex}`, 'contains');
        params.set(`tag_${tagIndex}`, brandFilter);
        tagIndex++;
      }

      categoryTags.slice(0, 3).forEach(tag => {
        params.set(`tagtype_${tagIndex}`, 'categories');
        params.set(`tag_contains_${tagIndex}`, 'contains');
        params.set(`tag_${tagIndex}`, tag);
        tagIndex++;
      });

      const url = `${PRODUCT_BASE}/cgi/search.pl?${params.toString()}`;
      const t0 = Date.now();
      let data;
      try {
        data = await fetchWithBackoff(url, {
          signal,
          timeoutMs,
          maxAttempts: 1,
          retryOnServerError: false,
          logBodyOnError: true
        });
      } catch (error) {
        console.log(`[OFF] legacy search error term="${limitedTerm}" brand="${brandFilter || 'none'}" page=${page}`, {
          ms: Date.now() - t0,
          error: error?.message || 'unknown'
        });
        throw error;
      }
      const dt = Date.now() - t0;

      console.log(`[OFF] legacy search term="${limitedTerm}" brand="${brandFilter || 'none'}" page=${page}`, {
        count: data?.count,
        products_len: data?.products?.length,
        ms: dt
      });

      if (Array.isArray(data?.products) && data.products.length > 0) {
        return { ...data, query_term: term, brand_filter: brandFilter };
      }
    }
    return null;
  }

  async function runSearchSafe(term, brandFilter) {
    try {
      return await runSearch(term, brandFilter);
    } catch (error) {
      const isAbort = error?.name === 'AbortError';
      console.log(`[OFF] legacy search aborted term="${limitSearchTerms(term)}" brand="${brandFilter || 'none'}"`, {
        timeout: isAbort,
        error: error?.message || 'unknown'
      });
      return null;
    }
  }

  if (brand) {
    const data = await runSearchSafe(sanitizedQuery, brand);
    if (data) return data;
  }

  const data = await runSearchSafe(sanitizedQuery, null);
  if (data) return data;

  return { count: 0, products: [], query_term: limitSearchTerms(sanitizedQuery), brand_filter: brand || null };
}

// Narrow field list keeps responses small and fast
const PRODUCT_FIELDS_V3 = 'code,product_name,brands,quantity,serving_size,nutriments,categories_tags,last_modified_t,nutriscore_grade,nutriscore_score,nutriscore_data,ecoscore_grade,ecoscore_score,nova_group,nova_groups,additives_tags,additives_n,allergens_tags,ingredients_analysis_tags,ingredients_text,labels_tags,nutrition_grades_tags';
const LEGACY_SEARCH_FIELDS = 'code,product_name,brands,serving_size,nutriments,categories_tags,last_modified_t';
const SEARCH_V3_FIELDS = [
  'code',
  'product_name',
  'brands',
  'brands_tags',
  'quantity',
  'serving_size',
  'nutriments',
  'languages_tags',
  'categories_tags',
  'countries_tags',
  'last_modified_t',
  // Health and quality data
  'nutriscore_grade',
  'nutriscore_score',
  'nutriscore_data',
  'ecoscore_grade',
  'ecoscore_score', 
  'nova_group',
  'nova_groups',
  'additives_tags',
  'additives_n',
  'allergens_tags',
  'ingredients_analysis_tags',
  'ingredients_text',
  'labels_tags',
  'nutrition_grades_tags',
  'data_quality_score'
];

const SEARCH_V2_FIELDS = 'code,product_name,brands,brands_tags,labels_tags,categories_tags,nutriments';

const HTTP_AGENT = new Agent({
  connect: { timeout: TIMEOUT },
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 60_000,
  maxSockets: 50
});

function cacheKey(url){ return `off:${url}`; }

let searchTokens = SEARCH_BUCKET_CAPACITY;
let lastRefillTs = Date.now();

function refillSearchTokens() {
  const now = Date.now();
  if (searchTokens >= SEARCH_BUCKET_CAPACITY) {
    lastRefillTs = now;
    return;
  }

  const elapsed = now - lastRefillTs;
  if (elapsed <= 0) return;

  const intervals = Math.floor(elapsed / SEARCH_BUCKET_REFILL_MS);
  if (intervals <= 0) return;

  searchTokens = Math.min(
    SEARCH_BUCKET_CAPACITY,
    searchTokens + intervals * SEARCH_BUCKET_CAPACITY
  );
  lastRefillTs = lastRefillTs + intervals * SEARCH_BUCKET_REFILL_MS;
}

function createAbortError() {
  const err = new Error('Rate limit wait aborted');
  err.name = 'AbortError';
  err.code = 'rate_limit_wait_aborted';
  return err;
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(createAbortError());
    }

    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(createAbortError());
    }

    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function acquireSearchToken(signal) {
  while (true) {
    refillSearchTokens();
    if (searchTokens > 0) {
      searchTokens -= 1;
      // Add minimum delay between requests to be nice to the API
      await delay(Math.max(1000, SEARCH_BUCKET_POLL_MS), signal);
      return;
    }
    await delay(SEARCH_BUCKET_POLL_MS, signal);
  }
}

function combineSignals(a, b) {
  // Node 18.17+ supports AbortSignal.any
  if (a && b && 'any' in AbortSignal) return AbortSignal.any([a, b]);
  return a || b || undefined;
}

async function fetchWithBackoff(url, { signal, timeoutMs, maxAttempts = 2, retryOnServerError = true, logBodyOnError = false } = {}) {
  // CACHE DISABLED FOR TESTING - check cache before hitting the network
  // const ck = cacheKey(url);
  // const hit = getCache(ck);
  // if (hit) return hit;

  let delay = 150;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), timeoutMs ?? TIMEOUT);
    const combined = combineSignals(signal, ac.signal);

    try {
      const res = await fetch(url, { headers: buildHeaders(), signal: combined, dispatcher: HTTP_AGENT });
      clearTimeout(timeoutId);
      const requestId = res.headers.get('x-request-id') || null;
      if (!res.ok) {
        let responseBody = null;
        if (logBodyOnError) {
          try {
            responseBody = await res.text();
          } catch {
            responseBody = null;
          }
        }

        const error = new Error(`OFF ${res.status}`);
        error.status = res.status;
        error.url = url;
        error.requestId = requestId;
        error.responseBody = responseBody;

        const shouldRetry = retryOnServerError && attempt < maxAttempts - 1 && (res.status === 429 || res.status >= 500);
        if (shouldRetry) {
          if (logBodyOnError) {
            console.log(`[OFF] retryable GET error ${res.status} (${url})`, {
              attempt,
              request_id: requestId,
              body: responseBody?.slice(0, 300) || null
            });
          }
          throw error;
        }

        throw error;
      }
      const json = await res.json();
      // CACHE DISABLED FOR TESTING - setCache(ck, json, TTL);
      return json;
    } catch (e) {
      clearTimeout(timeoutId);            // always clear timeout handle
      const isRetryable = retryOnServerError && e?.status != null && (e.status === 429 || e.status >= 500);
      if (attempt === maxAttempts - 1 || !isRetryable) {
        if (logBodyOnError && e?.status != null) {
          console.log(`[OFF] GET error ${e.status} (${url})`, {
            attempt,
            request_id: e.requestId || null,
            body: e.responseBody?.slice(0, 300) || null
          });
        }
        throw e;
      }
      await new Promise(r => setTimeout(r, delay + Math.floor(Math.random()*120)));
      delay *= 2;
    }
  }
}

async function fetchWithBackoffPost(url, body, { signal, timeoutMs, maxAttempts = 2, retryOnServerError = true, logBodyOnError = false } = {}) {
  // CACHE DISABLED FOR TESTING - Create cache key based on URL and body for POST requests
  // const ck = cacheKey(url + JSON.stringify(body));
  // const hit = getCache(ck);
  // if (hit) return hit;

  let delay = 150;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), timeoutMs ?? TIMEOUT);
    const combined = combineSignals(signal, ac.signal);

    try {
      const headers = {
        ...buildHeaders(),
        'Content-Type': 'application/json'
      };
      
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: combined,
        dispatcher: HTTP_AGENT
      });
      
      clearTimeout(timeoutId);
      const requestId = res.headers.get('x-request-id') || null;
      if (!res.ok) {
        let responseBody = null;
        if (logBodyOnError) {
          try {
            responseBody = await res.text();
          } catch {
            responseBody = null;
          }
        }

        const error = new Error(`OFF ${res.status}`);
        error.status = res.status;
        error.url = url;
        error.requestId = requestId;
        error.responseBody = logBodyOnError ? responseBody : null;

        const shouldRetry = retryOnServerError && attempt < maxAttempts - 1 && (res.status === 429 || res.status >= 500);
        if (shouldRetry) {
          if (logBodyOnError) {
            console.log(`[OFF] retryable POST error ${res.status} (${url})`, {
              attempt,
              request_id: requestId,
              body: responseBody?.slice(0, 300) || null
            });
          }
          throw error;
        }

        throw error;
      }
      const json = await res.json();
      // CACHE DISABLED FOR TESTING - setCache(ck, json, TTL);
      return json;
    } catch (e) {
      clearTimeout(timeoutId);            // always clear timeout handle
      const isRetryable = retryOnServerError && e?.status != null && (e.status === 429 || e.status >= 500);
      if (attempt === maxAttempts - 1 || !isRetryable) {
        if (logBodyOnError && e?.status != null) {
          console.log(`[OFF] POST error ${e.status} (${url})`, {
            attempt,
            request_id: e.requestId || null,
            body: e.responseBody?.slice(0, 300) || null
          });
        }
        throw e;
      }
      await new Promise(r => setTimeout(r, delay + Math.floor(Math.random()*120)));
      delay *= 2;
    }
  }
}

export async function getByBarcode(barcode, { signal } = {}) {
  const params = new URLSearchParams({ fields: PRODUCT_FIELDS_V3 });
  const url = `${PRODUCT_BASE}/api/v3/product/${encodeURIComponent(barcode)}?${params.toString()}`;
  const json = await fetchWithBackoff(url, { signal });
  if (!json || json.status !== 'success' || !json.product) return null;
  return json.product;
}

// Primary OFF search endpoint (Search-a-licious with legacy fallback)
export async function searchByNameV1(query, { signal, categoryTags = [], negativeCategoryTags = [], brand = null, maxPages = 1, locale = null, variantTokens = [] } = {}) {
  const localeParam = normalizeLocale(locale);
  const cleanQuery = query.trim();
  const brandSlug = brand ? toBrandSlug(brand) : null;
  const primaryCategory = Array.isArray(categoryTags) ? categoryTags[0] : categoryTags;
  const labelFilters = collectVariantLabelFilters(variantTokens);
  const attemptedResults = [];
  const stageUsed = [];
  const startedAt = Date.now();

  const remainingBudget = () => GLOBAL_BUDGET_MS - (Date.now() - startedAt);
  const canRunStage = (desiredTimeout) => Math.max(0, remainingBudget()) > 50 && desiredTimeout > 0;
  const adjustedTimeout = (desiredTimeout) => {
    const remaining = Math.max(0, remainingBudget());
    return Math.max(100, Math.min(desiredTimeout, remaining));
  };

  const queries = buildSearchQueries(cleanQuery, brand).slice(0, 1);
  const salTerm = queries[0] || cleanQuery;

  const runHedgedSalAndStrict = async () => {
    return new Promise((resolve) => {
      let resolved = false;
      let winner = null;
      let v2Timer = null;
      let active = 0;
      const abortFns = new Map();

      const settle = (value) => {
        if (resolved) return;
        resolved = true;
        if (v2Timer) clearTimeout(v2Timer);
        resolve(value);
      };

      const launchStage = (stageName, controller, runner) => {
        const abortFn = () => {
          if (!controller.signal.aborted) controller.abort('hedge_cancelled');
        };
        abortFns.set(stageName, abortFn);
        active++;
        runner()
          .then(res => {
            if (res?.products?.length && !winner) {
              stageUsed.push(stageName);
              winner = { stage: stageName, result: res };
              abortFns.forEach((fn, key) => {
                if (key !== stageName) fn();
              });
              settle(winner);
            } else if (res) {
              stageUsed.push(`${stageName}_empty`);
              attemptedResults.push(res);
            }
          })
          .catch(error => {
            stageUsed.push(`${stageName}_error`);
            console.log(`[OFF] Hedged stage ${stageName} failed`, {
              error: error?.code || error?.message || 'unknown'
            });
          })
          .finally(() => {
            active--;
            if (!winner && active === 0) {
              settle(null);
            }
          });
      };

      emitMetric('off_budget_remaining', { stage: 'sal_hedged', ms: Math.max(0, remainingBudget()) });
      const salController = new AbortController();
      const salSignal = combineSignals(signal, salController.signal);
      launchStage('sal', salController, () => runSearchV3(salTerm, {
        signal: salSignal,
        locale: localeParam,
        categoryTags: primaryCategory ? [primaryCategory] : [],
        negativeCategoryTags,
        brandFilter: brand,
        variantTokens
      }));

      if (brandSlug && primaryCategory && canRunStage(V2_STRICT_TIMEOUT_MS)) {
        v2Timer = setTimeout(() => {
          if (resolved) return;
          const v2Controller = new AbortController();
          const v2Signal = combineSignals(signal, v2Controller.signal);
          const hedgeTimeout = adjustedTimeout(Math.min(HEDGE_TIMEOUT_MS, V2_STRICT_TIMEOUT_MS));
          launchStage('v2_strict', v2Controller, () => runSearchV2({
            signal: v2Signal,
            locale: localeParam,
            stage: 'v2_strict',
            brandSlug,
            primaryCategory,
            labelFilters,
            timeoutMs: hedgeTimeout,
            negativeCategoryTags
          }));
        }, HEDGE_DELAY_MS);
      }
    });
  };

  let hedgedResult = null;
  let hedgedTried = false;
  if (brandSlug && primaryCategory && canRunStage(SAL_TIMEOUT_MS)) {
    hedgedResult = await runHedgedSalAndStrict();
    hedgedTried = true;
    if (hedgedResult?.stage === 'sal') {
      console.log('[OFF] Hedged winner: Search-a-licious');
      return hedgedResult.result;
    }
    if (hedgedResult?.stage === 'v2_strict') {
      console.log('[OFF] Hedged winner: v2_strict');
      return hedgedResult.result;
    }
  }

  if ((!hedgedTried || hedgedResult === null) && canRunStage(SAL_TIMEOUT_MS)) {
    emitMetric('off_budget_remaining', { stage: 'sal', ms: Math.max(0, remainingBudget()) });
    try {
      const salResult = await runSearchV3(salTerm, {
        signal,
        locale: localeParam,
        categoryTags: primaryCategory ? [primaryCategory] : [],
        negativeCategoryTags,
        brandFilter: brand,
        variantTokens
      });

      if (salResult?.products?.length) {
        stageUsed.push(hedgedTried ? 'sal_retry' : 'sal');
        console.log('[OFF] Stage A (Search-a-licious) succeeded');
        return salResult;
      }

      if (salResult) {
        stageUsed.push(hedgedTried ? 'sal_empty_retry' : 'sal_empty');
        attemptedResults.push(salResult);
      }
    } catch (error) {
      stageUsed.push('sal_error');
      console.log('[OFF] Stage A (Search-a-licious) failed', {
        status: error?.status || null,
        error: error?.message || error || 'unknown'
      });
    }
  }

  const runV2Stage = async (stage, { brandSlug: stageBrand, labelFilters: stageLabels, timeoutMs }) => {
    if (!canRunStage(timeoutMs)) {
      console.log(`[OFF] Stage ${stage} skipped (budget exhausted)`);
      emitMetric('off_stage_skipped', { stage, reason: 'budget' });
      return null;
    }

    emitMetric('off_budget_remaining', { stage, ms: Math.max(0, remainingBudget()) });

    try {
      const result = await runSearchV2({
        signal,
        locale: localeParam,
        stage,
        brandSlug: stageBrand,
        primaryCategory,
        labelFilters: stageLabels,
        timeoutMs: adjustedTimeout(timeoutMs),
        negativeCategoryTags
      });

      if (result?.products?.length) {
        stageUsed.push(stage);
        return result;
      }

      if (result) {
        attemptedResults.push(result);
      }
    } catch (error) {
      stageUsed.push(`${stage}_error`);
      console.log(`[OFF] Stage ${stage} failed`, {
        error: error?.code || error?.message || 'unknown'
      });
    }

    return null;
  };

  // Stage B: v2 STRICT (brand + category + labels)
  if (brandSlug && primaryCategory) {
    const strictResult = await runV2Stage('v2_strict', {
      brandSlug,
      labelFilters,
      timeoutMs: V2_STRICT_TIMEOUT_MS
    });
    if (strictResult) return strictResult;
  }

  // Stage C: v2 RELAX (brand + category)
  if (brandSlug && primaryCategory) {
    const relaxResult = await runV2Stage('v2_relax', {
      brandSlug,
      labelFilters: [],
      timeoutMs: V2_RELAX_TIMEOUT_MS
    });
    if (relaxResult) return relaxResult;
  }

  // Stage D: v2 BRANDLESS (category + optional labels)
  if (primaryCategory) {
    const brandlessResult = await runV2Stage('v2_brandless', {
      brandSlug: null,
      labelFilters,
      timeoutMs: V2_BRANDLESS_TIMEOUT_MS
    });
    if (brandlessResult) return brandlessResult;
  }

  // Stage E: Legacy fallback
  if (canRunStage(LEGACY_TIMEOUT_MS)) {
    emitMetric('off_budget_remaining', { stage: 'legacy', ms: Math.max(0, remainingBudget()) });
    try {
      console.log(`[OFF] Falling back to legacy search for "${cleanQuery}"`);
      const legacyResult = await searchByNameLegacy(cleanQuery, {
        signal,
        categoryTags: primaryCategory ? [primaryCategory] : [],
        brand,
        maxPages,
        locale: localeParam,
        timeoutMs: adjustedTimeout(LEGACY_TIMEOUT_MS)
      });
      if (legacyResult?.products?.length) {
        stageUsed.push('legacy');
        console.log('[OFF] Legacy search SUCCESS');
        emitMetric('off_fallback_step_used', { step: 'legacy', hits: legacyResult.products.length });
        return legacyResult;
      }
      if (legacyResult) {
        attemptedResults.push(legacyResult);
      }
    } catch (legacyError) {
      stageUsed.push('legacy_error');
      console.log(`[OFF] legacy search error term="${cleanQuery}" brand="${brand || 'none'}"`, {
        error: legacyError?.message || 'unknown'
      });
    }
  }

  console.log('[OFF] No OFF results after staged fallback', { stageUsed });
  emitMetric('off_pipeline_empty', {
    brand: brandSlug || 'none',
    category: primaryCategory || 'none',
    stages: stageUsed.join(',')
  });

  if (attemptedResults.length > 0) {
    return attemptedResults[attemptedResults.length - 1];
  }

  return { count: 0, products: [], query_term: cleanQuery, brand_filter: brand || null };
}
