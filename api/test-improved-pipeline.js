#!/usr/bin/env node

/**
 * Тест улучшенного пайплайна поиска
 * Проверяем динамическую глубину, brand boost и rescue стратегии
 */

import { resolveOneItemOFF } from './modules/nutrition/off-resolver.js';

// Тестовые кейсы из реальных проблем
const testCases = [
  {
    name: 'Central Lechera Asturiana Nata Montada',
    item: {
      name: 'nata montada',
      brand: 'Central Lechera Asturiana',
      off_primary_tokens: ['nata', 'montada'],
      off_brand_filter: 'central-lechera-asturiana',
      locale: 'es'
    },
    expectedCode: '8410297121104',
    description: 'Основной проблемный кейс - продукт на 10-й странице'
  },
  {
    name: 'Generic Brand Test',
    item: {
      name: 'chocolate milk',
      brand: 'Hacendado',
      off_primary_tokens: ['chocolate', 'milk'],
      off_brand_filter: 'hacendado',
      locale: 'es'
    },
    expectedCode: null, // Не знаем точный код, но проверим качество
    description: 'Тест для сравнения - популярный бренд'
  },
  {
    name: 'Rescue Strategy Test',
    item: {
      name: 'organic almond milk unsweetened',
      brand: 'SomeUnknownBrand',
      off_primary_tokens: ['organic', 'almond', 'milk'],
      off_brand_filter: 'some-unknown-brand',
      off_neg_tokens: ['sweetened'],
      locale: 'en'
    },
    expectedCode: null,
    description: 'Тест rescue стратегии с неизвестным брендом'
  }
];

async function runSingleTest(testCase, index) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`ТЕСТ ${index + 1}: ${testCase.name}`);
  console.log(`Описание: ${testCase.description}`);
  console.log(`Ожидаемый код: ${testCase.expectedCode || 'неизвестен'}`);
  console.log(`${'='.repeat(60)}`);

  const startTime = Date.now();
  
  try {
    const result = await resolveOneItemOFF(testCase.item);
    const duration = Date.now() - startTime;
    
    console.log('\n📊 РЕЗУЛЬТАТ:');
    
    if (result?.product) {
      const product = result.product;
      const isExpectedMatch = testCase.expectedCode ? 
        product.code === testCase.expectedCode : false;
      
      console.log(`✅ Найден продукт: ${product.code}`);
      console.log(`📝 Название: ${product.product_name}`);
      console.log(`🏷️ Бренд: ${product.brands || 'не указан'}`);
      console.log(`⭐ Скор: ${result.score || 'неизвестен'}`);
      console.log(`🎯 Точность: ${result.confidence || 'неизвестна'}`);
      console.log(`⏱️ Время: ${duration}ms`);
      
      if (testCase.expectedCode) {
        if (isExpectedMatch) {
          console.log('🎉 УСПЕХ: Найден ожидаемый продукт!');
        } else {
          console.log(`❌ ОШИБКА: Ожидался ${testCase.expectedCode}, получен ${product.code}`);
        }
      }
      
      return {
        success: true,
        foundExpected: isExpectedMatch,
        code: product.code,
        duration,
        score: result.score,
        confidence: result.confidence
      };
      
    } else {
      console.log('❌ Продукт не найден');
      console.log(`⏱️ Время: ${duration}ms`);
      
      if (result?.failure) {
        console.log(`🔍 Причина: ${result.failure.reason}`);
      }
      
      return {
        success: false,
        foundExpected: false,
        duration,
        reason: result?.failure?.reason || 'unknown'
      };
    }
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`💥 ОШИБКА: ${error.message}`);
    console.log(`⏱️ Время: ${duration}ms`);
    
    return {
      success: false,
      foundExpected: false,
      duration,
      error: error.message
    };
  }
}

async function runBenchmark() {
  console.log('🚀 ТЕСТИРОВАНИЕ УЛУЧШЕННОГО ПАЙПЛАЙНА');
  console.log('Проверяем динамическую глубину, brand boost и rescue стратегии');
  
  const results = [];
  
  for (let i = 0; i < testCases.length; i++) {
    const result = await runSingleTest(testCases[i], i);
    results.push({
      testCase: testCases[i].name,
      ...result
    });
    
    // Пауза между тестами
    if (i < testCases.length - 1) {
      console.log('\n⏳ Пауза 2 секунды...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  // Итоговый отчёт
  console.log(`\n${'='.repeat(80)}`);
  console.log('📈 ИТОГОВЫЙ ОТЧЁТ');
  console.log(`${'='.repeat(80)}`);
  
  const successful = results.filter(r => r.success);
  const expectedMatches = results.filter(r => r.foundExpected);
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
  
  console.log(`\n📊 Общая статистика:`);
  console.log(`  Всего тестов: ${results.length}`);
  console.log(`  Успешных: ${successful.length} (${(successful.length/results.length*100).toFixed(1)}%)`);
  console.log(`  Точных совпадений: ${expectedMatches.length}`);
  console.log(`  Среднее время: ${avgDuration.toFixed(0)}ms`);
  
  console.log(`\n📋 Детали по тестам:`);
  results.forEach((result, idx) => {
    const status = result.success ? '✅' : '❌';
    const expected = result.foundExpected ? '🎯' : '';
    const time = `${result.duration}ms`;
    console.log(`  ${idx + 1}. ${status} ${result.testCase} ${expected} (${time})`);
    
    if (result.error) {
      console.log(`     💥 ${result.error}`);
    } else if (!result.success && result.reason) {
      console.log(`     🔍 ${result.reason}`);
    }
  });
  
  console.log(`\n🎯 Ключевые улучшения:`);
  console.log(`  • Динамическая глубина поиска до 20 страниц для brand+variant`);
  console.log(`  • Brand boost множитель ${process.env.OFF_BRAND_BOOST_MULTIPLIER || 2.0}x`);
  console.log(`  • Улучшенные rescue стратегии с точным поиском`);
  console.log(`  • Раннее завершение при достижении качественных результатов`);
  
  // Проверим основной кейс
  const mainTest = results.find(r => r.testCase.includes('Central Lechera'));
  if (mainTest) {
    console.log(`\n🎯 ОСНОВНОЙ КЕЙС (Central Lechera Asturiana):`);
    if (mainTest.foundExpected) {
      console.log(`  ✅ РЕШЁН! Продукт найден за ${mainTest.duration}ms`);
    } else if (mainTest.success) {
      console.log(`  ⚠️ Найден другой продукт: ${mainTest.code}`);
      console.log(`  💡 Возможно, нужна дополнительная настройка`);
    } else {
      console.log(`  ❌ Продукт всё ещё не найден`);
      console.log(`  🔧 Требуются дополнительные улучшения`);
    }
  }
  
  return results;
}

// Запуск
if (import.meta.url === `file://${process.argv[1]}`) {
  runBenchmark()
    .then(results => {
      console.log('\n✨ Тестирование завершено!');
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 Критическая ошибка:', error);
      process.exit(1);
    });
}
