/**
 * Smart Routing Layer для выбора между CGI и SAL API
 * Принимает решения на основе типа бренда, сложности запроса и контекста
 */

import { runSearchCGI } from './search-cgi.js';
import { runSearchV3 } from './search-sal.js';
import { determineBrandType } from '../../search-metrics.js';

// Конфигурация роутинга
const ROUTING_CONFIG = {
  // Пороги для принятия решений
  MIN_RESULTS_FOR_CGI_SUCCESS: 3,
  PARALLEL_FALLBACK_THRESHOLD: 5,
  MAX_SAL_PAGES_PRIMARY: 3,      // Уменьшено с 20 до 3 для latency
  MAX_SAL_PAGES_FALLBACK: 8,     // Для fallback можно больше
  
  // Таймауты
  CGI_TIMEOUT_MS: 3000,
  SAL_TIMEOUT_MS: 5000,
  PARALLEL_TIMEOUT_MS: 8000,
  
  // Флаги
  ENABLE_PARALLEL_FALLBACK: true,
  ENABLE_QUALITY_CHECKS: true
};

/**
 * Основная функция умного роутинга
 */
export async function smartSearch(query, {
  signal,
  locale,
  brandFilter = null,
  pageSize = 40,
  filters = {},
  page = 1,
  expectedBarcode = null // Для метрик
} = {}) {
  
  const startTime = Date.now();
  const brandType = determineBrandType(brandFilter);
  
  console.log('[SMART_ROUTING] Decision process started', {
    query: query?.substring(0, 30) + '...',
    brand: brandFilter || 'none',
    brand_type: brandType,
    page_size: pageSize
  });
  
  // Выбираем стратегию на основе типа бренда
  const strategy = chooseSearchStrategy(brandType, query, brandFilter);
  
  try {
    switch (strategy.primary) {
      case 'cgi_primary':
        return await executeCGIPrimary(query, { 
          signal, locale, brandFilter, pageSize, filters, page 
        }, strategy, startTime, expectedBarcode);
        
      case 'sal_primary':
        return await executeSALPrimary(query, { 
          signal, locale, brandFilter, pageSize, filters, page 
        }, strategy, startTime, expectedBarcode);
        
      case 'parallel':
        return await executeParallel(query, { 
          signal, locale, brandFilter, pageSize, filters, page 
        }, strategy, startTime, expectedBarcode);
        
      default:
        throw new Error(`Unknown strategy: ${strategy.primary}`);
    }
  } catch (error) {
    console.log('[SMART_ROUTING] Search failed', {
      strategy: strategy.primary,
      error: error.message,
      latency_ms: Date.now() - startTime
    });
    throw error;
  }
}

/**
 * Выбирает стратегию поиска на основе контекста
 */
function chooseSearchStrategy(brandType, query, brandFilter) {
  // Локальные европейские бренды → CGI primary
  if (brandType === 'local') {
    return {
      primary: 'cgi_primary',
      fallback: 'sal',
      reason: 'local_brand_cgi_advantage',
      max_sal_pages: ROUTING_CONFIG.MAX_SAL_PAGES_FALLBACK
    };
  }
  
  // Глобальные бренды → SAL primary (но с ограниченной пагинацией)
  if (brandType === 'global') {
    return {
      primary: 'sal_primary', 
      fallback: 'cgi',
      reason: 'global_brand_sal_depth',
      max_sal_pages: ROUTING_CONFIG.MAX_SAL_PAGES_PRIMARY // 3 страницы вместо 20
    };
  }
  
  // Неизвестные бренды или без бренда → параллельный поиск
  if (!brandFilter || brandType === 'unknown') {
    return {
      primary: 'parallel',
      reason: 'unknown_brand_parallel_search',
      max_sal_pages: ROUTING_CONFIG.MAX_SAL_PAGES_PRIMARY
    };
  }
  
  // Дефолт: CGI first
  return {
    primary: 'cgi_primary',
    fallback: 'sal', 
    reason: 'default_cgi_first',
    max_sal_pages: ROUTING_CONFIG.MAX_SAL_PAGES_FALLBACK
  };
}

/**
 * CGI как основной API с SAL fallback
 */
