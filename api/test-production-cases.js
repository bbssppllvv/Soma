#!/usr/bin/env node

/**
 * Test Production Cases - реальные кейсы из продакшена
 * Воспроизводим точные проблемы и проверяем исправления
 */

import { resolveOneItemOFF } from './modules/nutrition/off-resolver.js';

// Отключаем агрессивный rate limiting для тестов
process.env.OFF_SEARCH_MAX_TOKENS = '100';
process.env.OFF_SEARCH_REFILL_MS = '1000';
process.env.OFF_GLOBAL_BUDGET_MS = '8000';

const PRODUCTION_CASES = [
  // ✅ SUCCESS CASE (для сравнения)
  {
    name: 'M&M\'s Success Case',
    item: {
      name: "m&m's",
      brand: "M&M's",
      brand_normalized: 'mms',
      clean_name: 'peanut butter',
      required_tokens: ['peanut', 'butter'],
      canonical_category: 'snack-sweet',
      confidence: 0.8,
      off_candidate: true
    },
    expected: {
      shouldFind: true,
      shouldHaveBrand: 'M&M\'s',
      shouldHaveTokens: ['peanut', 'butter'],
      minScore: 700
    }
  },
  
  // 🚨 PROBLEM CASE 1: Coca-Cola Zero skipped
  {
    name: 'Coca-Cola Zero Skipped',
    item: {
      name: 'Coca-Cola',
      brand: 'Coca-Cola',
      brand_normalized: 'cocacola',
      clean_name: 'Coca-Cola',
      required_tokens: ['zero'],
      canonical_category: 'beverage',
      confidence: 0.6,
      off_candidate: true
    },
    expected: {
      shouldFind: true,
      shouldHaveBrand: 'Coca-Cola',
      shouldHaveTokens: ['zero'],
      minScore: 500
    }
  },
  
  // 🚨 PROBLEM CASE 2: Central Lechera timeout
  {
    name: 'Central Lechera Semi Timeout',
    item: {
      name: 'Central Lechera Asturiana',
      brand: 'Central Lechera Asturiana',
      brand_normalized: 'central lechera asturiana',
      clean_name: 'leche semidesnatada',
      required_tokens: ['semi', 'desnatada', 'semidesnatada'],
      canonical_category: 'dairy',
      confidence: 0.9,
      off_candidate: true,
      locale: 'es'
    },
    expected: {
      shouldFind: true,
      shouldHaveBrand: 'Central Lechera',
      shouldHaveTokens: ['semi', 'desnatada'],
      minScore: 600
    }
  },
  
  // 🚨 PROBLEM CASE 3: Central Lechera Mantequilla timeout
  {
    name: 'Central Lechera Mantequilla Timeout',
    item: {
      name: 'Central Lechera Asturiana Mantequilla Tradicional',
      brand: 'Central Lechera Asturiana',
      brand_normalized: 'central lechera asturiana',
      clean_name: 'Mantequilla',
      required_tokens: ['tradicional'],
      canonical_category: 'dairy',
      confidence: 0.9,
      off_candidate: true,
      locale: 'es'
    },
    expected: {
      shouldFind: true,
      shouldHaveBrand: 'Central Lechera',
      shouldHaveTokens: ['tradicional'],
      minScore: 600
    }
  }
];

