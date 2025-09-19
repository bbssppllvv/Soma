/**
 * Тест кейса Feastables Cookies & Creme
 * Проверяет Brand Gate v2 + Category Guard
 */

// Включаем все улучшения
process.env.OFF_USE_SMART_ROUTING = 'true';
process.env.OFF_ENFORCE_BRAND_GATE_V2 = 'true';
process.env.OFF_CATEGORY_HARD_BLOCKS_ENABLED = 'true';

import { searchByNameV1 } from './modules/nutrition/off-client.js';
import { searchMetrics } from './modules/nutrition/search-metrics.js';

async function testFeastablesCase() {
    console.log('🍫 Тестирование кейса Feastables Cookies & Creme');
    console.log('===============================================');
    console.log('🎯 Цель: НЕ выбрать мороженое (7613312361887), найти шоколад Feastables');
    console.log('');
    
    // Сбрасываем метрики
    searchMetrics.reset();
    
    const testCases = [
        // Основной проблемный кейс
        {
            name: "Feastables Cookies & Creme",
            mockGPTOutput: {
                name: "Feastables Cookies & Creme",
                brand: "Mr Beast",
                brand_normalized: "mr-beast", 
                brand_synonyms: ["mrbeast", "feastables", "mr. beast"],
                clean_name: "chocolate bar",
                off_primary_tokens: ["feastables cookies creme"],
                off_alt_tokens: ["cookies and cream", "oreo flavor"],
                off_neg_tokens: ["ice cream", "frozen", "dairy"],
                off_attr_avoid: ["ice cream", "frozen", "dairy dessert"],
                off_attr_want: [],
                canonical_category: "snack-sweet", // НЕ dessert/ice-cream
                food_form: "bar",
                locale: "en"
            },
            expectedCode: "0850027880303",
            shouldNotFind: "7613312361887", // Мороженое Cookies & Cream
            testFocus: "brand_gate_v2_category_guard"
        },
        
        // Тест Amazon (бренд только в названии)
        {
            name: "Amazon brand in product name only",
            mockGPTOutput: {
                name: "Amazon red kidney beans",
                brand: "Amazon",
                brand_normalized: "amazon",
                brand_synonyms: ["by amazon", "amazon brand", "amazon basics"],
                clean_name: "kidney beans",
                off_primary_tokens: ["red kidney beans"],
                off_alt_tokens: ["kidney beans in water", "canned beans"],
                off_neg_tokens: ["chilli", "refried", "black beans"],
                off_attr_avoid: ["chilli", "spicy", "refried"],
                off_attr_want: [],
                canonical_category: "legume",
                food_form: "unknown",
                locale: "en"
            },
            expectedCode: "0644216479092",
            testFocus: "brand_name_salvage"
        },
        
        // Контрольный тест - не должен сломать Central Lechera
        {
            name: "Central Lechera Asturiana (control test)",
            mockGPTOutput: {
                name: "Central Lechera Asturiana nata montada",
                brand: "Central Lechera Asturiana",
                brand_normalized: "central-lechera-asturiana",
                brand_synonyms: ["asturiana", "lechera asturiana"],
                clean_name: "nata montada",
                off_primary_tokens: ["nata montada"],
                off_alt_tokens: ["whipped cream", "crema montada"],
                off_neg_tokens: ["light", "sin lactosa"],
                off_attr_avoid: ["light", "sin lactosa", "spray"],
                off_attr_want: [],
                canonical_category: "dairy",
                food_form: "unknown", 
                locale: "es"
            },
            expectedCode: "8410297121104",
            testFocus: "regression_prevention"
        }
    ];
    
    console.log(`🧪 Тестируем ${testCases.length} кейса с улучшенными gate'ами\n`);
    
    for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i];
        const mockItem = testCase.mockGPTOutput;
        
        console.log(`[${i + 1}/${testCases.length}] ${testCase.name}`);
        console.log(`Focus: ${testCase.testFocus}`);
        console.log(`Brand: ${mockItem.brand} (synonyms: [${mockItem.brand_synonyms?.join(', ') || 'none'}])`);
        console.log(`Category: ${mockItem.canonical_category} / ${mockItem.food_form}`);
        console.log(`Primary tokens: [${mockItem.off_primary_tokens?.join(', ') || 'none'}]`);
        console.log(`Attr avoid: [${mockItem.off_attr_avoid?.join(', ') || 'none'}]`);
        
        if (testCase.shouldNotFind) {
            console.log(`❌ Should NOT find: ${testCase.shouldNotFind}`);
        }
        
        try {
            const startTime = Date.now();
            
            // Симулируем поиск с mock GPT данными
            const results = await searchByNameV1(mockItem.name, {
                brand: mockItem.brand_normalized,
                pageSize: 30, // Больше результатов для анализа
                expectedBarcode: testCase.expectedCode,
                locale: mockItem.locale,
                // Передаем mock данные для тестирования
                mockItem: mockItem
            });
            
            const duration = Date.now() - startTime;
            
            console.log(`✅ Results: ${results.products?.length || 0} products in ${duration}ms`);
            
            // Проверяем API и стратегию
            if (results.api_used) {
                console.log(`🌐 API used: ${results.api_used}`);
                console.log(`🎯 Strategy: ${results.strategy || 'unknown'}`);
                
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
                    console.log(`🎯 Target found at position ${targetIndex + 1}`);
                } else {
                    console.log(`❌ Target not found`);
                }
            }
            
            // Проверяем что НЕ выбрали нежелательный продукт
            if (testCase.shouldNotFind && results.products) {
                const unwantedIndex = results.products.findIndex(p => p.code === testCase.shouldNotFind);
                if (unwantedIndex !== -1) {
                    console.log(`❌ FAIL: Found unwanted product at position ${unwantedIndex + 1}`);
                } else {
                    console.log(`✅ SUCCESS: Unwanted product correctly excluded`);
                }
            }
            
            // Анализируем топ-5 на предмет брендов и категорий
            if (results.products && results.products.length > 0) {
                console.log(`📋 Top 5 analysis:`);
                results.products.slice(0, 5).forEach((product, idx) => {
                    const name = product.product_name || 'N/A';
                    const brands = Array.isArray(product.brands) ? product.brands.join(', ') : product.brands || 'N/A';
                    const categories = Array.isArray(product.categories_tags) ? 
                        product.categories_tags.slice(0, 3).map(c => c.replace(/^[a-z]{2}:/, '')).join(', ') : 'N/A';
                    
                    // Проверяем соответствие бренду
                    const brandMatch = brands.toLowerCase().includes(mockItem.brand.toLowerCase()) ||
                                     mockItem.brand_synonyms?.some(syn => 
                                         brands.toLowerCase().includes(syn.toLowerCase()) ||
                                         name.toLowerCase().includes(syn.toLowerCase())
                                     );
                    
                    const brandFlag = brandMatch ? ' ✅ BRAND_MATCH' : ' ❌ BRAND_MISS';
                    
                    // Проверяем категорию
                    const isCorrectCategory = mockItem.canonical_category === 'snack-sweet' ? 
                        !categories.includes('ice-cream') && !categories.includes('frozen') :
                        true;
                    const categoryFlag = isCorrectCategory ? ' ✅ CATEGORY_OK' : ' ❌ CATEGORY_CONFLICT';
                    
                    console.log(`  ${idx + 1}. ${product.code} - ${name}`);
                    console.log(`     Brands: ${brands}${brandFlag}`);
                    console.log(`     Categories: ${categories}${categoryFlag}`);
                });
            }
            
        } catch (error) {
            console.log(`❌ Error: ${error.message}`);
        }
        
        console.log(''); // Пустая строка между тестами
        
        // Пауза между запросами
        if (i < testCases.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    
    // Показываем сводку метрик
    console.log('📊 МЕТРИКИ УЛУЧШЕННЫХ GATE\'ОВ');
    console.log('==============================');
    searchMetrics.printReport();
    
    console.log('\n🎯 АНАЛИЗ КАЧЕСТВА GATE\'ОВ:');
    const summary = searchMetrics.getSummary();
    if (summary) {
        console.log(`✅ Success@1: ${summary.success_rates.at_1}% (цель: >50%)`);
        console.log(`✅ Brand accuracy: проверить отсутствие чужих брендов в топ-3`);
        console.log(`✅ Category accuracy: проверить отсутствие конфликтующих категорий`);
    }
    
    console.log('\n✅ Тестирование улучшенных gate\'ов завершено!');
    return summary;
}

// Запуск теста
const isMainModule = import.meta.url.startsWith('file:') && 
    (import.meta.url.includes(process.argv[1]?.replace(/\\/g, '/')) || 
     process.argv[1]?.endsWith('test-feastables-case.js'));

if (isMainModule) {
    testFeastablesCase().catch(error => {
        console.error('❌ Ошибка при тестировании Feastables кейса:', error);
        process.exit(1);
    });
}

export { testFeastablesCase };
