import { SAL_TIMEOUT_MS, SEARCH_BASE, SEARCH_PAGE_SIZE } from './config.js';
import { fetchWithBackoffPost } from './http.js';
import { buildLangsParam } from './text.js';
import { normalizeV3Product } from './normalizers.js';

function clampPageSize(value) {
  const numeric = Number.isFinite(value) ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return Math.min(SEARCH_PAGE_SIZE, 50);
  }
  return Math.max(1, Math.min(numeric, 100));
}

export async function runSearchV3(term, { signal, locale, brandFilter = null, pageSize = SEARCH_PAGE_SIZE, filters = {}, page = 1 } = {}) {
  const queryTerm = typeof term === 'string' ? term.trim() : '';
  if (!queryTerm) {
    return { count: 0, products: [], query_term: '', brand_filter: brandFilter ?? null, page_size: clampPageSize(pageSize), page: 1 };
  }

  const requestBody = {
    q: queryTerm,
    page_size: clampPageSize(pageSize),
    fields: SEARCH_V3_FIELDS,
    boost_phrase: true
  };

  if (filters && typeof filters === 'object' && !Array.isArray(filters)) {
    requestBody.filters = { ...filters };
  }

  const pageNumber = Number.isFinite(page) ? Number(page) : Number.parseInt(page, 10);
  requestBody.page = pageNumber > 0 ? pageNumber : 1;

  if (brandFilter) {
    const existingFilters = typeof requestBody.filters === 'object' && requestBody.filters !== null
      ? { ...requestBody.filters }
      : {};
    const mergedBrandTags = Array.isArray(existingFilters.brands_tags)
      ? [...new Set([...existingFilters.brands_tags, brandFilter])]
      : [brandFilter];
    requestBody.filters = { ...existingFilters, brands_tags: mergedBrandTags };
  }

  const langs = buildLangsParam(locale);
  if (langs.length > 0) {
    requestBody.langs = langs;
  }

  console.log('[OFF] query', {
    q: requestBody.q,
    filters: requestBody.filters || null,
    page: requestBody.page,
    page_size: requestBody.page_size,
    langs: requestBody.langs || null,
    boost_phrase: requestBody.boost_phrase === true,
    brand_filter: brandFilter || null
  });

  const url = `${SEARCH_BASE}/search`;
  const startedAt = Date.now();

  try {
    const response = await fetchWithBackoffPost(url, requestBody, {
      signal,
      timeoutMs: SAL_TIMEOUT_MS,
      maxAttempts: 1,
      retryOnServerError: false,
      logBodyOnError: true
    });

    const hits = Array.isArray(response?.hits) ? response.hits : [];
    const products = hits.map(hit => normalizeV3Product(hit, locale)).filter(Boolean);
    const count = typeof response?.count === 'number' ? response.count : products.length;

    console.log('[OFF] search page summary', {
      q: queryTerm,
      brand: brandFilter || null,
      page: requestBody.page,
      hits: products.length,
      count,
      codes: products.slice(0, 10).map(prod => prod?.code).filter(Boolean),
      ms: Date.now() - startedAt
    });

    return {
      count,
      products,
      query_term: queryTerm,
      brand_filter: brandFilter ?? null,
      page_size: requestBody.page_size,
      page: requestBody.page
    };
  } catch (error) {
    console.log(`[OFF] search error q="${queryTerm}" brand="${brandFilter || 'none'}" page=${requestBody.page}`, {
      status: error?.status || null,
      request_id: error?.requestId || null,
      body: error?.responseBody || null,
      error: error?.message || 'unknown',
      ms: Date.now() - startedAt
    });
    throw error;
  }
}

const SEARCH_V3_FIELDS = [
  'code',
  'product_name',
  'brands',
  'brands_tags',
  'quantity',
  'serving_size',
  'nutriments',
  'languages_tags',
  'categories_tags',
  'countries_tags',
  'last_modified_t',
  'nutriscore_grade',
  'nutriscore_score',
  'nutriscore_data',
  'ecoscore_grade',
  'ecoscore_score',
  'nova_group',
  'nova_groups',
  'additives_tags',
  'additives_n',
  'allergens_tags',
  'ingredients_analysis_tags',
  'ingredients_text',
  'labels_tags',
  'nutrition_grades_tags',
  'data_quality_score'
];

export { SEARCH_V3_FIELDS };
