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

export async function runSearchV3(term, { signal, locale, brandFilter = null, pageSize = SEARCH_PAGE_SIZE, filters = {} } = {}) {
  const queryTerm = typeof term === 'string' ? term.trim() : '';
  if (!queryTerm) {
    return { count: 0, products: [], query_term: '', brand_filter: brandFilter ?? null };
  }

  const requestBody = {
    q: queryTerm,
    page_size: clampPageSize(pageSize),
    fields: SEARCH_V3_FIELDS,
    boost_phrase: true,
    ...filters
  };

  const langs = buildLangsParam(locale);
  if (langs.length > 0) {
    requestBody.langs = langs;
  }

  if (brandFilter) {
    requestBody.brands = [brandFilter];
  }

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

    console.log(`[OFF] search q="${queryTerm}" brand="${brandFilter || 'none'}" hits=${products.length}`, {
      ms: Date.now() - startedAt
    });

    return {
      count,
      products,
      query_term: queryTerm,
      brand_filter: brandFilter ?? null
    };
  } catch (error) {
    console.log(`[OFF] search error q="${queryTerm}" brand="${brandFilter || 'none'}"`, {
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
