import { resolveOneItemOFF, scalePerPortionOFF } from './off-resolver.js';
import { toGrams } from './units.js';

export async function resolveItemsWithOFF(items, { signal } = {}) {
  // Фильтруем и ограничиваем items для OFF
  const candidates = items
    .filter(it => (it.confidence ?? 0) >= 0.4)
    .slice(0, 6);

  // Добавляем отфильтрованные items как нерезолвленные
  const filtered = items.filter(it => !candidates.includes(it));
  
  const out = [];
  
  // Обрабатываем кандидатов через OFF
  for (const it of candidates) {
    const grams = toGrams(it.portion, it.unit, it.name);
    const matched = grams ? await resolveOneItemOFF(it, { signal }).catch(()=>null) : null;

    if (!matched || !grams) {
      out.push({ ...it, grams: grams || null, resolved: null, nutrients: null,
                 confidence: Math.min(it.confidence ?? 0.6, 0.6), needs_clarification: true });
      continue;
    }
    const scaled = scalePerPortionOFF(matched.product, grams);
    out.push({
      ...it,
      grams,
      resolved: { source:'off', score: matched.score, product_code: scaled.meta.code,
                  product_name: scaled.meta.name, brand: scaled.meta.brand },
      nutrients: { calories: scaled.calories, protein_g: scaled.protein_g, fat_g: scaled.fat_g,
                   carbs_g: scaled.carbs_g, fiber_g: scaled.fiber_g },
      confidence: Math.max(it.confidence ?? 0.6, matched.score),
      needs_clarification: false
    });
  }
  
  // Добавляем отфильтрованные как нерезолвленные
  for (const it of filtered) {
    const grams = toGrams(it.portion, it.unit, it.name);
    out.push({ ...it, grams: grams || null, resolved: null, nutrients: null,
               confidence: Math.min(it.confidence ?? 0.6, 0.4), needs_clarification: true });
  }
  const agg = out.reduce((a,x)=>{
    if (x.nutrients){ a.calories+=x.nutrients.calories||0; a.protein_g+=x.nutrients.protein_g||0;
      a.fat_g+=x.nutrients.fat_g||0; a.carbs_g+=x.nutrients.carbs_g||0; a.fiber_g+=x.nutrients.fiber_g||0; }
    return a;
  }, { calories:0, protein_g:0, fat_g:0, carbs_g:0, fiber_g:0 });

  return { items: out, aggregates: agg };
}
