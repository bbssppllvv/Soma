/**
 * Скрипт для сравнительного тестирования двух API OpenFoodFacts:
 * 1. SAL API → https://world.openfoodfacts.org/api/v3/search
 * 2. Legacy CGI API → https://world.openfoodfacts.org/cgi/search.pl
 * 
 * Цель: проверить, какой API даёт более точные результаты для нишевых продуктов
 */

import https from 'https';
import fs from 'fs';

// Тестовые продукты с известными кодами
const TEST_PRODUCTS = [
    {
        name: "Central Lechera Asturiana Nata Montada",
        query: "Central Lechera Asturiana nata montada",
        expectedBarcode: "8410297121104",
        description: "clásica, обычные сливки"
    },
    {
        name: "Central Lechera Asturiana Nata ligera",
        query: "Central Lechera Asturiana nata ligera",
        expectedBarcode: "8410297120176",
        description: "лёгкие сливки / líquida para cocinar"
    },
    {
        name: "Central Lechera Asturiana Nata montada sin lactosa",
        query: "Central Lechera Asturiana nata montada sin lactosa",
        expectedBarcode: "8410297121234",
        description: "безлактозные сливки"
    },
    {
        name: "Coca-Cola Zero Sugar (Asian)",
        query: "Coca-Cola Zero Sugar",
        expectedBarcode: "8851959132074",
        description: "азиатский код, встречался в тестах"
    },
    {
        name: "Coca-Cola Zero (European)",
        query: "Coca-Cola Zero",
        expectedBarcode: "5000112658637",
        description: "европейский код, Нидерланды, 250 мл"
    },
    {
        name: "Pepsi Max Cherry",
        query: "Pepsi Max Cherry",
        expectedBarcode: "5352201084422",
        description: "вишнёвая Pepsi Max"
    },
    {
        name: "Ben & Jerry's Chocolate Fudge Brownie",
        query: "Ben Jerry Chocolate Fudge Brownie",
        expectedBarcode: "0076840303236",
        description: "dairy ice cream"
    },
    {
        name: "Nutella",
        query: "Nutella hazelnut spread",
        expectedBarcode: "3017620422003",
        description: "classic spread"
    },
    {
        name: "H-E-B Red Kidney Beans",
        query: "red kidney beans water",
        expectedBarcode: "0644216479092",
        description: "fallback для Amazon brand"
    }
];

/**
 * Выполняет HTTP запрос и возвращает Promise с результатом
 */
function makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        
        const req = https.request(url, options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                const responseTime = Date.now() - startTime;
                try {
                    const parsedData = JSON.parse(data);
                    resolve({
                        data: parsedData,
                        responseTime,
                        statusCode: res.statusCode
                    });
                } catch (error) {
                    reject(new Error(`JSON parse error: ${error.message}`));
                }
            });
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        req.setTimeout(30000, () => {
            req.abort();
            reject(new Error('Request timeout'));
        });
        
        if (options.body) {
            req.write(options.body);
        }
        
        req.end();
    });
}

/**
 * Извлекает бренд из названия продукта для фильтрации SAL
 */
function extractBrandSlug(productName) {
    const brandMappings = {
        'Central Lechera Asturiana': 'central-lechera-asturiana',
        'Coca-Cola': 'coca-cola',
        'Pepsi': 'pepsi',
        'Ben & Jerry': 'ben-jerry-s',
        'Nutella': 'nutella',
        'H-E-B': 'h-e-b'
    };
    
    for (const [brand, slug] of Object.entries(brandMappings)) {
        if (productName.includes(brand)) {
            return slug;
        }
    }
    
    return null;
}

/**
 * Поиск через SAL API (v2) - канонический способ с пагинацией
 */
