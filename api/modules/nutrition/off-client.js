const BASE = process.env.OFF_BASE_URL || 'https://world.openfoodfacts.org';
const UA   = process.env.OFF_USER_AGENT || 'SomaDietTracker/1.0 (support@yourdomain.com)';
const LANG = (process.env.OFF_LANG || 'en').toLowerCase();
const TIMEOUT = Number(process.env.OFF_TIMEOUT_MS || 3500);
const TTL = Number(process.env.OFF_CACHE_TTL_MS || 10800000);
const SEARCH_BUCKET_CAPACITY = Number(process.env.OFF_SEARCH_MAX_TOKENS || 10);
const SEARCH_BUCKET_REFILL_MS = Number(process.env.OFF_SEARCH_REFILL_MS || 60000);
const SEARCH_BUCKET_POLL_MS = Number(process.env.OFF_SEARCH_POLL_MS || 500);

import { getCache, setCache } from './simple-cache.js';

function buildHeaders() {
  return { 'User-Agent': UA, 'Accept': 'application/json', 'Accept-Language': LANG };
}

// Нормализация свободного текста для поиска (универсально)
export function canonicalizeQuery(raw = '') {
  return raw
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')                                  // (plain cooked) → ''
    .replace(/\b(plain|boiled|cooked|baked|grilled|roasted|fried|raw|fresh|hard|soft)\b/g, ' ')
    .replace(/\b(of|or|with|and)\b/g, ' ')
    .replace(/\b(slices?|slice|wedges?|wedge|sticks?|sprinkled)\b/g, ' ') // формы и нарезки
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(\w+)s\b/g, '$1')                              // plural → singular (грубо)
    .trim();
}

// Узкий список полей — быстрее и дешевле
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
  // Node 18.17+ поддерживает AbortSignal.any
  if (a && b && 'any' in AbortSignal) return AbortSignal.any([a, b]);
  return a || b || undefined;
}

async function fetchWithBackoff(url, { signal } = {}) {
  // кэш перед сетью
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
      clearTimeout(timeoutId);            // важно: чистим именно timeoutId
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

// V1 полнотекстовый поиск (стабильный)
export async function searchByNameV1(query, { signal } = {}) {
  await acquireSearchToken(signal);

  const base = process.env.OFF_BASE_URL || 'https://world.openfoodfacts.org';
  const url = `${base}/cgi/search.pl?action=process&search_terms=${encodeURIComponent(query)}&search_simple=1&json=1&page_size=24&lc=${encodeURIComponent(LANG)}&nocache=1&sort_by=unique_scans_n`;

  const t0 = Date.now();
  const data = await fetchWithBackoff(url, { signal }); // JSON + кеш + ретраи
  const dt = Date.now() - t0;

  console.log(`[OFF] V1 hits for "${query}":`, {
    count: data?.count,
    products_len: data?.products?.length,
    page_size: data?.page_size,
    ms: dt
  });

  return data;                                         // {count, products: [...]}
}
