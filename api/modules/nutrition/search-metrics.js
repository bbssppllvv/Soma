/**
 * Search Metrics & Telemetry Module
 * Отслеживает качество поиска, стратегии и производительность
 */

// Метрики поиска для анализа качества
export class SearchMetrics {
  constructor() {
    this.metrics = {
      total_searches: 0,
      api_usage: { cgi: 0, sal: 0, fallback: 0 },
      success_rates: { at_1: 0, at_3: 0, at_5: 0 },
      strategies: {},
      latency: { cgi: [], sal: [], total: [] },
      brand_types: { local: 0, global: 0, unknown: 0 },
      fallback_triggers: { low_results: 0, api_failure: 0, quality_check: 0 }
    };
  }

  /**
   * Записывает метрики поискового запроса
   */
  recordSearch({
    query,
    brand,
    brandType, // 'local', 'global', 'unknown'
    apiUsed, // 'cgi', 'sal', 'fallback'
    strategy, // 'brand_filtered_search', 'fallback_or_tokens', etc.
    results,
    targetFound,
    targetPosition,
    latencyMs,
    fallbackReason = null
  }) {
    this.metrics.total_searches++;
    
    // API использование
    this.metrics.api_usage[apiUsed]++;
    
    // Тип бренда
    if (brandType) {
      this.metrics.brand_types[brandType]++;
    }
    
    // Стратегии поиска
    if (strategy) {
      this.metrics.strategies[strategy] = (this.metrics.strategies[strategy] || 0) + 1;
    }
    
    // Success rates
    if (targetFound && targetPosition) {
      if (targetPosition <= 1) this.metrics.success_rates.at_1++;
      if (targetPosition <= 3) this.metrics.success_rates.at_3++;
      if (targetPosition <= 5) this.metrics.success_rates.at_5++;
    }
    
    // Latency tracking
    if (latencyMs) {
      this.metrics.latency[apiUsed].push(latencyMs);
      this.metrics.latency.total.push(latencyMs);
    }
    
    // Fallback reasons
    if (fallbackReason) {
      this.metrics.fallback_triggers[fallbackReason] = 
        (this.metrics.fallback_triggers[fallbackReason] || 0) + 1;
    }

    // Логируем для мониторинга
    console.log('[METRICS] Search recorded', {
      query: query?.substring(0, 30) + '...',
      brand: brand || 'none',
      brand_type: brandType,
      api: apiUsed,
      strategy,
      target_pos: targetPosition || 'not_found',
      results_count: results?.length || 0,
      latency_ms: latencyMs,
      fallback_reason: fallbackReason
    });
  }

  /**
   * Получает сводную статистику
   */
  getSummary() {
    const total = this.metrics.total_searches;
    if (total === 0) return null;

    const avgLatency = (arr) => arr.length > 0 ? 
      Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

    return {
      total_searches: total,
      
      // Success rates (проценты)
      success_rates: {
        at_1: Math.round((this.metrics.success_rates.at_1 / total) * 100),
        at_3: Math.round((this.metrics.success_rates.at_3 / total) * 100),
        at_5: Math.round((this.metrics.success_rates.at_5 / total) * 100)
      },
      
      // API distribution (проценты)
      api_distribution: {
        cgi: Math.round((this.metrics.api_usage.cgi / total) * 100),
        sal: Math.round((this.metrics.api_usage.sal / total) * 100),
        fallback: Math.round((this.metrics.api_usage.fallback / total) * 100)
      },
      
      // Brand types (проценты)
      brand_distribution: {
        local: Math.round((this.metrics.brand_types.local / total) * 100),
        global: Math.round((this.metrics.brand_types.global / total) * 100),
        unknown: Math.round((this.metrics.brand_types.unknown / total) * 100)
      },
      
      // Average latencies
      avg_latency: {
        cgi: avgLatency(this.metrics.latency.cgi),
        sal: avgLatency(this.metrics.latency.sal),
        overall: avgLatency(this.metrics.latency.total)
      },
      
      // Top strategies
      top_strategies: Object.entries(this.metrics.strategies)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .map(([strategy, count]) => ({
          strategy,
          count,
          percentage: Math.round((count / total) * 100)
        })),
      
      // Fallback analysis
      fallback_reasons: this.metrics.fallback_triggers
    };
  }

