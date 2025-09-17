const PRODUCT_BASE = process.env.OFF_BASE_URL || 'https://world.openfoodfacts.org';
const SEARCH_BASE = process.env.OFF_SEARCH_BASE_URL || 'https://search.openfoodfacts.org';
const UA   = process.env.OFF_USER_AGENT || 'SomaDietTracker/1.0 (support@yourdomain.com)';
const LANG = (process.env.OFF_LANG || 'en').toLowerCase();
const TIMEOUT = Number(process.env.OFF_TIMEOUT_MS || 6000);
const TTL = Number(process.env.OFF_CACHE_TTL_MS || 10800000);
const SEARCH_BUCKET_CAPACITY = Number(process.env.OFF_SEARCH_MAX_TOKENS || 10);
const SEARCH_BUCKET_REFILL_MS = Number(process.env.OFF_SEARCH_REFILL_MS || 60000);
const SEARCH_BUCKET_POLL_MS = Number(process.env.OFF_SEARCH_POLL_MS || 500);
const SEARCH_PAGE_SIZE = Number(process.env.OFF_SEARCH_PAGE_SIZE || 40); // Larger window to capture variants
const SEARCH_TIMEOUT_MS = Number(process.env.OFF_SEARCH_TIMEOUT_MS || 600);

import { getCache, setCache } from './simple-cache.js';
import { matchVariantRules, isVariantToken } from './variant-rules.js';

