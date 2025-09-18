import { SEARCH_BUCKET_CAPACITY, SEARCH_BUCKET_POLL_MS, SEARCH_BUCKET_REFILL_MS } from './config.js';

let searchTokens = SEARCH_BUCKET_CAPACITY;
let lastRefillTs = Date.now();

function createAbortError() {
  const error = new Error('Rate limit wait aborted');
  error.name = 'AbortError';
  error.code = 'rate_limit_wait_aborted';
  return error;
}

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

  searchTokens = Math.min(SEARCH_BUCKET_CAPACITY, searchTokens + intervals * SEARCH_BUCKET_CAPACITY);
  lastRefillTs += intervals * SEARCH_BUCKET_REFILL_MS;
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

export async function acquireSearchToken(signal) {
  while (true) {
    refillSearchTokens();
    if (searchTokens > 0) {
      searchTokens -= 1;
      await delay(Math.max(1000, SEARCH_BUCKET_POLL_MS), signal);
      return;
    }
    await delay(SEARCH_BUCKET_POLL_MS, signal);
  }
}

export function combineSignals(a, b) {
  if (a && b && 'any' in AbortSignal) {
    return AbortSignal.any([a, b]);
  }
  return a || b || undefined;
}
