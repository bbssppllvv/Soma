#!/usr/bin/env node

/**
 * Тест умной системы совместимости форм
 */

// Импортируем функции (в реальности они будут импортированы)
function detectFormFamily(categories) {
  if (!Array.isArray(categories)) return null;
  
  const categoryText = categories.join(' ').toLowerCase();
  
  // Кондитерские изделия
  if (categoryText.includes('chocolate') || 
      categoryText.includes('candies') || 
      categoryText.includes('confectioneries') ||
      categoryText.includes('sweet snacks')) {
    return 'confectionery';
  }
  
  // Молочные продукты
  if (categoryText.includes('dairy') || 
      categoryText.includes('milk') || 
      categoryText.includes('butter') ||
      categoryText.includes('cream')) {
    return 'dairy';
  }
  
  return null;
}

function calculateSmartCompatibility(expectedForm, actualForm, categories = []) {
  const formFamily = detectFormFamily(categories);
  
  const familyRules = {
    'confectionery': {
      compatible: ['candy', 'bar', 'tablet', 'raw'],
      reason: 'confectionery_family'
    },
    'dairy': {
      compatible: ['spread', 'jar', 'whipped', 'drink', 'loaf'],
      reason: 'dairy_family'
    }
  };
  
  if (formFamily && familyRules[formFamily]) {
    const rule = familyRules[formFamily];
    const isCompatible = rule.compatible.includes(expectedForm) && rule.compatible.includes(actualForm);
    
    if (isCompatible) {
      return {
        isCompatible: true,
        confidence: 0.9,
        reason: rule.reason,
        family: formFamily
      };
    }
  }
  
  // Проблемные формы GPT
  const problematicForms = ['unknown', 'raw', 'soup', 'loaf'];
  
  if (problematicForms.includes(expectedForm)) {
    return {
      isCompatible: true,
      confidence: 0.3,
      reason: 'gpt_form_uncertainty',
      fallback: true
    };
  }
  
  return {
    isCompatible: false,
    confidence: 0.1,
    reason: 'no_compatibility'
  };
}

// Тестовые случаи
const testCases = [
  {
    name: "M&M's Peanut Butter",
    expectedForm: "raw",
    actualForm: "candy", 
    categories: ["en:sweet snacks", "en:chocolate candies", "en:confectioneries"],
    shouldPass: true,
    reason: "Кондитерские изделия: raw и candy совместимы"
  },
  {
    name: "Asturiana Mantequilla",
    expectedForm: "loaf",
    actualForm: "spread",
    categories: ["en:dairy", "en:butters", "en:spreads"],
    shouldPass: true,
    reason: "Молочные продукты: loaf и spread совместимы"
  },
  {
    name: "Coca Cola",
    expectedForm: "bottle",
    actualForm: "drink",
    categories: ["en:beverages", "en:sodas"],
    shouldPass: false,
    reason: "Нет семейства для напитков в текущих правилах"
  },
  {
    name: "Неизвестная форма",
    expectedForm: "unknown",
    actualForm: "candy",
    categories: ["en:sweet snacks"],
    shouldPass: true,
    reason: "Проблемные формы GPT разрешаются с низкой уверенностью"
  }
];

console.log('🧪 Тестирование умной системы совместимости форм\n');

testCases.forEach((testCase, index) => {
  const result = calculateSmartCompatibility(
    testCase.expectedForm, 
    testCase.actualForm, 
    testCase.categories
  );
  
  const passed = result.isCompatible === testCase.shouldPass;
  const status = passed ? '✅ PASS' : '❌ FAIL';
  
  console.log(`${index + 1}. ${testCase.name}`);
  console.log(`   Expected: ${testCase.expectedForm} → Actual: ${testCase.actualForm}`);
  console.log(`   Categories: ${testCase.categories.join(', ')}`);
  console.log(`   Result: ${status}`);
  console.log(`   Family: ${result.family || 'none'}`);
  console.log(`   Reason: ${result.reason}`);
  console.log(`   Confidence: ${result.confidence}`);
  console.log(`   Expected: ${testCase.reason}`);
  console.log('');
});

console.log('🎯 Система работает прогрессивно:');
console.log('1. Определяет семейство продукта по категориям');
console.log('2. Применяет правила совместимости для семейства');
console.log('3. Fallback для проблемных форм GPT');
console.log('4. Возвращает уверенность и причину решения');
