import { getByBarcode, searchByNameV1, canonicalizeQuery } from './off-client.js';
import { mapOFFProductToPer100g } from './off-map.js';
import { getCachedOffProduct, upsertOffProduct } from './off-supabase-cache.js';

const REQUIRE_BRAND = String(process.env.OFF_REQUIRE_BRAND || 'false').toLowerCase() === 'true';
const BRAND_THRESHOLD = Number(process.env.OFF_BRAND_THRESHOLD || 0.7);
const DEFAULT_THRESHOLD = 0.8;
const OFF_BUDGET_MS = Number(process.env.OFF_GLOBAL_BUDGET_MS || 3000);

const SWEET_SENSITIVE_CATEGORIES = new Set(['snack-sweet', 'cookie-biscuit', 'dessert']);
const SWEET_CATEGORY_TAGS = new Set([
  'en:cookies',
  'en:biscuits',
  'en:desserts',
  'en:snacks-sweet',
  'en:sweet-snacks',
  'en:candies',
  'en:chocolate-products',
  'en:chocolate-biscuits',
  'en:chocolate-covered-biscuits'
]);
const SWEET_NAME_KEYWORDS = ['cookie', 'biscuit', 'dessert', 'snack', 'brownie', 'cake', 'candy', 'bar', 'chocolate', 'wafer'];

const FLAVOR_KEYWORDS = [
  'maple',
  'brown sugar',
  'honey',
  'vanilla',
  'chocolate',
  'strawberry',
  'raspberry',
  'cinnamon',
  'protein',
  'flavor',
  'flavoured',
  'flavored',
  'sweetened',
  'caramel',
  'butter',
  'apple'
];

const PLAIN_ELIGIBLE_CATEGORIES = new Set([
  'grain',
  'porridge',
  'rice',
  'pasta',
  'bread',
  'breakfast-cereal',
  'legume',
  'vegetable',
  'fruit'
]);

const CATEGORY_POSITIVE_HINTS = {
  porridge: {
    tags: ['en:porridges', 'en:oat-flakes', 'en:breakfast-cereals'],
    keywords: ['porridge', 'oatmeal', 'hot cereal']
  },
  'breakfast-cereal': {
    tags: ['en:breakfast-cereals', 'en:cereals'],
    keywords: ['cereal', 'flakes']
  },
  grain: {
    tags: ['en:grains', 'en:cereal-grains'],
    keywords: ['grain']
  },
  rice: {
    tags: ['en:rices'],
    keywords: ['rice']
  }
};

const FOOD_FORM_HINTS = {
  'hot-cereal': {
    tags: ['en:porridges', 'en:breakfast-cereals'],
    keywords: ['porridge', 'hot cereal', 'oatmeal']
  },
  flakes: {
    tags: ['en:oat-flakes', 'en:breakfast-cereals'],
    keywords: ['flakes']
  },
  cookie: {
    tags: ['en:cookies', 'en:biscuits'],
    keywords: ['cookie', 'biscuit']
  },
  bar: {
    tags: ['en:energy-bars', 'en:snack-bars'],
    keywords: ['bar']
  },
  salad: {
    tags: ['en:salads'],
    keywords: ['salad']
  },
  drink: {
    tags: ['en:beverages', 'en:drinks'],
    keywords: ['drink', 'beverage']
  }
}; 

function tokenize(value) {
  return canonicalizeQuery(value || '').split(' ').filter(Boolean);
}

function tokensFromTags(tags) {
  if (!Array.isArray(tags)) return [];
  const tokens = [];
  for (const raw of tags) {
    const value = raw.includes(':') ? raw.split(':').pop() : raw;
    tokens.push(...tokenize(value));
  }
  return tokens;
}

function limitTokens(value = '', maxTokens = 6) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxTokens)
    .join(' ')
    .trim();
}

