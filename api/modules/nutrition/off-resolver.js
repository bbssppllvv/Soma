import { getByBarcode, searchByNameV1, canonicalizeQuery } from './off-client.js';
import { mapOFFProductToPer100g } from './off-map.js';
import { getCachedOffProduct, upsertOffProduct } from './off-supabase-cache.js';

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

// 🏷️ скоринг с учётом брендов и категорий
function scoreProduct(item, product) {
  const queryTokens = tokenize(item?.name || '');
  const itemBrandTokens = tokenize(item?.brand || '');
  const name = (product.product_name || '').toLowerCase();
  let score = 0;

  // Совпадения по названию
  const nameHits = queryTokens.filter(t => name.includes(t)).length;
  score += Math.min(0.5, (nameHits / Math.max(1, queryTokens.length)) * 0.5);

  // Бонус за нутриенты
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

  return score;
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

export async function resolveOneItemOFF(item, { signal } = {}) {
  const canonicalQuery = canonicalizeQuery(item.name);
  console.log(`[OFF] Resolving item:`, { 
    name: item.name, 
    canonical: canonicalQuery,
    brand: item.brand, 
    upc: item.upc, 
    confidence: item.confidence 
  });
  
  if (item.upc) {
    const normalizedUPC = normalizeUPC(item.upc);
    if (normalizedUPC) {
      const cached = await getCachedOffProduct(normalizedUPC, { signal });
      if (cached?.product && cached.isFresh) {
        console.log(`[OFF] Cache hit for UPC ${normalizedUPC}`);
        return { product: cached.product, score: 1.0 };
      }

      const prod = await getByBarcode(normalizedUPC, { signal });
      if (prod && hasUsefulNutriments(prod)) {
        await upsertOffProduct(prod, { previousLastModified: cached?.last_modified_t, signal });
        return { product: prod, score: 1.0 };
      }

      if (cached?.product) {
        console.log(`[OFF] Using stale cache for UPC ${normalizedUPC}`);
        return { product: cached.product, score: Math.max(item.confidence ?? 0.6, 0.85) };
      }
    }
  }

  // V1 полнотекстовый поиск с канонической строкой
  try {
    const data = await searchByNameV1(canonicalQuery, { signal });
    const products = Array.isArray(data?.products) ? data.products : [];
    
    if (products.length === 0) {
      console.log(`[OFF] No hits for "${canonicalQuery}"`);
      return { item, reason: 'no_hits', canonical: canonicalQuery };
    }

    // ⚖️ базовая пригодность: есть хоть один пер-100г нутриент
    const useful = products.filter(hasUsefulNutriments);

    if (useful.length === 0) {
      console.log(`[OFF] No useful nutrients for "${canonicalQuery}" (${products.length} products found)`);
      return { item, reason: 'no_useful_nutrients', canonical: canonicalQuery };
    }

    const best = useful
      .map(p => ({ p, s: scoreProduct(item, p) }))
      .sort((a,b) => b.s - a.s)[0];

    if (!best || best.s < 0.5) {
      console.log(`[OFF] Low score for "${canonicalQuery}": ${best?.s ?? 'null'} (${useful.length} useful products)`);
      return { item, reason: 'low_score', canonical: canonicalQuery, score: best?.s };
    }

    if (best.p?.code) {
      const cached = await getCachedOffProduct(best.p.code, { signal });
      await upsertOffProduct(best.p, { previousLastModified: cached?.last_modified_t, signal });
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
