const QUERY_CACHE = new Map();
const RESULT_TTL_MS = 60_000;

export function getCachedResult(key) {
  const cached = QUERY_CACHE.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > RESULT_TTL_MS) {
    QUERY_CACHE.delete(key);
    return null;
  }
  return cached.result;
}

export function setCachedResult(key, result) {
  QUERY_CACHE.set(key, { result, timestamp: Date.now() });
  if (QUERY_CACHE.size > 100) {
    const now = Date.now();
    for (const [entryKey, entryValue] of QUERY_CACHE.entries()) {
      if (now - entryValue.timestamp > RESULT_TTL_MS) {
        QUERY_CACHE.delete(entryKey);
      }
    }
  }
}
