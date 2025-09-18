#!/usr/bin/env node

/**
 * Test GPT Improvements - проверка улучшенного prompt'а
 * Симулирует ожидаемые ответы GPT с новыми правилами
 */

// Симулируем ожидаемые ответы GPT с улучшенным prompt'ом
const EXPECTED_GPT_RESPONSES = [
  // Coca-Cola Zero case
  {
    case: 'Coca-Cola Zero',
    expected: {
      name: 'Coca-Cola Zero',
      brand: 'Coca-Cola',
      brand_normalized: 'coca-cola',
      clean_name: 'cola',
      required_tokens: ['zero'],
      canonical_category: 'beverage',
      confidence: 0.8
    }
  },
  
  // M&M's case  
  {
    case: 'M&M\'s Peanut Butter',
    expected: {
      name: 'M&M\'s Peanut Butter',
      brand: 'M&M\'s',
      brand_normalized: 'm&ms', // Preserve recognizable form
      clean_name: 'chocolate',
      required_tokens: ['peanut', 'butter'],
      canonical_category: 'snack-sweet',
      confidence: 0.85
    }
  },
  
  // Central Lechera case
  {
    case: 'Central Lechera Asturiana Semi Desnatada',
    expected: {
      name: 'Central Lechera Asturiana Semi Desnatada',
      brand: 'Central Lechera Asturiana',
      brand_normalized: 'central lechera asturiana',
      clean_name: 'leche',
      required_tokens: ['semi', 'desnatada'],
      canonical_category: 'dairy',
      confidence: 0.9
    }
  },
  
  // Central Lechera Mantequilla case
  {
    case: 'Central Lechera Asturiana Mantequilla Tradicional',
    expected: {
      name: 'Central Lechera Asturiana Mantequilla Tradicional',
      brand: 'Central Lechera Asturiana',
      brand_normalized: 'central lechera asturiana',
      clean_name: 'mantequilla',
      required_tokens: ['tradicional'],
      canonical_category: 'dairy',
      confidence: 0.9
    }
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
  console.log('🧪 GPT Prompt Improvements Test');
  console.log('===============================\n');
  
  console.log('Testing expected GPT responses with improved prompt rules...\n');
  
  for (const testCase of EXPECTED_GPT_RESPONSES) {
    console.log(`🔍 ${testCase.case}`);
    console.log('   Expected GPT response:');
    console.log(`     name: "${testCase.expected.name}"`);
    console.log(`     brand: "${testCase.expected.brand}"`);
    console.log(`     brand_normalized: "${testCase.expected.brand_normalized}"`);
    console.log(`     clean_name: "${testCase.expected.clean_name}"`);
    console.log(`     required_tokens: [${testCase.expected.required_tokens.map(t => `'${t}'`).join(', ')}]`);
    
    const issues = validateGPTResponse(testCase.expected, testCase.expected);
    
    if (issues.length === 0) {
      console.log('   ✅ PERFECT: No issues detected');
    } else {
      console.log(`   🟡 ISSUES: ${issues.join(', ')}`);
    }
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

export { EXPECTED_GPT_RESPONSES, validateGPTResponse };
