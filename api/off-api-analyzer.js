#!/usr/bin/env node

/**
 * OpenFoodFacts API Deep Analysis Tool
 * 
 * Анализирует поведение OFF API для понимания:
 * - Как работают разные endpoints (SaL, v2, Legacy)
 * - Какие ограничения и особенности у каждого
 * - Паттерны успехов и неудач
 * - Оптимальные стратегии запросов
 */

import fs from 'fs/promises';
import path from 'path';

class OFFApiAnalyzer {
  constructor() {
    this.results = [];
    this.analysis = {
      endpoints: {
        sal: { total: 0, success: 0, errors: {}, avgDuration: 0, patterns: {} },
        v2: { total: 0, success: 0, errors: {}, avgDuration: 0, patterns: {} },
        legacy: { total: 0, success: 0, errors: {}, avgDuration: 0, patterns: {} }
      },
      queryPatterns: new Map(),
      brandBehavior: new Map(),
      categoryBehavior: new Map(),
      timeoutAnalysis: {},
      rateLimit: {
        frequency: 0,
        triggers: [],
        patterns: []
      },
      luceneQueries: {
        successful: [],
        failed: [],
        patterns: new Map()
      }
    };
  }

  async loadTestResults(resultsDir) {
    console.log(`📂 Loading test results from: ${resultsDir}`);
    
    try {
      const rawDataFile = path.join(resultsDir, 'raw-results.json');
      const rawData = await fs.readFile(rawDataFile, 'utf8');
      const testData = JSON.parse(rawData);
      
      this.results = testData.results || [];
      console.log(`✅ Loaded ${this.results.length} test results`);
      
      return true;
    } catch (error) {
      console.error(`❌ Failed to load results: ${error.message}`);
      return false;
    }
  }

  analyzeEndpointBehavior() {
    console.log('\n🔍 Analyzing Endpoint Behavior...');
    
    for (const testItem of this.results) {
      const product = testItem.product;
      
      for (const [testKey, result] of Object.entries(testItem.results)) {
        const endpoint = this.detectEndpoint(result);
        if (!endpoint) continue;

        const endpointStats = this.analysis.endpoints[endpoint];
        endpointStats.total++;

        // Success/failure analysis
        if (result.status === 'success' && result.count > 0) {
          endpointStats.success++;
        }

        // Error analysis
        if (result.error) {
          const errorType = this.categorizeError(result.error);
          endpointStats.errors[errorType] = (endpointStats.errors[errorType] || 0) + 1;
        }

        // Duration analysis
        if (result.duration_ms) {
          endpointStats.avgDuration = (endpointStats.avgDuration * (endpointStats.total - 1) + result.duration_ms) / endpointStats.total;
        }

        // Pattern analysis
        this.analyzeQueryPatterns(result, endpoint, product);
      }
    }

    // Calculate success rates
    for (const [endpoint, stats] of Object.entries(this.analysis.endpoints)) {
      stats.successRate = stats.total > 0 ? (stats.success / stats.total) * 100 : 0;
    }
  }

  detectEndpoint(result) {
    if (result.metadata?.source === 'sal' || result.metadata?.lucene_q) {
      return 'sal';
    }
    if (result.metadata?.source === 'v2' || result.strategy?.includes('v2')) {
      return 'v2';
    }
    if (result.metadata?.source === 'legacy' || result.strategy?.includes('legacy')) {
      return 'legacy';
    }
    // Try to detect from strategy name
    if (result.strategy?.includes('main_pipeline')) {
      return 'sal'; // Main pipeline starts with SaL
    }
    return null;
  }

  categorizeError(error) {
    if (error.includes('timeout')) return 'timeout';
    if (error.includes('500')) return 'server_error';
    if (error.includes('rate limit')) return 'rate_limit';
    if (error.includes('404')) return 'not_found';
    return 'other';
  }

