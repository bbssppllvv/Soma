import { getByBarcode, searchByNameV1, canonicalizeQuery, normalizeBrandForSearch } from './off-client.js';
import { mapOFFProductToPer100g } from './off-map.js';
import { getCachedOffProduct, upsertOffProduct } from './off-supabase-cache.js';
import { isVariantToken } from './variant-rules.js';

const REQUIRE_BRAND = String(process.env.OFF_REQUIRE_BRAND || 'false').toLowerCase() === 'true';
const OFF_BUDGET_MS = Number(process.env.OFF_GLOBAL_BUDGET_MS || 3000);

const BRAND_ACCEPT_SCORE = 100; // minimum brand score to consider a match reliable (final reduction for M&M's type brands)
const BRAND_MISS_PENALTY = 100; // penalty applied when brand context exists but no match (reduced for production)

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
  },
  dairy: {
    tags: ['en:milks', 'en:cheeses', 'en:butters', 'en:cream-cheeses'],
    keywords: ['milk', 'leche', 'queso', 'cheese', 'mantequilla', 'butter', 'philadelphia', 'cream cheese']
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

function normalizeBrandVariant(value) {
  if (!value) return null;
  const lower = value.toString().toLowerCase();
  const normalized = lower
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/["'’‘`´]/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .trim();

  if (!normalized) return null;

  const tokens = normalized.split(/[\s-]+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every(token => token.length === 1)) {
    return tokens.join('');
  }

  return normalized;
}

function expandBrandCandidate(value) {
  if (!value) return [];
  const str = value.toString().trim();
  if (!str) return [];
  const lower = str.toLowerCase();
  const normalized = lower.normalize('NFKD').replace(/\p{M}/gu, '');
  const variants = new Set([
    lower,
    normalized,
    normalizeBrandForSearch(lower)
  ]);

  variants.add(normalized.replace(/&/g, ' '));
  variants.add(normalized.replace(/[+@]/g, ' '));
  variants.add(normalized.replace(/_/g, ' '));
  variants.add(normalized.replace(/[^a-z0-9\s-]/g, ' '));
  variants.add(normalized.replace(/[^a-z0-9]+/g, '-'));

  return [...variants].filter(Boolean);
}

function brandVariantScore(value) {
  if (!value) return 0;
  const tokens = value.split(/[\s-]+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  const longTokens = tokens.filter(token => token.length > 1).length;
  const alnumLength = value.replace(/[^a-z0-9]/g, '').length;
  let score = longTokens * 100 + Math.min(alnumLength, 40);
  if (tokens.length === 1) score += 15;
  if (value.includes(' ')) score += 5;
  if (value.includes('-')) score += 5;
  if (longTokens === 0 && tokens.length > 1) score -= 60;
  return score;
}

function collectBrandSearchVariants(item) {
  // SIMPLIFIED: Only 2 main variants to reduce noise (per developer feedback)
  const variants = [];
  
  // Variant 1: Normalized for search (preserves spaces)
  const brand = item?.brand_normalized || item?.brand;
  if (brand) {
    const normalized = normalizeBrandForSearch(brand);
    if (normalized) {
      variants.push(normalized);
    }
  }
  
  // Variant 2: Slug for v2 API (hyphens instead of spaces)  
  if (brand) {
    const slug = brand
      .toLowerCase()
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '');
    
    if (slug && slug !== variants[0]) {
      variants.push(slug);
    }
  }
  
  // Fallback: if no variants, use original brand
  if (variants.length === 0 && item?.brand) {
    variants.push(item.brand.toLowerCase());
  }
  
  return variants.slice(0, 2); // Maximum 2 variants to reduce noise
}

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

function deriveCategoryFilters(item, variantTokens = []) {
  let primary = null;
  const secondary = new Set();
  const exclude = new Set();
  const canonical = item?.canonical_category || 'unknown';
  const combinedText = normalizeText([
    item?.brand,
    item?.brand_normalized,
    item?.clean_name,
    item?.name
  ].filter(Boolean).join(' '));

  if (canonical === 'dairy') {
    exclude.add('en:plant-based-milk-alternatives');

    const isButter = /\bmantequilla\b|\bbutter\b/.test(combinedText);
    const isCheese = /\bqueso\b|\bcheese\b|\bphiladelphia\b|cream\s*cheese/.test(combinedText);
    const milkSignals = /\bleche\b|\bmilk\b|\blacteo\b/.test(combinedText);

    const variantSignal = variantTokens.some(token => {
      const normalized = normalizeText(token);
      return normalized.includes('semidesnat') || normalized.includes('semi') || normalized.includes('desnatada') || normalized.includes('entera') || normalized.includes('light');
    });

    if (isButter) {
      primary = 'en:butters';
    }

    if (isCheese) {
      primary = primary || 'en:cheeses';
      secondary.add('en:cream-cheeses');
    }

    if (!primary && (milkSignals || variantSignal || (!isButter && !isCheese))) {
      primary = 'en:milks';
    }
  }

  if (!primary) {
    const hint = CATEGORY_POSITIVE_HINTS[canonical];
    if (hint?.tags?.length) {
      primary = hint.tags[0];
      hint.tags.slice(1).forEach(tag => secondary.add(tag));
    }
  }

  return {
    primary: primary || null,
    secondary: [...secondary],
    exclude: [...exclude]
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
    score += 500; // REDUCED from 1000 to balance with name/variant matching
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

  if (!exact && partialHits === 0) {
    // Only apply penalty if brand context exists and no partial matches
    // But reduce penalty if we're searching for a specific brand
    score -= BRAND_MISS_PENALTY;
  } else if (!exact && partialHits > 0) {
    // Bonus for partial brand matches (better than complete miss)
    score += Math.min(200, partialHits * 50);
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

function computeCategorySpecificityScore(categories = []) {
  let bestDepth = 0;
  for (const raw of categories) {
    const value = stripLangPrefix(raw || '').toLowerCase();
    if (!value) continue;
    const depth = value.split('-').length;
    if (depth > bestDepth) bestDepth = depth;
  }
  if (bestDepth <= 1) return 0;
  return Math.min(20, (bestDepth - 1) * 5);
}

function parseQuantityToBase(raw) {
  if (!raw) return null;
  const value = String(raw).toLowerCase();
  const match = value.match(/(\d+(?:[\.,]\d+)?)\s*(kg|g|l|ml)\b/);
  if (!match) return null;
  const amount = parseFloat(match[1].replace(',', '.'));
  if (!Number.isFinite(amount)) return null;
  const unit = match[2];
  if (unit === 'kg') {
    return { value: amount * 1000, unit: 'g' };
  }
  if (unit === 'g') {
    return { value: amount, unit: 'g' };
  }
  if (unit === 'l') {
    return { value: amount * 1000, unit: 'ml' };
  }
  if (unit === 'ml') {
    return { value: amount, unit: 'ml' };
  }
  return null;
}

function computeQuantityMatchScore(item, product) {
  const parsed = parseQuantityToBase(product?.quantity);
  if (!parsed) return 0;

  const portion = Number(item?.portion);
  const unit = (item?.unit || '').toLowerCase();
  if (!Number.isFinite(portion)) return 0;

  let targetValue = null;
  if (unit === 'g' || unit === 'gram' || unit === 'grams') {
    targetValue = { value: portion, unit: 'g' };
  } else if (unit === 'ml' || unit === 'milliliter' || unit === 'milliliters') {
    targetValue = { value: portion, unit: 'ml' };
  }

  if (!targetValue || targetValue.unit !== parsed.unit) return 0;

  const diff = Math.abs(parsed.value - targetValue.value);
  const tolerance = Math.max(20, targetValue.value * 0.15);
  if (diff <= tolerance) return 15;
  if (diff <= targetValue.value * 0.3) return 8;
  return 0;
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
  
  // CRITICAL FIX: Required tokens must have much higher weight
  // to prevent brand-only matches from winning over specific products
  const variantPhraseScore = variantSignals.phraseMatches * 200; // Increased from 80
  const variantTokenScore = variantSignals.tokenMatches * 100;   // Increased from 20
  
  breakdown.variant_phrase = variantPhraseScore;
  breakdown.variant_tokens = variantTokenScore;
  total += variantPhraseScore + variantTokenScore;
  
  // CRITICAL: If required_tokens exist but NONE match, apply heavy penalty
  if (variantTokens?.length > 0 && variantSignals.tokenMatches === 0) {
    const requiredTokensPenalty = -500; // Heavy penalty for missing required tokens
    breakdown.required_tokens_penalty = requiredTokensPenalty;
    total += requiredTokensPenalty;
    console.log(`[OFF] Required tokens penalty applied: ${requiredTokensPenalty} (missing: ${variantTokens.join(', ')})`);
  }

  const categoryPenalty = computeCategoryPenalty(product, negativeCategoryTags);
  breakdown.category_penalty = categoryPenalty;
  total += categoryPenalty;

  const brandTagsBonus = Array.isArray(product.brands_tags) && product.brands_tags.length > 0 ? 25 : 0;
  breakdown.brand_tags = brandTagsBonus;
  total += brandTagsBonus;

  const categorySpecificityScore = computeCategorySpecificityScore(product.categories_tags);
  breakdown.category_specificity = categorySpecificityScore;
  total += categorySpecificityScore;

  const countryBonus = Array.isArray(product.countries_tags) && product.countries_tags.some(tag => {
    const normalized = stripLangPrefix(tag || '').toLowerCase();
    return normalized === 'spain' || normalized === 'espana' || normalized === 'españa';
  }) ? 10 : 0;
  breakdown.country = countryBonus;
  total += countryBonus;

  const nutrimentCount = Object.keys(product?.nutriments || {}).filter(key => key.endsWith('_100g')).length;
  const nutrimentScore = Math.min(30, nutrimentCount);
  breakdown.nutriments = nutrimentScore;
  total += nutrimentScore;

  const quantityBonus = computeQuantityMatchScore(item, product);
  breakdown.quantity = quantityBonus;
  total += quantityBonus;

  const dataQualityBonus = typeof product.data_quality_score === 'number'
    ? Math.max(0, Math.min(20, Math.round(product.data_quality_score)))
    : 0;
  breakdown.data_quality = dataQualityBonus;
  total += dataQualityBonus;

  const nameScore = computeNameSimilarityScore(product, nameTokens);
  // IMPROVEMENT: Increase name score weight to balance with brand score
  const enhancedNameScore = nameScore * 3; // Increased weight for name matching
  breakdown.name = enhancedNameScore;
  total += enhancedNameScore;

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
  
  // DEFENSIVE: Check if clean_name contains brand name (GPT error)
  if (item.clean_name && item.brand) {
    const cleanLower = item.clean_name.toLowerCase();
    const brandWords = item.brand.toLowerCase().split(/[\s&'-]+/);
    const brandInClean = brandWords.some(word => 
      word.length > 2 && cleanLower.includes(word)
    );
    
    if (brandInClean) {
      console.log(`[OFF] WARNING: clean_name contains brand name - GPT field separation error`);
      console.log(`[OFF] clean_name: "${item.clean_name}", brand: "${item.brand}"`);
      // Use generic product type instead
      const genericType = item.canonical_category === 'snack-sweet' ? 'chocolate' :
                         item.canonical_category === 'dairy' ? 'milk' :
                         item.canonical_category === 'beverage' ? 'drink' : 'product';
      console.log(`[OFF] Using generic type: "${genericType}" instead of "${item.clean_name}"`);
    }
  }

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
    const brandVariants = collectBrandSearchVariants(item);
    if (brandVariants.length > 0) {
      console.log(`[OFF] Brand variants:`, brandVariants.slice(0, 5));
    }
    const brandName = brandVariants[0] || null;
    const cleanName = canonicalQuery || canonicalizeQuery(item.name || '');
    const locale = typeof item.locale === 'string' && item.locale.trim() ? item.locale.trim().toLowerCase() : 'en';
  const variantWhitelistTokens = Array.isArray(item.required_tokens)
    ? [...new Set(item.required_tokens
        .filter(token => isVariantToken(token))
        .map(token => canonicalizeQuery(token)) // Full canonicalization for consistent matching
        .filter(Boolean))]
    : [];
    const categoryFilters = deriveCategoryFilters(item, variantWhitelistTokens);
    const categoryTags = [];
    if (categoryFilters.primary) {
      categoryTags.push(categoryFilters.primary);
    } else if (positiveHints?.tags?.length) {
      categoryTags.push(positiveHints.tags[0]);
    }
    const negativeCategoryTags = [...new Set(categoryFilters.exclude)];
    const brandContext = buildBrandContext(item);

    const brandTokens = brandName
      ? new Set(brandName.replace(/[-_]/g, ' ').split(/\s+/).filter(Boolean))
      : null;
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

    const limitedProductTerm = limitTokens(nameWithoutBrand);
    const limitedCleanTerm = limitTokens(cleanName);

    const searchStrategies = [];
    const seenStrategies = new Set();

    const pushStrategy = (termValue, brandValue, strategy) => {
      if (!termValue) return;
      const limitedTerm = limitTokens(termValue);
      if (!limitedTerm) return;
      const normalizedBrand = brandValue ? limitTokens(brandValue) : null;
      const key = `${limitedTerm}::${normalizedBrand || ''}`;
      if (seenStrategies.has(key)) return;
      seenStrategies.add(key);
      searchStrategies.push({ term: limitedTerm, brand: normalizedBrand, strategy });
    };

    if (brandVariants.length > 0 && limitedProductTerm) {
      brandVariants.slice(0, 3).forEach((variant, idx) => {
        pushStrategy(limitedProductTerm, variant, idx === 0 ? 'brand_primary' : `brand_alt_${idx}`);
      });
    }

    if (variantWhitelistTokens.length > 0 && brandVariants.length > 0) {
      const variantPhrase = variantWhitelistTokens.join(' ');
      brandVariants.slice(0, 2).forEach((variant, idx) => {
        const combined = `${variant} ${variantPhrase}`.trim();
        pushStrategy(combined, variant, idx === 0 ? 'brand_variant_tokens' : `brand_variant_tokens_${idx}`);
      });
    }

    if (brandName) {
      pushStrategy(brandName, brandName, 'brand_only');
    }

    if (limitedCleanTerm) {
      pushStrategy(limitedCleanTerm, null, 'clean_name');
    }

    if (brandName && limitedCleanTerm) {
      pushStrategy(`${brandName} ${limitedCleanTerm}`, brandName, 'brand_plus_clean');
    }

    if (!searchStrategies.length && limitedProductTerm) {
      pushStrategy(limitedProductTerm, null, 'product_only');
    }

    const finalQueries = searchStrategies.slice(0, 4); // Try up to 4 strategies
    
    console.log(`[OFF] Search strategies generated:`, finalQueries.map(q => ({
      strategy: q.strategy,
      term: q.term,
      brand: q.brand
    })));

    if (finalQueries.length === 0) {
      console.log(`[OFF] No search strategies generated - empty query`);
      return { item, reason: 'empty_query', canonical: canonicalQuery };
    }

    const responseBatches = [];

    for (const { term, brand, strategy } of finalQueries) {
      if (Date.now() - startedAt > OFF_BUDGET_MS) {
        return { item, reason: 'timeout', canonical: canonicalQuery, error: 'budget_exceeded' };
      }
      const batch = await searchByNameV1(term, {
        signal,
        categoryTags,
        negativeCategoryTags,
        brand,
        maxPages: 1,
        locale,
        variantTokens: variantWhitelistTokens
      });
      if (Array.isArray(batch?.products) && batch.products.length > 0) {
        console.log(`[OFF] Search strategy '${strategy}' found ${batch.products.length} products`);
        responseBatches.push({ strategy, products: batch.products });

        if (brandContext) {
          const brandScores = batch.products.map(product => {
            const score = computeBrandScore(brandContext, product);
            return { name: product.product_name, brands: product.brands, score: score.score };
          });
          
          const hasStrongBrand = brandScores.some(s => s.score >= BRAND_ACCEPT_SCORE);
          const maxScore = Math.max(...brandScores.map(s => s.score));
          
          console.log(`[OFF] Brand scores for '${strategy}': max=${maxScore}, threshold=${BRAND_ACCEPT_SCORE}`);
          console.log(`[OFF] Top brand scores:`, brandScores.slice(0, 3));
          
          if (hasStrongBrand) {
            console.log(`[OFF] Strategy '${strategy}' produced a strong brand match, stopping search.`);
            break;
          }
          console.log(`[OFF] Strategy '${strategy}' lacks strong brand match, continuing to next strategy.`);
        } else {
          break;
        }
      } else {
        console.log(`[OFF] Search strategy '${strategy}' found no products for term="${term}"`);
      }
    }

    if (responseBatches.length === 0) {
      const reason = brandName ? 'off_not_found_brand' : 'no_hits';
      return {
        item,
        reason,
        canonical: canonicalQuery,
        error: `OFF not found for brand="${brandName || 'none'}" name="${item.name}"`
      };
    }

    const dedupedProducts = [];
    const seen = new Set();
    for (const { strategy, products } of responseBatches) {
      for (const product of products) {
        const key = product?.code || `${normalizeForMatch(product?.product_name || '')}::${normalizeForMatch(product?.brands || '')}`;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        dedupedProducts.push({ product, strategy });
      }
    }

    if (dedupedProducts.length === 0) {
      return { item, reason: 'no_candidates', canonical: canonicalQuery };
    }

    console.log(`[OFF] Search returned ${dedupedProducts.length} unique products across ${responseBatches.length} strategies`);

    // Log raw response (top-N documents)
    console.log(`[OFF] Raw Response top-${Math.min(dedupedProducts.length, 5)}:`, dedupedProducts.slice(0, 5).map(({ product, strategy }) => ({
      strategy,
      code: product.code,
      product_name: product.product_name,
      brands: product.brands,
      brands_tags: product.brands_tags?.slice(0, 3),
      categories_tags: product.categories_tags?.slice(0, 3)
    })));

    // Require at least one useful per-100g nutrient value
    const useful = dedupedProducts
      .filter(({ product }) => hasUsefulNutriments(product))
      .map(({ product, strategy }) => ({ product, strategy }));
    console.log(`[OFF] Nutrient filter: ${useful.length}/${dedupedProducts.length} products have useful nutrients`);

    if (useful.length === 0) {
      console.log(`[OFF] No useful nutrients for "${canonicalQuery}" (${dedupedProducts.length} products found)`);
      return { item, reason: 'no_useful_nutrients', canonical: canonicalQuery };
    }

    const scoringContext = {
      brandContext,
      variantTokens: variantWhitelistTokens,
      negativeCategoryTags,
      nameTokens
    };

    const scoredCandidates = useful
      .map(({ product, strategy }) => {
        const { score, breakdown, brandExact } = scoreProduct(item, product, scoringContext);
        return { product, score, breakdown, brandExact, strategy };
      })
      .sort((a, b) => {
        // CRITICAL FIX: If required_tokens exist, prioritize products that match them
        const aHasRequiredTokens = variantWhitelistTokens.length === 0 || 
          (a.breakdown.variant_phrase > 0 || a.breakdown.variant_tokens > 0);
        const bHasRequiredTokens = variantWhitelistTokens.length === 0 || 
          (b.breakdown.variant_phrase > 0 || b.breakdown.variant_tokens > 0);
        
        // If only one has required tokens, it wins regardless of score
        if (aHasRequiredTokens && !bHasRequiredTokens) return -1;
        if (bHasRequiredTokens && !aHasRequiredTokens) return 1;
        
        // Both have or both don't have required tokens - sort by score
        return b.score - a.score;
      });

    if (scoredCandidates.length === 0) {
      console.log(`[OFF] No candidates after scoring for "${canonicalQuery}"`);
      return { item, reason: 'no_candidates', canonical: canonicalQuery };
    }

    console.log(`[OFF] Rerank top candidates:`, scoredCandidates.slice(0, 3).map(({ product, score, brandExact, breakdown, strategy }) => ({
      strategy,
      product_name: product.product_name,
      score,
      brandExact,
      brands: product.brands,
      breakdown
    })));

    const best = scoredCandidates[0];
    const scoreThreshold = brandContext ? 200 : 80;

    // CRITICAL: Check if required tokens are missing from best candidate
    if (variantWhitelistTokens.length > 0 && best) {
      const hasRequiredTokens = best.breakdown.variant_phrase > 0 || best.breakdown.variant_tokens > 0;
      if (!hasRequiredTokens) {
        console.log(`[OFF] Final Decision: REJECTED, reason=missing_required_tokens, score=${best.score?.toFixed(2)}`);
        console.log(`[OFF] Missing required tokens: ${variantWhitelistTokens.join(', ')} in "${best.product.product_name}"`);
        return { item, reason: 'missing_required_tokens', canonical: canonicalQuery, score: best?.score };
      }
    }

    // CRITICAL FIX: If product has required_tokens, allow it even with poor brand score
    const hasRequiredTokensInBest = variantWhitelistTokens.length === 0 || 
      (best?.breakdown?.variant_phrase > 0 || best?.breakdown?.variant_tokens > 0);
    
    if (brandContext && best && best.breakdown?.brand < -200 && !hasRequiredTokensInBest) {
      // Only reject if brand component is very negative AND no required_tokens match
      const bestScoreText = best?.score != null ? best.score.toFixed(2) : 'null';
      console.log(`[OFF] Final Decision: REJECTED, reason=severe_brand_mismatch, score=${bestScoreText}, brand_component=${best.breakdown.brand}`);
      return { item, reason: 'severe_brand_mismatch', canonical: canonicalQuery, score: best.score };
    }
    
    // Special case: If best candidate has required_tokens but poor brand, accept it
    if (hasRequiredTokensInBest && best?.breakdown?.brand < 0) {
      console.log(`[OFF] Accepting product with required_tokens despite poor brand score (${best.breakdown.brand})`);
    }

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