function scoreProduct(item, product) {
  const queryTokens = tokenize(item?.name || '');
  const itemBrandTokens = tokenize(item?.brand || '');
  const name = (product.product_name || '').toLowerCase();
  let score = 0;
  const categories = Array.isArray(product.categories_tags) ? product.categories_tags : [];

  // Name overlap bonus with exact word matching
  const nameHits = queryTokens.filter(t => name.includes(t)).length;
  score += Math.min(0.5, (nameHits / Math.max(1, queryTokens.length)) * 0.5);
  
  // Bonus for exact token matches (prefer exact word matches over partial)
  const exactMatches = queryTokens.filter(t => {
    const regex = new RegExp(`\\b${t}\\b`, 'i');
    return regex.test(name);
  }).length;
  if (exactMatches > 0) {
    score += Math.min(0.3, exactMatches * 0.15);
  }

  // Bonus for nutrient coverage
  const n = product.nutriments || {};
  if (
    n['energy-kcal_100g'] != null ||
    n['energy_100g'] != null ||
    n['energy-kj_100g'] != null ||
    n['proteins_100g'] != null ||
    n['protein_100g'] != null
  ) {
    score += 0.5;
  }

  // Bonus for health data availability (prefer products with complete data)
  if (product.nutriscore_grade && product.nutriscore_grade !== 'unknown') {
    score += 0.3;
  }
  if (product.ecoscore_grade && product.ecoscore_grade !== 'unknown') {
    score += 0.2;
  }
  if (product.allergens_tags && product.allergens_tags.length > 0) {
    score += 0.1;
  }

  const brandTokens = new Set([
    ...tokensFromTags(product.brands_tags),
    ...tokenize(product.brands || '')
  ]);
  if (brandTokens.size > 0) {
    const hitsFromQuery = queryTokens.filter(t => brandTokens.has(t)).length;
    const hitsFromItemBrand = itemBrandTokens.filter(t => brandTokens.has(t)).length;
    const brandHits = hitsFromQuery + hitsFromItemBrand;
    if (brandHits > 0) {
      score += Math.min(0.4, brandHits * 0.2);
    }
  }

  const categoryTokens = new Set(tokensFromTags(product.categories_tags));
  if (categoryTokens.size > 0) {
    const categoryHits = queryTokens.filter(t => categoryTokens.has(t)).length;
    if (categoryHits > 0) {
      score += Math.min(0.3, categoryHits * 0.15);
    }
  }

  const canonical = item?.canonical_category || 'unknown';
  const positiveHints = CATEGORY_POSITIVE_HINTS[canonical];
  if (positiveHints) {
    const hasPosTag = categories.some(tag => positiveHints.tags.includes(tag));
    const hasPosKeyword = positiveHints.keywords.some(word => name.includes(word));
    if (hasPosTag || hasPosKeyword) {
      score += 0.25;
    }
  }

  const formHints = FOOD_FORM_HINTS[item?.food_form || 'unknown'];
  if (formHints) {
    const formTagHit = categories.some(tag => formHints.tags.includes(tag));
    const formKeywordHit = formHints.keywords.some(word => name.includes(word));
    if (formTagHit || formKeywordHit) {
      score += 0.3;
    }
  }

  const sweetSensitive = !SWEET_SENSITIVE_CATEGORIES.has(canonical);
  if (sweetSensitive) {
    const hasSweetTag = categories.some(tag => SWEET_CATEGORY_TAGS.has(tag));
    const hasSweetKeyword = SWEET_NAME_KEYWORDS.some(word => name.includes(word));
    if (hasSweetTag || hasSweetKeyword) {
      score -= 0.8;
    }
  }

  const plainSensitive = PLAIN_ELIGIBLE_CATEGORIES.has(canonical) && !item?.brand;
  if (plainSensitive) {
    if (FLAVOR_KEYWORDS.some(word => name.includes(word))) {
      score -= 0.6;
    }
  }

  return Math.max(score, 0);
}

function pickBest(list, scorer, thr){
  if (!Array.isArray(list) || !list.length) return null;
  const scored = list.map(p => ({ product:p, score: scorer(p) }))
                     .sort((a,b)=>b.score-a.score);
  return (scored[0]?.score ?? 0) >= thr ? scored[0] : null;
}

