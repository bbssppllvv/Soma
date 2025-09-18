#!/usr/bin/env node

/**
 * Quick test for reranker fixes
 * Test the Central Lechera case specifically
 */

import { resolveOneItemOFF } from './modules/nutrition/off-resolver.js';

async function testRerankerFix() {
  console.log('🧪 Quick Reranker Fix Test');
  console.log('==========================\n');
  
  const testCase = {
    name: 'Central Lechera Semi Desnatada',
    brand: 'Central Lechera Asturiana',
    clean_name: 'leche',
    required_tokens: ['semi', 'desnatada'],
    canonical_category: 'dairy',
    confidence: 0.9
  };
  
  console.log('Testing: Central Lechera Semi Desnatada');
  console.log('Required tokens: [semi, desnatada]');
  console.log('Goal: Find milk with semi desnatada, NOT Naturcol\n');
  
  try {
    const result = await resolveOneItemOFF(testCase);
    
    if (result.product) {
      console.log(`✅ Found: ${result.product.product_name}`);
      console.log(`   Brand: ${result.product.brands}`);
      console.log(`   Score: ${result.score?.toFixed(0)}`);
      
      const name = result.product.product_name.toLowerCase();
      const hasSemi = name.includes('semi');
      const hasDesnatada = name.includes('desnatada');
      const isNaturcol = name.includes('naturcol');
      
      console.log('\n🎯 Analysis:');
      console.log(`   Has 'semi': ${hasSemi ? '✅' : '❌'}`);
      console.log(`   Has 'desnatada': ${hasDesnatada ? '✅' : '❌'}`);
      console.log(`   Is Naturcol: ${isNaturcol ? '❌ BAD' : '✅ GOOD'}`);
      
      if (hasSemi && hasDesnatada && !isNaturcol) {
        console.log('\n🏆 RERANKER FIX SUCCESS!');
      } else if (isNaturcol) {
        console.log('\n🚨 RERANKER PROBLEM PERSISTS');
      } else {
        console.log('\n🟡 PARTIAL SUCCESS');
      }
      
    } else {
      console.log(`❌ Not found: ${result.reason}`);
    }
    
  } catch (error) {
    console.log(`💥 Error: ${error.message}`);
  }
}

testRerankerFix();
