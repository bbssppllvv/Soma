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

  // Name overlap bonus
  const nameHits = queryTokens.filter(t => name.includes(t)).length;
  score += Math.min(0.5, (nameHits / Math.max(1, queryTokens.length)) * 0.5);

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
  const canonicalQuery = canonicalizeQuery(item.name);
  console.log(`[OFF] Resolving item:`, { 
    name: item.name, 
    canonical: canonicalQuery,
    brand: item.brand, 
    upc: item.upc, 
    confidence: item.confidence 
  });

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

    const finalQueries = [];
    const seen = new Set();
    for (const q of queries) {
      if (!q.term) continue;
      const key = `${q.term}::${q.brand || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      finalQueries.push(q);
      if (finalQueries.length >= 2) break;
    }

    if (finalQueries.length === 0) {
      return { item, reason: 'empty_query', canonical: canonicalQuery };
    }

    let data = null;

    for (const { term, brand } of finalQueries) {
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
        break;
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

    // Require at least one useful per-100g nutrient value
    const useful = products.filter(hasUsefulNutriments);

    if (useful.length === 0) {
      console.log(`[OFF] No useful nutrients for "${canonicalQuery}" (${products.length} products found)`);
      return { item, reason: 'no_useful_nutrients', canonical: canonicalQuery };
    }

    const filtered = [];
    for (const prod of useful) {
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

    console.log(`[OFF] Success for "${canonicalQuery}": ${best.p.product_name} (score: ${best.s.toFixed(2)})`);
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