function buildHeaders() {
  return { 'User-Agent': UA, 'Accept': 'application/json', 'Accept-Language': LANG };
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
    .replace(/([+\-!(){}\[\]^"~*?:\\/]|&&|\|\|)/g, '\\$1');
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
  return `brands:${makeTerm(brand, { boost: 4 })}`;
}

function buildCategoryClauses(includes = [], excludes = []) {
  const clauses = [];
  if (includes.length > 0) {
    const includeTerms = includes.map(term => makeTerm(term));
    clauses.push(`categories_tags:(${joinOr(includeTerms)})`);
  }
  for (const term of excludes) {
    clauses.push(`NOT categories_tags:${makeTerm(term)}`);
  }
  return clauses;
}

function buildVariantClause(tokens = []) {
  const rules = matchVariantRules(tokens);
  if (rules.length === 0) {
    console.log(`[OFF] No variant rules matched for tokens: ${JSON.stringify(tokens)}`);
    return null;
  }

  console.log(`[OFF] Matched variant rules: ${rules.map(r => r.id).join(', ')} for tokens: ${JSON.stringify(tokens)}`);

  const ruleClauses = [];
  for (const rule of rules) {
    const segments = [];
    if (Array.isArray(rule.productTerms) && rule.productTerms.length > 0) {
      segments.push(`product_name:(${rule.productTerms.join(' OR ')})`);
    }
    if (Array.isArray(rule.labelTerms) && rule.labelTerms.length > 0) {
      const labelTerms = rule.labelTerms.map(term => makeTerm(term));
      segments.push(`labels_tags:(${joinOr(labelTerms)})`);
    }
    if (Array.isArray(rule.categoryTerms) && rule.categoryTerms.length > 0) {
      const categoryTerms = rule.categoryTerms.map(term => makeTerm(term));
      segments.push(`categories_tags:(${joinOr(categoryTerms)})`);
    }
    if (segments.length > 0) {
      ruleClauses.push(`(${segments.join(' OR ')})`);
    }
  }

  if (ruleClauses.length === 0) return null;
  return ruleClauses.length === 1 ? ruleClauses[0] : `(${ruleClauses.join(' AND ')})`;
}

function buildProductNameClause(term, brandTokens = new Set(), variantTokens = new Set()) {
  const tokens = canonicalTokens(term)
    .filter(token => !brandTokens.has(token))
    .filter(token => !variantTokens.has(token));

  if (tokens.length === 0) return null;

  const uniqueTokens = [...new Set(tokens)];
  const clauses = [];

  if (uniqueTokens.length > 1) {
    const phrase = uniqueTokens.join(' ');
    clauses.push(`product_name:(${makeTerm(phrase, { proximity: 2, boost: 3 })})`);
  }

  const singleTerms = uniqueTokens.map(token => makeTerm(token, { boost: uniqueTokens.length > 1 ? 1.5 : 3 }));
  clauses.push(`product_name:(${joinOr(singleTerms)})`);

  return clauses.length === 1 ? clauses[0] : `(${clauses.join(' OR ')})`;
}

function buildFallbackNameClause(term) {
  if (!term) return null;
  return `product_name:${makeTerm(term, { proximity: 3 })}`;
}

function buildLuceneQuery({ term, brand, includeCategories = [], excludeCategories = [], variantTokens = [] }) {
  const brandTokens = new Set(canonicalTokens(brand));
  const variantTokenSet = new Set();
  for (const token of variantTokens) {
    if (!isVariantToken(token)) continue;
    for (const part of canonicalTokens(token)) {
      variantTokenSet.add(part);
    }
  }

  const clauses = [];

  const brandClause = buildBrandClause(brand);
  if (brandClause) {
    clauses.push(brandClause);
    console.log(`[OFF] Lucene brand clause: ${brandClause}`);
  }

  const categoryClauses = buildCategoryClauses(includeCategories, excludeCategories);
  if (categoryClauses.length > 0) {
    clauses.push(...categoryClauses);
    console.log(`[OFF] Lucene category clauses: ${categoryClauses.join(' ')}`);
  }

  const variantClause = buildVariantClause(variantTokens);
  if (variantClause) {
    clauses.push(variantClause);
    console.log(`[OFF] Lucene variant clause: ${variantClause}`);
  }

  const nameClause = buildProductNameClause(term, brandTokens, variantTokenSet);
  if (nameClause) {
    clauses.push(nameClause);
    console.log(`[OFF] Lucene name clause: ${nameClause}`);
  } else {
    const fallback = buildFallbackNameClause(term);
    if (fallback) {
      clauses.push(fallback);
      console.log(`[OFF] Lucene fallback clause: ${fallback}`);
    }
  }

  const finalQuery = clauses.filter(Boolean).join(' AND ');
  console.log(`[OFF] Complete Lucene query: ${finalQuery}`);
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

async function runSearchV3(term, { signal, locale, categoryTags = [], negativeCategoryTags = [], brandFilter = null, variantTokens = [] } = {}) {
  const queryTerm = term?.trim();
  if (!queryTerm && !brandFilter && variantTokens.length === 0) {
    return null;
  }

  await acquireSearchToken(signal);

  const luceneQuery = buildLuceneQuery({
    term: queryTerm,
    brand: brandFilter,
    includeCategories: categoryTags,
    excludeCategories: negativeCategoryTags,
    variantTokens
  });

  if (!luceneQuery) {
    return null;
  }

  const requestBody = {
    q: luceneQuery,
    page_size: Math.min(Math.max(SEARCH_PAGE_SIZE, 30), 50),
    fields: SEARCH_V3_FIELDS,
    langs: buildLangsParam(locale),
    boost_phrase: true
  };

  console.log(`[OFF] Search-a-licious request params:`, {
    page_size: requestBody.page_size,
    langs: requestBody.langs,
    boost_phrase: requestBody.boost_phrase,
    fields_count: requestBody.fields.length,
    no_sort_by: !requestBody.sort_by // Подтверждаем, что sort_by не задан
  });

  const url = `${SEARCH_BASE}/search`;
  const startedAt = Date.now();
  
  try {
    const response = await fetchWithBackoffPost(url, requestBody, { signal, timeoutMs: SEARCH_TIMEOUT_MS });
    const duration = Date.now() - startedAt;

    const hits = Array.isArray(response?.hits) ? response.hits : [];
    const products = hits.map(hit => normalizeV3Product(hit, locale)).filter(Boolean);
    const count = typeof response?.count === 'number' ? response.count : hits.length;

    console.log(`[OFF] search v3 POST q="${luceneQuery}" term="${queryTerm || '∅'}" brand="${brandFilter || 'none'}" hits=${products.length}`, {
      count,
      ms: duration
    });

    return {
      count,
      products,
      query_term: queryTerm,
      brand_filter: brandFilter,
      lucene_q: luceneQuery
    };
  } catch (error) {
    console.log(`[OFF] search v3 POST error term="${queryTerm || '∅'}" brand="${brandFilter || 'none'}"`, {
      error: error?.message || 'unknown',
      ms: Date.now() - startedAt
    });
    throw error;
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

  return normalized;
}

async function searchByNameLegacy(query, { signal, categoryTags = [], brand = null, maxPages = 1, locale = LANG } = {}) {
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
          timeoutMs: SEARCH_TIMEOUT_MS
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
  'nutrition_grades_tags'
];

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

async function fetchWithBackoff(url, { signal, timeoutMs } = {}) {
  // CACHE DISABLED FOR TESTING - check cache before hitting the network
  // const ck = cacheKey(url);
  // const hit = getCache(ck);
  // if (hit) return hit;

  let delay = 150;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), timeoutMs ?? TIMEOUT);
    const combined = combineSignals(signal, ac.signal);

    try {
      const res = await fetch(url, { headers: buildHeaders(), signal: combined });
      clearTimeout(timeoutId);
      if (res.status === 429 || res.status >= 500) throw new Error(`OFF ${res.status}`);
      if (!res.ok) throw new Error(`OFF ${res.status}`);
      const json = await res.json();
      // CACHE DISABLED FOR TESTING - setCache(ck, json, TTL);
      return json;
    } catch (e) {
      clearTimeout(timeoutId);            // always clear timeout handle
      if (attempt === 1) throw e;
      await new Promise(r => setTimeout(r, delay + Math.floor(Math.random()*120)));
      delay *= 2;
    }
  }
}

async function fetchWithBackoffPost(url, body, { signal, timeoutMs } = {}) {
  // CACHE DISABLED FOR TESTING - Create cache key based on URL and body for POST requests
  // const ck = cacheKey(url + JSON.stringify(body));
  // const hit = getCache(ck);
  // if (hit) return hit;

  let delay = 150;
  for (let attempt = 0; attempt < 2; attempt++) {
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
        signal: combined
      });
      
      clearTimeout(timeoutId);
      if (res.status === 429 || res.status >= 500) throw new Error(`OFF ${res.status}`);
      if (!res.ok) throw new Error(`OFF ${res.status}`);
      const json = await res.json();
      // CACHE DISABLED FOR TESTING - setCache(ck, json, TTL);
      return json;
    } catch (e) {
      clearTimeout(timeoutId);            // always clear timeout handle
      if (attempt === 1) throw e;
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
  const queries = buildSearchQueries(cleanQuery, brand).slice(0, 2);
  const attemptedResults = [];

  // Try Search-a-licious POST API first
  for (const term of queries) {
    try {
      const v3Result = await runSearchV3(term, {
        signal,
        locale: localeParam,
        categoryTags,
        negativeCategoryTags,
        brandFilter: brand,
        variantTokens
      });
      if (v3Result) {
        if (v3Result.products.length > 0) {
          console.log(`[OFF] Search-a-licious SUCCESS: found ${v3Result.products.length} products, using v3 API`);
          return v3Result;
        }
        attemptedResults.push(v3Result);
      }
    } catch (error) {
      const isServerError = error?.message?.includes('500');
      console.log(`[OFF] search v3 POST error term="${term}" brand="${brand || 'none'}"`, {
        error: error?.message || 'unknown',
        server_error: isServerError,
        will_fallback: isServerError
      });
      
      // If it's a 500 error, we'll try legacy fallback below
      if (!isServerError) {
        throw error; // Re-throw non-server errors
      }
    }
  }

  // Fallback to legacy search if Search-a-licious failed
  try {
    console.log(`[OFF] Falling back to legacy search for "${cleanQuery}"`);
    const legacyResult = await searchByNameLegacy(cleanQuery, { signal, categoryTags, brand, maxPages, locale: localeParam });
    if (legacyResult && legacyResult.products.length > 0) {
      console.log(`[OFF] Legacy search SUCCESS: found ${legacyResult.products.length} products, using legacy API`);
      return legacyResult;
    }
  } catch (legacyError) {
    console.log(`[OFF] legacy search error term="${cleanQuery}" brand="${brand || 'none'}"`, {
      error: legacyError?.message || 'unknown'
    });
  }

  // Return best attempt if we have any results, otherwise empty result
  if (attemptedResults.length > 0) {
    return attemptedResults[attemptedResults.length - 1];
  }

  return { count: 0, products: [], query_term: cleanQuery, brand_filter: brand || null };
}
