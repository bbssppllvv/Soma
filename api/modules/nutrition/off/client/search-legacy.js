import { PRODUCT_BASE, LEGACY_TIMEOUT_MS } from './config.js';
import { acquireSearchToken } from './throttle.js';
import { fetchWithBackoff } from './http.js';
import { limitSearchTerms, normalizeLocale } from './text.js';

export async function searchByNameLegacy(query, { signal, categoryTags = [], brand = null, maxPages = 1, locale, timeoutMs = LEGACY_TIMEOUT_MS } = {}) {
  const sanitizedQuery = query.trim();
  if (!sanitizedQuery) {
    return { count: 0, products: [], query_term: '', brand_filter: brand || null };
  }

  const searchLocale = normalizeLocale(locale);

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
      const startedAt = Date.now();

      try {
        const data = await fetchWithBackoff(url, {
          signal,
          timeoutMs,
          maxAttempts: 1,
          retryOnServerError: false,
          logBodyOnError: true
        });

        const duration = Date.now() - startedAt;
        console.log(`[OFF] legacy search term="${limitedTerm}" brand="${brandFilter || 'none'}" page=${page}`, {
          count: data?.count,
          products_len: data?.products?.length,
          ms: duration
        });

        if (Array.isArray(data?.products) && data.products.length > 0) {
          return { ...data, query_term: term, brand_filter: brandFilter };
        }
      } catch (error) {
        console.log(`[OFF] legacy search error term="${limitedTerm}" brand="${brandFilter || 'none'}" page=${page}`, {
          ms: Date.now() - startedAt,
          error: error?.message || 'unknown'
        });
        throw error;
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

  const fallback = await runSearchSafe(sanitizedQuery, null);
  if (fallback) return fallback;

  return { count: 0, products: [], query_term: limitSearchTerms(sanitizedQuery), brand_filter: brand || null };
}

const LEGACY_SEARCH_FIELDS = 'code,product_name,brands,serving_size,nutriments,categories_tags,last_modified_t';
