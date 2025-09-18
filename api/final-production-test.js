#!/usr/bin/env node

/**
 * Final Production Test - быстрая проверка всех исправлений
 */

import { resolveOneItemOFF } from './modules/nutrition/off-resolver.js';

// Отключаем rate limiting для тестов
process.env.OFF_SEARCH_MAX_TOKENS = '100';
process.env.OFF_SEARCH_REFILL_MS = '1000';

async function quickTest() {
  console.log('🎯 FINAL PRODUCTION TEST');
  console.log('========================\n');
  
  const tests = [
    {
      name: 'M&M\'s Peanut',
      item: {
        name: "m&m's",
        brand: "M&M's",
        clean_name: 'peanut butter',
        required_tokens: ['peanut', 'butter'],
        canonical_category: 'snack-sweet',
        confidence: 0.8
      }
    },
    {
      name: 'Central Lechera Mantequilla',
      item: {
        name: 'Central Lechera Asturiana Mantequilla Tradicional',
        brand: 'Central Lechera Asturiana',
        clean_name: 'Mantequilla',
        required_tokens: ['tradicional'],
        canonical_category: 'dairy',
        confidence: 0.9
      }
    }
  ];
  
  for (const test of tests) {
    console.log(`🧪 ${test.name}`);
    
    try {
      const result = await resolveOneItemOFF(test.item);
      
      if (result.product) {
        console.log(`   ✅ FOUND: ${result.product.product_name}`);
        console.log(`   📊 Score: ${result.score?.toFixed(0)}`);
        
        const hasTokens = test.item.required_tokens.some(token => 
          result.product.product_name.toLowerCase().includes(token)
        );
        console.log(`   🎯 Required tokens: ${hasTokens ? '✅ YES' : '❌ NO'}`);
        
      } else {
        console.log(`   ❌ ${result.reason}`);
      }
      
    } catch (error) {
      console.log(`   💥 ${error.message}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  console.log('\n🏆 Test complete!');
}

quickTest();