async function searchSAL(query, productName = '', maxPages = 10) {
    const url = 'https://search.openfoodfacts.org/search';
    
    // Извлекаем бренд для фильтрации
    const brandSlug = extractBrandSlug(productName);
    
    const allProducts = [];
    let totalResponseTime = 0;
    let totalResults = 0;
    
    console.log(`    🔍 SAL: поиск "${query}" с фильтром "${brandSlug || 'без фильтра'}"`);
    
    for (let page = 1; page <= maxPages; page++) {
        const requestBody = {
            q: query,
            page: page,
            page_size: 40,
            langs: ["es", "en"],
            boost_phrase: true
        };
        
        // Добавляем фильтр по бренду если найден
        if (brandSlug) {
            requestBody.filters = {
                brands_tags: [brandSlug]
            };
        }
        
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        };
        
        // Логируем отправленное тело для диагностики
        if (page === 1) {
            console.log(`    📤 SAL request body:`, JSON.stringify(requestBody, null, 2));
        }
        
        try {
            const result = await makeRequest(url, options);
            const pageProducts = result.data.hits || [];
            
            if (page === 1) {
                totalResults = result.data.count || 0;
                console.log(`    📊 SAL: всего результатов ${totalResults}, получаем до ${maxPages * 40}`);
            }
            
            allProducts.push(...pageProducts);
            totalResponseTime += result.responseTime;
            
            // Если продуктов меньше чем page_size, значит это последняя страница
            if (pageProducts.length < 40) {
                console.log(`    ⏹️ SAL: остановились на странице ${page} (получено ${pageProducts.length} продуктов)`);
                break;
            }
            
            // Небольшая пауза между страницами
            if (page < maxPages) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            
        } catch (error) {
            console.log(`    ❌ SAL: ошибка на странице ${page}: ${error.message}`);
            if (page === 1) {
                return {
                    success: false,
                    error: error.message,
                    products: [],
                    responseTime: null,
                    totalResults: 0,
                    brandFilter: brandSlug,
                    pagesProcessed: 0
                };
            }
            break;
        }
    }
    
    console.log(`    ✅ SAL: собрано ${allProducts.length} продуктов за ${totalResponseTime}мс`);
    
    return {
        success: true,
        products: allProducts,
        responseTime: totalResponseTime,
        totalResults: totalResults,
        brandFilter: brandSlug,
        pagesProcessed: Math.min(maxPages, Math.ceil(allProducts.length / 40))
    };
}

/**
 * Поиск через Legacy CGI API с правильными параметрами
 */
async function searchCGI(query, productName = '') {
    // Извлекаем бренд для фильтрации
    const brandSlug = extractBrandSlug(productName);
    const brandName = getBrandName(productName);
    
    let url = `https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1&search_terms=${encodeURIComponent(query)}&page_size=60`;
    
    // Добавляем фильтр по бренду если найден
    if (brandName) {
        url += `&tagtype_0=brands&tag_contains_0=contains&tag_0=${encodeURIComponent(brandName)}`;
    }
    
    // Добавляем поля для ускорения
    url += `&fields=code,brands,brands_tags,product_name,categories_tags,labels_tags`;
    
    console.log(`    🔍 CGI: поиск "${query}" с брендом "${brandName || 'без фильтра'}"`);
    console.log(`    📤 CGI URL: ${url}`);
    
    try {
        const result = await makeRequest(url);
        const products = result.data.products || [];
        const totalResults = result.data.count || products.length;
        
        console.log(`    ✅ CGI: получено ${products.length} продуктов за ${result.responseTime}мс`);
        
        return {
            success: true,
            products: products,
            responseTime: result.responseTime,
            totalResults: totalResults,
            brandFilter: brandName
        };
    } catch (error) {
        console.log(`    ❌ CGI: ошибка ${error.message}`);
        return {
            success: false,
            error: error.message,
            products: [],
            responseTime: null,
            totalResults: 0,
            brandFilter: brandName
        };
    }
}

/**
 * Получает полное название бренда для CGI фильтрации
 */
function getBrandName(productName) {
    const brandMappings = {
        'Central Lechera Asturiana': 'Central Lechera Asturiana',
        'Coca-Cola': 'Coca-Cola',
        'Pepsi': 'Pepsi',
        'Ben & Jerry': 'Ben & Jerry\'s',
        'Nutella': 'Nutella',
        'H-E-B': 'H-E-B'
    };
    
    for (const [brand, fullName] of Object.entries(brandMappings)) {
        if (productName.includes(brand)) {
            return fullName;
        }
    }
    
    return null;
}