  analyzeQueryPatterns(result, endpoint, product) {
    const luceneQuery = result.metadata?.lucene_q;
    if (luceneQuery) {
      const pattern = this.extractQueryPattern(luceneQuery);
      
      if (!this.analysis.luceneQueries.patterns.has(pattern)) {
        this.analysis.luceneQueries.patterns.set(pattern, {
          count: 0,
          successes: 0,
          failures: 0,
          examples: []
        });
      }

      const patternData = this.analysis.luceneQueries.patterns.get(pattern);
      patternData.count++;
      
      if (result.status === 'success' && result.count > 0) {
        patternData.successes++;
        this.analysis.luceneQueries.successful.push({
          query: luceneQuery,
          product: product.id,
          count: result.count
        });
      } else {
        patternData.failures++;
        this.analysis.luceneQueries.failed.push({
          query: luceneQuery,
          product: product.id,
          error: result.error
        });
      }

      patternData.examples.push({
        query: luceneQuery,
        product: product.id,
        success: result.status === 'success' && result.count > 0
      });
    }
  }

  extractQueryPattern(luceneQuery) {
    // Extract the structure of the Lucene query
    let pattern = luceneQuery
      .replace(/"[^"]*"/g, '"TERM"')  // Replace quoted terms
      .replace(/\^[\d.]+/g, '^BOOST') // Replace boost values
      .replace(/~[\d.]+/g, '~PROX')   // Replace proximity values
      .replace(/\([^)]*\)/g, '(CLAUSE)'); // Replace clause contents
    
