#!/usr/bin/env node

/**
 * A/B Test: Original vs Normalized Brand Search
 * 
 * Тестирует действительно ли нужна нормализация брендов
 * или API работает отлично с оригинальными названиями
 */

import { normalizeBrandForSearch } from './modules/nutrition/off-client.js';

const TEST_BRANDS = [
  // Проблематичные бренды
  { original: "M&M's", category: "chocolate" },
  { original: "Ben & Jerry's", category: "ice cream" },
  { original: "Coca-Cola", category: "soda" },
  { original: "Häagen-Dazs", category: "ice cream" },
  
  // Edge cases
  { original: "Dr. Pepper", category: "soda" },
  { original: "7-Eleven", category: "convenience" },
  { original: "L'Oréal", category: "cosmetics" },
  { original: "McDonald's", category: "fast food" },
  { original: "Kellogg's", category: "cereal" },
  { original: "Lay's", category: "chips" }
];

async function testBrandApproach(brand, product, approach) {
  const query = approach === 'original' 
    ? `${brand} ${product}`
    : `${normalizeBrandForSearch(brand)} ${product}`;
    
  try {
    const response = await fetch('https://search.openfoodfacts.org/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: query,
        page_size: 5,
        fields: ['code', 'product_name', 'brands', 'brands_tags']
      }),
      signal: AbortSignal.timeout(5000)
    });
    
    if (!response.ok) {
      return { error: `HTTP ${response.status}`, count: 0, results: [] };
    }
    
    const data = await response.json();
    return {
      count: data.count || 0,
      results: data.hits || [],
      query: query
    };
    
  } catch (error) {
    return { error: error.message, count: 0, results: [] };
  }
}

function analyzeBrandMatches(results, originalBrand) {
  if (!results.length) return { exactMatches: 0, partialMatches: 0, quality: 0 };
  
  const brandLower = originalBrand.toLowerCase();
  let exactMatches = 0;
  let partialMatches = 0;
  
  for (const result of results) {
    const resultBrands = String(result.brands || '').toLowerCase();
    const resultBrandTags = Array.isArray(result.brands_tags) 
      ? result.brands_tags.join(' ').toLowerCase() 
      : String(result.brands_tags || '').toLowerCase();
    
    if (resultBrands.includes(brandLower) || resultBrandTags.includes(brandLower)) {
      exactMatches++;
    } else if (brandLower.split(/[&'\s-]+/).some(part => 
      part.length > 2 && (resultBrands.includes(part) || resultBrandTags.includes(part))
    )) {
      partialMatches++;
    }
  }
  
  return {
    exactMatches,
    partialMatches,
    quality: (exactMatches * 2 + partialMatches) / results.length
  };
}

async function runABTest() {
  console.log('🧪 A/B Test: Original vs Normalized Brand Search');
  console.log('===============================================\n');
  
  const results = [];
  
  for (const testCase of TEST_BRANDS) {
    console.log(`🔍 Testing: ${testCase.original}`);
    
    // Test original approach
    const originalResult = await testBrandApproach(testCase.original, testCase.category, 'original');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Pause between requests
    
    // Test normalized approach  
    const normalizedResult = await testBrandApproach(testCase.original, testCase.category, 'normalized');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Analyze results
    const originalAnalysis = analyzeBrandMatches(originalResult.results, testCase.original);
    const normalizedAnalysis = analyzeBrandMatches(normalizedResult.results, testCase.original);
    
    const testResult = {
      brand: testCase.original,
      normalized: normalizeBrandForSearch(testCase.original),
      original: {
        query: originalResult.query,
        count: originalResult.count,
        error: originalResult.error,
        brandMatches: originalAnalysis
      },
      normalized: {
        query: normalizedResult.query,
        count: normalizedResult.count,
        error: normalizedResult.error,
        brandMatches: normalizedAnalysis
      }
    };
    
    results.push(testResult);
    
    // Print results
    console.log(`   Original: "${originalResult.query}"`);
    console.log(`     → ${originalResult.count} results, quality: ${originalAnalysis.quality.toFixed(2)}`);
    console.log(`   Normalized: "${normalizedResult.query}"`);
    console.log(`     → ${normalizedResult.count} results, quality: ${normalizedAnalysis.quality.toFixed(2)}`);
    
    const winner = originalAnalysis.quality >= normalizedAnalysis.quality ? 'ORIGINAL' : 'NORMALIZED';
    console.log(`   🏆 Winner: ${winner}\n`);
  }
  
  // Generate summary
  console.log('📊 A/B Test Summary:');
  console.log('===================');
  
  let originalWins = 0;
  let normalizedWins = 0;
  let ties = 0;
  
  for (const result of results) {
    const originalQuality = result.original.brandMatches.quality;
    const normalizedQuality = result.normalized.brandMatches.quality;
    
    if (originalQuality > normalizedQuality) {
      originalWins++;
    } else if (normalizedQuality > originalQuality) {
      normalizedWins++;
    } else {
      ties++;
    }
  }
  
  console.log(`Original wins: ${originalWins}/${TEST_BRANDS.length}`);
  console.log(`Normalized wins: ${normalizedWins}/${TEST_BRANDS.length}`);
  console.log(`Ties: ${ties}/${TEST_BRANDS.length}`);
  
  const recommendation = originalWins > normalizedWins ? 
    'Use ORIGINAL brands (minimal normalization)' :
    'Use NORMALIZED brands (current approach)';
    
  console.log(`\n🎯 Recommendation: ${recommendation}`);
  
  // Show problematic cases
  console.log('\n🚨 Problematic Cases:');
  for (const result of results) {
    const originalQuality = result.original.brandMatches.quality;
    const normalizedQuality = result.normalized.brandMatches.quality;
    
    if (originalQuality < 0.5 && normalizedQuality < 0.5) {
      console.log(`   ❌ ${result.brand}: Both approaches poor quality`);
    } else if (Math.abs(originalQuality - normalizedQuality) > 0.3) {
      console.log(`   ⚠️ ${result.brand}: Significant difference (${originalQuality.toFixed(2)} vs ${normalizedQuality.toFixed(2)})`);
    }
  }
  
  return results;
}

// Run if called directly
if (process.argv[1] && (
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === new URL(process.argv[1], 'file:').href
)) {
  runABTest().catch(console.error);
}

export { runABTest, TEST_BRANDS };
