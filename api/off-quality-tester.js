#!/usr/bin/env node

/**
 * OpenFoodFacts Quality Tester
 * 
 * Фокус на реальных проблемах продакшена:
 * - Качество поиска продуктов
 * - Правильность распознавания брендов
 * - Точность категоризации
 * - Реалистичные интервалы между запросами
 */

import { searchByNameV1, canonicalizeQuery } from './modules/nutrition/off-client.js';
import { resolveOneItemOFF } from './modules/nutrition/off-resolver.js';
import fs from 'fs/promises';

// Реалистичные продукты из реального использования
const REAL_WORLD_PRODUCTS = [
  {
    id: 'philadelphia_light_real',
    user_input: 'Philadelphia light cream cheese',
    expected_brand: 'Philadelphia',
    expected_product: 'cream cheese',
    expected_variant: 'light',
    expected_category: 'dairy',
    difficulty: 'easy' // популярный бренд
  },
  {
    id: 'central_lechera_semi',
    user_input: 'Central Lechera leche semidesnatada',
    expected_brand: 'Central Lechera Asturiana',
    expected_product: 'milk',
    expected_variant: 'semidesnatada',
    expected_category: 'dairy',
    difficulty: 'medium' // испанский, длинный бренд
  },
  {
    id: 'mms_peanut',
    user_input: 'M&Ms peanut',
    expected_brand: 'M&M\'s',
    expected_product: 'chocolate',
    expected_variant: 'peanut',
    expected_category: 'snacks',
    difficulty: 'hard' // спецсимволы в бренде
  },
  {
    id: 'cocacola_zero',
    user_input: 'Coca Cola Zero',
    expected_brand: 'Coca-Cola',
    expected_product: 'cola',
    expected_variant: 'zero',
    expected_category: 'beverages',
    difficulty: 'easy'
  },
  {
    id: 'alpro_soja_natural',
    user_input: 'Alpro bebida soja natural',
    expected_brand: 'Alpro',
    expected_product: 'soy milk',
    expected_variant: 'natural',
    expected_category: 'plant-based',
    difficulty: 'medium' // plant-based, испанский
  },
  {
    id: 'danone_yogur_griego',
    user_input: 'Danone yogur griego natural',
    expected_brand: 'Danone',
    expected_product: 'greek yogurt',
    expected_variant: 'natural',
    expected_category: 'dairy',
    difficulty: 'medium'
  },
  {
    id: 'nutella_350g',
    user_input: 'Nutella 350g',
    expected_brand: 'Ferrero',
    expected_product: 'hazelnut spread',
    expected_variant: null,
    expected_category: 'spreads',
    difficulty: 'easy'
  },
  {
    id: 'aceite_oliva_virgen',
    user_input: 'aceite oliva virgen extra',
    expected_brand: null, // generic product
    expected_product: 'olive oil',
    expected_variant: 'extra virgin',
    expected_category: 'oils',
    difficulty: 'hard' // no brand, spanish
  },
  {
    id: 'pan_integral',
    user_input: 'pan de molde integral',
    expected_brand: null,
    expected_product: 'bread',
    expected_variant: 'integral',
    expected_category: 'bakery',
    difficulty: 'hard' // generic, spanish
  },
  {
    id: 'queso_manchego',
    user_input: 'queso manchego curado',
    expected_brand: null,
    expected_product: 'manchego cheese',
    expected_variant: 'curado',
    expected_category: 'dairy',
    difficulty: 'medium'
  }
];

class QualityTester {
  constructor() {
    this.results = [];
    this.qualityMetrics = {
      brandAccuracy: 0,
      productAccuracy: 0,
      categoryAccuracy: 0,
      overallFindRate: 0,
      byDifficulty: {
        easy: { total: 0, found: 0, correct: 0 },
        medium: { total: 0, found: 0, correct: 0 },
        hard: { total: 0, found: 0, correct: 0 }
      }
    };
  }

