#!/usr/bin/env node

/**
 * OpenFoodFacts Pattern Analyzer
 * 
 * Analyzes test results to identify patterns, issues, and optimization opportunities
 * 
 * Usage: node off-pattern-analyzer.js [test-results-dir]
 */

import fs from 'fs/promises';
import path from 'path';

// ===== PATTERN ANALYSIS FUNCTIONS =====

class PatternAnalyzer {
  constructor() {
    this.results = [];
    this.patterns = {
      brandNormalization: new Map(),
      timeoutPatterns: new Map(),
      queryStructures: new Map(),
      errorTypes: new Map(),
      successRates: new Map(),
      categoryPerformance: new Map(),
      luceneQueryEffectiveness: new Map()
    };
  }

  loadResults(resultsData) {
    this.results = resultsData.results || [];
    this.summary = resultsData.summary || {};
    console.log(`Loaded ${this.results.length} test results for analysis`);
  }

  // Analyze brand normalization issues
  analyzeBrandNormalization() {
    console.log('\n🔍 Analyzing Brand Normalization Patterns...');
    
    for (const item of this.results) {
      const product = item.product;
      const originalBrand = product.brand;
      
      if (!originalBrand) continue;
      
      const brandIssues = {
        originalBrand,
        variations: [],
        successfulVariations: [],
        failedVariations: [],
        normalizationIssues: []
      };

      // Check each variation and strategy result
      for (const [testKey, result] of Object.entries(item.results)) {
        const [strategy, variation] = testKey.split('_');
        
        if (result.test_query && result.test_query.toLowerCase().includes(originalBrand.toLowerCase())) {
          const variationData = {
            variation,
            strategy,
            query: result.test_query,
            status: result.status,
            count: result.count,
            luceneQuery: result.metadata?.lucene_q
          };

          brandIssues.variations.push(variationData);

          if (result.status === 'success' && result.count > 0) {
            brandIssues.successfulVariations.push(variationData);
            
            // Check if brand was found in results
            const brandFound = result.top_results?.some(r => 
              product.expected_brands?.some(expectedBrand =>
                r.brands?.toLowerCase().includes(expectedBrand.toLowerCase())
              )
            );
            
            if (!brandFound) {
              brandIssues.normalizationIssues.push(`Brand not found in results for variation: ${variation}`);
            }
          } else {
            brandIssues.failedVariations.push(variationData);
          }
        }
      }

      // Detect common normalization patterns
      if (originalBrand.includes('&')) {
        brandIssues.normalizationIssues.push('Contains ampersand - potential special char issue');
      }
      if (originalBrand.includes("'")) {
        brandIssues.normalizationIssues.push('Contains apostrophe - potential normalization issue');
      }
      if (originalBrand.includes('-')) {
        brandIssues.normalizationIssues.push('Contains hyphen - space vs hyphen normalization');
      }
      if (originalBrand.split(' ').length > 2) {
        brandIssues.normalizationIssues.push('Multi-word brand - potential token fragmentation');
      }

      this.patterns.brandNormalization.set(originalBrand, brandIssues);
    }

    return this.patterns.brandNormalization;
  }

