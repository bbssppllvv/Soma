/**
 * Тест улучшений для продакшена:
 * 1. Locale-safe запросы
 * 2. Жёсткий атрибутный gate
 * 3. Clean-first выбор
 */

// Включаем все улучшения
process.env.OFF_USE_SMART_ROUTING = 'true';

import { searchByNameV1 } from './modules/nutrition/off-client.js';
import { searchMetrics } from './modules/nutrition/search-metrics.js';

async function testProductionImprovements() {
    console.log('🚀 Тестирование улучшений для продакшена');
    console.log('=========================================');
    
    // Сбрасываем метрики
    searchMetrics.reset();
    
    const testCases = [
        // Тест 1: Locale-safe запрос (должен использовать "nata montada", не "whipped cream")
        {
            name: "Locale-safe: Central Lechera Asturiana",
            mockGPTOutput: {
                name: "Central Lechera Asturiana nata montada",
                brand: "Central Lechera Asturiana", 
                brand_normalized: "central-lechera-asturiana",
                clean_name: "whipped cream", // Переведено GPT
                off_primary_tokens: ["nata montada"], // Оригинальная фраза
                off_attr_avoid: ["light", "sin lactosa", "spray"],
                off_attr_want: [],
                locale: "es"
            },
            expectedCode: "8410297121104",
            expectedAPI: "cgi",
            expectedPosition: 1,
            testFocus: "locale_consistency"
        },
        
        // Тест 2: Атрибутный gate (должен исключить light/zero варианты)
        {
            name: "Attribute gate: Coca-Cola regular (не Zero)",
            mockGPTOutput: {
                name: "Coca-Cola",
                brand: "Coca-Cola",
                brand_normalized: "coca-cola", 
                clean_name: "cola",
                off_primary_tokens: ["coca cola"],
                off_attr_avoid: ["zero", "light", "diet", "sugar free"],
                off_attr_want: [],
                locale: "en"
            },
            expectedCode: null, // Не знаем конкретный код
            expectedAPI: "sal",
            testFocus: "attribute_filtering"
        },
        
        // Тест 3: Clean-first выбор (должен предпочесть классическую Nutella)
        {
            name: "Clean-first: Nutella classic (не vegan/sugar-free)",
            mockGPTOutput: {
                name: "Nutella hazelnut spread",
                brand: "Nutella",
                brand_normalized: "nutella",
                clean_name: "hazelnut spread", 
                off_primary_tokens: ["nutella"],
                off_attr_avoid: ["vegan", "sugar free", "organic", "palm oil free"],
                off_attr_want: [],
                locale: "en"
            },
            expectedCode: "3017620422003",
            expectedAPI: "sal",
            testFocus: "clean_selection"
        }
    ];
    
    console.log(`🎯 Тестируем ${testCases.length} сценария улучшений\n`);
    
    for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i];
        const mockItem = testCase.mockGPTOutput;
        
        console.log(`[${i + 1}/${testCases.length}] ${testCase.name}`);
        console.log(`Focus: ${testCase.testFocus}`);
        console.log(`Primary tokens: [${mockItem.off_primary_tokens?.join(', ') || 'none'}]`);
        console.log(`Attr avoid: [${mockItem.off_attr_avoid?.join(', ') || 'none'}]`);
        console.log(`Expected API: ${testCase.expectedAPI}`);
        
        try {
            const startTime = Date.now();
            
            // Симулируем поиск с mock GPT данными
            const results = await searchByNameV1(mockItem.name, {
                brand: mockItem.brand_normalized,
                pageSize: 20,
                expectedBarcode: testCase.expectedCode,
                locale: mockItem.locale,
                // Передаем mock данные для тестирования
                mockItem: mockItem
            });
            
            const duration = Date.now() - startTime;
            
            console.log(`✅ Results: ${results.products?.length || 0} products in ${duration}ms`);
            
            // Проверяем API и стратегию
            if (results.api_used) {
                console.log(`🌐 API used: ${results.api_used} (expected: ${testCase.expectedAPI})`);
                console.log(`🎯 Strategy: ${results.strategy || 'unknown'}`);
                
                if (results.exact_phrase_used) {
                    console.log(`📝 Exact phrase used: ${results.exact_phrase_used}`);
                }
                
                if (results.selection_phase) {
                    console.log(`🔍 Selection phase: ${results.selection_phase}`);
                }
                
                if (results.degraded_pick) {
                    console.log(`⚠️ Degraded selection: ${results.degraded_pick}`);
                }
            }
            
            // Ищем целевой продукт
            if (testCase.expectedCode && results.products) {
                const targetIndex = results.products.findIndex(p => p.code === testCase.expectedCode);
                if (targetIndex !== -1) {
                    console.log(`🎯 Target found at position ${targetIndex + 1} (expected: ${testCase.expectedPosition || 'any'})`);
                    
                    if (testCase.expectedPosition && targetIndex + 1 <= testCase.expectedPosition) {
                        console.log(`✅ Position meets expectations`);
                    }
                } else {
                    console.log(`❌ Target not found`);
                }
            }
            
            // Проверяем качество топ-3 на предмет avoided атрибутов
            if (results.products && results.products.length > 0) {
                console.log(`📋 Top 3 results:`);
                results.products.slice(0, 3).forEach((product, idx) => {
                    const name = product.product_name || 'N/A';
                    const brands = Array.isArray(product.brands) ? product.brands.join(', ') : product.brands || 'N/A';
                    
                    // Проверяем на avoided атрибуты
                    const hasAvoidedAttrs = mockItem.off_attr_avoid?.some(avoided => 
                        name.toLowerCase().includes(avoided.toLowerCase())
                    ) || false;
                    
                    const avoidedFlag = hasAvoidedAttrs ? ' ⚠️ HAS_AVOIDED' : '';
                    console.log(`  ${idx + 1}. ${product.code} - ${name} (${brands})${avoidedFlag}`);
                });
                
                // Статистика по avoided атрибутам в топ-3
                const topWithAvoided = results.products.slice(0, 3).filter(product => {
                    const name = (product.product_name || '').toLowerCase();
                    return mockItem.off_attr_avoid?.some(avoided => 
                        name.includes(avoided.toLowerCase())
                    );
                }).length;
                
                if (topWithAvoided > 0) {
                    console.log(`⚠️ WARNING: ${topWithAvoided}/3 top results have avoided attributes`);
                } else {
                    console.log(`✅ Clean top-3: no avoided attributes found`);
                }
            }
            
        } catch (error) {
            console.log(`❌ Error: ${error.message}`);
        }
        
        console.log(''); // Пустая строка между тестами
        
        // Пауза между запросами
        if (i < testCases.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
    }
    
    // Показываем сводку метрик
    console.log('📊 МЕТРИКИ УЛУЧШЕНИЙ ПРОДАКШЕНА');
    console.log('===============================');
    searchMetrics.printReport();
    
    // Анализ качества
    const summary = searchMetrics.getSummary();
    if (summary) {
        console.log('\n🎯 АНАЛИЗ КАЧЕСТВА УЛУЧШЕНИЙ:');
        console.log(`✅ Success@1: ${summary.success_rates.at_1}% (цель: >50%)`);
        console.log(`✅ CGI usage: ${summary.api_distribution.cgi}% (ожидается для локальных брендов)`);
        console.log(`✅ Avg latency: ${summary.avg_latency.overall}ms (цель: <2000ms)`);
        
        if (summary.fallback_reasons.low_results > 0) {
            console.log(`⚠️ Low results fallbacks: ${summary.fallback_reasons.low_results} (оптимизировать CGI)`);
        }
        
        if (summary.fallback_reasons.api_failure > 0) {
            console.log(`⚠️ API failures: ${summary.fallback_reasons.api_failure} (проверить стабильность)`);
        }
    }
    
    console.log('\n✅ Тестирование улучшений завершено!');
    return summary;
}

// Запуск теста
const isMainModule = import.meta.url.startsWith('file:') && 
    (import.meta.url.includes(process.argv[1]?.replace(/\\/g, '/')) || 
     process.argv[1]?.endsWith('test-production-improvements.js'));

if (isMainModule) {
    testProductionImprovements().catch(error => {
        console.error('❌ Ошибка при тестировании улучшений:', error);
        process.exit(1);
    });
}

export { testProductionImprovements };