async function executeCGIPrimary(query, options, strategy, startTime, expectedBarcode) {
  const { signal, locale, brandFilter, pageSize, filters, page } = options;
  
  try {
    // Пробуем CGI с поддержкой точных фраз
    console.log('[SMART_ROUTING] Trying CGI primary');
    
    // Если запрос в кавычках (exact phrase), используем его как есть
    const isExactPhrase = query.startsWith('"') && query.endsWith('"');
    const searchQuery = isExactPhrase ? query.slice(1, -1) : query; // Убираем кавычки для CGI
    
    const cgiResult = await runSearchCGI(searchQuery, {
      signal: createTimeoutSignal(signal, ROUTING_CONFIG.CGI_TIMEOUT_MS),
      locale,
      brandFilter,
      pageSize,
      page
    });
    
    const cgiLatency = Date.now() - startTime;
    
    // Проверяем качество результатов CGI
    if (isGoodCGIResult(cgiResult)) {
      recordMetrics('cgi', 'cgi_primary_success', query, brandFilter, 
                   cgiResult.products, cgiLatency, expectedBarcode);
      
      return {
        ...cgiResult,
        api_used: 'cgi',
        strategy: 'cgi_primary_success',
        latency_ms: cgiLatency,
        exact_phrase_used: isExactPhrase
      };
    }
    
    // CGI дал мало результатов → fallback на SAL
    console.log('[SMART_ROUTING] CGI low results, trying SAL fallback');
    return await executeSALFallback(query, options, strategy, startTime, expectedBarcode, 'low_results');
    
  } catch (error) {
    console.log('[SMART_ROUTING] CGI failed, trying SAL fallback', { error: error.message });
    return await executeSALFallback(query, options, strategy, startTime, expectedBarcode, 'api_failure');
  }
}

/**
 * SAL как основной API с ограниченной пагинацией
 */
async function executeSALPrimary(query, options, strategy, startTime, expectedBarcode) {
  const { signal, locale, brandFilter, pageSize, filters, page } = options;
  
  try {
    console.log('[SMART_ROUTING] Trying SAL primary (limited pagination)');
    
    // SAL с ограниченной глубиной для лучшей latency
    const salResult = await runSearchV3(query, {
      signal: createTimeoutSignal(signal, ROUTING_CONFIG.SAL_TIMEOUT_MS),
      locale,
      brandFilter,
      pageSize: Math.min(pageSize, 40), // Ограничиваем размер страницы
      filters,
      page,
      maxPages: strategy.max_sal_pages // 3 вместо 20
    });
    
    const salLatency = Date.now() - startTime;
    
    recordMetrics('sal', 'sal_primary_limited', query, brandFilter, 
                 salResult.products, salLatency, expectedBarcode);
    
    return {
      ...salResult,
      api_used: 'sal',
      strategy: 'sal_primary_limited',
      latency_ms: salLatency
    };
    
  } catch (error) {
    console.log('[SMART_ROUTING] SAL failed, trying CGI fallback', { error: error.message });
    return await executeCGIFallback(query, options, startTime, expectedBarcode, 'api_failure');
  }
}

/**
 * Параллельный поиск CGI + SAL с выбором лучшего
 */
async function executeParallel(query, options, strategy, startTime, expectedBarcode) {
  const { signal, locale, brandFilter, pageSize, filters, page } = options;
  
  console.log('[SMART_ROUTING] Executing parallel search');
  
  const parallelSignal = createTimeoutSignal(signal, ROUTING_CONFIG.PARALLEL_TIMEOUT_MS);
  
  try {
    const [cgiResult, salResult] = await Promise.allSettled([
      runSearchCGI(query, {
        signal: parallelSignal,
        locale,
        brandFilter,
        pageSize: Math.min(pageSize, 60), // CGI лимит
        page
      }),
      runSearchV3(query, {
        signal: parallelSignal,
        locale,
        brandFilter,
        pageSize: Math.min(pageSize, 40),
        filters,
        page,
        maxPages: strategy.max_sal_pages
      })
    ]);
    
    const totalLatency = Date.now() - startTime;
    
    // Выбираем лучший результат
    const bestResult = chooseBestParallelResult(cgiResult, salResult, brandFilter);
    
    recordMetrics(bestResult.api_used, 'parallel_search', query, brandFilter, 
                 bestResult.products, totalLatency, expectedBarcode);
    
    return {
      ...bestResult,
      strategy: 'parallel_search',
      latency_ms: totalLatency
    };
    
  } catch (error) {
    console.log('[SMART_ROUTING] Parallel search failed', { error: error.message });
    throw error;
  }
}

/**
 * SAL fallback с полной глубиной
 */