/**
 * Анализирует результаты поиска для конкретного продукта
 */
function analyzeResults(testProduct, salResults, cgiResults) {
    const analysis = {
        product: testProduct.name,
        query: testProduct.query,
        expectedBarcode: testProduct.expectedBarcode,
        description: testProduct.description,
        sal: {
            success: salResults.success,
            responseTime: salResults.responseTime,
            totalResults: salResults.totalResults,
            targetPosition: -1,
            topResults: [],
            error: salResults.error || null
        },
        cgi: {
            success: cgiResults.success,
            responseTime: cgiResults.responseTime,
            totalResults: cgiResults.totalResults,
            targetPosition: -1,
            topResults: [],
            error: cgiResults.error || null
        },
        winner: null,
        notes: []
    };

    // Анализируем SAL результаты
    if (salResults.success && salResults.products.length > 0) {
        // Топ-5 результатов
        analysis.sal.topResults = salResults.products.slice(0, 5).map(p => ({
            code: p.code,
            name: p.product_name || 'N/A',
            brands: p.brands || 'N/A'
        }));

        // Ищем позицию целевого продукта
        const targetIndex = salResults.products.findIndex(p => p.code === testProduct.expectedBarcode);
        if (targetIndex !== -1) {
            analysis.sal.targetPosition = targetIndex + 1;
        }
    }

    // Анализируем CGI результаты
    if (cgiResults.success && cgiResults.products.length > 0) {
        // Топ-5 результатов
        analysis.cgi.topResults = cgiResults.products.slice(0, 5).map(p => ({
            code: p.code,
            name: p.product_name || 'N/A',
            brands: p.brands || 'N/A'
        }));

        // Ищем позицию целевого продукта
        const targetIndex = cgiResults.products.findIndex(p => p.code === testProduct.expectedBarcode);
        if (targetIndex !== -1) {
            analysis.cgi.targetPosition = targetIndex + 1;
        }
    }

    // Определяем победителя
    if (analysis.sal.targetPosition > 0 && analysis.cgi.targetPosition > 0) {
        if (analysis.sal.targetPosition < analysis.cgi.targetPosition) {
            analysis.winner = 'SAL';
            analysis.notes.push(`SAL нашёл продукт на позиции ${analysis.sal.targetPosition}, CGI на позиции ${analysis.cgi.targetPosition}`);
        } else if (analysis.cgi.targetPosition < analysis.sal.targetPosition) {
            analysis.winner = 'CGI';
            analysis.notes.push(`CGI нашёл продукт на позиции ${analysis.cgi.targetPosition}, SAL на позиции ${analysis.sal.targetPosition}`);
        } else {
            analysis.winner = 'TIE';
            analysis.notes.push(`Оба API нашли продукт на одинаковой позиции ${analysis.sal.targetPosition}`);
        }
    } else if (analysis.sal.targetPosition > 0) {
        analysis.winner = 'SAL';
        analysis.notes.push(`Только SAL нашёл продукт на позиции ${analysis.sal.targetPosition}`);
    } else if (analysis.cgi.targetPosition > 0) {
        analysis.winner = 'CGI';
        analysis.notes.push(`Только CGI нашёл продукт на позиции ${analysis.cgi.targetPosition}`);
    } else {
        analysis.winner = 'NONE';
        analysis.notes.push('Ни один API не нашёл целевой продукт');
    }

    // Добавляем заметки о производительности
    if (analysis.sal.responseTime && analysis.cgi.responseTime) {
        const faster = analysis.sal.responseTime < analysis.cgi.responseTime ? 'SAL' : 'CGI';
        const diff = Math.abs(analysis.sal.responseTime - analysis.cgi.responseTime);
        analysis.notes.push(`${faster} быстрее на ${diff}мс`);
    }

    return analysis;
}

/**
 * Генерирует сводный отчёт
 */