  // Analyze timeout patterns
  analyzeTimeoutPatterns() {
    console.log('\n⏱️ Analyzing Timeout Patterns...');
    
    const timeoutAnalysis = {
      byStrategy: new Map(),
      byCategory: new Map(),
      byQueryLength: new Map(),
      byBrandComplexity: new Map(),
      commonTimeoutQueries: []
    };

    for (const item of this.results) {
      const product = item.product;
      
      for (const [testKey, result] of Object.entries(item.results)) {
        const [strategy, variation] = testKey.split('_');
        
        if (result.status === 'timeout') {
          // By strategy
          const strategyData = timeoutAnalysis.byStrategy.get(strategy) || { count: 0, examples: [] };
          strategyData.count++;
          strategyData.examples.push({
            product: product.id,
            query: result.test_query,
            variation,
            duration: result.duration_ms
          });
          timeoutAnalysis.byStrategy.set(strategy, strategyData);

          // By category
          const categoryData = timeoutAnalysis.byCategory.get(product.category) || { count: 0, examples: [] };
          categoryData.count++;
          categoryData.examples.push({
            product: product.id,
            strategy,
            query: result.test_query
          });
          timeoutAnalysis.byCategory.set(product.category, categoryData);

          // By query length
          const queryLength = result.test_query?.length || 0;
          const lengthBucket = Math.floor(queryLength / 20) * 20; // 0-19, 20-39, etc.
          const lengthData = timeoutAnalysis.byQueryLength.get(lengthBucket) || { count: 0, examples: [] };
          lengthData.count++;
          lengthData.examples.push({
            product: product.id,
            strategy,
            query: result.test_query,
            length: queryLength
          });
          timeoutAnalysis.byQueryLength.set(lengthBucket, lengthData);

          // Common timeout queries
          timeoutAnalysis.commonTimeoutQueries.push({
            query: result.test_query,
            strategy,
            product: product.id,
            duration: result.duration_ms
          });
        }
      }
    }

    this.patterns.timeoutPatterns = timeoutAnalysis;
    return timeoutAnalysis;
  }

  // Analyze Lucene query effectiveness
  analyzeLuceneQueries() {
    console.log('\n🔍 Analyzing Lucene Query Effectiveness...');
    
    const luceneAnalysis = {
      queryStructures: new Map(),
      boostEffectiveness: new Map(),
      categoryFilterEffectiveness: new Map(),
      variantTokenEffectiveness: new Map()
    };

    for (const item of this.results) {
      const product = item.product;
      const expectedLucene = product.expected_lucene;
      
      for (const [testKey, result] of Object.entries(item.results)) {
        const actualLucene = result.metadata?.lucene_q;
        
        if (actualLucene) {
          // Analyze query structure
          const structure = this.extractQueryStructure(actualLucene);
          const structureKey = structure.join(' + ');
          
          const structureData = luceneAnalysis.queryStructures.get(structureKey) || {
            count: 0,
            successes: 0,
            avgResults: 0,
            examples: []
          };
          
          structureData.count++;
          if (result.status === 'success' && result.count > 0) {
            structureData.successes++;
            structureData.avgResults = (structureData.avgResults * (structureData.count - 1) + result.count) / structureData.count;
          }
          
          structureData.examples.push({
            product: product.id,
            query: actualLucene,
            results: result.count,
            status: result.status
          });
          
          luceneAnalysis.queryStructures.set(structureKey, structureData);

          // Compare with expected Lucene if available
          if (expectedLucene) {
            const expectedStructure = this.extractQueryStructure(expectedLucene);
            const actualStructure = this.extractQueryStructure(actualLucene);
            
            const similarity = this.calculateStructureSimilarity(expectedStructure, actualStructure);
            
            if (similarity < 0.8) {
              console.log(`⚠️ Lucene mismatch for ${product.id}:`);
              console.log(`  Expected: ${expectedLucene.substring(0, 100)}...`);
              console.log(`  Actual:   ${actualLucene.substring(0, 100)}...`);
              console.log(`  Similarity: ${(similarity * 100).toFixed(1)}%`);
            }
          }
        }
      }
    }

    this.patterns.luceneQueryEffectiveness = luceneAnalysis;
    return luceneAnalysis;
  }

  // Extract query structure components
  extractQueryStructure(luceneQuery) {
    const structure = [];
    
    if (luceneQuery.includes('brands:')) structure.push('BRAND');
    if (luceneQuery.includes('categories_tags:')) structure.push('CATEGORY');
    if (luceneQuery.includes('product_name:')) structure.push('PRODUCT_NAME');
    if (luceneQuery.includes('labels_tags:')) structure.push('LABELS');
    if (luceneQuery.includes('NOT ')) structure.push('EXCLUSION');
    if (luceneQuery.includes('~')) structure.push('PROXIMITY');
    if (luceneQuery.includes('^')) structure.push('BOOST');
    if (luceneQuery.includes(' OR ')) structure.push('OR_LOGIC');
    if (luceneQuery.includes(' AND ')) structure.push('AND_LOGIC');
    
    return structure;
  }

