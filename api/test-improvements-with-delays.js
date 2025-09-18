#!/usr/bin/env node

/**
 * Тест улучшений SAL API с правильными задержками
 * Учитываем rate limits и даём API отдохнуть
 */

import { runSearchV3 } from './modules/nutrition/off/client/search-sal.js';

const TARGET_BARCODE = '8410297121104';
const SEARCH_TERM = 'nata montada';
const BRAND_FILTER = 'central-lechera-asturiana';

// Настройки для бережного тестирования
const DELAY_BETWEEN_REQUESTS = 2000; // 2 секунды между запросами
const DELAY_BETWEEN_TESTS = 5000; // 5 секунд между тестами
const MAX_PAGES_TO_TEST = 12; // Ограничим до 12 страниц

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function findProductInPages(searchTerm, brandFilter, maxPages, testName) {
  console.log(`\n=== ${testName} ===`);
  console.log(`Поиск: "${searchTerm}" + бренд: "${brandFilter || 'без бренда'}"`);
  console.log(`Максимум страниц: ${maxPages}`);
  
  let foundOnPage = null;
  let foundAtPosition = null;
  let totalProducts = 0;
  
  for (let page = 1; page <= maxPages; page++) {
    try {
      console.log(`\n🔍 Проверяем страницу ${page}...`);
      
      const searchOptions = {
        page,
        pageSize: 50
      };
      
      if (brandFilter) {
        searchOptions.brandFilter = brandFilter;
      }
      
      const result = await runSearchV3(searchTerm, searchOptions);
      
      if (result.products.length === 0) {
        console.log(`  📭 Страница ${page} пуста, прекращаем поиск`);
        break;
      }
      
      console.log(`  📊 Найдено: ${result.products.length} продуктов (всего в базе: ${result.count})`);
      totalProducts += result.products.length;
      
      // Показываем первые несколько продуктов для понимания качества
      if (page <= 3) {
        console.log(`  📋 Топ-3 продукта на странице:`);
        result.products.slice(0, 3).forEach((prod, idx) => {
          const brand = prod.brands || 'без бренда';
          console.log(`    ${idx + 1}. ${prod.code} - ${prod.product_name} [${brand}]`);
        });
      }
      
      // Ищем целевой продукт
      const position = result.products.findIndex(prod => prod.code === TARGET_BARCODE);
      if (position >= 0) {
        foundOnPage = page;
        foundAtPosition = position + 1;
        console.log(`\n🎯 НАЙДЕН! Продукт ${TARGET_BARCODE} на странице ${page}, позиция ${position + 1}`);
        console.log(`📈 Общая позиция в результатах: ${(page - 1) * 50 + position + 1}`);
        break;
      }
      
      // Задержка между запросами для соблюдения rate limits
      if (page < maxPages) {
        console.log(`  ⏳ Пауза ${DELAY_BETWEEN_REQUESTS/1000}с перед следующим запросом...`);
        await delay(DELAY_BETWEEN_REQUESTS);
      }
      
    } catch (error) {
      console.error(`  ❌ Ошибка на странице ${page}: ${error.message}`);
      
      if (error.message.includes('aborted') || error.message.includes('timeout')) {
        console.log(`  🔄 Увеличиваем задержку и пробуем ещё раз...`);
        await delay(5000); // 5 секунд при таймауте
        
        // Повторная попытка
        try {
          const result = await runSearchV3(searchTerm, searchOptions);
          console.log(`  ✅ Повторная попытка успешна: ${result.products.length} продуктов`);
          
          const position = result.products.findIndex(prod => prod.code === TARGET_BARCODE);
          if (position >= 0) {
            foundOnPage = page;
            foundAtPosition = position + 1;
            console.log(`\n🎯 НАЙДЕН при повторе! Продукт ${TARGET_BARCODE} на странице ${page}, позиция ${position + 1}`);
            break;
          }
        } catch (retryError) {
          console.error(`  💥 Повторная попытка не удалась: ${retryError.message}`);
          break;
        }
      } else {
        break;
      }
    }
  }
  
  return {
    found: foundOnPage !== null,
    page: foundOnPage,
    position: foundAtPosition,
    totalChecked: totalProducts,
    overallPosition: foundOnPage ? (foundOnPage - 1) * 50 + foundAtPosition : null
  };
}

