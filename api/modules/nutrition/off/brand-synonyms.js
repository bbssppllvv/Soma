/**
 * Brand Synonyms & Gate v2
 * Обработка синонимов брендов и строгая фильтрация при известном бренде
 */

// Карта алиасов брендов для расширения синонимов
const BRAND_ALIASES = {
  'mr beast': ['mrbeast', 'feastables', 'mr. beast'],
  'feastables': ['mr beast', 'mrbeast', 'mr. beast'],
  'coca cola': ['coca-cola', 'coke', 'cocacola'],
  'coca-cola': ['coca cola', 'coke', 'cocacola'],
  'ben jerry': ['ben & jerry', 'ben and jerry', 'ben jerrys', 'ben & jerrys'],
  'ben & jerry': ['ben jerry', 'ben and jerry', 'ben jerrys', 'ben & jerrys'],
  'mcdonalds': ['mcdonald', 'mc donald', 'mc donalds', 'mcd'],
  'central lechera asturiana': ['asturiana', 'lechera asturiana', 'central lechera'],
  'nutella': ['ferrero nutella', 'nutella ferrero'],
  'amazon': ['by amazon', 'amazon brand', 'amazon basics']
};

/**
 * Нормализует бренд для сравнения
 */
function normalizeBrandForComparison(brand) {
  if (!brand) return '';
  
  return brand
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // Убираем диакритику
    .replace(/[&]/g, ' and ') // & → and
    .replace(/[^\w\s]/g, ' ') // Убираем пунктуацию
    .replace(/\s+/g, ' ') // Схлопываем пробелы
    .trim();
}

/**
 * Генерирует все синонимы для бренда
 */
export function generateBrandSynonyms(brandName, gptSynonyms = []) {
  if (!brandName) return [];
  
  const normalized = normalizeBrandForComparison(brandName);
  const synonyms = new Set([normalized, brandName.toLowerCase()]);
  
  // Добавляем GPT синонимы
  if (Array.isArray(gptSynonyms)) {
    gptSynonyms.forEach(synonym => {
      if (synonym) {
        synonyms.add(normalizeBrandForComparison(synonym));
        synonyms.add(synonym.toLowerCase());
      }
    });
  }
  
  // Добавляем алиасы из карты
  const aliasKey = Object.keys(BRAND_ALIASES).find(key => 
    normalizeBrandForComparison(key) === normalized
  );
  
  if (aliasKey) {
    BRAND_ALIASES[aliasKey].forEach(alias => {
      synonyms.add(normalizeBrandForComparison(alias));
      synonyms.add(alias.toLowerCase());
    });
  }
  
  // Авто-эвристики
  // Слитное/раздельное написание
  if (normalized.includes(' ')) {
    synonyms.add(normalized.replace(/\s+/g, '')); // mr beast → mrbeast
  } else if (normalized.length > 6) {
    // Пробуем разделить по заглавным буквам или общим паттернам
    const withSpaces = normalized.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    if (withSpaces !== normalized) {
      synonyms.add(withSpaces);
    }
  }
  
  return Array.from(synonyms).filter(s => s.length > 1);
}

/**
 * Проверяет соответствие продукта бренду через синонимы
 */
export function checkBrandMatchWithSynonyms(product, brandName, gptSynonyms = []) {
  if (!brandName || !product) return false;
  
  const synonyms = generateBrandSynonyms(brandName, gptSynonyms);
  
  // Проверяем brands_tags
  if (Array.isArray(product.brands_tags)) {
    const brandTagsNormalized = product.brands_tags.map(tag => 
      normalizeBrandForComparison(tag.replace(/^[a-z]{2}:/, ''))
    );
    
    const hasTagMatch = synonyms.some(synonym => 
      brandTagsNormalized.some(tag => 
        tag.includes(synonym) || synonym.includes(tag)
      )
    );
    
    if (hasTagMatch) {
      return { match: true, source: 'brands_tags', synonym_used: synonyms };
    }
  }
  
  // Проверяем brands массив
  if (product.brands) {
    const brandsArray = Array.isArray(product.brands) ? product.brands : [product.brands];
    const brandsNormalized = brandsArray.map(normalizeBrandForComparison);
    
    const hasBrandMatch = synonyms.some(synonym => 
      brandsNormalized.some(brand => 
        brand.includes(synonym) || synonym.includes(brand)
      )
    );
    
    if (hasBrandMatch) {
      return { match: true, source: 'brands_array', synonym_used: synonyms };
    }
  }
  
  // Проверяем product_name (если brands_tags пуст)
  const hasEmptyBrandsTags = !product.brands_tags || product.brands_tags.length === 0;
  if (hasEmptyBrandsTags && product.product_name) {
    const productNameNormalized = normalizeBrandForComparison(product.product_name);
    
    const hasNameMatch = synonyms.some(synonym => 
      productNameNormalized.includes(synonym) || synonym.includes(productNameNormalized)
    );
    
    if (hasNameMatch) {
      return { match: true, source: 'product_name_salvage', synonym_used: synonyms };
    }
  }
  
  return { match: false, source: 'none', synonym_used: synonyms };
}

/**
 * Brand Gate v2: строгая фильтрация при известном бренде
 */
export function applyBrandGateV2(products, brandName, gptSynonyms = [], enforceGate = true) {
  if (!brandName || !enforceGate || !Array.isArray(products)) {
    return {
      validCandidates: products || [],
      blocked: [],
      salvaged: [],
      stats: { total: products?.length || 0, blocked: 0, salvaged: 0, passed: products?.length || 0 }
    };
  }
  
  const validCandidates = [];
  const blocked = [];
  const salvaged = [];
  
  for (const product of products) {
    const brandCheck = checkBrandMatchWithSynonyms(product, brandName, gptSynonyms);
    
    if (brandCheck.match) {
      validCandidates.push(product);
      
      if (brandCheck.source === 'product_name_salvage') {
        salvaged.push({
          code: product.code,
          name: product.product_name,
          source: brandCheck.source
        });
      }
    } else {
      blocked.push({
        code: product.code,
        name: product.product_name,
        brands: product.brands || 'N/A',
        reason: 'brand_mismatch'
      });
    }
  }
  
  console.log('[BRAND_GATE_V2] Filtering applied', {
    brand: brandName,
    synonyms: generateBrandSynonyms(brandName, gptSynonyms).slice(0, 5),
    total_products: products.length,
    valid_candidates: validCandidates.length,
    blocked_count: blocked.length,
    salvaged_count: salvaged.length,
    salvaged_codes: salvaged.map(s => s.code)
  });
  
  // Специальный лог для виртуального совпадения бренда по имени
  if (salvaged.length > 0) {
    console.log('[BRAND_GATE_V2] virtual_name_match applied', {
      brand: brandName,
      salvaged_count: salvaged.length,
      salvaged_codes: salvaged.map(s => s.code)
    });
  }
  
  return {
    validCandidates,
    blocked,
    salvaged,
    stats: {
      total: products.length,
      blocked: blocked.length,
      salvaged: salvaged.length,
      passed: validCandidates.length
    }
  };
}

/**
 * Проверяет, нужно ли применять Brand Gate
 */
export function shouldEnforceBrandGate(item) {
  const hasKnownBrand = Boolean(
    item?.brand || 
    item?.brand_normalized || 
    item?.off_brand_filter
  );
  
  const enforceFlag = process.env.OFF_ENFORCE_BRAND_GATE_V2 === 'true';
  
  return hasKnownBrand && enforceFlag;
}
