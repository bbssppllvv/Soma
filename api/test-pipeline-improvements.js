#!/usr/bin/env node

// Test script for pipeline improvements
// Tests: Rescue Queries, Split-OR, and Attribute Handling

import { resolveOneItemOFF } from './modules/nutrition/off-resolver.js';

const TEST_CASES = [
  // Test Case 1: Nata (classic vs sin lactosa vs light/spray) - rescue should find "clean" SKU
  {
    name: 'Central Lechera Asturiana Nata Montada Clásica',
    brand: 'Central Lechera Asturiana',
    brand_normalized: 'central lechera asturiana',
    clean_name: 'nata',
    required_tokens: ['montada'],
    off_primary_tokens: ['nata montada'],
    off_alt_tokens: ['clasica', 'traditional'],
    off_neg_tokens: ['light', 'sin lactosa', 'spray'],
    off_attr_want: ['traditional', 'classic', 'full-fat'],
    off_attr_avoid: ['light', 'spray', 'low-fat'],
    locale: 'es',
    expected: 'Should find traditional nata montada, avoid light/spray variants'
  },

  // Test Case 2: Nutella - split-OR should handle multiple fallback phrases
  {
    name: 'Nutella Hazelnut Spread',
    brand: 'Nutella',
    brand_normalized: 'nutella',
    clean_name: 'spread',
    required_tokens: ['hazelnut'],
    off_primary_tokens: ['nutella', 'hazelnut spread'],
    off_alt_tokens: ['chocolate spread', 'cocoa spread', 'nut spread', 'breakfast spread', 'sweet spread'],
    off_neg_tokens: ['sugar-free', 'diet', 'organic'],
    off_attr_want: ['original', 'classic', 'traditional'],
    off_attr_avoid: ['diet', 'sugar-free', 'organic'],
    locale: 'en',
    expected: 'Should use split-OR for multiple alt_tokens and find classic Nutella'
  },

  // Test Case 3: Coke - should work normally (positive case)
  {
    name: 'Coca-Cola Classic',
    brand: 'Coca-Cola',
    brand_normalized: 'coca-cola',
    clean_name: 'cola',
    required_tokens: [],
    off_primary_tokens: ['coca cola', 'coca-cola'],
    off_alt_tokens: ['coke', 'classic cola'],
    off_neg_tokens: ['zero', 'diet', 'light'],
    off_attr_want: ['classic', 'original', 'regular'],
    off_attr_avoid: ['zero', 'diet', 'light'],
    locale: 'en',
    expected: 'Should find classic Coca-Cola, avoid diet variants'
  },

  // Test Case 4: Pepsi - another positive case
  {
    name: 'Pepsi Cola Regular',
    brand: 'Pepsi',
    brand_normalized: 'pepsi',
    clean_name: 'cola',
    required_tokens: [],
    off_primary_tokens: ['pepsi'],
    off_alt_tokens: ['pepsi cola', 'cola'],
    off_neg_tokens: ['max', 'zero', 'diet'],
    off_attr_want: ['regular', 'classic', 'original'],
    off_attr_avoid: ['max', 'zero', 'diet'],
    locale: 'en',
    expected: 'Should find regular Pepsi, avoid diet variants'
  },

  // Test Case 5: Amazon beans - test brand + product combination
  {
    name: 'By Amazon Red Kidney Beans in Water',
    brand: 'By Amazon',
    brand_normalized: 'by amazon',
    clean_name: 'beans',
    required_tokens: ['kidney'],
    off_primary_tokens: ['red kidney beans'],
    off_alt_tokens: ['beans in water', 'canned beans', 'kidney beans'],
    off_neg_tokens: ['chilli', 'refried', 'black beans'],
    off_attr_want: ['organic', 'natural', 'no added salt'],
    off_attr_avoid: ['seasoned', 'spiced', 'flavored'],
    locale: 'en',
    expected: 'Should find plain kidney beans, avoid seasoned variants'
  }
];

async function runTest(testCase, index) {
  console.log(`\n=== TEST ${index + 1}: ${testCase.name} ===`);
  console.log(`Expected: ${testCase.expected}`);
  console.log(`Features to test: ${testCase.off_alt_tokens.length > 4 ? 'Split-OR, ' : ''}${testCase.off_attr_avoid.length > 0 ? 'Rescue Queries, ' : ''}Attribute Handling`);
  
  const startTime = Date.now();
  
  try {
    const result = await resolveOneItemOFF(testCase, { signal: AbortSignal.timeout(15000) });
    const duration = Date.now() - startTime;
    
    if (result.product) {
      console.log(`✅ SUCCESS (${duration}ms)`);
      console.log(`   Product: ${result.product.code} - ${result.product.product_name}`);
      console.log(`   Confidence: ${result.confidence}`);
      console.log(`   Score: ${result.score}`);
      
      // Check if rescue was triggered (look for rescue logs in console)
      // Check if split-OR was used (look for split-OR logs in console)
      
      return { success: true, duration, result };
    } else {
      console.log(`❌ FAILED (${duration}ms): ${result.reason}`);
      return { success: false, duration, reason: result.reason };
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`💥 ERROR (${duration}ms): ${error.message}`);
    return { success: false, duration, error: error.message };
  }
}

async function runAllTests() {
  console.log('🧪 PIPELINE IMPROVEMENTS INTEGRATION TESTS');
  console.log('Testing: Rescue Queries, Split-OR, Attribute Handling\n');
  
  const results = [];
  
  for (let i = 0; i < TEST_CASES.length; i++) {
    const result = await runTest(TEST_CASES[i], i);
    results.push(result);
    
    // Small delay between tests to avoid overwhelming the API
    if (i < TEST_CASES.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  // Summary
  console.log('\n📊 TEST SUMMARY');
  console.log('================');
  
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
  
  console.log(`✅ Successful: ${successful}/${TEST_CASES.length}`);
  console.log(`❌ Failed: ${failed}/${TEST_CASES.length}`);
  console.log(`⏱️  Average Duration: ${Math.round(avgDuration)}ms`);
  
  if (failed > 0) {
    console.log('\nFailed Tests:');
    results.forEach((result, index) => {
      if (!result.success) {
        console.log(`  ${index + 1}. ${TEST_CASES[index].name}: ${result.reason || result.error}`);
      }
    });
  }
  
  console.log('\n🎯 FEATURE VERIFICATION CHECKLIST:');
  console.log('- Look for "[OFF] Rescue triggered" in logs above');
  console.log('- Look for "[OFF] Using split-OR strategy" in logs above');
  console.log('- Look for attribute matching in candidate scoring');
  console.log('- Verify rescue attempts found better candidates');
  
  process.exit(failed > 0 ? 1 : 0);
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run tests
runAllTests().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