function hasUsefulNutriments(p) {
  const n = p?.nutriments || {};
  return n['energy-kcal_100g'] != null ||
         n['energy_100g'] != null ||
         n['energy-kj_100g'] != null ||
         n['proteins_100g'] != null ||
         n['protein_100g'] != null ||
         n['fat_100g'] != null ||
         n['carbohydrates_100g'] != null ||
         n['fiber_100g'] != null ||
         n['fibre_100g'] != null;
}

function normalizeUPC(s){ 
  return String(s||'').replace(/[^0-9]/g,''); 
}

function productMatchesPreferences(item, product) {
  const canonical = item?.canonical_category || 'unknown';
  const sweetSensitive = !SWEET_SENSITIVE_CATEGORIES.has(canonical);
  const categories = Array.isArray(product.categories_tags) ? product.categories_tags : [];
  const name = (product.product_name || '').toLowerCase();
  const nutriments = product?.nutriments || {};

  if (sweetSensitive) {
    const hasSweetTag = categories.some(tag => SWEET_CATEGORY_TAGS.has(tag));
    const hasSweetKeyword = SWEET_NAME_KEYWORDS.some(word => name.includes(word));
    if (hasSweetTag || hasSweetKeyword) {
      return { ok: false, reason: 'bad_category' };
    }
  }

  const positiveHints = CATEGORY_POSITIVE_HINTS[canonical];
  if (positiveHints) {
    const hasPosTag = categories.some(tag => positiveHints.tags.includes(tag));
    const hasPosKeyword = positiveHints.keywords.some(word => name.includes(word));
    if (!(hasPosTag || hasPosKeyword)) {
      return { ok: false, reason: 'bad_category' };
    }
  }

  const plainSensitive = PLAIN_ELIGIBLE_CATEGORIES.has(canonical) && !item?.brand;
  if (plainSensitive) {
    if (FLAVOR_KEYWORDS.some(word => name.includes(word))) {
      return { ok: false, reason: 'flavored' };
    }
    const sugars = Number(nutriments['sugars_100g']);
    if (Number.isFinite(sugars) && sugars > 5) {
      return { ok: false, reason: 'high_sugar' };
    }
  }

  return { ok: true };
}

