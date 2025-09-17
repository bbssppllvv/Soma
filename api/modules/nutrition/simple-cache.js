const CACHE = new Map(); // in-memory LRU scoped to the worker lifetime — fine for serverless
const MAX_ITEMS = 1000;

export function getCache(key){
  const c = CACHE.get(key);
  if (!c) return null;
  if (c.exp < Date.now()) { CACHE.delete(key); return null; }
  return c.val;
}

export function setCache(key, val, ttlMs){
  // LRU eviction: drop the oldest item when capacity is reached
  if (CACHE.size >= MAX_ITEMS) {
    const first = CACHE.keys().next().value;
    if (first) CACHE.delete(first);
  }
  CACHE.set(key, { val, exp: Date.now() + ttlMs });
}