async function testRescueStrategies() {
  console.log(`\n=== ТЕСТ RESCUE СТРАТЕГИЙ ===`);
  
  const rescueTests = [
    {
      name: 'Точный поиск без бренда',
      query: '"nata montada"',
      options: { pageSize: 30 }
    },
    {
      name: 'Простой поиск без кавычек и без бренда',
      query: 'nata montada',
      options: { pageSize: 30 }
    },
    {
      name: 'Поиск с категорией whipped-creams',
      query: 'nata montada',
      options: {
        pageSize: 30,
        filters: { categories_tags: ['whipped-creams'] }
      }
    }
  ];
  
  for (const test of rescueTests) {
    try {
      console.log(`\n🔍 ${test.name}:`);
      console.log(`  Запрос: "${test.query}"`);
      
      const result = await runSearchV3(test.query, test.options);
      
      console.log(`  📊 Результатов: ${result.products.length}`);
      
      if (result.products.length > 0) {
        const position = result.products.findIndex(prod => prod.code === TARGET_BARCODE);
        if (position >= 0) {
          console.log(`  🎯 НАЙДЕН на позиции ${position + 1}!`);
        } else {
          console.log(`  📋 Топ-5 результатов:`);
          result.products.slice(0, 5).forEach((prod, idx) => {
            const brand = prod.brands || 'без бренда';
            console.log(`    ${idx + 1}. ${prod.code} - ${prod.product_name} [${brand}]`);
          });
        }
      } else {
        console.log(`  📭 Нет результатов`);
      }
      
      // Пауза между rescue тестами
      await delay(3000);
      
    } catch (error) {
      console.error(`  ❌ Ошибка: ${error.message}`);
    }
  }
}

async function main() {
  console.log('🚀 ТЕСТ УЛУЧШЕНИЙ SAL API С ПРАВИЛЬНЫМИ ЗАДЕРЖКАМИ');
  console.log('=' * 60);
  console.log(`Цель: найти продукт ${TARGET_BARCODE} (Central Lechera Asturiana Nata Montada)`);
  console.log(`Задержка между запросами: ${DELAY_BETWEEN_REQUESTS/1000}с`);
  console.log(`Задержка между тестами: ${DELAY_BETWEEN_TESTS/1000}с`);
  
  try {
    // Тест 1: Стандартный поиск с брендом (первые 5 страниц)
    const standardResult = await findProductInPages(
      SEARCH_TERM, 
      BRAND_FILTER, 
      5, 
      'ТЕСТ 1: Стандартный поиск (5 страниц)'
    );
    
    await delay(DELAY_BETWEEN_TESTS);
    
    // Тест 2: Расширенный поиск с брендом (до 12 страниц)
    let extendedResult = null;
    if (!standardResult.found) {
      extendedResult = await findProductInPages(
        SEARCH_TERM, 
        BRAND_FILTER, 
        MAX_PAGES_TO_TEST, 
        'ТЕСТ 2: Расширенный поиск (до 12 страниц)'
      );
      
      await delay(DELAY_BETWEEN_TESTS);
    }
    
    // Тест 3: Rescue стратегии
    await testRescueStrategies();
    
    // Итоговый отчёт
    console.log(`\n${'='.repeat(60)}`);
    console.log('📊 ИТОГОВЫЙ ОТЧЁТ');
    console.log(`${'='.repeat(60)}`);
    
    console.log(`\n1️⃣ Стандартный поиск (5 страниц):`);
    if (standardResult.found) {
      console.log(`   ✅ НАЙДЕН на странице ${standardResult.page}, позиция ${standardResult.position}`);
      console.log(`   📈 Общая позиция: ${standardResult.overallPosition}`);
      console.log(`   💡 Результат: Стандартная глубина достаточна`);
    } else {
      console.log(`   ❌ НЕ НАЙДЕН в первых 5 страницах`);
      console.log(`   📊 Проверено продуктов: ${standardResult.totalChecked}`);
    }
    
    if (extendedResult) {
      console.log(`\n2️⃣ Расширенный поиск (до ${MAX_PAGES_TO_TEST} страниц):`);
      if (extendedResult.found) {
        console.log(`   ✅ НАЙДЕН на странице ${extendedResult.page}, позиция ${extendedResult.position}`);
        console.log(`   📈 Общая позиция: ${extendedResult.overallPosition}`);
        console.log(`   💡 Результат: Увеличенная глубина помогает!`);
      } else {
        console.log(`   ❌ НЕ НАЙДЕН даже при расширенном поиске`);
        console.log(`   📊 Проверено продуктов: ${extendedResult.totalChecked}`);
      }
    }
    
    console.log(`\n🎯 ВЫВОДЫ:`);
    const mainFound = standardResult.found || (extendedResult && extendedResult.found);
    if (mainFound) {
      const result = standardResult.found ? standardResult : extendedResult;
      if (result.page <= 5) {
        console.log(`   ✅ Продукт найден в стандартной зоне поиска`);
      } else {
        console.log(`   🔧 Продукт найден только при увеличенной глубине`);
        console.log(`   💡 РЕКОМЕНДАЦИЯ: Увеличить MAX_SEARCH_PAGES до ${Math.max(result.page + 2, 12)}`);
      }
    } else {
      console.log(`   🔍 Продукт не найден при прямом поиске с брендом`);
      console.log(`   💡 РЕКОМЕНДАЦИЯ: Активировать rescue стратегии раньше`);
    }
    
  } catch (error) {
    console.error('💥 Критическая ошибка:', error);
  }
  
  console.log('\n✨ Тестирование завершено!');
}

// Запуск
main().catch(console.error);