export async function resolveOneItemOFF(item, { signal } = {}) {
  // Use clean_name + required_tokens for better search query
  const fullProductName = item.clean_name && item.required_tokens?.length > 0
    ? `${item.clean_name} ${item.required_tokens.join(' ')}`
    : item.name;
  
  const canonicalQuery = canonicalizeQuery(fullProductName);
  
  // COMPREHENSIVE LOGGING for troubleshooting
  console.log(`[OFF] === RESOLVING ITEM START ===`);
  console.log(`[OFF] Input item:`, { 
    name: item.name, 
    brand: item.brand,
    brand_normalized: item.brand_normalized,
    clean_name: item.clean_name,
    required_tokens: item.required_tokens,
    canonical_category: item.canonical_category,
    confidence: item.confidence,
    locale: item.locale
  });
  console.log(`[OFF] Canonical query: "${canonicalQuery}" (from: "${fullProductName}")`);

  if (REQUIRE_BRAND && !item.off_candidate) {
    console.log(`[OFF] Skipping (no brand/upc): ${item.name}`);
    return { item, reason: 'skipped_no_brand', canonical: canonicalQuery };
  }
  
  if (item.upc) {
    const normalizedUPC = normalizeUPC(item.upc);
    if (normalizedUPC) {
      // CACHE DISABLED FOR TESTING
      // const cached = await getCachedOffProduct(normalizedUPC, { signal });
      // if (cached?.product && cached.isFresh) {
      //   console.log(`[OFF] Cache hit for UPC ${normalizedUPC}`);
      //   return { product: cached.product, score: 1.0 };
      // }

      const prod = await getByBarcode(normalizedUPC, { signal });
      if (prod && hasUsefulNutriments(prod)) {
        // CACHE DISABLED FOR TESTING - await upsertOffProduct(prod, { previousLastModified: null, signal });
        return { product: prod, score: 1.0 };
      }

      // CACHE DISABLED FOR TESTING
      // if (cached?.product) {
      //   console.log(`[OFF] Using stale cache for UPC ${normalizedUPC}`);
      //   return { product: cached.product, score: Math.max(item.confidence ?? 0.6, 0.85) };
      // }
    }
  }

  // Primary OFF search with canonical query
  try {
    const startedAt = Date.now();
    const positiveHints = CATEGORY_POSITIVE_HINTS[item?.canonical_category || ''] || null;
    const categoryTags = positiveHints ? positiveHints.tags : [];
    const brandName = item.brand ? canonicalizeQuery(String(item.brand)) : null;
    const cleanName = canonicalQuery || canonicalizeQuery(item.name || '');
    const locale = typeof item.locale === 'string' && item.locale.trim() ? item.locale.trim().toLowerCase() : 'en';

    const brandTokens = brandName ? new Set(brandName.split(' ')) : null;
    const cleanTokens = cleanName ? cleanName.split(' ') : [];
    let nameWithoutBrand = cleanTokens.filter(token => !brandTokens || !brandTokens.has(token)).join(' ');
    if (!nameWithoutBrand && cleanName) {
      nameWithoutBrand = cleanName;
    }

    const limitedBrandTerm = limitTokens(nameWithoutBrand);
    const limitedCleanTerm = limitTokens(cleanName);

    const queries = [];
    if (brandName && limitedBrandTerm) {
      queries.push({ term: limitedBrandTerm, brand: brandName });
    }
    if (limitedCleanTerm) {
      queries.push({ term: limitedCleanTerm, brand: null });
    }

    // Build multiple search strategies for better coverage
    const searchStrategies = [];
    
    // Strategy 1: Brand + simple tokens only  
    if (brandName && item.required_tokens?.length > 0) {
      const simpleTokens = item.required_tokens.filter(token => 
        token.length <= 15 && !token.includes('/') && !token.includes('%') && !token.match(/\d/)
      );
      if (simpleTokens.length > 0) {
        const brandWithTokens = `${brandName} ${simpleTokens.join(' ')}`;
        searchStrategies.push({ term: limitTokens(brandWithTokens), brand: brandName, strategy: 'brand_with_tokens' });
      }
    }
    
    // Strategy 3: Original queries as fallback
    for (const q of queries) {
      if (!q.term) continue;
      const key = `${q.term}::${q.brand || ''}`;
      if (!searchStrategies.some(s => `${s.term}::${s.brand || ''}` === key)) {
        searchStrategies.push({ ...q, strategy: 'original' });
      }
    }

    const finalQueries = searchStrategies.slice(0, 3); // Try up to 3 strategies
    
    console.log(`[OFF] Search strategies generated:`, finalQueries.map(q => ({
      strategy: q.strategy,
      term: q.term,
      brand: q.brand
    })));

    if (finalQueries.length === 0) {
      console.log(`[OFF] No search strategies generated - empty query`);
      return { item, reason: 'empty_query', canonical: canonicalQuery };
    }

    let data = null;

    for (const { term, brand, strategy } of finalQueries) {
      if (Date.now() - startedAt > OFF_BUDGET_MS) {
        return { item, reason: 'timeout', canonical: canonicalQuery, error: 'budget_exceeded' };
      }
      data = await searchByNameV1(term, {
        signal,
        categoryTags,
        brand,
        maxPages: 1,
        locale
      });
      if (Array.isArray(data?.products) && data.products.length > 0) {
        console.log(`[OFF] Search strategy '${strategy}' found ${data.products.length} products`);
        break;
      } else {
        console.log(`[OFF] Search strategy '${strategy}' found no products for term="${term}"`);
      }
    }

    if (!data || !Array.isArray(data.products) || data.products.length === 0) {
      const reason = brandName ? 'off_not_found_brand' : 'no_hits';
      return {
        item,
        reason,
        canonical: canonicalQuery,
        error: `OFF not found for brand="${brandName || 'none'}" name="${item.name}"`
      };
    }

    const products = data.products;
    console.log(`[OFF] Search returned ${products.length} products from API`);

    // Require at least one useful per-100g nutrient value
    const useful = products.filter(hasUsefulNutriments);
    console.log(`[OFF] Nutrient filter: ${useful.length}/${products.length} products have useful nutrients`);

    if (useful.length === 0) {
      console.log(`[OFF] No useful nutrients for "${canonicalQuery}" (${products.length} products found)`);
      return { item, reason: 'no_useful_nutrients', canonical: canonicalQuery };
    }

    // HARD FILTERS: Brand and variant token matching
    let candidates = useful;
    
    // Brand gate: proper brands_tags matching with aliases
    if (item.brand_normalized) {
      const normalizedBrand = item.brand_normalized.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      
      // Generate brand aliases (full name + individual words)
      const brandAliases = new Set([normalizedBrand]);
      const brandWords = normalizedBrand.split(' ').filter(w => w.length > 2);
      brandWords.forEach(word => brandAliases.add(word));
      
      candidates = candidates.filter(product => {
        const brandTags = (product.brands_tags || []).map(tag => 
          tag.replace(/^[a-z]{2}:/, '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        );
        const brandText = (product.brands || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        
        // DEBUG: Log brand data for first product
        if (candidates.indexOf(product) === 0) {
          console.log(`[OFF] DEBUG first product brands:`, {
            product_name: product.product_name,
            brands: product.brands,
            brands_tags: product.brands_tags,
            normalized_tags: brandTags,
            normalized_text: brandText,
            seeking_aliases: [...brandAliases]
          });
        }
        
        // Check if any brand alias matches any brand tag or text (flexible matching)
        return [...brandAliases].some(alias => {
          return brandTags.some(tag => tag.includes(alias)) || 
                 brandText.includes(alias);
        });
      });
      
      if (candidates.length === 0) {
        console.log(`[OFF] === BRAND FILTER FAIL ===`);
        console.log(`[OFF] No products match brand aliases [${[...brandAliases].join(', ')}] for "${canonicalQuery}"`);
        console.log(`[OFF] Available brands in search results:`, useful.slice(0, 3).map(p => ({
          product_name: p.product_name,
          brands: p.brands,
          brands_tags: p.brands_tags
        })));
        return { item, reason: 'brand_filter_no_match', canonical: canonicalQuery, brand_aliases: [...brandAliases] };
      }
      
      console.log(`[OFF] Brand filter: ${[...brandAliases].length} aliases, ${candidates.length} candidates match`);
    }
    
    // Variant gate: require ALL variant tokens in multiple fields
    if (item.required_tokens && item.required_tokens.length > 0) {
      // Filter out overly long/complex tokens (keep only simple modifiers)
      const simpleTokens = item.required_tokens.filter(token => 
        token.length <= 15 && !token.includes('/') && !token.includes('%') && !token.match(/\d/)
      );
      
      if (simpleTokens.length > 0) {
        candidates = candidates.filter(product => {
          // Normalize and combine searchable fields
          const productName = (product.product_name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          const labelTags = (product.labels_tags || []).map(tag => tag.replace(/^[a-z]{2}:/, '').toLowerCase());
          const categoryTags = (product.categories_tags || []).map(tag => tag.replace(/^[a-z]{2}:/, '').toLowerCase());
          
          const searchableText = [productName, ...labelTags, ...categoryTags].join(' ');
          
          // Require ALL tokens to be present (every, not some)
          return simpleTokens.every(token => {
            const normalizedToken = token.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const regex = new RegExp(`\\b${normalizedToken}\\b`, 'i');
            return regex.test(searchableText);
          });
        });
        
        if (candidates.length === 0) {
          console.log(`[OFF] === VARIANT FILTER FAIL ===`);
          console.log(`[OFF] No products match ALL required tokens [${simpleTokens.join(', ')}] for "${canonicalQuery}"`);
          console.log(`[OFF] Checked products:`, candidates.slice(0, 3).map(p => ({
            product_name: p.product_name,
            labels_tags: p.labels_tags?.slice(0, 3),
            categories_tags: p.categories_tags?.slice(0, 3)
          })));
          return { item, reason: 'variant_filter_no_match', canonical: canonicalQuery, missing_tokens: simpleTokens };
        }
        
        console.log(`[OFF] Variant filter: ALL ${simpleTokens.length} tokens required, ${candidates.length} candidates match`);
      }
    }
    
    // Category gate: prevent type mismatches (dairy vs plant-based)
    if (item.canonical_category === 'dairy') {
      const beforeCategoryFilter = candidates.length;
      candidates = candidates.filter(product => {
        const categories = product.categories_tags || [];
        const hasPlantBased = categories.some(cat => 
          cat.includes('plant-based') || 
          cat.includes('vegetal') ||
          cat.includes('almond') ||
          cat.includes('soy') ||
          cat.includes('oat')
        );
        return !hasPlantBased;
      });
      
      if (candidates.length === 0) {
        console.log(`[OFF] Category filter removed all candidates (${beforeCategoryFilter} plant-based products filtered out)`);
        return { item, reason: 'category_type_mismatch', canonical: canonicalQuery };
      }
    }

    console.log(`[OFF] After hard filters: ${candidates.length}/${useful.length} candidates remaining`);

    const filtered = [];
    for (const prod of candidates) {
      const pref = productMatchesPreferences(item, prod);
      if (pref.ok) {
        filtered.push(prod);
      }
    }

    if (filtered.length === 0) {
      console.log(`[OFF] Category filter removed all OFF hits for "${canonicalQuery}" (canonical_category: ${item?.canonical_category || 'unknown'})`);
      return { item, reason: 'bad_category', canonical: canonicalQuery };
    }

    const threshold = item?.off_candidate ? BRAND_THRESHOLD : DEFAULT_THRESHOLD;

    const best = filtered
      .map(p => ({ p, s: scoreProduct(item, p) }))
      .sort((a,b) => b.s - a.s)[0];

    if (!best || best.s < threshold) {
      console.log(`[OFF] Low score for "${canonicalQuery}": ${best?.s ?? 'null'} (${filtered.length} filtered products)`);
      return { item, reason: 'low_score', canonical: canonicalQuery, score: best?.s };
    }

    if (best.p?.code) {
      // CACHE DISABLED FOR TESTING
      // const cached = await getCachedOffProduct(best.p.code, { signal });
      // await upsertOffProduct(best.p, { previousLastModified: cached?.last_modified_t, signal });
    }

    console.log(`[OFF] === SUCCESS ===`);
    console.log(`[OFF] Found: "${best.p.product_name}" (code: ${best.p.code}, score: ${best.s.toFixed(2)})`);
    console.log(`[OFF] Product data:`, {
      code: best.p.code,
      brands: best.p.brands,
      brands_tags: best.p.brands_tags,
      nutriscore: best.p.nutriscore_grade,
      allergens: best.p.allergens_tags,
      ingredients_analysis: best.p.ingredients_analysis_tags,
      labels_tags: best.p.labels_tags?.slice(0, 5), // first 5 labels
      categories_tags: best.p.categories_tags?.slice(0, 5) // first 5 categories
    });
    console.log(`[OFF] === RESOLVING ITEM END ===`);
    
    return { product: best.p, score: best.s };
    
  } catch (e) {
    const isAbort = e?.name === 'AbortError';
    console.log(`[OFF] Error for "${canonicalQuery}": ${isAbort ? 'timeout' : 'http_or_json_error'} - ${e.message}`);
    return { item, reason: isAbort ? 'timeout' : 'http_or_json_error', canonical: canonicalQuery, error: e.message };
  }
}

export function scalePerPortionOFF(prod, grams) {
  const per100 = mapOFFProductToPer100g(prod);
  const k = grams / 100;
  const round = (n,d=0)=>{ const m=10**d; return Math.round((n+Number.EPSILON)*m)/m; };
  return {
    calories:  round((per100.ENERC_KCAL||0) * k),
    protein_g: round((per100.PROCNT||0) * k,1),
    fat_g:     round((per100.FAT||0) * k,1),
    carbs_g:   round((per100.CHOCDF||0) * k,1),
    fiber_g:   round((per100.FIBTG||0) * k,1),
    meta: per100.meta,
    serving_size_label: per100.serving_size
  };
}
