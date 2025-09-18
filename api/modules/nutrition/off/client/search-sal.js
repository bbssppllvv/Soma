import { SEARCH_BASE } from './config.js';
import { SEARCH_PAGE_SIZE, SAL_TIMEOUT_MS } from './config.js';
import { acquireSearchToken } from './throttle.js';
import { fetchWithBackoffPost } from './http.js';
import { buildLuceneQuery, buildLangsParam } from './queries.js';
import { normalizeBrandForSearch } from '../brand.js';
import { normalizeV3Product } from './normalizers.js';
import { getCachedResult, setCachedResult } from './query-cache.js';
import { emitMetric } from './metrics.js';

export async function runSearchV3(term, { signal, locale, categoryTags = [], negativeCategoryTags = [], brandFilter = null, variantTokens = [] } = {}) {
  const queryTerm = term?.trim();
  if (!queryTerm && !brandFilter && variantTokens.length === 0) {
    return null;
  }

  const cacheKey = JSON.stringify({ term: queryTerm, locale, categoryTags, negativeCategoryTags, brandFilter, variantTokens });
  const cachedResult = getCachedResult(cacheKey);
  if (cachedResult) {
    console.log(`[OFF] Using cached result for query: "${queryTerm}"`);
    return cachedResult;
  }

  await acquireSearchToken(signal);

  const primaryCategory = Array.isArray(categoryTags) ? categoryTags[0] : categoryTags;

  const luceneQuery = buildLuceneQuery({
    term: queryTerm,
    brand: brandFilter,
    primaryCategory,
    excludeCategories: negativeCategoryTags,
    variantTokens
  });

  if (!luceneQuery) {
    return null;
  }

  const requestBody = {
    q: luceneQuery,
    page_size: Math.max(1, Math.min(SEARCH_PAGE_SIZE, 50)),
    fields: SEARCH_V3_FIELDS,
    langs: buildLangsParam(locale),
    boost_phrase: true
  };

  if (brandFilter) {
    const normalizedBrand = normalizeBrandForSearch(brandFilter);
    if (normalizedBrand) {
      requestBody.brands = [normalizedBrand];
    }
  }

  if (primaryCategory) {
    requestBody.categories = [primaryCategory];
  }

  if (negativeCategoryTags.length > 0) {
    requestBody.not_categories = negativeCategoryTags;
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
    const duration = Date.now() - startedAt;

    const hits = Array.isArray(response?.hits) ? response.hits : [];
    const products = hits.map(hit => normalizeV3Product(hit, locale)).filter(Boolean);
    const count = typeof response?.count === 'number' ? response.count : hits.length;

    console.log(`[OFF] search v3 POST q="${luceneQuery}" term="${queryTerm || '∅'}" brand="${brandFilter || 'none'}" hits=${products.length}`, {
      count,
      ms: duration
    });

    emitMetric('off_fallback_step_used', { step: 'sal', hits: products.length });

    const result = {
      count,
      products,
      query_term: queryTerm,
      brand_filter: brandFilter,
      lucene_q: luceneQuery
    };

    setCachedResult(cacheKey, result);
    return result;
  } catch (error) {
    console.log(`[OFF] search v3 POST error q="${luceneQuery}" term="${queryTerm || '∅'}" brand="${brandFilter || 'none'}"`, {
      status: error?.status || null,
      request_id: error?.requestId || null,
      body: error?.responseBody || null,
      error: error?.message || 'unknown',
      ms: Date.now() - startedAt
    });

    if (error?.status >= 500) {
      emitMetric('off_sal_5xx', {
        status: error.status,
        brand: brandFilter || 'none',
        category: primaryCategory || 'none'
      });
      console.log('[OFF] SaL 5xx error, allowing fallback to v2/legacy');
      return null;
    }

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
