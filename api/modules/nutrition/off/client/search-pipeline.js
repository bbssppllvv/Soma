import { runSearchV3 } from './search-sal.js';
import { runSearchCGI } from './search-cgi.js';
import { USE_CGI_SEARCH } from './config.js';

export async function searchByNamePipeline(query, { signal, brand = null, locale = null, pageSize, filters, page = 1 } = {}) {
  const cleanQuery = typeof query === 'string' ? query.trim() : '';
  if (!cleanQuery) {
    return { count: 0, products: [], query_term: '', brand_filter: brand ?? null, page_size: pageSize, page };
  }

  // Выбираем API в зависимости от флага
  const searchFunction = USE_CGI_SEARCH ? runSearchCGI : runSearchV3;
  const apiName = USE_CGI_SEARCH ? 'CGI' : 'SAL';

  try {
    const result = await searchFunction(cleanQuery, {
      signal,
      locale,
      brandFilter: brand,
      pageSize,
      filters,
      page
    });
    
    if (result) {
      console.log(`[OFF] ${apiName} search successful`, {
        query: cleanQuery,
        brand: brand || null,
        results: result.products?.length || 0,
        api: apiName
      });
      return result;
    }
  } catch (error) {
    console.log(`[OFF] ${apiName} search failed`, {
      query: cleanQuery,
      brand: brand || null,
      api: apiName,
      error: error?.message || 'unknown'
    });
    
    // Fallback на другой API если основной не сработал
    if (USE_CGI_SEARCH) {
      console.log('[OFF] Trying SAL fallback...');
      try {
        const fallbackResult = await runSearchV3(cleanQuery, {
          signal,
          locale,
          brandFilter: brand,
          pageSize,
          filters,
          page
        });
        if (fallbackResult) {
          console.log('[OFF] SAL fallback successful', {
            query: cleanQuery,
            results: fallbackResult.products?.length || 0
          });
          return fallbackResult;
        }
      } catch (fallbackError) {
        console.log('[OFF] SAL fallback also failed', {
          error: fallbackError?.message || 'unknown'
        });
      }
    }
  }

  return { count: 0, products: [], query_term: cleanQuery, brand_filter: brand ?? null, page_size: pageSize, page };
}
