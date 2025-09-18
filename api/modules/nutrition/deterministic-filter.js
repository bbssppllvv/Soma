/**
 * Deterministic Filter - альтернатива сложному scoring
 * Простые boolean проверки вместо эвристических баллов
 */

import { canonicalizeQuery } from './off-client.js';

export function isGoodMatch(product, item) {
  const checks = {
    hasNutrients: false,
    brandMatch: false,
    requiredTokensMatch: false,
    categoryMatch: false,
    overall: false
  };
  
  // 1. Must have useful nutrients
  checks.hasNutrients = hasUsefulNutriments(product);
  if (!checks.hasNutrients) return checks;
  
  // 2. Brand matching (if brand context exists)
  if (item.brand) {
    checks.brandMatch = checkBrandMatch(product, item.brand);
  } else {
    checks.brandMatch = true; // No brand context = pass
  }
  
  // 3. Required tokens matching (critical)
  if (item.required_tokens?.length > 0) {
    checks.requiredTokensMatch = checkRequiredTokens(product, item.required_tokens);
  } else {
    checks.requiredTokensMatch = true; // No required tokens = pass
  }
  
  // 4. Category relevance (soft check)
  checks.categoryMatch = checkCategoryRelevance(product, item.canonical_category);
  
  // Overall: All critical checks must pass
  checks.overall = checks.hasNutrients && 
                   (checks.brandMatch || checks.requiredTokensMatch) && // Either brand OR tokens
                   checks.categoryMatch;
  
  return checks;
}

function hasUsefulNutriments(product) {
  const n = product?.nutriments || {};
  return n['energy-kcal_100g'] != null ||
         n['energy_100g'] != null ||
         n['proteins_100g'] != null ||
         n['fat_100g'] != null ||
         n['carbohydrates_100g'] != null;
}

function checkBrandMatch(product, expectedBrand) {
  if (!expectedBrand) return true;
  
  const productBrands = (product.brands || '').toLowerCase();
  const brandTags = (product.brands_tags || []).join(' ').toLowerCase();
  const expected = expectedBrand.toLowerCase();
  
  // Exact match
  if (productBrands.includes(expected) || brandTags.includes(expected)) {
    return true;
  }
  
  // Partial match (for multi-word brands)
  const expectedWords = expected.split(/[\s&'-]+/).filter(w => w.length > 2);
  const hasPartialMatch = expectedWords.some(word => 
    productBrands.includes(word) || brandTags.includes(word)
  );
  
  return hasPartialMatch;
}

function checkRequiredTokens(product, requiredTokens) {
  if (!requiredTokens?.length) return true;
  
  const productName = canonicalizeQuery(product.product_name || '');
  const labelTexts = (product.labels_tags || [])
    .map(tag => canonicalizeQuery(tag))
    .join(' ');
  
  const searchText = `${productName} ${labelTexts}`.toLowerCase();
  
  // At least 50% of required tokens must be found
  const foundTokens = requiredTokens.filter(token => {
    const normalized = canonicalizeQuery(token);
    return searchText.includes(normalized);
  });
  
  return foundTokens.length >= Math.ceil(requiredTokens.length * 0.5);
}

function checkCategoryRelevance(product, expectedCategory) {
  if (!expectedCategory) return true;
  
  const categories = (product.categories_tags || []).join(' ').toLowerCase();
  
  const categoryMap = {
    'dairy': ['milk', 'cheese', 'yogurt', 'butter', 'cream'],
    'beverage': ['drink', 'soda', 'juice', 'water', 'cola'],
    'snack-sweet': ['chocolate', 'candy', 'sweet', 'cookie'],
    'snack-salty': ['chip', 'crisp', 'salty'],
  };
  
  const keywords = categoryMap[expectedCategory] || [];
  return keywords.length === 0 || keywords.some(keyword => categories.includes(keyword));
}

export function rankByDeterministicFilter(products, item) {
  return products
    .map(product => ({
      product,
      checks: isGoodMatch(product, item),
      score: calculateSimpleScore(product, item)
    }))
    .filter(candidate => candidate.checks.overall)
    .sort((a, b) => b.score - a.score);
}

function calculateSimpleScore(product, item) {
  let score = 0;
  
  // Brand bonus (simple)
  if (checkBrandMatch(product, item.brand)) {
    score += 100;
  }
  
  // Required tokens bonus
  if (checkRequiredTokens(product, item.required_tokens)) {
    score += 200;
  }
  
  // Name similarity
  const productName = canonicalizeQuery(product.product_name || '');
  const itemName = canonicalizeQuery(item.clean_name || item.name || '');
  const nameWords = itemName.split(' ');
  const matchingWords = nameWords.filter(word => 
    word.length > 2 && productName.includes(word)
  );
  score += matchingWords.length * 10;
  
  // Quality indicators
  if (product.nutriscore_grade) score += 5;
  if (product.data_quality_score > 50) score += 10;
  
  return score;
}
