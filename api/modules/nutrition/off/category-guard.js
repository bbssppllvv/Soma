/**
 * Category Guard
 * Предотвращает выбор продуктов из конфликтующих категорий
 * (например, мороженое вместо шоколадной плитки)
 */

// Маппинг форм продуктов для form-aware category guard
const FORM_CLUSTERS = {
  'bar': ['bars', 'tablets', 'chocolate-bars', 'energy-bars', 'protein-bars'],
  'candy': ['candies', 'bonbons', 'gummies', 'hard-candies', 'soft-candies'],
  'spread': ['spreads', 'nut-butters', 'peanut-butters', 'chocolate-spreads', 'jams'],
  'drink': ['beverages', 'sodas', 'juices', 'waters', 'energy-drinks', 'milk'],
  'whipped': ['whipped-creams', 'mousses', 'foams'],
  'spray': ['sprays', 'aerosols', 'spray-creams'],
  'jar': ['jars', 'containers', 'pots'],
  'frozen': ['ice-creams', 'frozen-desserts', 'sorbets', 'frozen-yogurts']
};

// Маппинг наших канонических категорий в OFF категории
const CATEGORY_MAPPINGS = {
  'snack-sweet': {
    off_categories: ['chocolates', 'bars', 'candies', 'sweets', 'confectioneries'],
    conflicts: ['ice-creams-and-sorbets', 'frozen-desserts', 'dairy-desserts', 'spreads', 'nut-butters', 'peanut-butters', 'oilseed-purees', 'plant-based-spreads'],
    boost: 3,
    preferred_forms: ['bar', 'candy']
  },
  'dessert': {
    off_categories: ['desserts', 'puddings', 'mousses', 'tiramisu'],
    conflicts: ['chocolates', 'candies', 'ice-creams-and-sorbets'],
    boost: 2,
    preferred_forms: ['whipped', 'jar']
  },
  'dairy': {
    off_categories: ['milk', 'cream', 'yogurt', 'cheese', 'dairy'],
    conflicts: ['plant-based-milk-substitutes', 'soy-milk', 'almond-milk'],
    boost: 3,
    preferred_forms: ['drink', 'whipped']
  },
  'beverage': {
    off_categories: ['beverages', 'sodas', 'juices', 'waters', 'energy-drinks'],
    conflicts: ['dairy', 'milk', 'yogurt'],
    boost: 2,
    preferred_forms: ['drink']
  },
  'cookie-biscuit': {
    off_categories: ['biscuits', 'cookies', 'crackers', 'wafers'],
    conflicts: ['chocolates', 'bars', 'ice-creams'],
    boost: 3,
    preferred_forms: ['bar']
  }
};

// Конфигурация Category Guard
const CATEGORY_CONFIG = {
  MATCH_BOOST: Number(process.env.OFF_CATEGORY_MATCH_BOOST || 3),
  CONFLICT_PENALTY: Number(process.env.OFF_CATEGORY_CONFLICT_PENALTY || 5),
  HARD_BLOCKS_ENABLED: process.env.OFF_CATEGORY_HARD_BLOCKS_ENABLED === 'true'
};

/**
 * Определяет форму продукта на основе категорий и названия
 */
function detectProductForm(product) {
  if (!product) return null;
  
  const categories = extractProductCategories(product);
  const productName = (product.product_name || '').toLowerCase();
  
  // Проверяем категории на соответствие формам
  for (const [formType, formCategories] of Object.entries(FORM_CLUSTERS)) {
    const hasFormCategory = categories.some(cat => 
      formCategories.some(formCat => cat.includes(formCat))
    );
    
    if (hasFormCategory) {
      return formType;
    }
  }
  
  // Проверяем название продукта на ключевые слова форм
  if (productName.includes('spray') || productName.includes('aerosol')) return 'spray';
  if (productName.includes('whipped') || productName.includes('montada')) return 'whipped';
  if (productName.includes('spread') || productName.includes('butter')) return 'spread';
  if (productName.includes('bar') || productName.includes('tablet')) return 'bar';
  if (productName.includes('drink') || productName.includes('beverage')) return 'drink';
  if (productName.includes('ice cream') || productName.includes('frozen')) return 'frozen';
  
  return null;
}

/**
 * Проверяет совместимость форм продуктов
 */
function areFormsCompatible(expectedForm, actualForm) {
  if (!expectedForm || !actualForm) return true; // Неизвестные формы совместимы
  if (expectedForm === actualForm) return true;
  
  // Некоторые формы совместимы между собой
  const compatibleForms = {
    'bar': ['candy'],
    'candy': ['bar'],
    'whipped': ['jar'],
    'jar': ['whipped'],
    'drink': ['beverage'],
    'beverage': ['drink']
  };
  
  return compatibleForms[expectedForm]?.includes(actualForm) || false;
}

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
    
    // FORM-AWARE CATEGORY GUARD: Проверяем совместимость форм
    const productForm = detectProductForm(product);
    const formCompatible = areFormsCompatible(expectedFoodForm, productForm);
    
    // Hard blocking при известном бренде и конфликте категории
    if (CATEGORY_CONFIG.HARD_BLOCKS_ENABLED && brandKnown && categoryCheck.conflict) {
      blocked.push({
        code: product.code,
        name: product.product_name,
        categories: categoryCheck.product_categories,
        conflict_reason: 'category_mismatch_with_known_brand'
      });
      
      console.log('[CATEGORY_GUARD] category_mismatch blocked', {
        product_code: product.code,
        expected_category: expectedCategory,
        product_categories: categoryCheck.product_categories
      });
      continue;
    }
    
    // Form mismatch blocking
    if (expectedFoodForm && productForm && !formCompatible) {
      blocked.push({
        code: product.code,
        name: product.product_name,
        expected_form: expectedFoodForm,
        actual_form: productForm,
        conflict_reason: 'form_mismatch'
      });
      
      console.log('[CATEGORY_GUARD] form_mismatch blocked', {
        product_code: product.code,
        expected_form: expectedFoodForm,
        actual_form: productForm
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
