import { Agent } from 'undici';
import { HTTP_TIMEOUT_MS, USER_AGENT, DEFAULT_LANG } from './config.js';

function buildHeaders() {
  return {
    'User-Agent': USER_AGENT,
    'Accept': 'application/json',
    'Accept-Language': DEFAULT_LANG
  };
}

function combineSignals(signalA, signalB) {
  if (signalA && signalB && typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    try {
      return AbortSignal.any([signalA, signalB]);
    } catch {
      // ignore and fall back to manual combination
    }
  }
  return signalA || signalB || undefined;
}

export const HTTP_AGENT = new Agent({
  connect: { timeout: HTTP_TIMEOUT_MS },
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 60_000,
  maxSockets: 50
});

export async function fetchWithBackoff(url, { signal, timeoutMs, maxAttempts = 2, retryOnServerError = true, logBodyOnError = false } = {}) {
  let backoff = 150;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs ?? HTTP_TIMEOUT_MS);
    const combinedSignal = combineSignals(signal, abortController.signal);

    try {
      const res = await fetch(url, {
        headers: buildHeaders(),
        signal: combinedSignal,
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
      return json;
    } catch (error) {
      clearTimeout(timeoutId);
      const retryable = retryOnServerError && error?.status != null && (error.status === 429 || error.status >= 500);
      if (attempt === maxAttempts - 1 || !retryable) {
        if (logBodyOnError && error?.status != null) {
          console.log(`[OFF] GET error ${error.status} (${url})`, {
            attempt,
            request_id: error.requestId || null,
            body: error.responseBody?.slice(0, 300) || null
          });
        }
        throw error;
      }

      await new Promise(resolve => setTimeout(resolve, backoff + Math.floor(Math.random() * 120)));
      backoff *= 2;
    }
  }

  return null;
}

export async function fetchWithBackoffPost(url, body, { signal, timeoutMs, maxAttempts = 2, retryOnServerError = true, logBodyOnError = false } = {}) {
  let backoff = 150;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs ?? HTTP_TIMEOUT_MS);
    const combinedSignal = combineSignals(signal, abortController.signal);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          ...buildHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: combinedSignal,
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
        error.responseBody = responseBody;

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
      return json;
    } catch (error) {
      clearTimeout(timeoutId);
      const retryable = retryOnServerError && error?.status != null && (error.status === 429 || error.status >= 500);
      if (attempt === maxAttempts - 1 || !retryable) {
        if (logBodyOnError && error?.status != null) {
          console.log(`[OFF] POST error ${error.status} (${url})`, {
            attempt,
            request_id: error.requestId || null,
            body: error.responseBody?.slice(0, 300) || null
          });
        }
        throw error;
      }

      await new Promise(resolve => setTimeout(resolve, backoff + Math.floor(Math.random() * 120)));
      backoff *= 2;
    }
  }

  return null;
}
