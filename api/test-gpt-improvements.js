#!/usr/bin/env node

/**
 * Test GPT Improvements - проверка улучшенного prompt'а
 * Симулирует ожидаемые ответы GPT с новыми правилами
 */

// Test patterns for common GPT issues (not specific products)
const GPT_QUALITY_PATTERNS = [
  // Pattern 1: Brand + Variant products
  {
    pattern: 'Brand with variant',
    example_structure: {
      name: 'Brand Name Product Variant',
      brand: 'Brand Name',
      brand_normalized: 'brand name',
      clean_name: 'product',
      required_tokens: ['variant'],
      canonical_category: 'category'
    },
    common_issues: ['name/clean_name duplication', 'missing variant in name', 'brand_normalized inconsistency']
  },
  
  // Pattern 2: Multi-word brands
  {
    pattern: 'Multi-word brand',
    example_structure: {
      name: 'Multi Word Brand Product',
      brand: 'Multi Word Brand',
      brand_normalized: 'multi word brand',
      clean_name: 'product',
      required_tokens: [],
      canonical_category: 'category'
    },
    common_issues: ['brand fragmentation', 'inconsistent spacing', 'over-normalization']
  },
  
  // Pattern 3: Special characters in brands
  {
    pattern: 'Special character brands',
    example_structure: {
      name: 'Brand&Co Product',
      brand: 'Brand&Co',
      brand_normalized: 'brand&co',
      clean_name: 'product',
      required_tokens: [],
      canonical_category: 'category'
    },
    common_issues: ['special char removal', 'over-normalization', 'loss of brand identity']
  },
  
  // Pattern 4: Compound variants
  {
    pattern: 'Compound variants',
    example_structure: {
      name: 'Brand Product Type Variant',
      brand: 'Brand',
      brand_normalized: 'brand',
      clean_name: 'product',
      required_tokens: ['type', 'variant'],
      canonical_category: 'category'
    },
    common_issues: ['variant overlap with clean_name', 'missing compound variants', 'incorrect separation']
  }
];

function validateGPTResponse(response, expected) {
  const issues = [];
  
  // Check field separation
  if (response.name === response.clean_name) {
    issues.push('name_clean_name_duplicate');
  }
  
  // Check required_tokens overlap with clean_name
  const cleanWords = response.clean_name?.toLowerCase().split(' ') || [];
  const duplicateTokens = response.required_tokens?.filter(token => 
    cleanWords.includes(token.toLowerCase())
  ) || [];
  
  if (duplicateTokens.length > 0) {
    issues.push(`required_tokens_overlap: ${duplicateTokens.join(', ')}`);
  }
  
  // Check brand_normalized consistency
  const expectedNormalized = expected.brand_normalized;
  if (response.brand_normalized !== expectedNormalized) {
    issues.push(`brand_normalized_inconsistent: got '${response.brand_normalized}', expected '${expectedNormalized}'`);
  }
  
  // Check if required_tokens are in name
  const nameWords = response.name?.toLowerCase().split(' ') || [];
  const missingFromName = response.required_tokens?.filter(token => 
    !nameWords.some(word => word.includes(token.toLowerCase()))
  ) || [];
  
  if (missingFromName.length > 0) {
    issues.push(`required_tokens_not_in_name: ${missingFromName.join(', ')}`);
  }
  
  return issues;
}

function testGPTImprovements() {
  console.log('🧪 GPT Prompt Pattern Analysis');
  console.log('==============================\n');
  
  console.log('Analyzing common GPT data quality patterns...\n');
  
  for (const pattern of GPT_QUALITY_PATTERNS) {
    console.log(`🔍 ${pattern.pattern}`);
    console.log('   Structure template:');
    console.log(`     name: "${pattern.example_structure.name}"`);
    console.log(`     brand: "${pattern.example_structure.brand}"`);
    console.log(`     brand_normalized: "${pattern.example_structure.brand_normalized}"`);
    console.log(`     clean_name: "${pattern.example_structure.clean_name}"`);
    console.log(`     required_tokens: [${pattern.example_structure.required_tokens.map(t => `'${t}'`).join(', ')}]`);
    
    console.log(`   Common issues to avoid: ${pattern.common_issues.join(', ')}`);
    console.log('');
  }
  
  console.log('🎯 GPT Prompt Quality Guidelines:');
  console.log('=================================');
  console.log('✅ name: Complete product name from packaging');
  console.log('✅ brand: Exact brand (preserve multi-word brands)');
  console.log('✅ brand_normalized: Lowercase + minimal changes');
  console.log('✅ clean_name: Product type only (no brand, no variants)');
  console.log('✅ required_tokens: Variants/modifiers only');
  console.log('✅ No duplication between fields');
  console.log('✅ Preserve original language');
}

// Run test
testGPTImprovements();

export { validateGPTResponse };
