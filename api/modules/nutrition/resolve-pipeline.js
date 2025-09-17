import { resolveOneItemOFF, scalePerPortionOFF } from './off-resolver.js';
import { toGrams } from './units.js';
import { canonicalizeQuery } from './off-client.js';
import pLimit from 'p-limit';

const OFF_MAX_ITEMS = Number(process.env.OFF_MAX_ITEMS || 4);
const REQUIRE_BRAND = String(process.env.OFF_REQUIRE_BRAND || 'true').toLowerCase() === 'true';

function ensureGramsFallback(it) {
  // 100 g/ml as universal default; avoids requiring product lists or densities
  if (!it.unit || !Number.isFinite(it.portion)) {
    return it.name?.match(/\b(ml|liter|l)\b/i) ? 100 : 100; // default to 100 g
  }
  const g = toGrams(it.portion, it.unit, it.name, it);
  return Number.isFinite(g) ? g : 100; // default 100 g when unknown
}

function computeItemPriority(item) {
  const portion = Number(item?.portion) || 100;
  const portionWeight = Math.min(Math.max(portion, 10), 600) / 100;
  const confidence = Math.min(Math.max(item?.confidence ?? 0.6, 0), 1);
  const confidenceWeight = 1 - confidence;
  const roleBoost = item?.item_role === 'dish' ? 2 : 1;
  return portionWeight * (0.5 + confidenceWeight) * roleBoost;
}