  async testProduct(product) {
    console.log(`\n🧪 Testing: "${product.user_input}" (${product.difficulty})`);
    
    const result = {
      id: product.id,
      user_input: product.user_input,
      expected: product,
      found: null,
      quality: {
        found: false,
        brand_match: false,
        product_match: false,
        category_match: false,
        variant_match: false
      },
      api_response: null,
      duration_ms: 0,
      error: null
    };

    const startTime = Date.now();
    
    try {
      // Simulate real usage - через resolveOneItemOFF
      const mockItem = {
        name: product.user_input,
        brand: product.expected_brand,
        canonical_category: product.expected_category,
        confidence: 0.8
      };

      const response = await resolveOneItemOFF(mockItem);
      result.duration_ms = Date.now() - startTime;
      
      if (response.product) {
        result.found = {
          code: response.product.code,
          name: response.product.product_name,
          brands: response.product.brands,
          categories: response.product.categories_tags?.slice(0, 3),
          score: response.score
        };
        result.quality.found = true;
        
        // Analyze quality
        this.analyzeQuality(result, product);
        
        console.log(`  ✅ Found: ${result.found.name} (${result.found.brands})`);
        console.log(`  📊 Score: ${response.score?.toFixed(2) || 'N/A'}`);
        
      } else {
        console.log(`  ❌ Not found: ${response.reason || 'unknown'}`);
        result.error = response.reason;
      }
      
    } catch (error) {
      result.duration_ms = Date.now() - startTime;
      result.error = error.message;
      console.log(`  💥 Error: ${error.message}`);
    }

    return result;
  }

  analyzeQuality(result, expected) {
    const found = result.found;
    
    // Brand matching
    if (expected.expected_brand && found.brands) {
      const expectedBrand = expected.expected_brand.toLowerCase();
      const foundBrands = found.brands.toLowerCase();
      result.quality.brand_match = foundBrands.includes(expectedBrand) || 
                                   expectedBrand.includes(foundBrands);
    }

    // Product matching (fuzzy)
    if (expected.expected_product && found.name) {
      const expectedProduct = expected.expected_product.toLowerCase();
      const foundName = found.name.toLowerCase();
      result.quality.product_match = foundName.includes(expectedProduct) ||
                                     expectedProduct.split(' ').some(word => 
                                       foundName.includes(word) && word.length > 3
                                     );
    }

    // Category matching
    if (expected.expected_category && found.categories) {
      const categoryMap = {
        'dairy': ['milk', 'cheese', 'yogurt', 'butter'],
        'beverages': ['drink', 'soda', 'juice', 'water'],
        'snacks': ['chocolate', 'candy', 'chip', 'biscuit'],
        'plant-based': ['plant', 'soy', 'oat', 'almond'],
        'spreads': ['spread', 'jam', 'honey'],
        'oils': ['oil'],
        'bakery': ['bread', 'cake'],
      };
      
      const expectedKeywords = categoryMap[expected.expected_category] || [];
      const foundCategories = found.categories.join(' ').toLowerCase();
      result.quality.category_match = expectedKeywords.some(keyword =>
        foundCategories.includes(keyword)
      );
    }

    // Variant matching
    if (expected.expected_variant && found.name) {
      const expectedVariant = expected.expected_variant.toLowerCase();
      const foundName = found.name.toLowerCase();
      result.quality.variant_match = foundName.includes(expectedVariant);
    }
  }

  async runQualityTest() {
    console.log('🎯 OpenFoodFacts Quality Test - Real World Scenarios');
    console.log(`Testing ${REAL_WORLD_PRODUCTS.length} realistic products...\n`);

    for (const product of REAL_WORLD_PRODUCTS) {
      const result = await this.testProduct(product);
      this.results.push(result);
      
      // Update metrics
      const difficulty = this.qualityMetrics.byDifficulty[product.difficulty];
      difficulty.total++;
      
      if (result.quality.found) {
        difficulty.found++;
        if (result.quality.brand_match || result.quality.product_match) {
          difficulty.correct++;
        }
      }
      
      // Realistic pause between requests (30-60 seconds)
      const pauseMs = 30000 + Math.random() * 30000;
      console.log(`  ⏳ Pausing ${Math.round(pauseMs/1000)}s (realistic usage)...`);
      await new Promise(resolve => setTimeout(resolve, pauseMs));
    }

    this.calculateMetrics();
    return this.results;
  }

  calculateMetrics() {
    const total = this.results.length;
    let found = 0;
    let brandCorrect = 0;
    let productCorrect = 0;
    let categoryCorrect = 0;

    for (const result of this.results) {
      if (result.quality.found) found++;
      if (result.quality.brand_match) brandCorrect++;
      if (result.quality.product_match) productCorrect++;
      if (result.quality.category_match) categoryCorrect++;
    }

    this.qualityMetrics.overallFindRate = (found / total) * 100;
    this.qualityMetrics.brandAccuracy = (brandCorrect / found) * 100 || 0;
    this.qualityMetrics.productAccuracy = (productCorrect / found) * 100 || 0;
    this.qualityMetrics.categoryAccuracy = (categoryCorrect / found) * 100 || 0;
  }

