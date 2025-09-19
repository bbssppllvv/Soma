/**
 * Category Guard
 * Предотвращает выбор продуктов из конфликтующих категорий
 * (например, мороженое вместо шоколадной плитки)
 */

// Маппинг наших канонических категорий в OFF категории
const CATEGORY_MAPPINGS = {
  'snack-sweet': {
    off_categories: ['chocolates', 'bars', 'candies', 'sweets', 'confectioneries'],
    conflicts: ['ice-creams-and-sorbets', 'frozen-desserts', 'dairy-desserts', 'spreads', 'nut-butters', 'peanut-butters', 'oilseed-purees', 'plant-based-spreads'],
    boost: 3
  },
  'dessert': {
    off_categories: ['desserts', 'puddings', 'mousses', 'tiramisu'],
    conflicts: ['chocolates', 'candies', 'ice-creams-and-sorbets'],
    boost: 2
  },
  'dairy': {
    off_categories: ['milk', 'cream', 'yogurt', 'cheese', 'dairy'],
    conflicts: ['plant-based-milk-substitutes', 'soy-milk', 'almond-milk'],
    boost: 3
  },
  'beverage': {
    off_categories: ['beverages', 'sodas', 'juices', 'waters', 'energy-drinks'],
    conflicts: ['dairy', 'milk', 'yogurt'],
    boost: 2
  },
  'cookie-biscuit': {
    off_categories: ['biscuits', 'cookies', 'crackers', 'wafers'],
    conflicts: ['chocolates', 'bars', 'ice-creams'],
    boost: 3
  }
};

// Конфигурация Category Guard
const CATEGORY_CONFIG = {
  MATCH_BOOST: Number(process.env.OFF_CATEGORY_MATCH_BOOST || 3),
  CONFLICT_PENALTY: Number(process.env.OFF_CATEGORY_CONFLICT_PENALTY || 5),
  HARD_BLOCKS_ENABLED: process.env.OFF_CATEGORY_HARD_BLOCKS_ENABLED === 'true'
};

/**
 * Извлекает категории продукта из OFF данных
 */
function extractProductCategories(product) {
  if (!product) return [];
  
  const categories = [];
  
  // Categories tags
  if (Array.isArray(product.categories_tags)) {
    categories.push(...product.categories_tags.map(tag => 
      tag.replace(/^[a-z]{2}:/, '').toLowerCase()
    ));
  }
  
  // Labels tags (могут содержать категорийную информацию)
  if (Array.isArray(product.labels_tags)) {
    categories.push(...product.labels_tags.map(tag => 
      tag.replace(/^[a-z]{2}:/, '').toLowerCase()
    ));
  }
  
  return categories.filter(Boolean);
}

/**
 * Проверяет соответствие категории продукта ожидаемой
 */
export function checkCategoryMatch(product, expectedCategory, expectedFoodForm = null) {
  if (!expectedCategory || !product) {
    return { match: false, conflict: false, boost: 0, penalty: 0 };
  }
  
  const productCategories = extractProductCategories(product);
  const mapping = CATEGORY_MAPPINGS[expectedCategory];
  
  if (!mapping) {
    return { match: false, conflict: false, boost: 0, penalty: 0 };
  }
  
  // Проверяем совпадение с ожидаемыми категориями
  const hasMatch = mapping.off_categories.some(offCat => 
    productCategories.some(prodCat => 
      prodCat.includes(offCat) || offCat.includes(prodCat)
    )
  );
  
  // Проверяем конфликты
  const hasConflict = mapping.conflicts.some(conflictCat => 
    productCategories.some(prodCat => 
      prodCat.includes(conflictCat) || conflictCat.includes(prodCat)
    )
  );
  
  const boost = hasMatch ? CATEGORY_CONFIG.MATCH_BOOST : 0;
  const penalty = hasConflict ? CATEGORY_CONFIG.CONFLICT_PENALTY : 0;
  
  return {
    match: hasMatch,
    conflict: hasConflict,
    boost: boost,
    penalty: penalty,
    product_categories: productCategories,
    expected_mapping: mapping.off_categories
  };
}

/**
 * Применяет Category Guard с возможностью hard blocking
 */
export function applyCategoryGuard(products, expectedCategory, expectedFoodForm, brandKnown = false) {
  if (!expectedCategory || !Array.isArray(products)) {
    return {
      validCandidates: products || [],
      blocked: [],
      boosted: [],
      penalized: [],
      stats: { total: products?.length || 0, blocked: 0, boosted: 0, penalized: 0 }
    };
  }
  
  const validCandidates = [];
  const blocked = [];
  const boosted = [];
  const penalized = [];
  
  for (const product of products) {
    const categoryCheck = checkCategoryMatch(product, expectedCategory, expectedFoodForm);
    
    // Hard blocking при известном бренде и конфликте категории
    if (CATEGORY_CONFIG.HARD_BLOCKS_ENABLED && brandKnown && categoryCheck.conflict) {
      blocked.push({
        code: product.code,
        name: product.product_name,
        categories: categoryCheck.product_categories,
        conflict_reason: 'category_mismatch_with_known_brand'
      });
      continue;
    }
    
    // Добавляем продукт с метаданными категории
    const productWithCategoryMeta = {
      ...product,
      category_boost: categoryCheck.boost,
      category_penalty: categoryCheck.penalty,
      category_match: categoryCheck.match,
      category_conflict: categoryCheck.conflict
    };
    
    validCandidates.push(productWithCategoryMeta);
    
    if (categoryCheck.boost > 0) {
      boosted.push({
        code: product.code,
        boost: categoryCheck.boost,
        reason: 'category_match'
      });
    }
    
    if (categoryCheck.penalty > 0) {
      penalized.push({
        code: product.code,
        penalty: categoryCheck.penalty,
        reason: 'category_conflict'
      });
    }
  }
  
  console.log('[CATEGORY_GUARD] Filtering applied', {
    expected_category: expectedCategory,
    brand_known: brandKnown,
    hard_blocks_enabled: CATEGORY_CONFIG.HARD_BLOCKS_ENABLED,
    total_products: products.length,
    valid_candidates: validCandidates.length,
    blocked_count: blocked.length,
    boosted_count: boosted.length,
    penalized_count: penalized.length
  });
  
  // Явный лог для кейса мороженого, чтобы проще было проверять приёмку
  if (expectedCategory === 'snack-sweet') {
    const blockedIceCream = blocked.filter(b => Array.isArray(b.categories) && b.categories.some(c => c.includes('ice-cream') || c.includes('ice-creams') || c.includes('ice-creams-and-sorbets') || c.includes('frozen')));
    if (blockedIceCream.length > 0) {
      console.log('[CATEGORY_GUARD] ice-cream blocked', {
        blocked_codes: blockedIceCream.map(b => b.code),
        count: blockedIceCream.length
      });
    }
  }
  
  return {
    validCandidates,
    blocked,
    boosted,
    penalized,
    stats: {
      total: products.length,
      blocked: blocked.length,
      boosted: boosted.length,
      penalized: penalized.length
    }
  };
}

/**
 * Интегрирует категорийные бонусы/штрафы в скоринг
 */
export function applyCategoryScoring(score, product) {
  let adjustedScore = score;
  
  if (product.category_boost) {
    adjustedScore += product.category_boost;
  }
  
  if (product.category_penalty) {
    adjustedScore -= product.category_penalty;
  }
  
  return adjustedScore;
}