function generateSummaryReport(results) {
    const summary = {
        totalTests: results.length,
        salWins: 0,
        cgiWins: 0,
        ties: 0,
        noResults: 0,
        avgResponseTime: {
            sal: 0,
            cgi: 0
        },
        successRate: {
            sal: 0,
            cgi: 0
        }
    };

    let salResponseTimes = [];
    let cgiResponseTimes = [];
    let salSuccesses = 0;
    let cgiSuccesses = 0;

    results.forEach(result => {
        switch (result.winner) {
            case 'SAL':
                summary.salWins++;
                break;
            case 'CGI':
                summary.cgiWins++;
                break;
            case 'TIE':
                summary.ties++;
                break;
            case 'NONE':
                summary.noResults++;
                break;
        }

        if (result.sal.success) {
            salSuccesses++;
            if (result.sal.responseTime) {
                salResponseTimes.push(result.sal.responseTime);
            }
        }

        if (result.cgi.success) {
            cgiSuccesses++;
            if (result.cgi.responseTime) {
                cgiResponseTimes.push(result.cgi.responseTime);
            }
        }
    });

    summary.successRate.sal = (salSuccesses / summary.totalTests * 100).toFixed(1);
    summary.successRate.cgi = (cgiSuccesses / summary.totalTests * 100).toFixed(1);

    if (salResponseTimes.length > 0) {
        summary.avgResponseTime.sal = Math.round(salResponseTimes.reduce((a, b) => a + b, 0) / salResponseTimes.length);
    }

    if (cgiResponseTimes.length > 0) {
        summary.avgResponseTime.cgi = Math.round(cgiResponseTimes.reduce((a, b) => a + b, 0) / cgiResponseTimes.length);
    }

    return summary;
}

/**
 * Основная функция тестирования
 */