  generateQualityReport() {
    const report = [];
    
    report.push('# OpenFoodFacts Quality Analysis Report');
    report.push(`Generated: ${new Date().toISOString()}\n`);
    
    report.push('## 🎯 Quality Metrics');
    report.push(`- **Overall Find Rate:** ${this.qualityMetrics.overallFindRate.toFixed(1)}%`);
    report.push(`- **Brand Accuracy:** ${this.qualityMetrics.brandAccuracy.toFixed(1)}%`);
    report.push(`- **Product Accuracy:** ${this.qualityMetrics.productAccuracy.toFixed(1)}%`);
    report.push(`- **Category Accuracy:** ${this.qualityMetrics.categoryAccuracy.toFixed(1)}%\n`);
    
    report.push('## 📊 By Difficulty Level');
    for (const [level, stats] of Object.entries(this.qualityMetrics.byDifficulty)) {
      if (stats.total === 0) continue;
      const findRate = (stats.found / stats.total) * 100;
      const accuracy = stats.found > 0 ? (stats.correct / stats.found) * 100 : 0;
      
      report.push(`### ${level.toUpperCase()}`);
      report.push(`- Find Rate: ${findRate.toFixed(1)}% (${stats.found}/${stats.total})`);
      report.push(`- Accuracy: ${accuracy.toFixed(1)}%`);
    }
    
    report.push('\n## 🔍 Detailed Results');
    report.push('| Product | Found | Brand Match | Product Match | Category Match |');
    report.push('|---------|-------|-------------|---------------|----------------|');
    
    for (const result of this.results) {
      const found = result.quality.found ? '✅' : '❌';
      const brand = result.quality.brand_match ? '✅' : '❌';
      const product = result.quality.product_match ? '✅' : '❌';
      const category = result.quality.category_match ? '✅' : '❌';
      
      report.push(`| ${result.user_input} | ${found} | ${brand} | ${product} | ${category} |`);
    }
    
    report.push('\n## 💡 Quality Issues Found');
    
    const issues = [];
    for (const result of this.results) {
      if (!result.quality.found) {
        issues.push(`**${result.user_input}**: Not found at all (${result.error || 'unknown reason'})`);
      } else if (!result.quality.brand_match && result.expected.expected_brand) {
        issues.push(`**${result.user_input}**: Wrong brand (expected: ${result.expected.expected_brand}, found: ${result.found.brands})`);
      } else if (!result.quality.product_match) {
        issues.push(`**${result.user_input}**: Wrong product type (expected: ${result.expected.expected_product}, found: ${result.found.name})`);
      }
    }
    
    issues.slice(0, 10).forEach(issue => report.push(`- ${issue}`));
    
    return report.join('\n');
  }

  async saveResults(outputDir) {
    await fs.mkdir(outputDir, { recursive: true });
    
    // Save raw results
    await fs.writeFile(
      `${outputDir}/quality-test-results.json`,
      JSON.stringify({
        results: this.results,
        metrics: this.qualityMetrics,
        timestamp: new Date().toISOString()
      }, null, 2)
    );
    
    // Save quality report
    const report = this.generateQualityReport();
    await fs.writeFile(
      `${outputDir}/quality-analysis.md`,
      report
    );
    
    console.log(`\n📊 Results saved to ${outputDir}/`);
  }
}

// Main execution
async function main() {
  const tester = new QualityTester();
  
  try {
    await tester.runQualityTest();
    
    console.log('\n📈 Final Quality Metrics:');
    console.log(`  Find Rate: ${tester.qualityMetrics.overallFindRate.toFixed(1)}%`);
    console.log(`  Brand Accuracy: ${tester.qualityMetrics.brandAccuracy.toFixed(1)}%`);
    console.log(`  Product Accuracy: ${tester.qualityMetrics.productAccuracy.toFixed(1)}%`);
    
    await tester.saveResults('./off-quality-analysis');
    
  } catch (error) {
    console.error('❌ Quality test failed:', error);
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

export { QualityTester, REAL_WORLD_PRODUCTS };