  // Calculate similarity between query structures
  calculateStructureSimilarity(expected, actual) {
    const allElements = new Set([...expected, ...actual]);
    const intersection = expected.filter(x => actual.includes(x));
    return intersection.length / allElements.size;
  }

  // Analyze success patterns by strategy and category
  analyzeSuccessPatterns() {
    console.log('\n📈 Analyzing Success Patterns...');
    
    const successAnalysis = {
      byStrategy: new Map(),
      byCategory: new Map(),
      byCombination: new Map(),
      bestPractices: []
    };

    for (const item of this.results) {
      const product = item.product;
      
      for (const [testKey, result] of Object.entries(item.results)) {
        const [strategy, variation] = testKey.split('_');
        
        // By strategy
        const strategyData = successAnalysis.byStrategy.get(strategy) || {
          total: 0,
          successes: 0,
          avgResults: 0,
          avgDuration: 0,
          totalResults: 0,
          totalDuration: 0
        };
        
        strategyData.total++;
        strategyData.totalDuration += result.duration_ms;
        
        if (result.status === 'success' && result.count > 0) {
          strategyData.successes++;
          strategyData.totalResults += result.count;
        }
        
        strategyData.avgResults = strategyData.totalResults / strategyData.successes || 0;
        strategyData.avgDuration = strategyData.totalDuration / strategyData.total;
        
        successAnalysis.byStrategy.set(strategy, strategyData);

        // By category
        const categoryKey = `${product.category}_${strategy}`;
        const categoryData = successAnalysis.byCombination.get(categoryKey) || {
          category: product.category,
          strategy,
          total: 0,
          successes: 0,
          successRate: 0
        };
        
        categoryData.total++;
        if (result.status === 'success' && result.count > 0) {
          categoryData.successes++;
        }
        categoryData.successRate = (categoryData.successes / categoryData.total) * 100;
        
        successAnalysis.byCombination.set(categoryKey, categoryData);
      }
    }

    // Identify best practices
    const strategies = Array.from(successAnalysis.byStrategy.entries())
      .map(([name, data]) => ({
        name,
        successRate: (data.successes / data.total) * 100,
        avgResults: data.avgResults,
        avgDuration: data.avgDuration
      }))
      .sort((a, b) => b.successRate - a.successRate);

    successAnalysis.bestPractices = [
      `Best overall strategy: ${strategies[0]?.name} (${strategies[0]?.successRate.toFixed(1)}% success rate)`,
      `Fastest strategy: ${strategies.sort((a, b) => a.avgDuration - b.avgDuration)[0]?.name}`,
      `Most results: ${strategies.sort((a, b) => b.avgResults - a.avgResults)[0]?.name}`
    ];

    this.patterns.successRates = successAnalysis;
    return successAnalysis;
  }

