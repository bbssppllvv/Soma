import { runSearchV3 } from './search-sal.js';

export async function searchByNamePipeline(query, { signal, brand = null, locale = null, pageSize, filters } = {}) {
  const cleanQuery = typeof query === 'string' ? query.trim() : '';
  if (!cleanQuery) {
    return { count: 0, products: [], query_term: '', brand_filter: brand ?? null };
  }

  try {
    const result = await runSearchV3(cleanQuery, {
      signal,
      locale,
      brandFilter: brand,
      pageSize,
      filters
    });
    if (result) {
      return result;
    }
  } catch (error) {
    console.log('[OFF] Simple search failed', {
      error: error?.message || 'unknown'
    });
  }

  return { count: 0, products: [], query_term: cleanQuery, brand_filter: brand ?? null };
}
