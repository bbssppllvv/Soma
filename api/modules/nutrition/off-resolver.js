import { getByBarcode, searchByName, canonicalizeQuery } from './off-client.js';
import { mapOFFProductToPer100g } from './off-map.js';

// 🏷️ простой скоринг (универсальный, без хардкодов)
function scoreProduct(query, product) {
  const qTok = canonicalizeQuery(query).split(' ').filter(Boolean);
  const name = (product.product_name || '').toLowerCase();
  let s = 0;
  
  // пересечение токенов
  const hit = qTok.filter(t => name.includes(t)).length;
  s += Math.min(0.5, (hit / Math.max(1, qTok.length)) * 0.5);
  
  // бонус за нутриенты
  const n = product.nutriments || {};
  if (n['energy-kcal_100g'] != null || n['protein_100g'] != null) s += 0.5;
  
  return s;
}

function pickBest(list, scorer, thr){
  if (!Array.isArray(list) || !list.length) return null;
  const scored = list.map(p => ({ product:p, score: scorer(p) }))
                     .sort((a,b)=>b.score-a.score);
  return (scored[0]?.score ?? 0) >= thr ? scored[0] : null;
}

function hasUsefulNutriments(p) {
  const n = p?.nutriments || {};
  return n['energy-kcal_100g'] != null || n['energy_100g'] != null ||
         n['protein_100g'] != null || n['fat_100g'] != null ||
         n['carbohydrates_100g'] != null || n['fiber_100g'] != null;
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
      const prod = await getByBarcode(normalizedUPC, { signal });
      if (prod && hasUsefulNutriments(prod)) return { product: prod, score: 1.0 };
    }
  }

  // V1 полнотекстовый поиск с канонической строкой
  const data = await searchByName({ query: item.name, page_size: 24 }, { signal });
  
  if (!Array.isArray(data.products) || data.products.length === 0) {
    console.log(`[OFF] No hits for "${canonicalQuery}"`);
    return null; // пометили как неразрешённый — дальше fallback на модель
  }

  // ⚖️ базовая пригодность: есть хоть один пер-100г нутриент
  const useful = data.products.filter(p => {
    const n = p?.nutriments || {};
    return n['energy-kcal_100g'] != null || n['protein_100g'] != null ||
           n['fat_100g'] != null || n['carbohydrates_100g'] != null || n['fiber_100g'] != null;
  });

  if (useful.length === 0) {
    console.log(`[OFF] No useful nutrients for "${canonicalQuery}" (${data.products.length} products found)`);
    return null;
  }

  const best = useful
    .map(p => ({ p, s: scoreProduct(item.name, p) }))
    .sort((a,b) => b.s - a.s)[0];

  if (!best || best.s < 0.5) {
    console.log(`[OFF] Low score for "${canonicalQuery}": ${best?.s ?? 'null'} (${useful.length} useful products)`);
    return null;
  }

  console.log(`[OFF] Success for "${canonicalQuery}": ${best.p.product_name} (score: ${best.s.toFixed(2)})`);
  return { product: best.p, score: best.s };
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
