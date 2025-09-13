const BASE = process.env.OFF_BASE_URL || 'https://world.openfoodfacts.org';
const UA   = process.env.OFF_USER_AGENT || 'SomaDietTracker/1.0 (contact@example.com)';
const LANG = process.env.OFF_LANG || 'en';
const TIMEOUT = Number(process.env.OFF_TIMEOUT_MS || 3500);
const TTL = Number(process.env.OFF_CACHE_TTL_MS || 10800000);

import { getCache, setCache } from './simple-cache.js';

const COMMON_HEADERS = {
  'User-Agent': UA,
  'Accept': 'application/json',
  'Accept-Language': LANG
};

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
      const res = await fetch(url, { headers: COMMON_HEADERS, signal: combined });
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

export async function searchByName({ query, brand, page_size = 24 }, { signal } = {}) {
  const u = new URL(`${BASE}/api/v2/search`);
  u.searchParams.set('fields', FIELDS);
  u.searchParams.set('page_size', String(page_size));
  u.searchParams.set('sort_by', 'unique_scans_n');
  u.searchParams.set('search_simple', '1');
  if (query) u.searchParams.set('search_terms', query);
  if (brand) u.searchParams.set('brands_tags', brand.toLowerCase());

  const json = await fetchWithBackoff(u.toString(), { signal });
  return Array.isArray(json?.products) ? json.products : [];
}
