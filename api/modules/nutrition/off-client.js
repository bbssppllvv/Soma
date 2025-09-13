const BASE = process.env.OFF_BASE_URL || 'https://world.openfoodfacts.org';
const UA   = process.env.OFF_USER_AGENT || 'SomaDietTracker/1.0 (contact@example.com)';
const LANG = process.env.OFF_LANG || 'en';
const TIMEOUT = Number(process.env.OFF_TIMEOUT_MS || 3500);
const TTL = Number(process.env.OFF_CACHE_TTL_MS || 10800000);

import { getCache, setCache } from './simple-cache.js';

function buildHeaders() {
  return { 'User-Agent': UA, 'Accept': 'application/json' };
}

// Нормализация свободного текста для поиска (универсально)
export function canonicalizeQuery(name = '') {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')                          // убираем скобки: "(plain cooked)"
    .replace(/\b(plain|boiled|cooked|baked|grilled|roasted|fried)\b/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Узкий список полей — быстрее и дешевле
const FIELDS = 'code,product_name,brands,serving_size,nutriments,categories_tags,last_modified_t';

function cacheKey(url){ return `off:${url}`; }

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
export async function searchByName({ query, page_size = 24 }, { signal } = {}) {
  const q = canonicalizeQuery(query);
  const qs = new URLSearchParams({
    action: 'process',
    search_terms: q,
    search_simple: '1',
    json: '1',
    page_size: String(page_size),
    fields: 'code,product_name,brands,nutriments,serving_size'
  });
  const url = `${BASE}/cgi/search.pl?${qs}`;

  const r = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': UA
    },
    signal
  });
  
  if (!r.ok) throw new Error(`OFF ${r.status}`);
  const data = await r.json();               // ← ВАЖНО: возвращаем уже JSON

  // 🔎 Диагностика: видим count/hits из ответа
  console.log(`[OFF] V1 hits for "${q}":`, {
    count: data.count, 
    products_len: data.products?.length, 
    page_size: data.page_size
  });

  return data;                               // { count, page, page_size, products: [...] }
}
