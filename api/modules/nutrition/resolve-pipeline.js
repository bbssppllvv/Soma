import { resolveOneItemOFF, scalePerPortionOFF } from './off-resolver.js';
import { toGrams } from './units.js';
import { canonicalizeQuery } from './off-client.js';
import pLimit from 'p-limit';

function ensureGramsFallback(it) {
  // 100 g/ml — универсальный дефолт; не нужен ни список продуктов, ни плотности
  if (!it.unit || !Number.isFinite(it.portion)) {
    return it.name?.match(/\b(ml|литр|l)\b/i) ? 100 : 100; // по умолчанию 100 g
  }
  const g = toGrams(it.portion, it.unit, it.name);
  return Number.isFinite(g) ? g : 100; // дефолт 100 g
}

export async function resolveItemsWithOFF(items, { signal } = {}) {
  const global = new AbortController();
  const globalTimer = setTimeout(() => global.abort(), Number(process.env.OFF_GLOBAL_BUDGET_MS || 3500));

  // dedupe по canonical
  const groups = new Map(); // canonical -> [items]
  for (const it of items.filter(it => (it.confidence ?? 0) >= 0.4).slice(0, 6)) {
    const key = canonicalizeQuery(it.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }

  const limit = pLimit(Number(process.env.OFF_CONCURRENCY || 2));
  const results = [];
  const reasons = [];

  const tasks = [...groups.entries()].map(([canonical, originals]) =>
    limit(async () => {
      const ctrl = new AbortController();
      const perReqTimer = setTimeout(() => ctrl.abort(), Number(process.env.OFF_TIMEOUT_MS || 2000));
      
      // Комбинируем сигналы
      let offSignal;
      try {
        offSignal = AbortSignal.any ? AbortSignal.any([signal, global.signal, ctrl.signal]) : ctrl.signal;
      } catch {
        offSignal = ctrl.signal; // fallback для старых Node
      }

      try {
        const result = await resolveOneItemOFF(originals[0], { signal: offSignal });
        
        if (result.product) {
          // Успешный резолв - применяем ко всем items в группе
          for (const it of originals) {
            const grams = ensureGramsFallback(it);
            const scaled = scalePerPortionOFF(result.product, grams);
            results.push({
              ...it,
              grams,
              resolved: { source:'off', score: result.score, product_code: scaled.meta.code,
                          product_name: scaled.meta.name, brand: scaled.meta.brand },
              nutrients: { calories: scaled.calories, protein_g: scaled.protein_g, fat_g: scaled.fat_g,
                           carbs_g: scaled.carbs_g, fiber_g: scaled.fiber_g },
              confidence: Math.max(it.confidence ?? 0.6, result.score),
              needs_clarification: false
            });
          }
        } else {
          // Не резолвлен - добавляем причину
          reasons.push({ name: originals[0].name, canonical, reason: result.reason });
          for (const it of originals) {
            const grams = ensureGramsFallback(it);
            results.push({ ...it, grams, resolved: null, nutrients: null,
                           confidence: Math.min(it.confidence ?? 0.6, 0.6), needs_clarification: true });
          }
        }
      } catch (e) {
        const isAbort = e?.name === 'AbortError';
        reasons.push({ name: originals[0].name, canonical, reason: isAbort ? 'timeout' : 'http_or_json_error', error: e.message });
        for (const it of originals) {
          const grams = ensureGramsFallback(it);
          results.push({ ...it, grams, resolved: null, nutrients: null,
                         confidence: Math.min(it.confidence ?? 0.6, 0.6), needs_clarification: true });
        }
      } finally {
        clearTimeout(perReqTimer);
      }
    })
  );

  try {
    await Promise.allSettled(tasks);
  } finally {
    clearTimeout(globalTimer);
  }

  // Добавляем отфильтрованные items
  const filtered = items.filter(it => !groups.has(canonicalizeQuery(it.name)) || (it.confidence ?? 0) < 0.4);
  for (const it of filtered) {
    const grams = ensureGramsFallback(it);
    results.push({ ...it, grams, resolved: null, nutrients: null,
                   confidence: Math.min(it.confidence ?? 0.6, 0.4), needs_clarification: true });
  }

  const agg = results.reduce((a,x)=>{
    if (x.nutrients){ a.calories+=x.nutrients.calories||0; a.protein_g+=x.nutrients.protein_g||0;
      a.fat_g+=x.nutrients.fat_g||0; a.carbs_g+=x.nutrients.carbs_g||0; a.fiber_g+=x.nutrients.fiber_g||0; }
    return a;
  }, { calories:0, protein_g:0, fat_g:0, carbs_g:0, fiber_g:0 });

  return { items: results, aggregates: agg, reasons };
}
