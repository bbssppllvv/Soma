#!/usr/bin/env node

/**
 * OpenFoodFacts Search Testing Suite
 * 
 * Comprehensive testing of OFF search strategies across different APIs:
 * - Search-a-licious (SaL v3)
 * - v2 strict/brandless
 * - Legacy search
 * 
 * Usage: node off-search-tester.js [options]
 * Options:
 *   --output-dir DIR    Output directory for results (default: ./off-test-results)
 *   --timeout MS        Global timeout per test case (default: 5000)
 *   --verbose           Enable verbose logging
 *   --categories CAT    Test only specific categories (comma-separated)
 *   --strategies STRAT  Test only specific strategies (comma-separated)
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Import our OFF modules
import { 
  searchByNameV1, 
  canonicalizeQuery,
  getByBarcode
} from './modules/nutrition/off-client.js';
import { matchVariantRules, isVariantToken } from './modules/nutrition/variant-rules.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== TEST DATASET =====

const TEST_PRODUCTS = [
  // ===== REAL PATTERNS FROM LOGS =====
  
  // 🧀 DAIRY PRODUCTS
  {
    id: 'philadelphia_light',
    category: 'dairy',
    brand: 'Philadelphia',
    product_name: 'light cream cheese',
    clean_name: 'cream cheese',
    required_tokens: ['light'],
    canonical_category: 'dairy',
    
    // Real Lucene query pattern from logs
    expected_lucene: `brands:"philadelphia"^4 AND categories_tags:"en:cheeses" AND NOT categories_tags:"en:plant-based-milk-alternatives" AND (product_name:("light"^3 OR ligera^2 OR lite^2) OR labels_tags:("en:light" OR "es:ligera")) AND product_name:"philadelphia light"~3`,
    
    variations: [
      { query: 'Philadelphia light', strategy: 'brand_product' },
      { query: 'philadelphia ligero', strategy: 'brand_spanish' },
      { query: 'Philadelphia Light Cream Cheese', strategy: 'brand_full_name' },
      { query: 'light cream cheese', strategy: 'product_only' },
      { query: 'Philadelphia', strategy: 'brand_only' },
      { query: 'philadelphia lite', strategy: 'brand_variant' }
    ],
    expected_brands: ['philadelphia'],
    expected_categories: ['en:cream-cheeses', 'en:cheeses'],
    known_issues: ['brand normalization', 'variant token matching']
  },
  {
    id: 'central_lechera_semi',
    category: 'dairy', 
    brand: 'Central Lechera Asturiana',
    product_name: 'leche semi desnatada',
    clean_name: 'leche',
    required_tokens: ['semi', 'desnatada'],
    canonical_category: 'dairy',
    
    expected_lucene: `brands:"central lechera asturiana"^4 AND categories_tags:"en:milks" AND NOT categories_tags:"en:plant-based-milk-alternatives" AND ((product_name:("semi desnatada"~1 OR semidesnatada OR "semi-desnatada") OR labels_tags:("es:semidesnatada")) AND (product_name:(desnatada) OR labels_tags:("es:desnatada"))) AND product_name:"central lechera asturiana semi desnatada"~3`,
    
    variations: [
      { query: 'Central Lechera Asturiana Leche semi desnatada', strategy: 'full_brand_product' },
      { query: 'Central Lechera semi desnatada', strategy: 'short_brand' },
      { query: 'central lechera semidesnatada', strategy: 'compound_variant' },
      { query: 'Central Lechera semi-desnatada', strategy: 'hyphenated' },
      { query: 'leche semi desnatada', strategy: 'product_only' },
      { query: 'Central Lechera Asturiana', strategy: 'brand_only' }
    ],
    expected_brands: ['central-lechera-asturiana', 'central lechera'],
    expected_categories: ['en:milks', 'en:semi-skimmed-milks'],
    known_issues: ['multi-word brand normalization', 'compound variant tokens']
  },
  {
    id: 'central_lechera_mantequilla',
    category: 'dairy',
    brand: 'Central Lechera Asturiana',
    product_name: 'mantequilla tradicional',
    clean_name: 'mantequilla',
    required_tokens: ['tradicional'],
    canonical_category: 'dairy',
    
    expected_lucene: `brands:"central lechera asturiana"^4 AND categories_tags:"en:butters" AND NOT categories_tags:"en:plant-based-milk-alternatives" AND (product_name:(tradicional) OR labels_tags:("es:tradicional")) AND product_name:"central lechera asturiana tradicional"~3`,
    
    variations: [
      { query: 'Central Lechera Asturiana Mantequilla Tradicional', strategy: 'full_name' },
      { query: 'Central Lechera mantequilla tradicional', strategy: 'short_brand' },
      { query: 'mantequilla tradicional', strategy: 'product_only' },
      { query: 'Central Lechera tradicional', strategy: 'brand_variant' },
      { query: 'mantequilla traditional', strategy: 'english_variant' }
    ],
    expected_brands: ['central-lechera-asturiana'],
    expected_categories: ['en:butters'],
    known_issues: ['spanish-english variant mixing']
  },

  // 🥤 BEVERAGES
  {
    id: 'coca_cola_original',
    category: 'beverages',
    brand: 'Coca-Cola',
    product_name: 'cola',
    clean_name: 'cola',
    required_tokens: [],
    canonical_category: 'beverage',
    
    expected_lucene: `brands:"coca cola"^4 AND product_name:"coca cola"~3`,
    
    variations: [
      { query: 'Coca-Cola', strategy: 'brand_hyphenated' },
      { query: 'Coca Cola', strategy: 'brand_spaces' },
      { query: 'coca cola original', strategy: 'brand_variant' },
      { query: 'cocacola', strategy: 'brand_collapsed' },
      { query: 'cola', strategy: 'product_only' }
    ],
    expected_brands: ['coca-cola'],
    expected_categories: ['en:sodas', 'en:cola-sodas'],
    known_issues: ['hyphen vs space normalization']
  },
  {
    id: 'pepsi_zero',
    category: 'beverages',
    brand: 'Pepsi',
    product_name: 'cola zero',
    clean_name: 'cola',
    required_tokens: ['zero'],
    canonical_category: 'beverage',
    
    expected_lucene: `brands:"pepsi"^4 AND categories_tags:"en:carbonated-drinks" AND (product_name:(zero) OR labels_tags:("en:zero" "es:zero"))`,
    
    variations: [
      { query: 'Pepsi Zero', strategy: 'brand_variant' },
      { query: 'pepsi zero sugar', strategy: 'brand_extended_variant' },
      { query: 'Pepsi Zero Sugar', strategy: 'brand_full_variant' },
      { query: 'pepsi 0', strategy: 'numeric_variant' },
      { query: 'zero cola', strategy: 'variant_product' }
    ],
    expected_brands: ['pepsi'],
    expected_categories: ['en:sodas', 'en:cola-sodas'],
    known_issues: ['zero vs 0 variant matching']
  },

  // 🍫 SNACKS (проблематичные кейсы)
  {
    id: 'mms_peanut_butter',
    category: 'snacks',
    brand: 'M&M\'s',
    product_name: 'peanut butter chocolate',
    clean_name: 'chocolate',
    required_tokens: ['peanut', 'butter'],
    canonical_category: 'snack-sweet',
    
    // Типичный кейс с поломанным брендом из логов
    expected_lucene: `brands:"m&m's"^4 AND (product_name:("peanut butter"~2^3) OR product_name:("peanut"^1.5 OR "butter"^1.5))`,
    
    variations: [
      { query: 'M&M\'s peanut butter', strategy: 'brand_apostrophe' },
      { query: 'M M s peanut butter', strategy: 'brand_spaces' },
      { query: 'MMs peanut butter', strategy: 'brand_collapsed' },
      { query: 'M&Ms Peanut Butter', strategy: 'brand_no_apostrophe' },
      { query: 'm and m peanut butter', strategy: 'brand_expanded' },
      { query: 'peanut butter chocolate', strategy: 'product_only' }
    ],
    expected_brands: ['m-m-s', 'mars'],
    expected_categories: ['en:chocolate-candies', 'en:candies'],
    known_issues: ['special characters in brand', 'apostrophe normalization', 'brand fragmentation']
  },
  {
    id: 'kitkat_chunky',
    category: 'snacks',
    brand: 'KitKat',
    product_name: 'chunky chocolate bar',
    clean_name: 'chocolate bar',
    required_tokens: ['chunky'],
    canonical_category: 'snack-sweet',
    
    expected_lucene: `brands:"kitkat"^4 AND categories_tags:"en:chocolates" AND product_name:"chunky"~2`,
    
    variations: [
      { query: 'KitKat chunky', strategy: 'brand_camelcase' },
      { query: 'Kit Kat chunky', strategy: 'brand_spaces' },
      { query: 'kitkat chunky', strategy: 'brand_lowercase' },
      { query: 'KitKat Chunky', strategy: 'brand_proper' },
      { query: 'kit-kat chunky', strategy: 'brand_hyphenated' },
      { query: 'chunky chocolate bar', strategy: 'product_only' }
    ],
    expected_brands: ['kitkat', 'nestle'],
    expected_categories: ['en:chocolate-bars', 'en:chocolate-products'],
    known_issues: ['camelcase vs spaces', 'parent brand detection']
  },

  // 🌱 PLANT-BASED
  {
    id: 'alpro_soja',
    category: 'plant-based',
    brand: 'Alpro',
    product_name: 'soja milk',
    clean_name: 'milk',
    required_tokens: ['soja'],
    canonical_category: 'dairy',
    
    expected_lucene: `brands:"alpro"^4 AND categories_tags:"en:plant-based-milk-alternatives" AND (product_name:(soja) OR labels_tags:("es:soja" "en:soy"))`,
    
    variations: [
      { query: 'Alpro soja', strategy: 'brand_spanish' },
      { query: 'alpro soy milk', strategy: 'brand_english' },
      { query: 'Alpro bebida de soja', strategy: 'brand_full_spanish' },
      { query: 'Alpro Soja', strategy: 'brand_proper' },
      { query: 'soja milk', strategy: 'spanish_product' },
      { query: 'soy milk', strategy: 'english_product' }
    ],
    expected_brands: ['alpro'],
    expected_categories: ['en:soy-milks', 'en:plant-based-milk-alternatives'],
    known_issues: ['spanish-english variant mixing', 'category exclusion conflicts']
  },
  {
    id: 'oatly_oat_milk',
    category: 'plant-based',
    brand: 'Oatly',
    product_name: 'oat milk',
    clean_name: 'milk',
    required_tokens: ['oat'],
    canonical_category: 'dairy',
    
    expected_lucene: `brands:"oatly"^4 AND categories_tags:"en:plant-based-milk-alternatives" AND (product_name:(oat) OR labels_tags:("en:oats"))`,
    
    variations: [
      { query: 'Oatly oat milk', strategy: 'brand_full_english' },
      { query: 'oatly avena', strategy: 'brand_spanish' },
      { query: 'Oatly Oat Drink', strategy: 'brand_alternative_name' },
      { query: 'oatly original', strategy: 'brand_variant' },
      { query: 'oat milk', strategy: 'product_only' },
      { query: 'avena drink', strategy: 'spanish_product' }
    ],
    expected_brands: ['oatly'],
    expected_categories: ['en:oat-milks', 'en:plant-based-milk-alternatives'],
    known_issues: ['oat vs avena translation', 'milk vs drink terminology']
  },

  // 🧪 EDGE CASES & STRESS TESTS
  {
    id: 'special_chars_stress',
    category: 'test',
    brand: 'Ben & Jerry\'s',
    product_name: 'cookie dough ice cream',
    clean_name: 'ice cream',
    required_tokens: ['cookie', 'dough'],
    canonical_category: 'dessert',
    
    variations: [
      { query: 'Ben & Jerry\'s cookie dough', strategy: 'full_special_chars' },
      { query: 'Ben and Jerrys cookie dough', strategy: 'expanded_chars' },
      { query: 'ben jerry cookie dough', strategy: 'no_special_chars' },
      { query: 'Ben & Jerry\'s Cookie Dough', strategy: 'proper_case' },
      { query: 'ben&jerrys cookie dough', strategy: 'collapsed_chars' }
    ],
    expected_brands: ['ben-jerry-s', 'ben-jerrys'],
    expected_categories: ['en:ice-creams'],
    known_issues: ['multiple special characters', 'apostrophe + ampersand']
  },
  {
    id: 'timeout_stress',
    category: 'test',
    brand: 'Very Long Brand Name That Might Cause Issues',
    product_name: 'extremely specific product with many descriptive words that could timeout',
    clean_name: 'product',
    required_tokens: ['extremely', 'specific', 'descriptive', 'words'],
    canonical_category: 'unknown',
    
    variations: [
      { query: 'Very Long Brand Name That Might Cause Issues extremely specific product with many descriptive words that could timeout', strategy: 'maximum_length' },
      { query: 'Very Long Brand extremely specific', strategy: 'truncated' },
      { query: 'Long Brand specific product', strategy: 'key_terms' }
    ],
    expected_brands: [],
    expected_categories: [],
    known_issues: ['query length limits', 'timeout probability', 'token limits']
  }
];

// ===== SEARCH STRATEGIES =====

const SEARCH_STRATEGIES = {
  // ===== MAIN SEARCH STRATEGIES =====
  
  // Use the main searchByNameV1 function which handles all fallbacks internally
  main_pipeline: {
    name: 'Main Pipeline (SaL + v2 + Legacy)',
    timeout: 3000,
    run: async (query, options) => {
      const result = await searchByNameV1(query.term, {
        signal: options.signal,
        categoryTags: query.categoryTags || [],
        negativeCategoryTags: query.negativeCategoryTags || [],
        brand: query.brand,
        maxPages: 1,
        locale: options.locale || 'en',
        variantTokens: query.variantTokens || []
      });
      return { ...result, api_endpoint: 'main_pipeline' };
    }
  },

  // Test different query combinations
  brand_with_product: {
    name: 'Brand + Product Combined',
    timeout: 1000,
    run: async (query, options) => {
      const combinedTerm = query.brand ? `${query.brand} ${query.term}` : query.term;
      return await searchByNameV1(combinedTerm, {
        signal: options.signal,
        categoryTags: query.categoryTags || [],
        negativeCategoryTags: query.negativeCategoryTags || [],
        brand: null, // Don't duplicate brand in brand filter
        maxPages: 1,
        locale: options.locale || 'en',
        variantTokens: query.variantTokens || []
      });
    }
  },

  brand_separate: {
    name: 'Brand as Separate Filter',
    timeout: 1000,
    run: async (query, options) => {
      return await searchByNameV1(query.term, {
        signal: options.signal,
        categoryTags: query.categoryTags || [],
        negativeCategoryTags: query.negativeCategoryTags || [],
        brand: query.brand,
        maxPages: 1,
        locale: options.locale || 'en',
        variantTokens: query.variantTokens || []
      });
    }
  },

  product_only: {
    name: 'Product Name Only',
    timeout: 800,
    run: async (query, options) => {
      return await searchByNameV1(query.term, {
        signal: options.signal,
        categoryTags: query.categoryTags || [],
        negativeCategoryTags: query.negativeCategoryTags || [],
        brand: null,
        maxPages: 1,
        locale: options.locale || 'en',
        variantTokens: query.variantTokens || []
      });
    }
  }
};

// ===== UTILITY FUNCTIONS =====

function createAbortController(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error('timeout'));
  }, timeoutMs);
  
  return {
    controller,
    cleanup: () => clearTimeout(timeout)
  };
}

function buildQueryFromProduct(product, variation = null) {
  const searchTerm = variation || `${product.brand || ''} ${product.product_name || product.clean_name}`.trim();
  
  // Smart category detection based on product name
  let categoryTags = [];
  if (product.canonical_category) {
    const allCategories = getCategoryTags(product.canonical_category);
    
    // For dairy products, detect specific type
    if (product.canonical_category === 'dairy') {
      const productText = (product.product_name || '').toLowerCase();
      if (productText.includes('mantequilla') || productText.includes('butter')) {
        categoryTags = ['en:butters'];
      } else if (productText.includes('queso') || productText.includes('cheese') || productText.includes('philadelphia')) {
        categoryTags = ['en:cheeses'];
      } else {
        categoryTags = ['en:milks']; // default for dairy
      }
    } else {
      categoryTags = allCategories;
    }
  }
  
  return {
    term: canonicalizeQuery(searchTerm),
    brand: product.brand,
    categoryTags,
    negativeCategoryTags: product.canonical_category === 'dairy' ? ['en:plant-based-milk-alternatives'] : [],
    variantTokens: product.required_tokens || [],
    labelFilters: (product.required_tokens || []).filter(token => isVariantToken(token))
  };
}

function getCategoryTags(canonicalCategory) {
  const categoryMap = {
    'dairy': ['en:milks', 'en:cheeses', 'en:butters'],
    'beverage': ['en:beverages', 'en:sodas'],
    'snack-sweet': ['en:candies', 'en:chocolate-products'],
    'snack-salty': ['en:crisps', 'en:potato-chips'],
    'breakfast-cereal': ['en:breakfast-cereals'],
    'porridge': ['en:porridges', 'en:oat-flakes'],
    'dessert': ['en:ice-creams', 'en:desserts'],
    'prepared-food': ['en:prepared-meals'],
    'spread': ['en:spreads']
  };
  
  return categoryMap[canonicalCategory] || [];
}

function analyzeResults(product, strategyResults) {
  const analysis = {
    product_id: product.id,
    product_name: product.product_name,
    brand: product.brand,
    category: product.category,
    
    strategies_tested: Object.keys(strategyResults).length,
    strategies_with_results: 0,
    strategies_with_errors: 0,
    strategies_timed_out: 0,
    
    total_unique_products: new Set(),
    brand_matches: 0,
    category_matches: 0,
    
    best_strategy: null,
    best_score: 0,
    
    recommendations: []
  };

  for (const [strategyName, result] of Object.entries(strategyResults)) {
    if (result.error) {
      analysis.strategies_with_errors++;
      if (result.error.includes('timeout')) {
        analysis.strategies_timed_out++;
      }
      continue;
    }

    if (result.products && result.products.length > 0) {
      analysis.strategies_with_results++;
      
      // Count unique products
      result.products.forEach(p => {
        if (p.code) analysis.total_unique_products.add(p.code);
      });

      // Check brand matches
      const brandMatches = result.products.filter(p => {
        if (!product.expected_brands || !p.brands) return false;
        const productBrands = p.brands.toLowerCase();
        return product.expected_brands.some(expectedBrand => 
          productBrands.includes(expectedBrand.toLowerCase())
        );
      });
      
      if (brandMatches.length > 0) {
        analysis.brand_matches++;
      }

      // Check category matches
      const categoryMatches = result.products.filter(p => {
        if (!product.expected_categories || !p.categories_tags) return false;
        return product.expected_categories.some(expectedCat =>
          p.categories_tags.some(cat => cat.toLowerCase().includes(expectedCat.toLowerCase()))
        );
      });
      
      if (categoryMatches.length > 0) {
        analysis.category_matches++;
      }

      // Calculate strategy score
      const score = (brandMatches.length * 50) + (categoryMatches.length * 30) + (result.products.length * 5);
      if (score > analysis.best_score) {
        analysis.best_score = score;
        analysis.best_strategy = strategyName;
      }
    }
  }

  analysis.total_unique_products = analysis.total_unique_products.size;

  // Generate recommendations
  if (analysis.strategies_with_results === 0) {
    analysis.recommendations.push('No strategies returned results - check product data or API availability');
  } else if (analysis.brand_matches === 0) {
    analysis.recommendations.push('No brand matches found - verify brand name normalization');
  } else if (analysis.category_matches === 0) {
    analysis.recommendations.push('No category matches found - verify category mapping');
  }

  if (analysis.strategies_timed_out > analysis.strategies_tested / 2) {
    analysis.recommendations.push('High timeout rate - consider increasing timeouts or checking network');
  }

  return analysis;
}

// ===== MAIN TESTING LOGIC =====

async function runSingleTest(product, strategyName, strategy, options = {}) {
  const testResult = {
    product_id: product.id,
    strategy: strategyName,
    status: 'pending',
    start_time: Date.now(),
    end_time: null,
    duration_ms: null,
    error: null,
    products: [],
    count: 0,
    top_results: [],
    metadata: {}
  };

  try {
    const { controller, cleanup } = createAbortController(strategy.timeout);
    
    try {
      // Use test_query if available (from variation), otherwise build from product
      const queryText = product.test_query || `${product.brand || ''} ${product.product_name}`.trim();
      const mainQuery = buildQueryFromProduct({
        ...product,
        product_name: queryText
      });
      
      // Override the term with the exact test query
      mainQuery.term = canonicalizeQuery(queryText);
      
      const result = await strategy.run(mainQuery, { 
        signal: controller.signal, 
        locale: options.locale || 'en' 
      });

      testResult.status = 'success';
      testResult.products = result?.products || [];
      testResult.count = result?.count || testResult.products.length;
      testResult.metadata = {
        query: mainQuery,
        source: result?.source || strategyName,
        lucene_q: result?.lucene_q,
        skipped: result?.skipped
      };

      // Store top 3 results for analysis
      testResult.top_results = testResult.products.slice(0, 3).map(p => ({
        code: p.code,
        product_name: p.product_name,
        brands: p.brands,
        brands_tags: p.brands_tags?.slice(0, 3),
        categories_tags: p.categories_tags?.slice(0, 3),
        data_quality_score: p.data_quality_score
      }));

    } catch (strategyError) {
      testResult.status = 'error';
      testResult.error = strategyError.message || String(strategyError);
      
      if (controller.signal.aborted) {
        testResult.status = 'timeout';
        testResult.error = `Timeout after ${strategy.timeout}ms`;
      }
    } finally {
      cleanup();
    }

  } catch (outerError) {
    testResult.status = 'error';
    testResult.error = outerError.message || String(outerError);
  }

  testResult.end_time = Date.now();
  testResult.duration_ms = testResult.end_time - testResult.start_time;

  return testResult;
}

async function runProductTests(product, strategies, options = {}) {
  const results = {};
  
  console.log(`\n=== Testing Product: ${product.id} ===`);
  console.log(`    Brand: ${product.brand}`);
  console.log(`    Product: ${product.product_name}`);
  console.log(`    Category: ${product.category}`);
  console.log(`    Known Issues: ${product.known_issues?.join(', ') || 'none'}`);
  console.log(`    Variations to test: ${product.variations?.length || 0}`);
  
  // Test each variation of the product
  const variationsToTest = product.variations || [
    { query: `${product.brand || ''} ${product.product_name}`.trim(), strategy: 'default' }
  ];
  
  for (const variation of variationsToTest) {
    console.log(`\n  --- Testing Variation: "${variation.query}" (${variation.strategy}) ---`);
    
    for (const [strategyName, strategy] of Object.entries(strategies)) {
      if (options.strategies && !options.strategies.includes(strategyName)) {
        continue; // Skip if specific strategies requested
      }

      const testKey = `${strategyName}_${variation.strategy}`;
      console.log(`    Running ${strategyName}...`);
      
      // Create a modified product for this variation
      const variationProduct = {
        ...product,
        test_query: variation.query,
        variation_strategy: variation.strategy
      };
      
      const result = await runSingleTest(variationProduct, strategyName, strategy, options);
      results[testKey] = {
        ...result,
        variation: variation.strategy,
        test_query: variation.query
      };
      
      const statusIcon = result.status === 'success' ? '✅' : 
                        result.status === 'timeout' ? '⏱️' : '❌';
      console.log(`      ${statusIcon} ${result.status} (${result.duration_ms}ms) - ${result.count} results`);
      
      if (options.verbose && result.top_results.length > 0) {
        console.log(`      Top: ${result.top_results[0].product_name} (${result.top_results[0].brands})`);
      }
      
      // Log Lucene query if available
      if (result.metadata?.lucene_q && options.verbose) {
        console.log(`      Lucene: ${result.metadata.lucene_q.substring(0, 100)}...`);
      }
    }
  }

  return results;
}

async function runAllTests(options = {}) {
  const startTime = Date.now();
  const allResults = [];
  const summary = {
    total_products: 0,
    total_tests: 0,
    successful_tests: 0,
    failed_tests: 0,
    timeout_tests: 0,
    total_duration_ms: 0,
    strategies_performance: {},
    category_performance: {},
    issues_found: []
  };

  const productsToTest = options.categories 
    ? TEST_PRODUCTS.filter(p => options.categories.includes(p.category))
    : TEST_PRODUCTS;

  console.log(`\n🚀 Starting OFF Search Testing Suite`);
  console.log(`Products to test: ${productsToTest.length}`);
  console.log(`Strategies: ${Object.keys(SEARCH_STRATEGIES).length}`);
  console.log(`Output directory: ${options.outputDir}`);

  for (const product of productsToTest) {
    const productResults = await runProductTests(product, SEARCH_STRATEGIES, options);
    const analysis = analyzeResults(product, productResults);
    
    allResults.push({
      product,
      results: productResults,
      analysis
    });

    // Update summary
    summary.total_products++;
    for (const [strategyName, result] of Object.entries(productResults)) {
      summary.total_tests++;
      summary.total_duration_ms += result.duration_ms;

      if (result.status === 'success') {
        summary.successful_tests++;
      } else if (result.status === 'timeout') {
        summary.timeout_tests++;
      } else {
        summary.failed_tests++;
      }

      // Strategy performance
      if (!summary.strategies_performance[strategyName]) {
        summary.strategies_performance[strategyName] = {
          total: 0,
          success: 0,
          timeout: 0,
          error: 0,
          avg_duration_ms: 0,
          avg_results: 0,
          total_duration: 0,
          total_results: 0
        };
      }
      
      const stratPerf = summary.strategies_performance[strategyName];
      stratPerf.total++;
      stratPerf.total_duration += result.duration_ms;
      stratPerf.total_results += result.count;
      
      if (result.status === 'success') stratPerf.success++;
      else if (result.status === 'timeout') stratPerf.timeout++;
      else stratPerf.error++;
    }

    // Category performance
    if (!summary.category_performance[product.category]) {
      summary.category_performance[product.category] = {
        total_products: 0,
        avg_brand_matches: 0,
        avg_results_per_strategy: 0,
        best_strategies: []
      };
    }
    summary.category_performance[product.category].total_products++;
  }

  // Calculate averages
  for (const stratPerf of Object.values(summary.strategies_performance)) {
    stratPerf.avg_duration_ms = Math.round(stratPerf.total_duration / stratPerf.total);
    stratPerf.avg_results = Math.round(stratPerf.total_results / stratPerf.total);
  }

  summary.total_duration_ms = Date.now() - startTime;

  return { results: allResults, summary };
}

// ===== REPORTING =====

async function generateReports(testData, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });

  // 1. Raw results JSON
  await fs.writeFile(
    path.join(outputDir, 'raw-results.json'),
    JSON.stringify(testData, null, 2)
  );

  // 2. Summary CSV
  const csvRows = ['Product,Category,Brand,Strategy,Status,Duration(ms),Results,Error'];
  
  for (const item of testData.results) {
    const product = item.product;
    for (const [strategyName, result] of Object.entries(item.results)) {
      csvRows.push([
        product.id,
        product.category,
        product.brand || '',
        strategyName,
        result.status,
        result.duration_ms,
        result.count,
        result.error || ''
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    }
  }
  
  await fs.writeFile(
    path.join(outputDir, 'results-summary.csv'),
    csvRows.join('\n')
  );

  // 3. Performance Report
  const performanceReport = generatePerformanceReport(testData.summary);
  await fs.writeFile(
    path.join(outputDir, 'performance-report.md'),
    performanceReport
  );

  // 4. Issues and Recommendations
  const issuesReport = generateIssuesReport(testData.results);
  await fs.writeFile(
    path.join(outputDir, 'issues-and-recommendations.md'),
    issuesReport
  );

  console.log(`\n📊 Reports generated in: ${outputDir}`);
  console.log(`  - raw-results.json: Complete test data`);
  console.log(`  - results-summary.csv: Summary table`);
  console.log(`  - performance-report.md: Performance analysis`);
  console.log(`  - issues-and-recommendations.md: Issues and best practices`);
}

function generatePerformanceReport(summary) {
  const report = [`# OpenFoodFacts Search Performance Report`];
  report.push(`Generated: ${new Date().toISOString()}\n`);

  report.push(`## Overall Statistics`);
  report.push(`- **Total Products Tested:** ${summary.total_products}`);
  report.push(`- **Total API Calls:** ${summary.total_tests}`);
  report.push(`- **Success Rate:** ${((summary.successful_tests / summary.total_tests) * 100).toFixed(1)}%`);
  report.push(`- **Timeout Rate:** ${((summary.timeout_tests / summary.total_tests) * 100).toFixed(1)}%`);
  report.push(`- **Error Rate:** ${((summary.failed_tests / summary.total_tests) * 100).toFixed(1)}%`);
  report.push(`- **Total Test Duration:** ${(summary.total_duration_ms / 1000).toFixed(1)}s\n`);

  report.push(`## Strategy Performance`);
  report.push(`| Strategy | Success Rate | Avg Duration | Avg Results | Timeout Rate |`);
  report.push(`|----------|-------------|-------------|-------------|-------------|`);
  
  for (const [name, perf] of Object.entries(summary.strategies_performance)) {
    const successRate = ((perf.success / perf.total) * 100).toFixed(1);
    const timeoutRate = ((perf.timeout / perf.total) * 100).toFixed(1);
    report.push(`| ${name} | ${successRate}% | ${perf.avg_duration_ms}ms | ${perf.avg_results} | ${timeoutRate}% |`);
  }

  report.push(`\n## Category Performance`);
  for (const [category, perf] of Object.entries(summary.category_performance)) {
    report.push(`### ${category}`);
    report.push(`- Products tested: ${perf.total_products}`);
    // Add more category-specific analysis here
  }

  return report.join('\n');
}

function generateIssuesReport(results) {
  const report = [`# Issues and Recommendations`];
  report.push(`Generated: ${new Date().toISOString()}\n`);

  const issues = [];
  const patterns = {};

  for (const item of results) {
    const product = item.product;
    const analysis = item.analysis;

    // Collect issues
    if (analysis.strategies_with_results === 0) {
      issues.push(`❌ **${product.id}**: No results from any strategy`);
    }

    if (analysis.brand_matches === 0 && product.expected_brands?.length > 0) {
      issues.push(`⚠️ **${product.id}**: No brand matches found (expected: ${product.expected_brands.join(', ')})`);
    }

    if (analysis.strategies_timed_out > analysis.strategies_tested / 2) {
      issues.push(`⏱️ **${product.id}**: High timeout rate (${analysis.strategies_timed_out}/${analysis.strategies_tested})`);
    }

    // Collect patterns
    for (const [strategyName, result] of Object.entries(item.results)) {
      if (result.status === 'error') {
        const errorKey = result.error.substring(0, 50);
        patterns[errorKey] = (patterns[errorKey] || 0) + 1;
      }
    }
  }

  report.push(`## Issues Found (${issues.length})`);
  issues.forEach(issue => report.push(issue));

  report.push(`\n## Error Patterns`);
  for (const [error, count] of Object.entries(patterns)) {
    report.push(`- **${error}...** (${count} occurrences)`);
  }

  report.push(`\n## Best Practices`);
  report.push(`1. **Brand Normalization**: Handle special characters (M&M's → m-m-s)`);
  report.push(`2. **Timeout Management**: SaL often fails with 500ms, consider 800ms+`);
  report.push(`3. **Category Filtering**: v2 strict requires both brand and category`);
  report.push(`4. **Variant Tokens**: Use variant rules for better matching (light, zero, etc.)`);
  report.push(`5. **Fallback Strategy**: Always have legacy as final fallback`);

  return report.join('\n');
}

// ===== CLI INTERFACE =====

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    outputDir: './off-test-results',
    timeout: 5000,
    verbose: false,
    categories: null,
    strategies: null
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--output-dir':
        options.outputDir = args[++i];
        break;
      case '--timeout':
        options.timeout = parseInt(args[++i]);
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--categories':
        options.categories = args[++i].split(',');
        break;
      case '--strategies':
        options.strategies = args[++i].split(',');
        break;
      case '--help':
        console.log(`
OpenFoodFacts Search Testing Suite

Usage: node off-search-tester.js [options]

Options:
  --output-dir DIR     Output directory for results (default: ./off-test-results)
  --timeout MS         Global timeout per test case (default: 5000)
  --verbose            Enable verbose logging
  --categories CAT     Test only specific categories (comma-separated)
  --strategies STRAT   Test only specific strategies (comma-separated)
  --help               Show this help

Available categories: ${[...new Set(TEST_PRODUCTS.map(p => p.category))].join(', ')}
Available strategies: ${Object.keys(SEARCH_STRATEGIES).join(', ')}
        `);
        process.exit(0);
        break;
    }
  }

  return options;
}

// ===== MAIN =====

async function main() {
  const options = parseArgs();
  
  try {
    console.log('🧪 OpenFoodFacts Search Testing Suite');
    
    const testData = await runAllTests(options);
    await generateReports(testData, options.outputDir);
    
    const summary = testData.summary;
    console.log(`\n✅ Testing Complete!`);
    console.log(`📈 Success Rate: ${((summary.successful_tests / summary.total_tests) * 100).toFixed(1)}%`);
    console.log(`⏱️ Total Duration: ${(summary.total_duration_ms / 1000).toFixed(1)}s`);
    console.log(`📁 Results saved to: ${options.outputDir}`);
    
  } catch (error) {
    console.error('❌ Testing failed:', error);
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

export { TEST_PRODUCTS, SEARCH_STRATEGIES, runAllTests, generateReports };
