const CACHE = new Map(); // in-memory LRU на жизнь воркера — для serverless ок
const MAX_ITEMS = 1000;

export function getCache(key){
  const c = CACHE.get(key);
  if (!c) return null;
  if (c.exp < Date.now()) { CACHE.delete(key); return null; }
  return c.val;
}

export function setCache(key, val, ttlMs){
  // LRU: удаляем самый старый элемент если превышен лимит
  if (CACHE.size >= MAX_ITEMS) {
    const first = CACHE.keys().next().value;
    if (first) CACHE.delete(first);
  }
  CACHE.set(key, { val, exp: Date.now() + ttlMs });
}
