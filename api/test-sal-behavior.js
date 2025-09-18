#!/usr/bin/env node

/**
 * Тест поведения SAL API для случая "nata montada" + "central-lechera-asturiana"
 * Цель: найти на какой странице появляется продукт 8410297121104
 */

import { runSearchV3 } from './modules/nutrition/off/client/search-sal.js';

const TARGET_BARCODE = '8410297121104';
const SEARCH_TERM = 'nata montada';
const BRAND_FILTER = 'central-lechera-asturiana';

// Максимальное количество страниц для поиска
const MAX_PAGES = 20;

async function findProductInResults(products, targetBarcode) {
  for (let i = 0; i < products.length; i++) {
    if (products[i]?.code === targetBarcode) {
      return i + 1; // позиция на странице (1-based)
    }
  }
  return null;
}

async function testDirectSearch() {
  console.log('\n=== ТЕСТ 1: Прямой поиск с брендом ===');
  console.log(`Поиск: "${SEARCH_TERM}" + бренд: "${BRAND_FILTER}"`);
  console.log(`Цель: найти продукт ${TARGET_BARCODE}\n`);

  let foundOnPage = null;
  let foundAtPosition = null;
  let totalProducts = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      console.log(`Проверяем страницу ${page}...`);
      
      const result = await runSearchV3(SEARCH_TERM, {
        brandFilter: BRAND_FILTER,
        page,
        pageSize: 50 // увеличим размер страницы
      });

      console.log(`  Найдено продуктов: ${result.products.length}, всего: ${result.count}`);
      
      if (result.products.length === 0) {
        console.log(`  Страница ${page} пуста, прекращаем поиск`);
        break;
      }

      totalProducts += result.products.length;
      
      // Показываем первые несколько продуктов для понимания
      if (page <= 3) {
        console.log('  Первые продукты на странице:');
        result.products.slice(0, 5).forEach((prod, idx) => {
          console.log(`    ${idx + 1}. ${prod.code} - ${prod.product_name} (${prod.brands})`);
        });
      }

      // Ищем целевой продукт
      const position = await findProductInResults(result.products, TARGET_BARCODE);
      if (position) {
        foundOnPage = page;
        foundAtPosition = position;
        console.log(`\n🎯 НАЙДЕН! Продукт ${TARGET_BARCODE} найден на странице ${page}, позиция ${position}`);
        break;
      }

    } catch (error) {
      console.error(`Ошибка на странице ${page}:`, error.message);
      break;
    }
  }

  if (!foundOnPage) {
    console.log(`\n❌ Продукт ${TARGET_BARCODE} НЕ НАЙДЕН в первых ${MAX_PAGES} страницах`);
    console.log(`Всего проверено продуктов: ${totalProducts}`);
  }

  return { foundOnPage, foundAtPosition, totalProducts };
}

async function testWithCategory() {
  console.log('\n=== ТЕСТ 2: Поиск с категорией ===');
  console.log(`Поиск: "${SEARCH_TERM}" + бренд: "${BRAND_FILTER}" + категория: "whipped-creams"`);

  try {
    const result = await runSearchV3(SEARCH_TERM, {
      brandFilter: BRAND_FILTER,
      filters: {
        categories_tags: ['whipped-creams']
      },
      page: 1,
      pageSize: 50
    });

    console.log(`Найдено продуктов с категорией: ${result.products.length}`);
    
    if (result.products.length > 0) {
      console.log('Продукты с категорией whipped-creams:');
      result.products.slice(0, 10).forEach((prod, idx) => {
        const isTarget = prod.code === TARGET_BARCODE ? ' 🎯' : '';
        console.log(`  ${idx + 1}. ${prod.code} - ${prod.product_name}${isTarget}`);
      });
    }

    const position = await findProductInResults(result.products, TARGET_BARCODE);
    if (position) {
      console.log(`\n🎯 С категорией НАЙДЕН на позиции ${position}!`);
    } else {
      console.log(`\n❌ С категорией НЕ НАЙДЕН`);
    }

    return { found: !!position, position, total: result.products.length };

  } catch (error) {
    console.error('Ошибка поиска с категорией:', error.message);
    return { found: false, error: error.message };
  }
}

