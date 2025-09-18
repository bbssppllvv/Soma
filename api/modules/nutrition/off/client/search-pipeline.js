import { runSearchV3 } from './search-sal.js';
import { runSearchCGI } from './search-cgi.js';
import { smartSearch } from './smart-routing.js';
import { USE_CGI_SEARCH } from './config.js';

// Флаг для включения умного роутинга (по умолчанию включен)
const USE_SMART_ROUTING = process.env.OFF_USE_SMART_ROUTING !== 'false';

export async function searchByNamePipeline(query, { 
  signal, 
  brand = null, 
  locale = null, 
  pageSize, 
  filters, 
  page = 1,
  expectedBarcode = null // Для метрик
} = {}) {
  const cleanQuery = typeof query === 'string' ? query.trim() : '';
  if (!cleanQuery) {
    return { count: 0, products: [], query_term: '', brand_filter: brand ?? null, page_size: pageSize, page };
  }

  // Используем умный роутинг если включен
  if (USE_SMART_ROUTING) {
    console.log('[OFF] Using smart routing');
    try {
      const result = await smartSearch(cleanQuery, {
        signal,
        locale,
        brandFilter: brand,
        pageSize,
        filters,
        page,
        expectedBarcode
      });
      
      if (result) {
        console.log(`[OFF] Smart routing successful`, {
          query: cleanQuery.substring(0, 30) + '...',
          brand: brand || null,
          results: result.products?.length || 0,
          api: result.api_used,
          strategy: result.strategy,
          latency_ms: result.latency_ms
        });
        return result;
      }
    } catch (error) {
      console.log('[OFF] Smart routing failed, falling back to legacy', {
        error: error?.message || 'unknown'
      });
      // Продолжаем с legacy логикой
    }
  }

  // Legacy логика (простой флаг CGI vs SAL)
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
