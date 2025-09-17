const BASE = process.env.OFF_BASE_URL || 'https://world.openfoodfacts.org';
const UA   = process.env.OFF_USER_AGENT || 'SomaDietTracker/1.0 (support@yourdomain.com)';
const LANG = (process.env.OFF_LANG || 'en').toLowerCase();
const TIMEOUT = Number(process.env.OFF_TIMEOUT_MS || 6000);
const TTL = Number(process.env.OFF_CACHE_TTL_MS || 10800000);
const SEARCH_BUCKET_CAPACITY = Number(process.env.OFF_SEARCH_MAX_TOKENS || 10);
const SEARCH_BUCKET_REFILL_MS = Number(process.env.OFF_SEARCH_REFILL_MS || 60000);
const SEARCH_BUCKET_POLL_MS = Number(process.env.OFF_SEARCH_POLL_MS || 500);

import { getCache, setCache } from './simple-cache.js';

function buildHeaders() {
  return { 'User-Agent': UA, 'Accept': 'application/json', 'Accept-Language': LANG };
}

// Normalize free-form text for search queries
export function canonicalizeQuery(raw = '') {
  return raw
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')                                  // drop parenthetical notes
    .replace(/\b(plain|boiled|cooked|baked|grilled|roasted|fried|raw|fresh|hard|soft)\b/g, ' ')
    .replace(/\b(of|or|with|and)\b/g, ' ')
    .replace(/\b(slices?|slice|wedges?|wedge|sticks?|sprinkled)\b/g, ' ') // remove cutting styles
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(\w+)s\b/g, '$1')                              // naive plural → singular
    .trim();
}

// Narrow field list keeps responses small and fast
const FIELDS = 'code,product_name,brands,serving_size,nutriments,categories_tags,last_modified_t';

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

async function fetchWithBackoff(url, { signal } = {}) {
  // check cache before hitting the network
  const ck = cacheKey(url);
  const hit = getCache(ck);
  if (hit) return hit;

  let delay = 200;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), TIMEOUT);
    const combined = combineSignals(signal, ac.signal);

    try {
      const res = await fetch(url, { headers: buildHeaders(), signal: combined });
      clearTimeout(timeoutId);
      if (res.status === 429 || res.status >= 500) throw new Error(`OFF ${res.status}`);
      if (!res.ok) throw new Error(`OFF ${res.status}`);
      const json = await res.json();
      setCache(ck, json, TTL);
      return json;
    } catch (e) {
      clearTimeout(timeoutId);            // always clear timeout handle
      if (attempt === 2) throw e;
      await new Promise(r => setTimeout(r, delay + Math.floor(Math.random()*120)));
      delay *= 2;
    }
  }
}

export async function getByBarcode(barcode, { signal } = {}) {
  const url = `${BASE}/api/v0/product/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`;
  const json = await fetchWithBackoff(url, { signal });
  if (json?.status !== 1 || !json?.product) return null;
  return json.product;
}

// Primary OFF search endpoint (stable)
export async function searchByNameV1(query, { signal, categoryTags = [], preferPlain = false } = {}) {
  await acquireSearchToken(signal);

  const base = process.env.OFF_BASE_URL || 'https://world.openfoodfacts.org';
  const searchQueries = preferPlain ? [`plain ${query}`.trim(), query] : [query];

  for (const searchTerm of searchQueries) {
    const params = new URLSearchParams({
      action: 'process',
      search_terms: searchTerm,
      search_simple: '1',
      json: '1',
      page_size: '10',
      lc: LANG,
      nocache: '1',
      sort_by: 'unique_scans_n',
      fields: FIELDS
    });

    categoryTags.slice(0, 3).forEach((tag, idx) => {
      params.set(`tagtype_${idx}`, 'categories');
      params.set(`tag_contains_${idx}`, 'contains');
      params.set(`tag_${idx}`, tag);
    });

    const url = `${base}/cgi/search.pl?${params.toString()}`;

    const t0 = Date.now();
    const data = await fetchWithBackoff(url, { signal });
    const dt = Date.now() - t0;

    console.log(`[OFF] V1 hits for "${searchTerm}":`, {
      count: data?.count,
      products_len: data?.products?.length,
      page_size: data?.page_size,
      ms: dt,
      category_tags: categoryTags
    });

    if (Array.isArray(data?.products) && data.products.length > 0) {
      return data;
    }
  }

  return { count: 0, products: [] };
}