async function testFallbackStrategy() {
  console.log('\n=== ТЕСТ 3: Fallback стратегия ===');
  console.log(`Поиск: '"nata montada"' (в кавычках) без бренда, но с категорией`);

  try {
    // Точный поиск в кавычках
    const result = await runSearchV3('"nata montada"', {
      filters: {
        categories_tags: ['whipped-creams']
      },
      page: 1,
      pageSize: 50
    });

    console.log(`Найдено продуктов при точном поиске: ${result.products.length}`);
    
    if (result.products.length > 0) {
      console.log('Продукты при точном поиске:');
      result.products.slice(0, 10).forEach((prod, idx) => {
        const isTarget = prod.code === TARGET_BARCODE ? ' 🎯' : '';
        const brand = prod.brands || 'без бренда';
        console.log(`  ${idx + 1}. ${prod.code} - ${prod.product_name} [${brand}]${isTarget}`);
      });
    }

    const position = await findProductInResults(result.products, TARGET_BARCODE);
    if (position) {
      console.log(`\n🎯 При точном поиске НАЙДЕН на позиции ${position}!`);
    } else {
      console.log(`\n❌ При точном поиске НЕ НАЙДЕН`);
    }

    return { found: !!position, position, total: result.products.length };

  } catch (error) {
    console.error('Ошибка fallback стратегии:', error.message);
    return { found: false, error: error.message };
  }
}

async function testAlternativeCategories() {
  console.log('\n=== ТЕСТ 4: Альтернативные категории ===');
  
  const categories = ['nata-montada', 'dairy-products', 'creams'];
  
  for (const category of categories) {
    console.log(`\nПробуем категорию: ${category}`);
    
    try {
      const result = await runSearchV3(SEARCH_TERM, {
        brandFilter: BRAND_FILTER,
        filters: {
          categories_tags: [category]
        },
        page: 1,
        pageSize: 20
      });

      console.log(`  Найдено: ${result.products.length} продуктов`);
      
      if (result.products.length > 0) {
        const position = await findProductInResults(result.products, TARGET_BARCODE);
        if (position) {
          console.log(`  🎯 НАЙДЕН на позиции ${position} в категории ${category}!`);
          return { found: true, category, position };
        }
      }
    } catch (error) {
      console.log(`  Ошибка для категории ${category}: ${error.message}`);
    }
  }
  
  return { found: false };
}

async function main() {
  console.log('🔍 ТЕСТ ПОВЕДЕНИЯ SAL API');
  console.log('=' * 50);
  
  try {
    // Тест 1: Прямой поиск
    const directResult = await testDirectSearch();
    
    // Тест 2: С категорией
    const categoryResult = await testWithCategory();
    
    // Тест 3: Fallback стратегия
    const fallbackResult = await testFallbackStrategy();
    
    // Тест 4: Альтернативные категории
    const altCategoriesResult = await testAlternativeCategories();
    
    // Итоговый отчёт
    console.log('\n' + '=' * 50);
    console.log('📊 ИТОГОВЫЙ ОТЧЁТ');
    console.log('=' * 50);
    
    console.log(`\n1. Прямой поиск с брендом:`);
    if (directResult.foundOnPage) {
      console.log(`   ✅ Найден на странице ${directResult.foundOnPage}, позиция ${directResult.foundAtPosition}`);
      console.log(`   📈 Глубина поиска: ${(directResult.foundOnPage - 1) * 50 + directResult.foundAtPosition} позиций`);
    } else {
      console.log(`   ❌ НЕ найден в ${MAX_PAGES} страницах (${directResult.totalProducts} продуктов)`);
    }
    
    console.log(`\n2. Поиск с категорией whipped-creams:`);
    if (categoryResult.found) {
      console.log(`   ✅ Найден на позиции ${categoryResult.position} из ${categoryResult.total}`);
    } else {
      console.log(`   ❌ НЕ найден среди ${categoryResult.total || 0} продуктов`);
    }
    
    console.log(`\n3. Точный поиск без бренда:`);
    if (fallbackResult.found) {
      console.log(`   ✅ Найден на позиции ${fallbackResult.position} из ${fallbackResult.total}`);
    } else {
      console.log(`   ❌ НЕ найден среди ${fallbackResult.total || 0} продуктов`);
    }
    
    console.log(`\n4. Альтернативные категории:`);
    if (altCategoriesResult.found) {
      console.log(`   ✅ Найден в категории "${altCategoriesResult.category}" на позиции ${altCategoriesResult.position}`);
    } else {
      console.log(`   ❌ НЕ найден ни в одной альтернативной категории`);
    }
    
    // Рекомендации
    console.log('\n🎯 РЕКОМЕНДАЦИИ:');
    if (directResult.foundOnPage && directResult.foundOnPage > 5) {
      console.log('- Продукт найден, но глубоко в результатах - нужно улучшить ранжирование');
    } else if (!directResult.foundOnPage && (categoryResult.found || fallbackResult.found)) {
      console.log('- Прямой поиск не работает, но fallback стратегии помогают');
    } else if (!directResult.foundOnPage && !categoryResult.found && !fallbackResult.found) {
      console.log('- Продукт может отсутствовать в индексе или иметь другие теги');
    }
    
  } catch (error) {
    console.error('Критическая ошибка:', error);
  }
}

// Запуск
main().catch(console.error);