async function runComparison() {
    console.log('🔍 Запуск сравнительного тестирования SAL vs CGI API');
    console.log('=' .repeat(60));

    const results = [];

    for (let i = 0; i < TEST_PRODUCTS.length; i++) {
        const product = TEST_PRODUCTS[i];
        console.log(`\n[${i + 1}/${TEST_PRODUCTS.length}] Тестируем: ${product.name}`);
        console.log(`Query: "${product.query}"`);
        console.log(`Expected: ${product.expectedBarcode}`);

        // Выполняем поиск параллельно
        const [salResults, cgiResults] = await Promise.all([
            searchSAL(product.query, product.name, 10), // 10 страниц = до 400 продуктов
            searchCGI(product.query, product.name)       // 60 продуктов
        ]);

        // Анализируем результаты
        const analysis = analyzeResults(product, salResults, cgiResults);
        results.push(analysis);

        // Выводим краткие результаты
        const salInfo = analysis.sal.success ? 
            `собрано ${salResults.products.length} из ${analysis.sal.totalResults}, ${analysis.sal.responseTime}мс, ${salResults.pagesProcessed} стр${salResults.brandFilter ? ` (фильтр: ${salResults.brandFilter})` : ''}` : 
            `ОШИБКА: ${analysis.sal.error}`;
        const cgiInfo = analysis.cgi.success ? 
            `${analysis.cgi.totalResults} результатов, ${analysis.cgi.responseTime}мс${cgiResults.brandFilter ? ` (фильтр: ${cgiResults.brandFilter})` : ''}` : 
            `ОШИБКА: ${analysis.cgi.error}`;
            
        console.log(`📊 SAL: ${salInfo}`);
        console.log(`📊 CGI: ${cgiInfo}`);
        
        // Показываем позицию целевого продукта
        if (analysis.sal.targetPosition > 0) {
            console.log(`🎯 SAL: целевой продукт на позиции ${analysis.sal.targetPosition}`);
        }
        if (analysis.cgi.targetPosition > 0) {
            console.log(`🎯 CGI: целевой продукт на позиции ${analysis.cgi.targetPosition}`);
        }
        
        console.log(`🏆 Победитель: ${analysis.winner}`);
        
        if (analysis.notes.length > 0) {
            console.log(`📝 ${analysis.notes.join(', ')}`);
        }
        
        // Логируем первые коды для отладки
        if (analysis.sal.success && analysis.sal.topResults.length > 0) {
            console.log(`🔍 SAL топ-5 коды: ${analysis.sal.topResults.slice(0, 5).map(r => r.code).join(', ')}`);
        }
        if (analysis.cgi.success && analysis.cgi.topResults.length > 0) {
            console.log(`🔍 CGI топ-5 коды: ${analysis.cgi.topResults.slice(0, 5).map(r => r.code).join(', ')}`);
        }

        // Пауза между запросами чтобы не перегружать API
        if (i < TEST_PRODUCTS.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    // Генерируем сводный отчёт
    const summary = generateSummaryReport(results);

    console.log('\n' + '=' .repeat(60));
    console.log('📊 СВОДНЫЙ ОТЧЁТ');
    console.log('=' .repeat(60));
    console.log(`Всего тестов: ${summary.totalTests}`);
    console.log(`SAL побед: ${summary.salWins}`);
    console.log(`CGI побед: ${summary.cgiWins}`);
    console.log(`Ничьих: ${summary.ties}`);
    console.log(`Без результатов: ${summary.noResults}`);
    console.log(`\nУспешность запросов:`);
    console.log(`SAL: ${summary.successRate.sal}%`);
    console.log(`CGI: ${summary.successRate.cgi}%`);
    console.log(`\nСреднее время ответа:`);
    console.log(`SAL: ${summary.avgResponseTime.sal}мс`);
    console.log(`CGI: ${summary.avgResponseTime.cgi}мс`);

    // Сохраняем детальные результаты в JSON файл
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `sal-vs-cgi-results_${timestamp}.json`;
    
    const fullReport = {
        timestamp: new Date().toISOString(),
        summary,
        detailedResults: results
    };

    fs.writeFileSync(filename, JSON.stringify(fullReport, null, 2));
    console.log(`\n💾 Детальные результаты сохранены в: ${filename}`);

    // Рекомендации
    console.log('\n' + '=' .repeat(60));
    console.log('🎯 РЕКОМЕНДАЦИИ');
    console.log('=' .repeat(60));

    if (summary.salWins > summary.cgiWins) {
        console.log('✅ SAL API показывает лучшие результаты для большинства запросов');
        console.log('💡 Рекомендация: использовать SAL как основной API');
    } else if (summary.cgiWins > summary.salWins) {
        console.log('✅ CGI API показывает лучшие результаты для большинства запросов');
        console.log('💡 Рекомендация: рассмотреть переход на CGI API');
    } else {
        console.log('⚖️ Оба API показывают сопоставимые результаты');
        console.log('💡 Рекомендация: использовать гибридную стратегию');
    }

    if (summary.avgResponseTime.sal < summary.avgResponseTime.cgi) {
        console.log(`⚡ SAL быстрее в среднем на ${summary.avgResponseTime.cgi - summary.avgResponseTime.sal}мс`);
    } else if (summary.avgResponseTime.cgi < summary.avgResponseTime.sal) {
        console.log(`⚡ CGI быстрее в среднем на ${summary.avgResponseTime.sal - summary.avgResponseTime.cgi}мс`);
    }

    if (summary.noResults > 0) {
        console.log(`⚠️ Внимание: ${summary.noResults} продуктов не найдены ни одним API`);
        console.log('💡 Рекомендация: проверить запросы или рассмотреть дополнительные стратегии поиска');
    }
}

// Запуск тестирования
// Проверяем, запущен ли файл напрямую
const isMainModule = import.meta.url.startsWith('file:') && 
    import.meta.url.includes(process.argv[1]?.replace(/\\/g, '/'));

if (isMainModule || process.argv[1]?.endsWith('sal-vs-cgi-comparison.js')) {
    runComparison().catch(error => {
        console.error('❌ Ошибка при выполнении тестирования:', error);
        process.exit(1);
    });
}

export {
    runComparison,
    searchSAL,
    searchCGI,
    TEST_PRODUCTS
};
