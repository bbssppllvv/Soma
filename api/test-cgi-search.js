/**
 * Простой тест CGI поиска
 */

// Устанавливаем флаг CGI поиска ДО импорта модулей
process.env.OFF_USE_CGI_SEARCH = 'true';

import { searchByNameV1 } from './modules/nutrition/off-client.js';
import { USE_CGI_SEARCH } from './modules/nutrition/off/client/config.js';

async function testCGISearch() {
    console.log('🧪 Тестирование CGI поиска');
    console.log('========================');
    console.log(`🔧 USE_CGI_SEARCH: ${USE_CGI_SEARCH}`);
    console.log('');
    
    const testCases = [
        {
            name: "Central Lechera Asturiana",
            query: "Central Lechera Asturiana nata montada",
            brand: "central-lechera-asturiana",
            expectedCode: "8410297121104"
        },
        {
            name: "Coca-Cola Zero",
            query: "Coca-Cola Zero",
            brand: "coca-cola",
            expectedCode: "5000112658637"
        },
        {
            name: "Nutella",
            query: "Nutella hazelnut spread",
            brand: "nutella",
            expectedCode: "3017620422003"
        }
    ];
    
    for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i];
        console.log(`\n[${i + 1}/${testCases.length}] ${testCase.name}`);
        console.log(`Query: "${testCase.query}"`);
        console.log(`Brand: ${testCase.brand}`);
        console.log(`Expected: ${testCase.expectedCode}`);
        
        try {
            const startTime = Date.now();
            const results = await searchByNameV1(testCase.query, {
                brand: testCase.brand,
                pageSize: 20
            });
            const duration = Date.now() - startTime;
            
            console.log(`✅ Results: ${results.products?.length || 0} products in ${duration}ms`);
            
            if (results.products && results.products.length > 0) {
                // Ищем целевой продукт
                const targetIndex = results.products.findIndex(p => p.code === testCase.expectedCode);
                
                if (targetIndex !== -1) {
                    console.log(`🎯 Target found at position ${targetIndex + 1}`);
                } else {
                    console.log(`❌ Target not found`);
                }
                
                // Показываем топ-3
                console.log(`📋 Top 3 results:`);
                results.products.slice(0, 3).forEach((product, idx) => {
                    console.log(`  ${idx + 1}. ${product.code} - ${product.product_name || 'N/A'} (${product.brands || 'N/A'})`);
                });
            } else {
                console.log(`❌ No results found`);
            }
            
        } catch (error) {
            console.log(`❌ Error: ${error.message}`);
        }
        
        // Пауза между запросами
        if (i < testCases.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    console.log('\n✅ Test completed!');
}

// Запуск теста
testCGISearch().catch(console.error);