function formatPortionDisplay(value, unit = 'g') {
  if (!Number.isFinite(value)) return null;
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${unit}`.trim();
}

function parseQuantityString(rawValue, unitHint) {
  if (rawValue == null) return null;
  let str = typeof rawValue === 'number' ? String(rawValue) : String(rawValue).trim().toLowerCase();
  if (!str) return null;
  if (!/[a-z]/.test(str) && unitHint) {
    str = `${str} ${String(unitHint).toLowerCase()}`;
  }
  const match = str.match(/([\d.,]+)\s*(kg|g|mg|l|ml|cl|dl|oz|lb|lbs)?/);
  if (!match) return null;
  const value = parseFloat(match[1].replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  const rawUnit = (match[2] || unitHint || '').toLowerCase();
  let gramsValue = value;
  let normalizedUnit = 'g';
  switch (rawUnit) {
    case 'kg':
      gramsValue = value * 1000;
      normalizedUnit = 'g';
      break;
    case 'mg':
      gramsValue = value / 1000;
      normalizedUnit = 'g';
      break;
    case 'l':
      gramsValue = value * 1000;
      normalizedUnit = 'ml';
      break;
    case 'ml':
      gramsValue = value;
      normalizedUnit = 'ml';
      break;
    case 'cl':
      gramsValue = value * 10;
      normalizedUnit = 'ml';
      break;
    case 'dl':
      gramsValue = value * 100;
      normalizedUnit = 'ml';
      break;
    case 'oz':
      gramsValue = value * 28.3495;
      normalizedUnit = 'g';
      break;
    case 'lb':
    case 'lbs':
      gramsValue = value * 453.592;
      normalizedUnit = 'g';
      break;
    case 'g':
    case '':
    default:
      gramsValue = value;
      normalizedUnit = 'g';
      break;
  }
  const display = formatPortionDisplay(gramsValue, normalizedUnit);
  return { grams: gramsValue, unit: normalizedUnit, display };
}

function extractServingInfo(product) {
  if (!product) return null;
  const servingSize = product.serving_size;
  const servingQuantity = product.serving_quantity;
  const servingUnit = product.serving_quantity_unit;
  return parseQuantityString(servingSize ?? servingQuantity, servingQuantity ? servingUnit : undefined);
}

function extractPackageInfo(product) {
  if (!product) return null;
  const quantity = product.product_quantity;
  const quantityUnit = product.product_quantity_unit;
  return parseQuantityString(quantity, quantityUnit);
}

function determinePortionInfo(item, product) {
  const userValue = Number(item.portion_value);
  if (item.portion_source === 'user' && Number.isFinite(userValue) && userValue > 0) {
    const unit = item.portion_unit || 'g';
    const display = item.portion_display || formatPortionDisplay(userValue, unit);
    return { grams: userValue, unit, display, source: 'user', reason: item.portion_reason || 'user_text' };
  }

  const packageInfo = extractPackageInfo(product);
  const servingInfo = extractServingInfo(product);

  if (packageInfo && Number.isFinite(packageInfo.grams)) {
    return {
      grams: packageInfo.grams,
      unit: packageInfo.unit || 'g',
      display: packageInfo.display || formatPortionDisplay(packageInfo.grams, packageInfo.unit || 'g'),
      source: 'package',
      reason: 'package_weight'
    };
  }

  if (servingInfo && Number.isFinite(servingInfo.grams)) {
    return {
      grams: servingInfo.grams,
      unit: servingInfo.unit || 'g',
      display: servingInfo.display || formatPortionDisplay(servingInfo.grams, servingInfo.unit || 'g'),
      source: 'serving',
      reason: 'serving_size'
    };
  }

  if (Number.isFinite(userValue)) {
    const unit = item.portion_unit || 'g';
    const display = item.portion_display || formatPortionDisplay(userValue, unit);
    return {
      grams: userValue,
      unit,
      display,
      source: item.portion_source || 'gpt_default',
      reason: item.portion_reason || 'gpt_guess'
    };
  }

  return {
    grams: null,
    unit: item.portion_unit || 'g',
    display: item.portion_display || null,
    source: item.portion_source || 'gpt_default',
    reason: item.portion_reason || 'gpt_guess'
  };
}

export async function resolveItemsWithOFF(items, { signal } = {}) {
  const global = new AbortController();
  const globalTimer = setTimeout(() => global.abort(), Number(process.env.OFF_GLOBAL_BUDGET_MS || 12000));

  const candidates = REQUIRE_BRAND ? items.filter(it => it.off_candidate) : items;
  const skippedNoBrand = REQUIRE_BRAND ? items.filter(it => !it.off_candidate) : [];

  const limit = pLimit(Number(process.env.OFF_CONCURRENCY || 2));
  const results = [];
  const reasons = [];

  for (const it of skippedNoBrand) {
    reasons.push({
      name: it.name,
      canonical: canonicalizeQuery(it.name),
      reason: 'skipped_no_brand',
      score: null,
      error: null
    });
    const portionInfo = determinePortionInfo(it, null);
    const grams = Number.isFinite(portionInfo.grams) ? portionInfo.grams : ensureGramsFallback(it);
    const portionUnit = portionInfo.unit || it.portion_unit || 'g';
    const portionDisplay = portionInfo.display || formatPortionDisplay(grams, portionUnit);
    results.push({
      ...it,
      grams,
      resolved: null,
      nutrients: null,
      confidence: Math.min(it.confidence ?? 0.6, 0.6),
      needs_clarification: Boolean(it.needs_clarification),
      data_source: it.data_source || 'ai',
      portion_source: portionInfo.source,
      portion_reason: portionInfo.reason,
      portion_value: grams,
      portion_unit: portionUnit,
      portion_display: portionDisplay
    });
  }

  // De-duplicate by canonical name among candidates
  const groups = new Map(); // canonical -> [items]
  for (const it of candidates.filter(it => (it.confidence ?? 0) >= 0.4).slice(0, 6)) {
    const key = canonicalizeQuery(it.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }

  const groupEntries = [...groups.entries()].map(([canonical, originals]) => ({
    canonical,
    originals,
    priority: computeItemPriority(originals[0]),
    tokenCount: canonical.split(/\s+/).length
  }));

  groupEntries.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.tokenCount - b.tokenCount;
  });

  const selected = groupEntries.slice(0, OFF_MAX_ITEMS);
  const skipped = groupEntries.slice(OFF_MAX_ITEMS);

  for (const skip of skipped) {
      reasons.push({
        name: skip.originals[0].name,
        canonical: skip.canonical,
        reason: 'budget_skipped',
        score: null,
        error: null
      });
      for (const it of skip.originals) {
        const grams = ensureGramsFallback(it);
        results.push({ ...it, grams, resolved: null, nutrients: null,
                     confidence: Math.min(it.confidence ?? 0.6, 0.6), needs_clarification: true, data_source: 'ai_fallback' });
      }
    }

  const backgroundPromises = skipped.map(skip =>
    resolveOneItemOFF(skip.originals[0]).catch(() => null)
  );

  const tasks = selected.map(({ canonical, originals }) =>
    limit(async () => {
      const ctrl = new AbortController();
      const perReqTimer = setTimeout(() => ctrl.abort(), Number(process.env.OFF_TIMEOUT_MS || 6000));
      
      // Combine signals
      let offSignal;
      try {
        offSignal = AbortSignal.any ? AbortSignal.any([signal, global.signal, ctrl.signal]) : ctrl.signal;
      } catch {
        offSignal = ctrl.signal; // fallback for older Node versions
      }

      try {
        const result = await resolveOneItemOFF(originals[0], { signal: offSignal });
        
        if (result.product) {
          // Successful resolution — apply to every item in the group
          for (const it of originals) {
            const portionInfo = determinePortionInfo(it, result.product);
            const grams = Number.isFinite(portionInfo.grams) ? portionInfo.grams : ensureGramsFallback(it);
            const portionUnit = portionInfo.unit || it.portion_unit || 'g';
            const portionDisplay = portionInfo.display || formatPortionDisplay(grams, portionUnit);
            const scaled = scalePerPortionOFF(result.product, grams);
            results.push({
              ...it,
              grams,
              resolved: { source:'off', score: result.score, product_code: scaled.meta.code,
                          product_name: scaled.meta.name, brand: scaled.meta.brand },
              nutrients: { calories: scaled.calories, protein_g: scaled.protein_g, fat_g: scaled.fat_g,
                           carbs_g: scaled.carbs_g, fiber_g: scaled.fiber_g },
              confidence: Math.max(it.confidence ?? 0.6, result.score),
              needs_clarification: false,
              data_source: 'off',
              locked_source: true,
              portion_source: portionInfo.source,
              portion_reason: portionInfo.reason,
              portion_value: grams,
              portion_unit: portionUnit,
              portion_display: portionDisplay
            });
          }
        } else {
          // Resolution failed — capture explicit reason from resolver
          console.log(`[OFF] Resolver fallback for "${canonical}": ${result.reason}${result.score != null ? ` (score=${result.score?.toFixed ? result.score.toFixed(2) : result.score})` : ''}`);
          reasons.push({ 
            name: originals[0].name, 
            canonical, 
            reason: result.reason,
            score: result.score,
            error: result.error
          });
          for (const it of originals) {
            const portionInfo = determinePortionInfo(it, null);
            const grams = Number.isFinite(portionInfo.grams) ? portionInfo.grams : ensureGramsFallback(it);
            const portionUnit = portionInfo.unit || it.portion_unit || 'g';
            const portionDisplay = portionInfo.display || formatPortionDisplay(grams, portionUnit);
            results.push({ ...it, grams, resolved: null, nutrients: null,
                           confidence: Math.min(it.confidence ?? 0.6, 0.6), needs_clarification: true,
                           data_source: 'ai_fallback',
                           portion_source: portionInfo.source,
                           portion_reason: portionInfo.reason,
                           portion_value: grams,
                           portion_unit: portionUnit,
                           portion_display: portionDisplay });
          }
        }
      } catch (e) {
        const isAbort = e?.name === 'AbortError';
        reasons.push({ 
          name: originals[0].name, 
          canonical, 
          reason: isAbort ? 'timeout' : 'http_or_json_error', 
          error: e.message 
        });
        for (const it of originals) {
          const portionInfo = determinePortionInfo(it, null);
          const grams = Number.isFinite(portionInfo.grams) ? portionInfo.grams : ensureGramsFallback(it);
          const portionUnit = portionInfo.unit || it.portion_unit || 'g';
          const portionDisplay = portionInfo.display || formatPortionDisplay(grams, portionUnit);
          results.push({ ...it, grams, resolved: null, nutrients: null,
                         confidence: Math.min(it.confidence ?? 0.6, 0.6), needs_clarification: true,
                         data_source: 'ai_fallback',
                         portion_source: portionInfo.source,
                         portion_reason: portionInfo.reason,
                         portion_value: grams,
                         portion_unit: portionUnit,
                         portion_display: portionDisplay });
        }
      } finally {
        clearTimeout(perReqTimer);
      }
    })
  );

  try {
    await Promise.allSettled(tasks);
    if (backgroundPromises.length) {
      Promise.allSettled(backgroundPromises).catch(() => {});
    }
  } finally {
    clearTimeout(globalTimer);
  }

  // Include filtered-out items
  const filtered = candidates.filter(it => !groups.has(canonicalizeQuery(it.name)) || (it.confidence ?? 0) < 0.4);
  for (const it of filtered) {
    const portionInfo = determinePortionInfo(it, null);
    const grams = Number.isFinite(portionInfo.grams) ? portionInfo.grams : ensureGramsFallback(it);
    const portionUnit = portionInfo.unit || it.portion_unit || 'g';
    const portionDisplay = portionInfo.display || formatPortionDisplay(grams, portionUnit);
    results.push({ ...it, grams, resolved: null, nutrients: null,
                   confidence: Math.min(it.confidence ?? 0.6, 0.4), needs_clarification: true,
                   data_source: 'ai_fallback',
                   portion_source: portionInfo.source,
                   portion_reason: portionInfo.reason,
                   portion_value: grams,
                   portion_unit: portionUnit,
                   portion_display: portionDisplay });
  }

  const agg = results.reduce((a,x)=>{
    if (x.nutrients){ a.calories+=x.nutrients.calories||0; a.protein_g+=x.nutrients.protein_g||0;
      a.fat_g+=x.nutrients.fat_g||0; a.carbs_g+=x.nutrients.carbs_g||0; a.fiber_g+=x.nutrients.fiber_g||0; }
    return a;
  }, { calories:0, protein_g:0, fat_g:0, carbs_g:0, fiber_g:0 });

  return { items: results, aggregates: agg, reasons };
}