async function executeSALFallback(query, options, strategy, startTime, expectedBarcode, fallbackReason) {
  const { signal, locale, brandFilter, pageSize, filters, page } = options;
  
  try {
    const salResult = await runSearchV3(query, {
      signal,
      locale,
      brandFilter,
      pageSize,
      filters,
      page,
      maxPages: strategy.max_sal_pages // Полная глубина для fallback
    });
    
    const totalLatency = Date.now() - startTime;
    
    recordMetrics('sal', 'sal_fallback', query, brandFilter, 
                 salResult.products, totalLatency, expectedBarcode, fallbackReason);
    
    return {
      ...salResult,
      api_used: 'sal',
      strategy: 'sal_fallback',
      latency_ms: totalLatency,
      fallback_reason: fallbackReason
    };
    
  } catch (error) {
    console.log('[SMART_ROUTING] SAL fallback also failed', { error: error.message });
    throw error;
  }
}

/**
 * CGI fallback
 */
async function executeCGIFallback(query, options, startTime, expectedBarcode, fallbackReason) {
  const { signal, locale, brandFilter, pageSize, page } = options;
  
  try {
    const cgiResult = await runSearchCGI(query, {
      signal,
      locale,
      brandFilter,
      pageSize,
      page
    });
    
    const totalLatency = Date.now() - startTime;
    
    recordMetrics('cgi', 'cgi_fallback', query, brandFilter, 
                 cgiResult.products, totalLatency, expectedBarcode, fallbackReason);
    
    return {
      ...cgiResult,
      api_used: 'cgi',
      strategy: 'cgi_fallback',
      latency_ms: totalLatency,
      fallback_reason: fallbackReason
    };
    
  } catch (error) {
    console.log('[SMART_ROUTING] CGI fallback also failed', { error: error.message });
    throw error;
  }
}

/**
 * Проверяет качество результатов CGI
 */
function isGoodCGIResult(result) {
  if (!result || !result.products) return false;
  
  const productCount = result.products.length;
  
  // Достаточно результатов
  if (productCount >= ROUTING_CONFIG.MIN_RESULTS_FOR_CGI_SUCCESS) {
    return true;
  }
  
  // Мало результатов, но они очень релевантные (например, точное совпадение бренда)
  if (productCount > 0 && result.products[0]?.brands) {
    return true;
  }
  
  return false;
}

/**
 * Выбирает лучший результат из параллельного поиска
 */
function chooseBestParallelResult(cgiResult, salResult, brandFilter) {
  const cgiOk = cgiResult.status === 'fulfilled' && cgiResult.value?.products;
  const salOk = salResult.status === 'fulfilled' && salResult.value?.products;
  
  // Если только один успешен
  if (cgiOk && !salOk) {
    return { ...cgiResult.value, api_used: 'cgi' };
  }
  if (salOk && !cgiOk) {
    return { ...salResult.value, api_used: 'sal' };
  }
  
  // Если оба неуспешны
  if (!cgiOk && !salOk) {
    throw new Error('Both CGI and SAL failed in parallel search');
  }
  
  // Оба успешны - выбираем по качеству
  const cgiProducts = cgiResult.value.products;
  const salProducts = salResult.value.products;
  
  // Приоритет CGI для локальных брендов
  const brandType = determineBrandType(brandFilter);
  if (brandType === 'local' && cgiProducts.length >= 3) {
    return { ...cgiResult.value, api_used: 'cgi' };
  }
  
  // Приоритет SAL если больше результатов
  if (salProducts.length > cgiProducts.length * 2) {
    return { ...salResult.value, api_used: 'sal' };
  }
  
  // По умолчанию CGI (быстрее и точнее для топ результатов)
  return { ...cgiResult.value, api_used: 'cgi' };
}

/**
 * Создает signal с таймаутом
 */
function createTimeoutSignal(originalSignal, timeoutMs) {
  if (!timeoutMs) return originalSignal;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  if (originalSignal) {
    originalSignal.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      controller.abort();
    });
  }
  
  return controller.signal;
}

/**
 * Записывает метрики (импортируем динамически чтобы избежать циклических зависимостей)
 */
async function recordMetrics(apiUsed, strategy, query, brand, results, latencyMs, expectedBarcode, fallbackReason) {
  try {
    const { recordSearchMetrics } = await import('../../search-metrics.js');
    recordSearchMetrics({
      query,
      brand,
      apiUsed,
      strategy,
      results,
      expectedBarcode,
      latencyMs,
      fallbackReason
    });
  } catch (error) {
    console.log('[SMART_ROUTING] Failed to record metrics', { error: error.message });
  }
}