  /**
   * Сбрасывает метрики (для тестирования)
   */
  reset() {
    this.metrics = {
      total_searches: 0,
      api_usage: { cgi: 0, sal: 0, fallback: 0 },
      success_rates: { at_1: 0, at_3: 0, at_5: 0 },
      strategies: {},
      latency: { cgi: [], sal: [], total: [] },
      brand_types: { local: 0, global: 0, unknown: 0 },
      fallback_triggers: { low_results: 0, api_failure: 0, quality_check: 0 }
    };
  }

  /**
   * Выводит красивый отчет в консоль
   */
  printReport() {
    const summary = this.getSummary();
    if (!summary) {
      console.log('📊 [METRICS] No searches recorded yet');
      return;
    }

    console.log('\n📊 SEARCH METRICS REPORT');
    console.log('========================');
    console.log(`🔍 Total searches: ${summary.total_searches}`);
    
    console.log('\n🎯 Success Rates:');
    console.log(`  Position 1: ${summary.success_rates.at_1}%`);
    console.log(`  Position 3: ${summary.success_rates.at_3}%`);
    console.log(`  Position 5: ${summary.success_rates.at_5}%`);
    
    console.log('\n🌐 API Usage:');
    console.log(`  CGI: ${summary.api_distribution.cgi}%`);
    console.log(`  SAL: ${summary.api_distribution.sal}%`);
    console.log(`  Fallback: ${summary.api_distribution.fallback}%`);
    
    console.log('\n🏷️ Brand Types:');
    console.log(`  Local: ${summary.brand_distribution.local}%`);
    console.log(`  Global: ${summary.brand_distribution.global}%`);
    console.log(`  Unknown: ${summary.brand_distribution.unknown}%`);
    
    console.log('\n⚡ Average Latency:');
    console.log(`  CGI: ${summary.avg_latency.cgi}ms`);
    console.log(`  SAL: ${summary.avg_latency.sal}ms`);
    console.log(`  Overall: ${summary.avg_latency.overall}ms`);
    
    console.log('\n🎯 Top Strategies:');
    summary.top_strategies.forEach(({ strategy, percentage }) => {
      console.log(`  ${strategy}: ${percentage}%`);
    });
    
    if (Object.keys(summary.fallback_reasons).length > 0) {
      console.log('\n🔄 Fallback Reasons:');
      Object.entries(summary.fallback_reasons).forEach(([reason, count]) => {
        console.log(`  ${reason}: ${count}`);
      });
    }
  }
}

// Глобальный инстанс метрик
export const searchMetrics = new SearchMetrics();

/**
 * Определяет тип бренда для метрик
 */
export function determineBrandType(brand) {
  if (!brand) return 'unknown';
  
  const brandLower = brand.toLowerCase();
  
  // Локальные европейские бренды
  const localBrands = [
    'central-lechera-asturiana', 'hacendado', 'carrefour', 'dia', 'eroski',
    'mercadona', 'auchan', 'lidl', 'aldi', 'tesco', 'sainsbury', 'asda',
    'intermarché', 'leclerc', 'système-u', 'monoprix', 'franprix'
  ];
  
  // Глобальные бренды
  const globalBrands = [
    'coca-cola', 'pepsi', 'nestle', 'unilever', 'kraft', 'danone',
    'ben-jerry-s', 'nutella', 'ferrero', 'mars', 'mondelez',
    'kellogg', 'general-mills', 'campbell', 'heinz', 'procter-gamble'
  ];
  
  if (localBrands.some(local => brandLower.includes(local) || local.includes(brandLower))) {
    return 'local';
  }
  
  if (globalBrands.some(global => brandLower.includes(global) || global.includes(brandLower))) {
    return 'global';
  }
  
  return 'unknown';
}

/**
 * Хелпер для записи метрик поиска
 */
export function recordSearchMetrics({
  query,
  brand,
  apiUsed,
  strategy,
  results,
  expectedBarcode = null,
  latencyMs,
  fallbackReason = null
}) {
  const brandType = determineBrandType(brand);
  
  // Находим позицию целевого продукта
  let targetFound = false;
  let targetPosition = null;
  
  if (expectedBarcode && Array.isArray(results)) {
    const index = results.findIndex(r => r.code === expectedBarcode);
    if (index !== -1) {
      targetFound = true;
      targetPosition = index + 1;
    }
  }
  
  searchMetrics.recordSearch({
    query,
    brand,
    brandType,
    apiUsed,
    strategy,
    results,
    targetFound,
    targetPosition,
    latencyMs,
    fallbackReason
  });
}