    return pattern;
  }

  analyzeBrandBehavior() {
    console.log('\n🏷️ Analyzing Brand Behavior...');
    
    for (const testItem of this.results) {
      const product = testItem.product;
      const brand = product.brand;
      
      if (!brand) continue;

      if (!this.analysis.brandBehavior.has(brand)) {
        this.analysis.brandBehavior.set(brand, {
          totalTests: 0,
          successes: 0,
          commonErrors: {},
          bestStrategies: [],
          normalizationIssues: []
        });
      }

      const brandData = this.analysis.brandBehavior.get(brand);
      
      for (const [testKey, result] of Object.entries(testItem.results)) {
        brandData.totalTests++;
        
        if (result.status === 'success' && result.count > 0) {
          brandData.successes++;
          brandData.bestStrategies.push(testKey.split('_')[0]); // Extract strategy name
        }

        if (result.error) {
          const errorType = this.categorizeError(result.error);
          brandData.commonErrors[errorType] = (brandData.commonErrors[errorType] || 0) + 1;
        }
      }

      // Detect normalization issues
      if (brand.includes('&') || brand.includes("'") || brand.includes('-')) {
        brandData.normalizationIssues.push('special_characters');
      }
      if (brand.split(' ').length > 2) {
        brandData.normalizationIssues.push('multi_word');
      }
    }
  }

  analyzeRateLimit() {
    console.log('\n⏱️ Analyzing Rate Limiting...');
    
    let rateLimitCount = 0;
    const rateLimitTimes = [];
    
    for (const testItem of this.results) {
      for (const [testKey, result] of Object.entries(testItem.results)) {
        if (result.error && result.error.includes('rate limit')) {
          rateLimitCount++;
          rateLimitTimes.push(result.duration_ms);
          this.analysis.rateLimit.triggers.push({
            product: testItem.product.id,
            strategy: testKey,
            time: result.duration_ms
          });
        }
      }
    }

    this.analysis.rateLimit.frequency = rateLimitCount;
    this.analysis.rateLimit.avgTriggerTime = rateLimitTimes.length > 0 
      ? rateLimitTimes.reduce((a, b) => a + b, 0) / rateLimitTimes.length 
      : 0;
  }

  generateInsights() {
    console.log('\n💡 Generating API Insights...');
    
    const insights = {
      summary: {
        totalTests: this.results.reduce((sum, item) => sum + Object.keys(item.results).length, 0),
        totalProducts: this.results.length,
        overallSuccessRate: 0
      },
      endpointComparison: {},
      criticalFindings: [],
      recommendations: [],
      queryOptimization: {},
      brandSpecificIssues: {},
      apiLimitations: []
    };

    // Calculate overall success rate
    let totalSuccesses = 0;
    let totalTests = 0;
    
    for (const endpoint of Object.values(this.analysis.endpoints)) {
      totalSuccesses += endpoint.success;
      totalTests += endpoint.total;
    }
    insights.summary.overallSuccessRate = totalTests > 0 ? (totalSuccesses / totalTests) * 100 : 0;

    // Endpoint comparison
    for (const [name, stats] of Object.entries(this.analysis.endpoints)) {
      if (stats.total === 0) continue;
      
      insights.endpointComparison[name] = {
        successRate: stats.successRate.toFixed(1) + '%',
        avgDuration: Math.round(stats.avgDuration) + 'ms',
        totalTests: stats.total,
        mainErrors: Object.entries(stats.errors)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([error, count]) => ({ error, count }))
      };
    }

    // Critical findings
    if (this.analysis.endpoints.sal.errors.server_error > 10) {
      insights.criticalFindings.push('SaL API has high server error rate (500s)');
    }
    
    if (this.analysis.rateLimit.frequency > totalTests * 0.3) {
      insights.criticalFindings.push('High rate limiting frequency detected');
    }

    // Query optimization insights
    const successfulPatterns = Array.from(this.analysis.luceneQueries.patterns.entries())
      .filter(([pattern, data]) => data.successes > data.failures)
      .sort((a, b) => b[1].successes - a[1].successes)
      .slice(0, 5);

    insights.queryOptimization.bestPatterns = successfulPatterns.map(([pattern, data]) => ({
      pattern,
      successRate: ((data.successes / data.count) * 100).toFixed(1) + '%',
      totalUses: data.count
    }));

    // Brand-specific issues
    for (const [brand, data] of this.analysis.brandBehavior.entries()) {
      const successRate = (data.successes / data.totalTests) * 100;
      if (successRate < 20 && data.totalTests > 5) {
        insights.brandSpecificIssues[brand] = {
          successRate: successRate.toFixed(1) + '%',
          issues: data.normalizationIssues,
          commonErrors: Object.entries(data.commonErrors)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2)
        };
      }
    }

    // Recommendations
    if (this.analysis.endpoints.sal.errors.server_error > 5) {
      insights.recommendations.push('Implement aggressive SaL error handling and fallback to v2');
    }
    
    if (this.analysis.rateLimit.frequency > 10) {
      insights.recommendations.push('Implement more conservative rate limiting (longer delays)');
    }

    if (Object.keys(insights.brandSpecificIssues).length > 0) {
      insights.recommendations.push('Improve brand normalization for special characters');
    }

    return insights;
  }

  async generateReport(outputDir) {
    console.log('\n📊 Generating Comprehensive API Analysis Report...');
    
    await fs.mkdir(outputDir, { recursive: true });

    // Generate insights
    const insights = this.generateInsights();

    // Save detailed analysis
    await fs.writeFile(
      path.join(outputDir, 'api-analysis-detailed.json'),
      JSON.stringify(this.analysis, null, 2)
    );

    // Save insights
    await fs.writeFile(
      path.join(outputDir, 'api-insights.json'),
      JSON.stringify(insights, null, 2)
    );

    // Generate markdown report
    const markdownReport = this.generateMarkdownReport(insights);
    await fs.writeFile(
      path.join(outputDir, 'OFF-API-ANALYSIS.md'),
      markdownReport
    );

    console.log(`✅ Reports saved to: ${outputDir}`);
    return insights;
  }

  generateMarkdownReport(insights) {
    const md = [];
    
    md.push('# OpenFoodFacts API - Comprehensive Analysis');
    md.push(`Generated: ${new Date().toISOString()}\n`);
    
    md.push('## 📊 Executive Summary');
    md.push(`- **Total Tests:** ${insights.summary.totalTests}`);
    md.push(`- **Products Tested:** ${insights.summary.totalProducts}`);
    md.push(`- **Overall Success Rate:** ${insights.summary.overallSuccessRate.toFixed(1)}%`);
    md.push(`- **Critical Issues Found:** ${insights.criticalFindings.length}\n`);

    md.push('## 🔌 API Endpoints Comparison');
    md.push('| Endpoint | Success Rate | Avg Duration | Tests | Main Errors |');
    md.push('|----------|-------------|-------------|-------|-------------|');
    
    for (const [endpoint, data] of Object.entries(insights.endpointComparison)) {
      const errors = data.mainErrors.map(e => `${e.error}(${e.count})`).join(', ') || 'none';
      md.push(`| ${endpoint.toUpperCase()} | ${data.successRate} | ${data.avgDuration} | ${data.totalTests} | ${errors} |`);
    }
    
    md.push('\n## 🚨 Critical Findings');
    insights.criticalFindings.forEach((finding, i) => {
      md.push(`${i + 1}. **${finding}**`);
    });

    md.push('\n## 🎯 Query Optimization');
    md.push('### Best Performing Lucene Patterns');
    md.push('| Pattern | Success Rate | Uses |');
    md.push('|---------|-------------|------|');
    
    insights.queryOptimization.bestPatterns?.forEach(pattern => {
      md.push(`| \`${pattern.pattern.substring(0, 50)}...\` | ${pattern.successRate} | ${pattern.totalUses} |`);
    });

    md.push('\n## 🏷️ Brand-Specific Issues');
    for (const [brand, data] of Object.entries(insights.brandSpecificIssues)) {
      md.push(`### ${brand}`);
      md.push(`- Success Rate: ${data.successRate}`);
      md.push(`- Issues: ${data.issues.join(', ')}`);
      md.push(`- Common Errors: ${data.commonErrors.map(e => `${e[0]}(${e[1]})`).join(', ')}`);
    }

    md.push('\n## 💡 Recommendations');
    insights.recommendations.forEach((rec, i) => {
      md.push(`${i + 1}. ${rec}`);
    });

    md.push('\n## 📈 API Behavior Analysis');
    
    md.push('### SaL API (Search-a-licious)');
    const sal = insights.endpointComparison.sal;
    if (sal) {
      md.push(`- **Reliability:** ${sal.successRate} success rate`);
      md.push(`- **Performance:** ${sal.avgDuration} average response time`);
      md.push('- **Issues:** High 500 error rate, complex Lucene queries cause failures');
      md.push('- **Best for:** Simple brand+product queries when working');
    }

    md.push('\n### v2 API');
    const v2 = insights.endpointComparison.v2;
    if (v2) {
      md.push(`- **Reliability:** ${v2.successRate} success rate`);
      md.push(`- **Performance:** ${v2.avgDuration} average response time`);
      md.push('- **Issues:** Strict requirements (brand+category), timeout prone');
      md.push('- **Best for:** Structured searches with known brand and category');
    }

    md.push('\n### Legacy API');
    const legacy = insights.endpointComparison.legacy;
    if (legacy) {
      md.push(`- **Reliability:** ${legacy.successRate} success rate`);
      md.push(`- **Performance:** ${legacy.avgDuration} average response time`);
      md.push('- **Issues:** Rate limiting, slower responses');
      md.push('- **Best for:** Fallback when other APIs fail');
    }

    return md.join('\n');
  }

  async runAnalysis(resultsDir, outputDir = './api-analysis') {
    console.log('🔍 Starting Comprehensive OFF API Analysis...\n');
    
    // Load test results
    const loaded = await this.loadTestResults(resultsDir);
    if (!loaded) return false;

    // Run all analysis phases
    this.analyzeEndpointBehavior();
    this.analyzeBrandBehavior();
    this.analyzeRateLimit();

    // Generate and save reports
    const insights = await this.generateReport(outputDir);

    // Print key insights
    console.log('\n🎯 Key API Insights:');
    console.log(`  • Overall Success Rate: ${insights.summary.overallSuccessRate.toFixed(1)}%`);
    console.log(`  • Critical Issues: ${insights.criticalFindings.length}`);
    console.log(`  • Brand Issues: ${Object.keys(insights.brandSpecificIssues).length} problematic brands`);
    console.log(`  • Recommendations: ${insights.recommendations.length} actionable items`);

    return insights;
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const resultsDir = args[0] || './off-test-results';
  const outputDir = args[1] || './off-api-analysis';

  const analyzer = new OFFApiAnalyzer();
  
  try {
    await analyzer.runAnalysis(resultsDir, outputDir);
    console.log('\n✅ API Analysis Complete!');
  } catch (error) {
    console.error('❌ Analysis failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (process.argv[1] && (
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === new URL(process.argv[1], 'file:').href
)) {
  main();
}

export { OFFApiAnalyzer };
