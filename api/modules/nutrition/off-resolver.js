import { getByBarcode, searchByName } from './off-client.js';
import { mapOFFProductToPer100g } from './off-map.js';

function scoreProduct(p, { query, brand }) {
  let s = 0;
  const name = (p.product_name || '').toLowerCase();
  const b    = (p.brands || '').toLowerCase();
  if (brand && b.includes(brand.toLowerCase())) s += 0.25;
  if (query && name.includes(query.toLowerCase())) s += 0.45;
  if (p.code) s += 0.30;
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
  if (item.upc) {
    const normalizedUPC = normalizeUPC(item.upc);
    if (normalizedUPC) {
      const prod = await getByBarcode(normalizedUPC, { signal });
      if (prod && hasUsefulNutriments(prod)) return { product: prod, score: 1.0 };
    }
  }
  const p1 = await searchByName({ query: item.name, brand: item.brand, page_size: 8 }, { signal });
  let best = pickBest(p1, p => scoreProduct(p, { query: item.name, brand: item.brand }), 0.80);
  if (best && hasUsefulNutriments(best.product)) return best;

  const p2 = await searchByName({ query: item.name, page_size: 10 }, { signal });
  best = pickBest(p2, p => scoreProduct(p, { query: item.name }), 0.70);
  if (best && !hasUsefulNutriments(best.product)) return null;
  return best; // может быть null
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
