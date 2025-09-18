import { PRODUCT_BASE, USER_AGENT } from './config.js';
import { fetchWithBackoff } from './http.js';
import { buildLangsParam } from './text.js';
import { normalizeV3Product } from './normalizers.js';

/**
 * Поиск через CGI API OpenFoodFacts
 * @param {string} term - поисковый запрос
 * @param {Object} options - опции поиска
 * @returns {Promise<Object>} результаты поиска
 */
export async function runSearchCGI(term, { signal, locale, brandFilter = null, pageSize = 60, page = 1 } = {}) {
  const queryTerm = typeof term === 'string' ? term.trim() : '';
  if (!queryTerm) {
    return { count: 0, products: [], query_term: '', brand_filter: brandFilter ?? null, page_size: pageSize, page: 1 };
  }

  // Строим URL для CGI поиска
  let url = `${PRODUCT_BASE}/cgi/search.pl?search_simple=1&action=process&json=1`;
  url += `&search_terms=${encodeURIComponent(queryTerm)}`;
  url += `&page_size=${Math.min(pageSize, 100)}`; // CGI лимит 100
  
  // Добавляем фильтр по бренду если указан
  if (brandFilter) {
    const brandName = mapBrandSlugToName(brandFilter);
    if (brandName) {
      url += `&tagtype_0=brands&tag_contains_0=contains&tag_0=${encodeURIComponent(brandName)}`;
    }
  }
  
  // Добавляем поля для ускорения
  url += `&fields=code,brands,brands_tags,product_name,categories_tags,labels_tags,quantity,serving_size,nutriments,languages_tags,countries_tags,last_modified_t,nutriscore_grade,nutriscore_score,ecoscore_grade,ecoscore_score,nova_group,additives_tags,allergens_tags,ingredients_analysis_tags,ingredients_text,nutrition_grades_tags`;

  console.log('[OFF] CGI query', {
    q: queryTerm,
    brand_filter: brandFilter || null,
    page_size: pageSize,
    page: page,
    url: url.length > 200 ? url.substring(0, 200) + '...' : url
  });

  const startedAt = Date.now();

  try {
    const response = await fetchWithBackoff(url, {
      signal,
      timeoutMs: 10000, // 10 секунд timeout для CGI
      maxAttempts: 2,
      retryOnServerError: false,
      headers: {
        'User-Agent': USER_AGENT
      }
    });

    const products = Array.isArray(response?.products) ? response.products : [];
    const normalizedProducts = products
      .map(product => normalizeV3Product(product, locale))
      .filter(Boolean);
    
    const count = typeof response?.count === 'number' ? response.count : normalizedProducts.length;

    console.log('[OFF] CGI search results', {
      q: queryTerm,
      brand: brandFilter || null,
      page: page,
      hits: normalizedProducts.length,
      count,
      codes: normalizedProducts.slice(0, 5).map(prod => prod?.code).filter(Boolean),
      ms: Date.now() - startedAt
    });

    return {
      count,
      products: normalizedProducts,
      query_term: queryTerm,
      brand_filter: brandFilter ?? null,
      page_size: pageSize,
      page: page
    };

  } catch (error) {
    console.log(`[OFF] CGI search error q="${queryTerm}" brand="${brandFilter || 'none'}" page=${page}`, {
      status: error?.status || null,
      request_id: error?.requestId || null,
      body: error?.responseBody || null,
      error: error?.message || 'unknown',
      ms: Date.now() - startedAt
    });
    throw error;
  }
}

/**
 * Маппинг slug брендов в полные названия для CGI фильтрации
 */
function mapBrandSlugToName(brandSlug) {
  const brandMappings = {
    'central-lechera-asturiana': 'Central Lechera Asturiana',
    'coca-cola': 'Coca-Cola',
    'pepsi': 'Pepsi',
    'ben-jerry-s': 'Ben & Jerry\'s',
    'nutella': 'Nutella',
    'h-e-b': 'H-E-B',
    'hacendado': 'Hacendado',
    'carrefour': 'Carrefour',
    'dia': 'DIA',
    'eroski': 'Eroski',
    'nestle': 'Nestlé',
    'danone': 'Danone',
    'unilever': 'Unilever',
    'kraft': 'Kraft',
    'philadelphia': 'Philadelphia',
    'oreo': 'Oreo',
    'mcdonalds': 'McDonald\'s',
    'kfc': 'KFC',
    'burger-king': 'Burger King',
    'starbucks': 'Starbucks'
  };
  
  return brandMappings[brandSlug] || null;
}
