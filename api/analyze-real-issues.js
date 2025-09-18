#!/usr/bin/env node

/**
 * Анализ реальных проблем качества поиска
 * Фокус на том, что действительно важно в продакшене
 */

import fs from 'fs/promises';

async function analyzeRealIssues() {
  console.log('🔍 Analyzing Real Production Issues...\n');
  
  try {
    // Load existing test results
    const rawData = await fs.readFile('./off-test-results/raw-results.json', 'utf8');
    const testData = JSON.parse(rawData);
    
    console.log('📊 Real Issues Analysis (ignoring rate limiting artifacts):\n');
    
    // 1. SaL API качество запросов
    console.log('## 1. SaL API Query Quality');
    
    const salQueries = [];
    for (const item of testData.results) {
      for (const [key, result] of Object.entries(item.results)) {
        if (result.metadata?.lucene_q) {
          salQueries.push({
            product: item.product.id,
            query: result.metadata.lucene_q,
            status: result.status,
            error: result.error,
            hasResults: result.count > 0
          });
        }
      }
    }
    
    console.log(`📈 Total Lucene queries analyzed: ${salQueries.length}`);
    
    // Analyze query complexity vs success
    const queryComplexity = salQueries.map(q => {
      const complexity = (q.query.match(/AND/g) || []).length + 
                        (q.query.match(/OR/g) || []).length +
                        (q.query.match(/~/g) || []).length +
                        (q.query.match(/\^/g) || []).length;
      return { ...q, complexity };
    });
    
    const avgComplexity = queryComplexity.reduce((sum, q) => sum + q.complexity, 0) / queryComplexity.length;
    console.log(`📊 Average query complexity: ${avgComplexity.toFixed(1)} operators per query`);
    
    // Find patterns that cause 500 errors
    const error500Queries = queryComplexity.filter(q => q.error?.includes('500'));
    console.log(`🚨 500 Error patterns (${error500Queries.length} cases):`);
    
    for (const errorQuery of error500Queries.slice(0, 5)) {
      console.log(`  • Product: ${errorQuery.product}`);
      console.log(`    Query: ${errorQuery.query.substring(0, 100)}...`);
      console.log(`    Complexity: ${errorQuery.complexity} operators`);
    }
    
    // 2. Brand normalization effectiveness
    console.log('\n## 2. Brand Normalization Issues');
    
    const brandIssues = [];
    for (const item of testData.results) {
      const originalBrand = item.product.brand;
      if (!originalBrand) continue;
      
      const hasSpecialChars = /[&''-]/.test(originalBrand);
      const isMultiWord = originalBrand.split(' ').length > 2;
      
      if (hasSpecialChars || isMultiWord) {
        const allFailed = Object.values(item.results).every(r => r.count === 0);
        brandIssues.push({
          brand: originalBrand,
          hasSpecialChars,
          isMultiWord,
          allFailed,
          issues: []
        });
        
        if (hasSpecialChars) brandIssues[brandIssues.length - 1].issues.push('special_chars');
        if (isMultiWord) brandIssues[brandIssues.length - 1].issues.push('multi_word');
      }
    }
    
    console.log(`🏷️ Problematic brands found: ${brandIssues.length}`);
    brandIssues.forEach(brand => {
      console.log(`  • ${brand.brand}: ${brand.issues.join(', ')} ${brand.allFailed ? '(complete failure)' : '(partial success)'}`);
    });
    
    // 3. Success patterns
    console.log('\n## 3. What Actually Works');
    
    const workingCases = [];
    for (const item of testData.results) {
      for (const [key, result] of Object.entries(item.results)) {
        if (result.count > 0) {
          workingCases.push({
            product: item.product.id,
            strategy: key,
            count: result.count,
            duration: result.duration_ms
          });
        }
      }
    }
    
    if (workingCases.length > 0) {
      console.log(`✅ Working cases found: ${workingCases.length}`);
      workingCases.forEach(w => {
        console.log(`  • ${w.product} via ${w.strategy}: ${w.count} results in ${w.duration}ms`);
      });
    } else {
      console.log('❌ No working cases found - all queries returned 0 results');
      console.log('   This suggests either:');
      console.log('   1. Rate limiting prevented actual API calls');
      console.log('   2. Query construction is fundamentally broken');
      console.log('   3. Test products don\'t exist in OFF database');
    }
    
    // 4. Recommendations for real production
    console.log('\n## 4. Production Recommendations');
    
    console.log('🎯 Immediate actions:');
    console.log('  1. Test with REAL products from your database');
    console.log('  2. Use single-product tests with 30+ second delays');
    console.log('  3. Focus on popular brands (Coca-Cola, Danone, etc.)');
    console.log('  4. Simplify Lucene queries to 2-3 conditions max');
    
    console.log('\n🔧 Query optimization:');
    console.log('  • brands:"simple-brand" AND product_name:"term"');
    console.log('  • Avoid complex OR chains');
    console.log('  • Avoid proximity + boost combinations');
    console.log('  • Test queries manually first');
    
    // 5. Generate actionable test plan
    console.log('\n## 5. Next Steps');
    console.log('🚀 Recommended testing approach:');
    console.log('  1. Pick 5 products from real user queries');
    console.log('  2. Test manually in OFF website first');
    console.log('  3. Run quality tester with realistic delays');
    console.log('  4. Iterate on query construction');
    console.log('  5. Focus on find rate, not speed');
    
  } catch (error) {
    console.error('❌ Analysis failed:', error);
  }
}

// Run analysis
main();

async function main() {
  await analyzeRealIssues();
}
