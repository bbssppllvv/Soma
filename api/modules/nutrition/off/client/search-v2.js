import { PRODUCT_BASE, SEARCH_PAGE_SIZE, V2_STRICT_TIMEOUT_MS } from './config.js';
import { fetchWithBackoff } from './http.js';
import { acquireSearchToken, combineSignals } from './throttle.js';
import { buildLangsParam, normalizeLocale } from './queries.js';
import { normalizeV3Product } from './normalizers.js';
import { emitMetric } from './metrics.js';
import { stripLangPrefix } from '../text.js';

export async function runSearchV2({
  signal,
  locale,
  stage,
  brandSlug = null,
  primaryCategory = null,
  labelFilters = [],
  timeoutMs = V2_STRICT_TIMEOUT_MS,
  negativeCategoryTags = []
} = {}) {
  const controller = new AbortController();
  const onTimeout = new Error('stage_timeout');
  const timer = setTimeout(() => controller.abort(onTimeout), timeoutMs);

  try {
    const stageSignal = combineSignals(signal, controller.signal);
    await acquireSearchToken(stageSignal);

    const params = new URLSearchParams();
    params.set('page', '1');
    params.set('page_size', String(Math.max(1, Math.min(SEARCH_PAGE_SIZE, 50))));
    params.set('fields', SEARCH_V2_FIELDS);
    params.set('sort_by', 'product_name');

    const langs = buildLangsParam(locale);
    if (langs.length > 0) {
      params.set('languages_tags', langs.join(','));
    }

    if (brandSlug) {
      params.set('brands_tags', brandSlug);
    }

    if (primaryCategory) {
      const categorySlug = stripLangPrefix(primaryCategory || '').toLowerCase();
      if (categorySlug) {
        params.set('categories_tags_en', categorySlug);
      } else {
        params.set('categories_tags', primaryCategory);
      }
    }

    labelFilters.forEach(label => {
      if (label) params.append('labels_tags', label);
    });

    const url = `${PRODUCT_BASE}/api/v2/search?${params.toString()}`;
    const startedAt = Date.now();

    const response = await fetchWithBackoff(url, {
      signal: stageSignal,
      timeoutMs,
      maxAttempts: 1,
      retryOnServerError: false,
      logBodyOnError: true
    });

    const duration = Date.now() - startedAt;
    const rawProducts = Array.isArray(response?.products) ? response.products : [];
    const products = rawProducts
      .map(hit => normalizeV3Product(hit, locale))
      .filter(Boolean)
      .filter(prod => {
        if (!negativeCategoryTags?.length) return true;
        const categories = Array.isArray(prod.categories_tags) ? prod.categories_tags : [];
        return !categories.some(cat => {
          const normalizedCat = stripLangPrefix(cat || '').toLowerCase();
          return negativeCategoryTags.some(neg => {
            const normalizedNeg = stripLangPrefix(neg || '').toLowerCase();
            return normalizedCat === normalizedNeg || normalizedCat.includes(normalizedNeg);
          });
        });
      });

    console.log(`[OFF] v2 search stage=${stage} brand=${brandSlug || 'none'} category=${primaryCategory || 'none'} hits=${products.length}`, {
      ms: duration,
      negative_filters: negativeCategoryTags
    });

    emitMetric('off_fallback_step_used', { step: stage, hits: products.length });

    return {
      count: products.length,
      products,
      query_term: null,
      brand_filter: brandSlug,
      stage
    };
  } catch (error) {
    const reason = error ?? null;
    const stageError = reason?.message || reason?.code || 'unknown';
    console.log(`[OFF] v2 search stage=${stage} failed`, {
      error: stageError,
      brand: brandSlug || 'none',
      category: primaryCategory || 'none',
      labels: labelFilters
    });

    if (reason === onTimeout) {
      emitMetric('off_v2_timeout', {
        stage,
        brand: brandSlug || 'none',
        category: primaryCategory || 'none'
      });
      const timeoutError = new Error('OFF v2 timeout');
      timeoutError.code = 'timeout';
      throw timeoutError;
    }

    if (error?.code === 'rate_limit_wait_aborted') {
      emitMetric('off_rate_limit_aborts', {
        stage,
        brand: brandSlug || 'none',
        category: primaryCategory || 'none'
      });
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const SEARCH_V2_FIELDS = 'code,product_name,brands,brands_tags,labels_tags,categories_tags,nutriments';