async function testProductionCase(testCase) {
  console.log(`\n🧪 ${testCase.name}`);
  console.log(`   Input: ${testCase.item.name}`);
  console.log(`   Brand: ${testCase.item.brand}`);
  console.log(`   Required tokens: [${testCase.item.required_tokens?.join(', ') || 'none'}]`);
  console.log(`   Confidence: ${testCase.item.confidence}`);
  
  const startTime = Date.now();
  
  try {
    const result = await resolveOneItemOFF(testCase.item);
    const duration = Date.now() - startTime;
    
    console.log(`   Duration: ${duration}ms`);
    
    if (result.product) {
      console.log(`   ✅ FOUND: ${result.product.product_name}`);
      console.log(`   🏷️ Brand: ${result.product.brands}`);
      console.log(`   📊 Score: ${result.score?.toFixed(0)}`);
      
      // Validate expectations
      const validation = validateResult(result, testCase.expected);
      console.log(`   🎯 Validation:`);
      console.log(`      Brand match: ${validation.brandMatch ? '✅' : '❌'}`);
      console.log(`      Required tokens: ${validation.tokensMatch ? '✅' : '❌'}`);
      console.log(`      Min score: ${validation.scoreOk ? '✅' : '❌'} (${result.score?.toFixed(0)} >= ${testCase.expected.minScore})`);
      
      if (validation.brandMatch && validation.tokensMatch && validation.scoreOk) {
        console.log(`   🏆 TEST PASSED!`);
        return { status: 'passed', duration, score: result.score };
      } else {
        console.log(`   🟡 TEST PARTIAL: Found product but validation failed`);
        return { status: 'partial', duration, score: result.score, issues: validation };
      }
      
    } else {
      console.log(`   ❌ NOT FOUND: ${result.reason}`);
      
      if (testCase.expected.shouldFind) {
        console.log(`   🚨 TEST FAILED: Expected to find product`);
        return { status: 'failed', duration, reason: result.reason };
      } else {
        console.log(`   ✅ TEST PASSED: Correctly rejected`);
        return { status: 'passed', duration, reason: result.reason };
      }
    }
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`   💥 ERROR: ${error.message}`);
    console.log(`   🚨 TEST FAILED: Unexpected error`);
    return { status: 'error', duration, error: error.message };
  }
}

function validateResult(result, expected) {
  const productName = result.product.product_name.toLowerCase();
  const brandName = (result.product.brands || '').toLowerCase();
  
  // Brand validation
  const brandMatch = expected.shouldHaveBrand ? 
    brandName.includes(expected.shouldHaveBrand.toLowerCase()) : true;
  
  // Required tokens validation
  const tokensMatch = expected.shouldHaveTokens ?
    expected.shouldHaveTokens.some(token => 
      productName.includes(token.toLowerCase())
    ) : true;
  
  // Score validation
  const scoreOk = result.score >= expected.minScore;
  
  return { brandMatch, tokensMatch, scoreOk };
}

async function runProductionTests() {
  console.log('🎯 Production Cases Test Suite');
  console.log('==============================');
  console.log('Testing real production issues with current fixes...\n');
  
  const results = [];
  
  for (const testCase of PRODUCTION_CASES) {
    const result = await testProductionCase(testCase);
    results.push({ testCase: testCase.name, ...result });
    
    // Realistic pause between tests
    console.log('   ⏳ Pause 10s...');
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  
  // Summary
  console.log('\n📊 PRODUCTION TEST SUMMARY:');
  console.log('===========================');
  
  let passed = 0;
  let failed = 0;
  let partial = 0;
  let errors = 0;
  
  for (const result of results) {
    const icon = result.status === 'passed' ? '✅' : 
                 result.status === 'partial' ? '🟡' : 
                 result.status === 'error' ? '💥' : '❌';
    
    console.log(`${icon} ${result.testCase}: ${result.status.toUpperCase()}`);
    
    if (result.status === 'passed') passed++;
    else if (result.status === 'failed') failed++;
    else if (result.status === 'partial') partial++;
    else errors++;
  }
  
  console.log(`\n🎯 FINAL RESULTS:`);
  console.log(`   Passed: ${passed}/${results.length}`);
  console.log(`   Partial: ${partial}/${results.length}`);
  console.log(`   Failed: ${failed}/${results.length}`);
  console.log(`   Errors: ${errors}/${results.length}`);
  
  const successRate = ((passed + partial) / results.length) * 100;
  console.log(`   Success Rate: ${successRate.toFixed(1)}%`);
  
  if (passed === results.length) {
    console.log('\n🏆 ALL TESTS PASSED! Ready for production!');
  } else if (successRate >= 75) {
    console.log('\n🟡 MOSTLY WORKING! Some issues remain but acceptable for production');
  } else {
    console.log('\n🚨 SIGNIFICANT ISSUES! Needs more fixes before production');
  }
  
  return results;
}

// Run if called directly
if (process.argv[1] && (
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === new URL(process.argv[1], 'file:').href
)) {
  runProductionTests().catch(console.error);
}

export { runProductionTests, PRODUCTION_CASES };