  // Generate comprehensive analysis report
  generateAnalysisReport() {
    console.log('\n📊 Generating Comprehensive Analysis Report...');
    
    const brandAnalysis = this.analyzeBrandNormalization();
    const timeoutAnalysis = this.analyzeTimeoutPatterns();
    const luceneAnalysis = this.analyzeLuceneQueries();
    const successAnalysis = this.analyzeSuccessPatterns();

    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalProducts: this.results.length,
        totalTests: Object.values(this.results).reduce((sum, item) => 
          sum + Object.keys(item.results).length, 0),
        analysisCategories: ['brand_normalization', 'timeouts', 'lucene_effectiveness', 'success_patterns']
      },
      brandNormalization: {
        totalBrands: brandAnalysis.size,
        problematicBrands: Array.from(brandAnalysis.values())
          .filter(brand => brand.normalizationIssues.length > 0)
          .length,
        commonIssues: this.extractCommonBrandIssues(brandAnalysis)
      },
      timeoutPatterns: {
        totalTimeouts: Array.from(timeoutAnalysis.byStrategy.values())
          .reduce((sum, data) => sum + data.count, 0),
        worstStrategies: Array.from(timeoutAnalysis.byStrategy.entries())
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 3)
          .map(([strategy, data]) => ({ strategy, timeouts: data.count })),
        problematicCategories: Array.from(timeoutAnalysis.byCategory.entries())
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 3)
          .map(([category, data]) => ({ category, timeouts: data.count }))
      },
      luceneEffectiveness: {
        totalQueries: luceneAnalysis.queryStructures.size,
        mostEffectiveStructures: Array.from(luceneAnalysis.queryStructures.entries())
          .sort((a, b) => (b[1].successes / b[1].count) - (a[1].successes / a[1].count))
          .slice(0, 5)
          .map(([structure, data]) => ({
            structure,
            successRate: ((data.successes / data.count) * 100).toFixed(1),
            avgResults: data.avgResults.toFixed(1)
          }))
      },
      successPatterns: {
        bestStrategies: Array.from(successAnalysis.byStrategy.entries())
          .map(([name, data]) => ({
            name,
            successRate: ((data.successes / data.total) * 100).toFixed(1),
            avgDuration: Math.round(data.avgDuration)
          }))
          .sort((a, b) => parseFloat(b.successRate) - parseFloat(a.successRate))
          .slice(0, 5)
      },
      recommendations: this.generateRecommendations(brandAnalysis, timeoutAnalysis, luceneAnalysis, successAnalysis)
    };

    return report;
  }

  extractCommonBrandIssues(brandAnalysis) {
    const issueTypes = new Map();
    
    for (const brand of brandAnalysis.values()) {
      for (const issue of brand.normalizationIssues) {
        issueTypes.set(issue, (issueTypes.get(issue) || 0) + 1);
      }
    }
    
    return Array.from(issueTypes.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([issue, count]) => ({ issue, count }));
  }

  generateRecommendations(brandAnalysis, timeoutAnalysis, luceneAnalysis, successAnalysis) {
    const recommendations = [];

    // Brand normalization recommendations
    const problematicBrands = Array.from(brandAnalysis.values())
      .filter(brand => brand.normalizationIssues.length > 0);
    
    if (problematicBrands.length > 0) {
      recommendations.push({
        category: 'Brand Normalization',
        priority: 'HIGH',
        issue: `${problematicBrands.length} brands have normalization issues`,
        solution: 'Implement consistent brand normalization rules for special characters (&, \', -)',
        examples: problematicBrands.slice(0, 3).map(b => b.originalBrand)
      });
    }

    // Timeout recommendations
    const highTimeoutStrategies = Array.from(timeoutAnalysis.byStrategy.entries())
      .filter(([_, data]) => data.count > 5);
    
    if (highTimeoutStrategies.length > 0) {
      recommendations.push({
        category: 'Performance',
        priority: 'HIGH',
        issue: `High timeout rates in strategies: ${highTimeoutStrategies.map(([s]) => s).join(', ')}`,
        solution: 'Increase timeout values or optimize query complexity',
        details: highTimeoutStrategies.map(([strategy, data]) => 
          `${strategy}: ${data.count} timeouts`)
      });
    }

    // Lucene query recommendations
    const ineffectiveStructures = Array.from(luceneAnalysis.queryStructures.entries())
      .filter(([_, data]) => (data.successes / data.count) < 0.3);
    
    if (ineffectiveStructures.length > 0) {
      recommendations.push({
        category: 'Query Optimization',
        priority: 'MEDIUM',
        issue: `${ineffectiveStructures.length} query structures have low success rates`,
        solution: 'Review and optimize Lucene query construction',
        examples: ineffectiveStructures.slice(0, 3).map(([structure]) => structure)
      });
    }

    // Success pattern recommendations
    const bestStrategy = Array.from(successAnalysis.byStrategy.entries())
      .sort((a, b) => (b[1].successes / b[1].total) - (a[1].successes / a[1].total))[0];
    
    if (bestStrategy) {
      recommendations.push({
        category: 'Strategy Optimization',
        priority: 'LOW',
        issue: 'Uneven strategy performance',
        solution: `Consider prioritizing ${bestStrategy[0]} strategy (${((bestStrategy[1].successes / bestStrategy[1].total) * 100).toFixed(1)}% success rate)`,
        details: `Average ${bestStrategy[1].avgResults.toFixed(1)} results in ${Math.round(bestStrategy[1].avgDuration)}ms`
      });
    }

    return recommendations;
  }
}

