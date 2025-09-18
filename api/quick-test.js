#!/usr/bin/env node

/**
 * 🧪 Быстрый тест улучшений для конкретных продуктов
 * Использование: node quick-test.js "product name" "brand name"
 */

import { resolveOneItemOFF } from './modules/nutrition/off-resolver.js';

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log(`
🧪 БЫСТРЫЙ ТЕСТ УЛУЧШЕНИЙ SAL API

Использование:
  node quick-test.js "название продукта" "бренд"

Примеры:
  node quick-test.js "nata montada" "Central Lechera Asturiana"
  node quick-test.js "chocolate con leche" "Hacendado"  
  node quick-test.js "yogur natural" "Danone"

Переменные окружения (опционально):
  OFF_BRAND_VARIANT_MAX_PAGES=15
  OFF_BRAND_BOOST_MULTIPLIER=2.0
  `);
  process.exit(1);
}

const [productName, brandName] = args;

// Подготавливаем тестовый item
const testItem = {
  name: productName,
  brand: brandName,
  off_primary_tokens: productName.toLowerCase().split(' ').slice(0, 3),
  off_brand_filter: brandName.toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9\s-]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, ''),
  locale: 'es'
};

console.log('🔍 ТЕСТ ПОИСКА ПРОДУКТА');
console.log('=' * 50);
console.log(`📦 Продукт: "${productName}"`);
console.log(`🏷️  Бренд: "${brandName}"`);
console.log(`🔤 Brand filter: "${testItem.off_brand_filter}"`);
console.log(`🎯 Primary tokens: ${testItem.off_primary_tokens.join(', ')}`);

// Показываем активные настройки
console.log('\n⚙️  НАСТРОЙКИ:');
console.log(`  MAX_BRAND_VARIANT_PAGES: ${process.env.OFF_BRAND_VARIANT_MAX_PAGES || 20} (default: 20)`);
console.log(`  BRAND_BOOST_MULTIPLIER: ${process.env.OFF_BRAND_BOOST_MULTIPLIER || 2.0} (default: 2.0)`);
console.log(`  SEARCH_MAX_PAGES: ${process.env.OFF_SEARCH_MAX_PAGES || 5} (default: 5)`);

console.log('\n🚀 Запуск поиска...\n');

const startTime = Date.now();

try {
  const result = await resolveOneItemOFF(testItem);
  const duration = Date.now() - startTime;
  
  console.log('\n' + '=' * 50);
  console.log('📊 РЕЗУЛЬТАТ');
  console.log('=' * 50);
  
  if (result?.product) {
    const product = result.product;
    
    console.log(`✅ НАЙДЕН ПРОДУКТ!`);
    console.log(`📋 Код: ${product.code}`);
    console.log(`📝 Название: ${product.product_name}`);
    console.log(`🏷️  Бренды: ${product.brands || 'не указаны'}`);
    console.log(`⭐ Скор: ${result.score?.toFixed(2) || 'неизвестен'}`);
    console.log(`🎯 Уверенность: ${result.confidence?.toFixed(2) || 'неизвестна'}`);
    console.log(`⏱️  Время поиска: ${duration}ms`);
    
    // Дополнительная информация о продукте
    if (product.categories_tags?.length > 0) {
      console.log(`📂 Категории: ${product.categories_tags.slice(0, 3).join(', ')}`);
    }
    
    if (product.nutrition_grade_fr) {
      console.log(`🥗 Nutri-Score: ${product.nutrition_grade_fr.toUpperCase()}`);
    }
    
    // Ссылка на продукт
    console.log(`🔗 OFF URL: https://world.openfoodfacts.org/product/${product.code}`);
    
    // Оценка результата
    console.log('\n🎯 ОЦЕНКА:');
    if (duration < 5000) {
      console.log('  ⚡ Отличная скорость поиска');
    } else if (duration < 15000) {
      console.log('  ✅ Нормальная скорость поиска');
    } else {
      console.log('  ⚠️  Медленный поиск - проверьте настройки');
    }
    
    if (result.confidence > 0.8) {
      console.log('  🎯 Высокая уверенность в результате');
    } else if (result.confidence > 0.6) {
      console.log('  ✅ Хорошая уверенность в результате');
    } else {
      console.log('  ⚠️  Низкая уверенность - возможно неточный результат');
    }
    
  } else {
    console.log(`❌ ПРОДУКТ НЕ НАЙДЕН`);
    console.log(`⏱️  Время поиска: ${duration}ms`);
    
    if (result?.failure) {
      console.log(`🔍 Причина: ${result.failure.reason}`);
      console.log(`📝 Детали: ${result.failure.canonical || 'нет данных'}`);
    }
    
    console.log('\n💡 РЕКОМЕНДАЦИИ:');
    console.log('  • Проверьте правильность названия продукта');
    console.log('  • Попробуйте упростить название (убрать лишние слова)');
    console.log('  • Проверьте правильность написания бренда');
    console.log('  • Возможно продукт отсутствует в базе OFF');
  }
  
} catch (error) {
  const duration = Date.now() - startTime;
  
  console.log('\n' + '=' * 50);
  console.log('💥 ОШИБКА');
  console.log('=' * 50);
  console.log(`❌ ${error.message}`);
  console.log(`⏱️  Время до ошибки: ${duration}ms`);
  
  console.log('\n🔧 ВОЗМОЖНЫЕ РЕШЕНИЯ:');
  console.log('  • Проверьте подключение к интернету');
  console.log('  • Убедитесь что search.openfoodfacts.org доступен');
  console.log('  • Попробуйте ещё раз через несколько секунд');
}

console.log('\n✨ Тест завершён!');
