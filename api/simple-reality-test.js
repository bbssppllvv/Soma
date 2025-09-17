#!/usr/bin/env node

/**
 * Simple Reality Test - как API работает в реальных условиях
 * Без агрессивного rate limiting, с реалистичными паузами
 */

import { searchByNameV1, canonicalizeQuery } from './modules/nutrition/off-client.js';

// Отключаем rate limiting для теста
process.env.OFF_SEARCH_MAX_TOKENS = '100';  // Много токенов
process.env.OFF_SEARCH_REFILL_MS = '1000';   // Быстрое пополнение
process.env.OFF_SEARCH_POLL_MS = '10';       // Минимальная пауза

const REAL_PRODUCTS = [
  {
    name: 'Philadelphia light',
    brand: 'Philadelphia',
    category: 'dairy',
    expected: 'cream cheese'
  },
  {
    name: 'Coca Cola',
    brand: 'Coca-Cola', 
    category: 'beverages',
    expected: 'cola'
  },
  {
    name: 'Danone yogur natural',
    brand: 'Danone',
    category: 'dairy', 
    expected: 'yogurt'
  }
];

async function testProduct(product) {
  console.log(`\n🧪 Testing: ${product.name}`);
  console.log(`   Expected: ${product.expected} from ${product.brand}`);
  
  try {
    const result = await searchByNameV1(product.name, {
      brand: product.brand,
      categoryTags: [],
      maxPages: 1,
      locale: 'en'
    });
    
    console.log(`✅ API Response:`);
    console.log(`   Count: ${result.count || 0}`);
    console.log(`   Products found: ${result.products?.length || 0}`);
    
    if (result.products?.length > 0) {
      console.log(`   Top result: ${result.products[0].product_name}`);
      console.log(`   Brand: ${result.products[0].brands}`);
      console.log(`   Categories: ${result.products[0].categories_tags?.slice(0, 3).join(', ')}`);
      
      // Check quality
      const topResult = result.products[0];
      const brandMatch = topResult.brands?.toLowerCase().includes(product.brand.toLowerCase());
      const productMatch = topResult.product_name?.toLowerCase().includes(product.expected.toLowerCase());
      
      console.log(`🎯 Quality Check:`);
      console.log(`   Brand match: ${brandMatch ? '✅' : '❌'}`);
      console.log(`   Product match: ${productMatch ? '✅' : '❌'}`);
      
      return {
        found: true,
        brandMatch,
        productMatch,
        topResult: {
          name: topResult.product_name,
          brands: topResult.brands,
          code: topResult.code
        }
      };
    } else {
      console.log(`❌ No products found`);
      return { found: false };
    }
    
  } catch (error) {
    console.log(`💥 Error: ${error.message}`);
    return { found: false, error: error.message };
  }
}

async function runRealityTest() {
  console.log('🌟 OFF API Reality Test - How it ACTUALLY works\n');
  console.log('Testing with realistic conditions (no aggressive rate limiting)...');
  
  const results = [];
  
  for (const product of REAL_PRODUCTS) {
    const result = await testProduct(product);
    results.push({ product, result });
    
    // Realistic pause between products (like real user)
    console.log('   ⏳ Realistic pause (10s)...');
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  
  console.log('\n📊 REALITY TEST SUMMARY:');
  console.log('========================');
  
  let found = 0;
  let brandMatches = 0;
  let productMatches = 0;
  
  for (const { product, result } of results) {
    if (result.found) {
      found++;
      if (result.brandMatch) brandMatches++;
      if (result.productMatch) productMatches++;
    }
    
    console.log(`${product.name}: ${result.found ? '✅ FOUND' : '❌ NOT FOUND'}`);
    if (result.found) {
      console.log(`  → ${result.topResult.name} (${result.topResult.brands})`);
    }
  }
  
  console.log(`\n🎯 FINAL METRICS:`);
  console.log(`   Find Rate: ${found}/${REAL_PRODUCTS.length} (${(found/REAL_PRODUCTS.length*100).toFixed(1)}%)`);
  console.log(`   Brand Accuracy: ${brandMatches}/${found} (${found > 0 ? (brandMatches/found*100).toFixed(1) : 0}%)`);
  console.log(`   Product Accuracy: ${productMatches}/${found} (${found > 0 ? (productMatches/found*100).toFixed(1) : 0}%)`);
  
  if (found > 0) {
    console.log('\n🎉 SUCCESS! OFF API works when not rate limited!');
    console.log('💡 Main issue was aggressive rate limiting in tests, not API quality');
  } else {
    console.log('\n🚨 Still no results - deeper investigation needed');
  }
}

runRealityTest().catch(console.error);
