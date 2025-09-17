import { getByBarcode, searchByNameV1, canonicalizeQuery } from './off-client.js';
import { mapOFFProductToPer100g } from './off-map.js';
import { getCachedOffProduct, upsertOffProduct } from './off-supabase-cache.js';
import { isVariantToken } from './variant-rules.js';

const REQUIRE_BRAND = String(process.env.OFF_REQUIRE_BRAND || 'false').toLowerCase() === 'true';
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

function limitTokens(value = '', maxTokens = 6) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxTokens)
    .join(' ')
    .trim();
}

function normalizeText(value) {
  return (value || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function normalizeForMatch(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function stripLangPrefix(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/^[a-z]{2,3}:/i, '');
}

function escapeRegex(value) {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function buildPhraseRegex(phrase) {
  const normalized = normalizeForMatch(phrase);
  if (!normalized) return null;
  const parts = normalized.split(/\s+/).filter(Boolean).map(escapeRegex);
  if (parts.length === 0) return null;
  return new RegExp(`\\b${parts.join('\\s+')}\\b`, 'i');
}

function buildBrandContext(item) {
  const raw = item?.brand_normalized || item?.brand;
  const normalized = normalizeForMatch(raw);
  if (!normalized) return null;
  const tokens = normalized.split(/\s+/).filter(token => token.length > 2);
  return {
    full: normalized,
    collapsed: normalized.replace(/\s+/g, ''),
    tokens: new Set(tokens)
  };
}

function extractProductBrandData(product) {
  const values = new Set();
  const words = new Set();

  const push = (value) => {
    const normalized = normalizeForMatch(value);
    if (!normalized) return;
    values.add(normalized);
    const collapsed = normalized.replace(/\s+/g, '');
    if (collapsed) values.add(collapsed);
    normalized.split(/\s+/).filter(token => token.length > 2).forEach(token => words.add(token));
  };

  if (typeof product?.brands === 'string') {
    product.brands.split(',').forEach(part => push(part));
  }
  if (Array.isArray(product?.brands_tags)) {
    product.brands_tags.forEach(tag => push(stripLangPrefix(tag)));
  }

  return { values, words };
}

function computeBrandScore(brandContext, product) {
  if (!brandContext) {
    return { score: 0, exact: false, partialHits: 0 };
  }

  const brandData = extractProductBrandData(product);
  let score = 0;
  let exact = false;

  if (brandData.values.has(brandContext.full) || brandData.values.has(brandContext.collapsed)) {
    score += 1000;
    exact = true;
  }

  let partialHits = 0;
  if (!exact) {
    for (const token of brandContext.tokens) {
      if (token.length <= 2) continue;
      if (brandData.words.has(token) || [...brandData.values].some(value => value.includes(token))) {
        partialHits += 1;
      }
    }
    if (partialHits > 0) {
      score += Math.min(400, partialHits * 180);
    }
  }

  return { score, exact, partialHits };
}

function computeVariantSignals(product, variantTokens = []) {
  if (!variantTokens?.length) {
    return { phraseMatches: 0, tokenMatches: 0 };
  }

  const normalizedName = normalizeForMatch(product.product_name);
  const labelTexts = (product.labels_tags || [])
    .map(tag => normalizeForMatch(stripLangPrefix(tag)))
    .filter(Boolean);
  const categoryTexts = (product.categories_tags || [])
    .map(tag => normalizeForMatch(stripLangPrefix(tag)))
    .filter(Boolean);

  const tokenMatches = new Set();
  let phraseMatches = 0;

  for (const rawToken of variantTokens) {
    const normalizedToken = normalizeForMatch(rawToken);
    if (!normalizedToken) continue;
    const regex = buildPhraseRegex(normalizedToken);
    let phraseFound = false;
    if (regex && regex.test(normalizedName)) {
      phraseMatches += 1;
      phraseFound = true;
    } else if (regex) {
      if (labelTexts.some(text => regex.test(text)) || categoryTexts.some(text => regex.test(text))) {
        phraseMatches += 1;
        phraseFound = true;
      }
    }

    if (
      phraseFound ||
      normalizedName.includes(normalizedToken) ||
      labelTexts.some(text => text.includes(normalizedToken)) ||
      categoryTexts.some(text => text.includes(normalizedToken))
    ) {
      tokenMatches.add(normalizedToken);
    }
  }

  return { phraseMatches, tokenMatches: tokenMatches.size };
}

function computeCategoryPenalty(product, negativeCategoryTags = []) {
  if (!negativeCategoryTags?.length) return 0;
  const categories = Array.isArray(product.categories_tags) ? product.categories_tags : [];
  if (categories.length === 0) return 0;

  const normalizedCategories = categories
    .map(tag => normalizeForMatch(stripLangPrefix(tag)))
    .filter(Boolean);

  for (const tag of negativeCategoryTags) {
    const normalized = normalizeForMatch(stripLangPrefix(tag));
    if (!normalized) continue;
    if (normalizedCategories.some(cat => cat === normalized || cat.includes(normalized))) {
      return -200;
    }
  }

  if (normalizedCategories.some(cat => cat.includes('plant based'))) {
    return -200;
  }

  return 0;
}

function computeNameSimilarityScore(product, queryTokens = new Set()) {
  if (!queryTokens || queryTokens.size === 0) return 0;
  const productTokens = new Set(normalizeForMatch(product.product_name).split(/\s+/).filter(Boolean));
  if (productTokens.size === 0) return 0;
  let shared = 0;
  for (const token of queryTokens) {
    if (productTokens.has(token)) shared += 1;
  }
  if (shared === 0) return 0;
  const ratio = shared / Math.max(1, queryTokens.size);
  return Math.min(60, Math.round(ratio * 60));
}

function computePreferenceAdjustments(item, product) {
  const canonical = item?.canonical_category || 'unknown';
  const categories = Array.isArray(product.categories_tags) ? product.categories_tags : [];
  const productName = (product.product_name || '').toLowerCase();
  const nutriments = product?.nutriments || {};

  let bonus = 0;
  let penalty = 0;

  if (!SWEET_SENSITIVE_CATEGORIES.has(canonical)) {
    const hasSweetTag = categories.some(tag => SWEET_CATEGORY_TAGS.has(tag));
    const hasSweetKeyword = SWEET_NAME_KEYWORDS.some(word => productName.includes(word));
    if (hasSweetTag || hasSweetKeyword) {
      penalty += 120;
    }
  }

  const positiveHints = CATEGORY_POSITIVE_HINTS[canonical];
  if (positiveHints) {
    const hasPosTag = categories.some(tag => positiveHints.tags.includes(tag));
    const hasPosKeyword = positiveHints.keywords.some(word => productName.includes(word));
    if (hasPosTag || hasPosKeyword) {
      bonus += 30;
    } else {
      penalty += 60;
    }
  }

  const plainSensitive = PLAIN_ELIGIBLE_CATEGORIES.has(canonical) && !item?.brand;
  if (plainSensitive) {
    if (FLAVOR_KEYWORDS.some(word => productName.includes(word))) {
      penalty += 120;
    }
    const sugars = Number(nutriments['sugars_100g']);
    if (Number.isFinite(sugars) && sugars > 5) {
      penalty += 80;
    }
  }

  return { bonus, penalty };
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

function scoreProduct(item, product, context) {
  const { brandContext, variantTokens, negativeCategoryTags, nameTokens } = context;
  const breakdown = {};

  const brandScore = computeBrandScore(brandContext, product);
  breakdown.brand = brandScore.score;
  let total = brandScore.score;

  const variantSignals = computeVariantSignals(product, variantTokens);
  const variantPhraseScore = variantSignals.phraseMatches * 80;
  const variantTokenScore = variantSignals.tokenMatches * 20;
  breakdown.variant_phrase = variantPhraseScore;
  breakdown.variant_tokens = variantTokenScore;
  total += variantPhraseScore + variantTokenScore;

  const categoryPenalty = computeCategoryPenalty(product, negativeCategoryTags);
  breakdown.category_penalty = categoryPenalty;
  total += categoryPenalty;
  
  if (categoryPenalty < 0) {
    console.log(`[OFF] Category penalty applied: ${categoryPenalty} for product "${product.product_name}"`);
  }

  const nameScore = computeNameSimilarityScore(product, nameTokens);
  breakdown.name = nameScore;
  total += nameScore;

  const preference = computePreferenceAdjustments(item, product);
  const preferenceScore = preference.bonus - preference.penalty;
  breakdown.preference = preferenceScore;
  total += preferenceScore;

  const nutritionBonus = hasUsefulNutriments(product) ? 30 : 0;
  breakdown.nutrition = nutritionBonus;
  total += nutritionBonus;

  return { score: total, breakdown, brandExact: brandScore.exact };
}

function normalizeUPC(s){ 
  return String(s||'').replace(/[^0-9]/g,''); 
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
    const variantWhitelistTokens = Array.isArray(item.required_tokens)
      ? [...new Set(item.required_tokens.filter(token => isVariantToken(token)))]
      : [];
    const negativeCategoryTags = [];
    if (item.canonical_category === 'dairy') {
      negativeCategoryTags.push('en:plant-based-milk-alternatives');
    }
    const brandContext = buildBrandContext(item);

    const brandTokens = brandName ? new Set(brandName.split(' ')) : null;
    const cleanTokens = cleanName ? cleanName.split(' ') : [];
    let nameWithoutBrand = cleanTokens.filter(token => !brandTokens || !brandTokens.has(token)).join(' ');
    if (!nameWithoutBrand && cleanName) {
      nameWithoutBrand = cleanName;
    }

    const variantWordSet = new Set();
    for (const token of variantWhitelistTokens) {
      const parts = canonicalizeQuery(token).split(' ').filter(Boolean);
      for (const part of parts) {
        variantWordSet.add(part);
      }
    }
    const nameTokens = new Set(
      cleanTokens
        .filter(Boolean)
        .filter(token => !brandTokens || !brandTokens.has(token))
        .filter(token => !variantWordSet.has(token))
    );
    if (nameTokens.size === 0) {
      cleanTokens.filter(Boolean).forEach(token => nameTokens.add(token));
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
    if (brandName && variantWhitelistTokens.length > 0) {
      const brandWithTokens = `${brandName} ${variantWhitelistTokens.join(' ')}`;
      searchStrategies.push({ term: limitTokens(brandWithTokens), brand: brandName, strategy: 'brand_with_tokens' });
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
        negativeCategoryTags,
        brand,
        maxPages: 1,
        locale,
        variantTokens: variantWhitelistTokens
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

    // Log raw response (top-N documents)
    console.log(`[OFF] Raw Response top-${Math.min(products.length, 5)}:`, products.slice(0, 5).map(p => ({
      code: p.code,
      product_name: p.product_name,
      brands: p.brands,
      brands_tags: p.brands_tags?.slice(0, 3),
      categories_tags: p.categories_tags?.slice(0, 3)
    })));

    // Require at least one useful per-100g nutrient value
    const useful = products.filter(hasUsefulNutriments);
    console.log(`[OFF] Nutrient filter: ${useful.length}/${products.length} products have useful nutrients`);

    if (useful.length === 0) {
      console.log(`[OFF] No useful nutrients for "${canonicalQuery}" (${products.length} products found)`);
      return { item, reason: 'no_useful_nutrients', canonical: canonicalQuery };
    }

    const scoringContext = {
      brandContext,
      variantTokens: variantWhitelistTokens,
      negativeCategoryTags,
      nameTokens
    };

    const scoredCandidates = useful
      .map(product => {
        const { score, breakdown, brandExact } = scoreProduct(item, product, scoringContext);
        return { product, score, breakdown, brandExact };
      })
      .sort((a, b) => b.score - a.score);

    if (scoredCandidates.length === 0) {
      console.log(`[OFF] No candidates after scoring for "${canonicalQuery}"`);
      return { item, reason: 'no_candidates', canonical: canonicalQuery };
    }

    console.log(`[OFF] Rerank top candidates:`, scoredCandidates.slice(0, 3).map(({ product, score, brandExact, breakdown }) => ({
      product_name: product.product_name,
      score,
      brandExact,
      brands: product.brands,
      breakdown
    })));

    const best = scoredCandidates[0];
    const scoreThreshold = brandContext ? 200 : 80;

    if (!best || best.score < scoreThreshold) {
      console.log(`[OFF] Final Decision: REJECTED, reason=low_score, score=${best?.score ?? 'null'}, threshold=${scoreThreshold}, candidates=${scoredCandidates.length}`);
      console.log(`[OFF] Low score for "${canonicalQuery}": ${best?.score ?? 'null'} (${scoredCandidates.length} candidates)`);
      return { item, reason: 'low_score', canonical: canonicalQuery, score: best?.score };
    }

    console.log(`[OFF] Best candidate breakdown:`, best.breakdown);

    if (best.product?.code) {
      // CACHE DISABLED FOR TESTING
      // const cached = await getCachedOffProduct(best.product.code, { signal });
      // await upsertOffProduct(best.product, { previousLastModified: cached?.last_modified_t, signal });
    }

    console.log(`[OFF] === SUCCESS ===`);
    console.log(`[OFF] Final Decision: selected product_code=${best.product.code}, final_score=${best.score.toFixed(2)}, reason=highest_rerank_score`);
    console.log(`[OFF] Found: "${best.product.product_name}" (code: ${best.product.code}, score: ${best.score.toFixed(2)})`);
    console.log(`[OFF] Product data:`, {
      code: best.product.code,
      brands: best.product.brands,
      brands_tags: best.product.brands_tags,
      nutriscore: best.product.nutriscore_grade,
      allergens: best.product.allergens_tags,
      ingredients_analysis: best.product.ingredients_analysis_tags,
      labels_tags: best.product.labels_tags?.slice(0, 5),
      categories_tags: best.product.categories_tags?.slice(0, 5)
    });
    console.log(`[OFF] === RESOLVING ITEM END ===`);
    
    return { product: best.product, score: best.score };
    
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