// ===== MAIN EXECUTION =====

async function main() {
  const args = process.argv.slice(2);
  const resultsDir = args[0] || './off-test-results';
  
  try {
    console.log(`🔍 OpenFoodFacts Pattern Analyzer`);
    console.log(`📂 Loading results from: ${resultsDir}`);
    
    const resultsFile = path.join(resultsDir, 'raw-results.json');
    const rawData = await fs.readFile(resultsFile, 'utf8');
    const resultsData = JSON.parse(rawData);
    
    const analyzer = new PatternAnalyzer();
    analyzer.loadResults(resultsData);
    
    const analysisReport = analyzer.generateAnalysisReport();
    
    // Save analysis report
    const analysisFile = path.join(resultsDir, 'pattern-analysis.json');
    await fs.writeFile(analysisFile, JSON.stringify(analysisReport, null, 2));
    
    // Generate markdown report
    const markdownReport = generateMarkdownReport(analysisReport);
    const markdownFile = path.join(resultsDir, 'pattern-analysis.md');
    await fs.writeFile(markdownFile, markdownReport);
    
    console.log(`\n✅ Analysis Complete!`);
    console.log(`📊 Analysis report saved to: ${analysisFile}`);
    console.log(`📝 Markdown report saved to: ${markdownFile}`);
    
    // Print key findings
    console.log(`\n🔍 Key Findings:`);
    console.log(`  • ${analysisReport.brandNormalization.problematicBrands}/${analysisReport.brandNormalization.totalBrands} brands have normalization issues`);
    console.log(`  • ${analysisReport.timeoutPatterns.totalTimeouts} total timeouts detected`);
    console.log(`  • Best strategy: ${analysisReport.successPatterns.bestStrategies[0]?.name} (${analysisReport.successPatterns.bestStrategies[0]?.successRate}% success)`);
    console.log(`  • ${analysisReport.recommendations.length} recommendations generated`);
    
  } catch (error) {
    console.error('❌ Analysis failed:', error.message);
    process.exit(1);
  }
}

function generateMarkdownReport(report) {
  const md = [];
  
  md.push('# OpenFoodFacts Pattern Analysis Report');
  md.push(`Generated: ${report.timestamp}\n`);
  
  md.push('## Executive Summary');
  md.push(`- **Total Products Tested:** ${report.summary.totalProducts}`);
  md.push(`- **Total API Calls:** ${report.summary.totalTests}`);
  md.push(`- **Problematic Brands:** ${report.brandNormalization.problematicBrands}/${report.brandNormalization.totalBrands}`);
  md.push(`- **Total Timeouts:** ${report.timeoutPatterns.totalTimeouts}\n`);
  
  md.push('## Brand Normalization Issues');
  md.push('| Issue | Count |');
  md.push('|-------|-------|');
  report.brandNormalization.commonIssues.forEach(({ issue, count }) => {
    md.push(`| ${issue} | ${count} |`);
  });
  
  md.push('\n## Strategy Performance');
  md.push('| Strategy | Success Rate | Avg Duration |');
  md.push('|----------|-------------|-------------|');
  report.successPatterns.bestStrategies.forEach(({ name, successRate, avgDuration }) => {
    md.push(`| ${name} | ${successRate}% | ${avgDuration}ms |`);
  });
  
  md.push('\n## Recommendations');
  report.recommendations.forEach((rec, i) => {
    md.push(`### ${i + 1}. ${rec.category} (${rec.priority} Priority)`);
    md.push(`**Issue:** ${rec.issue}`);
    md.push(`**Solution:** ${rec.solution}`);
    if (rec.examples) {
      md.push(`**Examples:** ${rec.examples.join(', ')}`);
    }
    md.push('');
  });
  
  return md.join('\n');
}

// Run if called directly
if (process.argv[1] && (
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === new URL(process.argv[1], 'file:').href
)) {
  main();
}

export { PatternAnalyzer };
