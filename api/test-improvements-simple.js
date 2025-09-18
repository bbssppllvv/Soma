#!/usr/bin/env node

/**
 * Простой тест улучшений SAL API
 */

import { runSearchV3 } from './modules/nutrition/off/client/search-sal.js';

async function testImprovements() {
  console.log('🔍 ТЕСТ УЛУЧШЕНИЙ SAL API');
  console.log('Проверяем поведение с увеличенной глубиной поиска');
  
  const TARGET_BARCODE = '8410297121104';
  const SEARCH_TERM = 'nata montada';
  const BRAND_FILTER = 'central-lechera-asturiana';
  
  // Тест 1: Стандартная глубина (5 страниц)
  console.log('\n=== ТЕСТ 1: Стандартная глубина (5 страниц) ===');
  let found = false;
  for (let page = 1; page <= 5; page++) {
    try {
      const result = await runSearchV3(SEARCH_TERM, {
        brandFilter: BRAND_FILTER,
        page,
        pageSize: 50
      });
      
      console.log(`Страница ${page}: ${result.products.length} продуктов`);
      
      const position = result.products.findIndex(prod => prod.code === TARGET_BARCODE);
      if (position >= 0) {
        console.log(`🎯 НАЙДЕН на странице ${page}, позиция ${position + 1}!`);
        found = true;
        break;
      }
    } catch (error) {
      console.error(`Ошибка на странице ${page}:`, error.message);
      break;
    }
  }
  
  if (!found) {
    console.log('❌ НЕ найден в первых 5 страницах');
  }
  
  // Тест 2: Увеличенная глубина (до 20 страниц)
  console.log('\n=== ТЕСТ 2: Увеличенная глубина (до 20 страниц) ===');
  found = false;
  for (let page = 6; page <= 20; page++) {
    try {
      const result = await runSearchV3(SEARCH_TERM, {
        brandFilter: BRAND_FILTER,
        page,
        pageSize: 50
      });
      
      if (result.products.length === 0) {
        console.log(`Страница ${page}: пуста, прекращаем поиск`);
        break;
      }
      
      console.log(`Страница ${page}: ${result.products.length} продуктов`);
      
      const position = result.products.findIndex(prod => prod.code === TARGET_BARCODE);
      if (position >= 0) {
        console.log(`🎯 НАЙДЕН на странице ${page}, позиция ${position + 1}!`);
        console.log(`📈 Общая позиция: ${(page - 1) * 50 + position + 1}`);
        found = true;
        break;
      }
    } catch (error) {
      console.error(`Ошибка на странице ${page}:`, error.message);
      break;
    }
    
    // Небольшая пауза между запросами
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  if (!found) {
    console.log('❌ НЕ найден даже в расширенном поиске');
  }
  
  // Тест 3: Rescue стратегия - точный поиск без бренда
  console.log('\n=== ТЕСТ 3: Rescue стратегия ===');
  try {
    const result = await runSearchV3('"nata montada"', {
      page: 1,
      pageSize: 50,
      filters: {
        categories_tags: ['whipped-creams', 'dairy-products']
      }
    });
    
    console.log(`Rescue поиск: ${result.products.length} продуктов`);
    
    if (result.products.length > 0) {
      console.log('Топ-5 результатов rescue поиска:');
      result.products.slice(0, 5).forEach((prod, idx) => {
        const isTarget = prod.code === TARGET_BARCODE ? ' 🎯' : '';
        console.log(`  ${idx + 1}. ${prod.code} - ${prod.product_name}${isTarget}`);
      });
      
      const position = result.products.findIndex(prod => prod.code === TARGET_BARCODE);
      if (position >= 0) {
        console.log(`🎯 Rescue стратегия УСПЕШНА! Позиция ${position + 1}`);
      }
    }
  } catch (error) {
    console.error('Ошибка rescue стратегии:', error.message);
  }
  
  console.log('\n✅ Тест завершён');
}

// Запуск
testImprovements().catch(console.error);
