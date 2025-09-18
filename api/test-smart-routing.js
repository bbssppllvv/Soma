/**
 * Тест умного роутинга и метрик
 */

// Включаем умный роутинг
process.env.OFF_USE_SMART_ROUTING = 'true';

import { searchByNameV1 } from './modules/nutrition/off-client.js';
import { searchMetrics } from './modules/nutrition/search-metrics.js';

async function testSmartRouting() {
    console.log('🧠 Тестирование умного роутинга');
    console.log('===============================');
    
    // Сбрасываем метрики
    searchMetrics.reset();
    
    const testCases = [
        // Локальные бренды → должны идти через CGI
        {
            name: "Local Brand - Central Lechera Asturiana",
            query: "Central Lechera Asturiana nata montada",
            brand: "central-lechera-asturiana",
            expectedCode: "8410297121104",
            expectedAPI: "cgi",
            expectedStrategy: "cgi_primary"
        },
        {
            name: "Local Brand - Hacendado",
            query: "Hacendado galletas maria",
            brand: "hacendado", 
            expectedCode: null,
            expectedAPI: "cgi",
            expectedStrategy: "cgi_primary"
        },
        
        // Глобальные бренды → должны идти через SAL (с ограниченной пагинацией)
        {
            name: "Global Brand - Coca-Cola",
            query: "Coca-Cola Zero",
            brand: "coca-cola",
            expectedCode: "5000112658637",
            expectedAPI: "sal", 
            expectedStrategy: "sal_primary"
        },
        {
            name: "Global Brand - Nutella",
            query: "Nutella hazelnut spread",
            brand: "nutella",
            expectedCode: "3017620422003", 
            expectedAPI: "sal",
            expectedStrategy: "sal_primary"
        },
        
        // Неизвестные бренды → параллельный поиск
        {
            name: "Unknown Brand",
            query: "some unknown brand chocolate",
            brand: "unknown-brand",
            expectedCode: null,
            expectedAPI: "parallel",
            expectedStrategy: "parallel"
        },
        
        // Без бренда → параллельный поиск
        {
            name: "No Brand",
            query: "chocolate milk",
            brand: null,
            expectedCode: null,
            expectedAPI: "parallel",
            expectedStrategy: "parallel"
        }
    ];
    
    console.log(`🎯 Тестируем ${testCases.length} сценариев умного роутинга\n`);
    
    for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i];
        console.log(`[${i + 1}/${testCases.length}] ${testCase.name}`);
        console.log(`Query: "${testCase.query}"`);
        console.log(`Brand: ${testCase.brand || 'none'}`);
        console.log(`Expected API: ${testCase.expectedAPI}`);
        
        try {
            const startTime = Date.now();
            const results = await searchByNameV1(testCase.query, {
                brand: testCase.brand,
                pageSize: 20,
                expectedBarcode: testCase.expectedCode
            });
            const duration = Date.now() - startTime;
            
            console.log(`✅ Results: ${results.products?.length || 0} products in ${duration}ms`);
            
            // Проверяем API и стратегию
            if (results.api_used) {
                console.log(`🌐 API used: ${results.api_used} (expected: ${testCase.expectedAPI})`);
                console.log(`🎯 Strategy: ${results.strategy || 'unknown'}`);
                
                // Проверяем соответствие ожиданиям
                const apiMatch = results.api_used.includes(testCase.expectedAPI) || 
                                testCase.expectedAPI === 'parallel';
                console.log(`${apiMatch ? '✅' : '❌'} API routing ${apiMatch ? 'correct' : 'unexpected'}`);
            }
            
            // Ищем целевой продукт
            if (testCase.expectedCode && results.products) {
                const targetIndex = results.products.findIndex(p => p.code === testCase.expectedCode);
                if (targetIndex !== -1) {
                    console.log(`🎯 Target found at position ${targetIndex + 1}`);
                } else {
                    console.log(`❌ Target not found`);
                }
            }
            
            // Показываем топ-3
            if (results.products && results.products.length > 0) {
                console.log(`📋 Top 3 results:`);
                results.products.slice(0, 3).forEach((product, idx) => {
                    const name = product.product_name || 'N/A';
                    const brands = Array.isArray(product.brands) ? product.brands.join(', ') : product.brands || 'N/A';
                    console.log(`  ${idx + 1}. ${product.code} - ${name} (${brands})`);
                });
            }
            
        } catch (error) {
            console.log(`❌ Error: ${error.message}`);
        }
        
        console.log(''); // Пустая строка между тестами
        
        // Пауза между запросами
        if (i < testCases.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    // Показываем сводку метрик
    console.log('📊 МЕТРИКИ УМНОГО РОУТИНГА');
    console.log('===========================');
    searchMetrics.printReport();
    
    console.log('\n✅ Тестирование умного роутинга завершено!');
    
    // Возвращаем метрики для анализа
    return searchMetrics.getSummary();
}

// Запуск теста
const isMainModule = import.meta.url.startsWith('file:') && 
    (import.meta.url.includes(process.argv[1]?.replace(/\\/g, '/')) || 
     process.argv[1]?.endsWith('test-smart-routing.js'));

if (isMainModule) {
    testSmartRouting().catch(error => {
        console.error('❌ Ошибка при тестировании умного роутинга:', error);
        process.exit(1);
    });
}

export { testSmartRouting };
