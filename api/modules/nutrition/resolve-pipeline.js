import { resolveOneItemOFF, scalePerPortionOFF } from './off-resolver.js';
import { toGrams } from './units.js';
import { canonicalizeQuery } from './off-client.js';
import pLimit from 'p-limit';

const OFF_MAX_ITEMS = Number(process.env.OFF_MAX_ITEMS || 4);
const REQUIRE_BRAND = String(process.env.OFF_REQUIRE_BRAND || 'false').toLowerCase() === 'true';

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

const NUMBER_WORDS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12
};

const FRACTION_WORDS = {
  'half': 0.5,
  'one half': 0.5,
  'a half': 0.5,
  'half of': 0.5,
  'quarter': 0.25,
  'one quarter': 0.25,
  'a quarter': 0.25,
  'third': 1 / 3,
  'one third': 1 / 3,
  'two thirds': 2 / 3,
  'three quarters': 0.75,
  'three quarter': 0.75
};

const PACKAGE_KEYWORDS = ['pack', 'package', 'tub', 'bottle', 'can', 'jar', 'wrap', 'bar'];

const VOLUME_KEYWORDS = {
  glass: 200,
  glasses: 200,
  cup: 240,
  cups: 240,
  spoon: 15,
  tablespoon: 15,
  tablespoons: 15,
  teaspoon: 5,
  teaspoons: 5
};

function parseWordNumber(word) {
  if (!word) return null;
  const lower = word.toLowerCase();
  if (NUMBER_WORDS[lower] != null) return NUMBER_WORDS[lower];
  const numeric = Number(lower.replace(',', '.'));
  return Number.isFinite(numeric) ? numeric : null;
}

function extractFractionMultiplier(text) {
  if (!text) return null;
  const fractionMatch = text.match(/(\d+\s*\/\s*\d+)/);
  if (fractionMatch) {
    const [num, den] = fractionMatch[1].split('/').map(part => parseFloat(part.trim()));
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
      return num / den;
    }
  }
  for (const [phrase, value] of Object.entries(FRACTION_WORDS)) {
    if (text.includes(phrase)) {
      return value;
    }
  }
  return null;
}

function extractCountAndUnit(text) {
  if (!text) return null;
  const unitPattern = ['slice', 'slices', 'piece', 'pieces', 'cup', 'cups', 'glass', 'glasses', 'tablespoon', 'tablespoons', 'tbsp', 'teaspoon', 'teaspoons', 'tsp', 'ml', 'milliliter', 'milliliters', 'l', 'liter', 'liters', 'g', 'gram', 'grams'];
  const regex = new RegExp(`(\b(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b)\s*(?:x|×)?\s*(?:of\s+)?(${unitPattern.join('|')})`, 'i');
  const match = text.match(regex);
  if (!match) return null;
  const count = parseWordNumber(match[1]);
  if (!Number.isFinite(count)) return null;
  const unit = match[2].toLowerCase();
  return { count, unit };
}

function computeUserTextOverride(item, product) {
  const userText = (item.user_text || '').toLowerCase();
  if (!userText) return null;

  const packageInfo = extractPackageInfo(product);
  const servingInfo = extractServingInfo(product);
  const fraction = extractFractionMultiplier(userText);
  const referencesPackage = PACKAGE_KEYWORDS.some(keyword => userText.includes(keyword));

  if (fraction != null && packageInfo && referencesPackage && Number.isFinite(packageInfo.grams)) {
    const grams = packageInfo.grams * fraction;
    return {
      grams,
      unit: packageInfo.unit || 'g',
      display: formatPortionDisplay(grams, packageInfo.unit || 'g'),
      source: 'user',
      reason: 'user_fraction_package'
    };
  }

  if (fraction != null && servingInfo && Number.isFinite(servingInfo.grams)) {
    const grams = servingInfo.grams * fraction;
    return {
      grams,
      unit: servingInfo.unit || 'g',
      display: formatPortionDisplay(grams, servingInfo.unit || 'g'),
      source: 'user',
      reason: 'user_fraction_serving'
    };
  }

  const countUnit = extractCountAndUnit(userText);
  if (countUnit) {
    const { count, unit } = countUnit;
    if (VOLUME_KEYWORDS[unit] != null) {
      const mlValue = count * VOLUME_KEYWORDS[unit];
      return {
        grams: mlValue,
        unit: 'ml',
        display: `${Math.round(mlValue)} ml`,
        source: 'user',
        reason: 'user_volume'
      };
    }
    const grams = toGrams(count, unit, item.name, item);
    if (Number.isFinite(grams)) {
      return {
        grams,
        unit: unit.toLowerCase().includes('ml') ? 'ml' : 'g',
        display: formatPortionDisplay(grams, unit.toLowerCase().includes('ml') ? 'ml' : 'g'),
        source: 'user',
        reason: 'user_units'
      };
    }
  }

  if (fraction != null && packageInfo && Number.isFinite(packageInfo.grams)) {
    const grams = packageInfo.grams * fraction;
    return {
      grams,
      unit: packageInfo.unit || 'g',
      display: formatPortionDisplay(grams, packageInfo.unit || 'g'),
      source: 'user',
      reason: 'user_fraction_generic'
    };
  }

  return null;
}

function parseQuantityString(rawValue, unitHint) {
  if (rawValue == null) return null;
  let str = typeof rawValue === 'number' ? String(rawValue) : String(rawValue).trim().toLowerCase();
  if (!str) return null;
  if (!/[a-z]/.test(str) && unitHint) {
    str = `${str} ${String(unitHint).toLowerCase()}`;
  }
  const multipackMatch = str.match(/(\d+)\s*(?:x|×)\s*(\d+(?:\.\d+)?)\s*(kg|g|mg|l|ml|cl|dl|oz|lb|lbs)?/i);
  if (multipackMatch) {
    const count = parseFloat(multipackMatch[1]);
    const perUnit = parseFloat(multipackMatch[2]);
    const unit = multipackMatch[3] || unitHint || 'g';
    if (Number.isFinite(count) && Number.isFinite(perUnit)) {
      const single = parseQuantityString(`${perUnit} ${unit}`, unit);
      if (single && Number.isFinite(single.grams)) {
        single.grams = single.grams * count;
        single.display = `${count}×${formatPortionDisplay(single.grams / count, single.unit)} (${formatPortionDisplay(single.grams, single.unit)})`;
        return single;
      }
    }
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
  const parsed = parseQuantityString(servingSize ?? servingQuantity, servingQuantity ? servingUnit : undefined);
  if (!parsed || !Number.isFinite(parsed.grams)) return null;
  if (parsed.unit === 'g' && parsed.grams < 10) return null;
  if (parsed.unit === 'ml' && parsed.grams < 10) return null;
  return parsed;
}

function extractPackageInfo(product) {
  if (!product) return null;
  const quantity = product.product_quantity;
  const quantityUnit = product.product_quantity_unit;
  const parsedQuantity = parseQuantityString(quantity, quantityUnit);
  if (parsedQuantity && Number.isFinite(parsedQuantity.grams)) {
    return parsedQuantity;
  }
  const labelQuantity = product.quantity;
  if (labelQuantity) {
    const parsedLabel = parseQuantityString(labelQuantity, undefined);
    if (parsedLabel && Number.isFinite(parsedLabel.grams)) {
      return parsedLabel;
    }
  }
  return null;
}

function determinePortionInfo(item, product) {
  const userOverride = computeUserTextOverride(item, product);
  if (userOverride) {
    return userOverride;
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

  const userValue = Number(item.portion_value);
  if (item.portion_source === 'user' && Number.isFinite(userValue) && userValue > 0) {
    const unit = item.portion_unit || 'g';
    const display = item.portion_display || formatPortionDisplay(userValue, unit);
    return { grams: userValue, unit, display, source: 'user', reason: item.portion_reason || 'user_text' };
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
  const globalTimer = setTimeout(() => global.abort(), Number(process.env.OFF_GLOBAL_BUDGET_MS || 3000));

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
    const portionFieldValue = Number.isFinite(grams) ? grams : it.portion;
    const unitFieldValue = portionUnit || it.unit || 'g';
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
      portion_display: portionDisplay,
      portion: portionFieldValue,
      unit: unitFieldValue
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
        const fallbackSource = it.off_candidate ? 'off_error' : 'ai_fallback';
        const portionInfo = determinePortionInfo(it, null);
        const portionUnit = portionInfo.unit || it.portion_unit || 'g';
        const portionDisplay = portionInfo.display || formatPortionDisplay(grams, portionUnit);
        const portionFieldValue = Number.isFinite(grams) ? grams : it.portion;
        const unitFieldValue = portionUnit || it.unit || 'g';
        results.push({ ...it, grams, resolved: null, nutrients: null,
                     confidence: Math.min(it.confidence ?? 0.6, 0.6), needs_clarification: true, data_source: fallbackSource,
                     portion_source: portionInfo.source,
                     portion_reason: portionInfo.reason,
                     portion_value: grams,
                     portion_unit: portionUnit,
                     portion_display: portionDisplay,
                     portion: portionFieldValue,
                     unit: unitFieldValue });
      }
    }

  const tasks = selected.map(({ canonical, originals }) =>
    limit(async () => {
      const ctrl = new AbortController();
      const perReqTimer = setTimeout(() => ctrl.abort(), Number(process.env.OFF_TIMEOUT_MS || 3000));
      
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
            const portionFieldValue = Number.isFinite(grams) ? grams : it.portion;
            const unitFieldValue = portionUnit || it.unit || 'g';
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
              portion_display: portionDisplay,
              portion: portionFieldValue,
              unit: unitFieldValue
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
            const fallbackSource = it.off_candidate ? 'off_error' : 'ai_fallback';
            const portionFieldValue = Number.isFinite(grams) ? grams : it.portion;
            const unitFieldValue = portionUnit || it.unit || 'g';
            results.push({ ...it, grams, resolved: null, nutrients: null,
                           confidence: Math.min(it.confidence ?? 0.6, 0.6), needs_clarification: true,
                           data_source: fallbackSource,
                           portion_source: portionInfo.source,
                           portion_reason: portionInfo.reason,
                           portion_value: grams,
                           portion_unit: portionUnit,
                           portion_display: portionDisplay,
                           portion: portionFieldValue,
                           unit: unitFieldValue });
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
          const fallbackSource = it.off_candidate ? 'off_error' : 'ai_fallback';
          const portionFieldValue = Number.isFinite(grams) ? grams : it.portion;
          const unitFieldValue = portionUnit || it.unit || 'g';
          results.push({ ...it, grams, resolved: null, nutrients: null,
                         confidence: Math.min(it.confidence ?? 0.6, 0.6), needs_clarification: true,
                         data_source: fallbackSource,
                         portion_source: portionInfo.source,
                         portion_reason: portionInfo.reason,
                         portion_value: grams,
                         portion_unit: portionUnit,
                         portion_display: portionDisplay,
                         portion: portionFieldValue,
                         unit: unitFieldValue });
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

  // Include filtered-out items
  const filtered = candidates.filter(it => !groups.has(canonicalizeQuery(it.name)) || (it.confidence ?? 0) < 0.4);
  for (const it of filtered) {
    const portionInfo = determinePortionInfo(it, null);
    const grams = Number.isFinite(portionInfo.grams) ? portionInfo.grams : ensureGramsFallback(it);
    const portionUnit = portionInfo.unit || it.portion_unit || 'g';
    const portionDisplay = portionInfo.display || formatPortionDisplay(grams, portionUnit);
    const fallbackSource = it.off_candidate ? 'off_error' : 'ai_fallback';
    const portionFieldValue = Number.isFinite(grams) ? grams : it.portion;
    const unitFieldValue = portionUnit || it.unit || 'g';
    results.push({ ...it, grams, resolved: null, nutrients: null,
                   confidence: Math.min(it.confidence ?? 0.6, 0.4), needs_clarification: true,
                   data_source: fallbackSource,
                   portion_source: portionInfo.source,
                   portion_reason: portionInfo.reason,
                   portion_value: grams,
                   portion_unit: portionUnit,
                   portion_display: portionDisplay,
                   portion: portionFieldValue,
                   unit: unitFieldValue });
  }

  const agg = results.reduce((a,x)=>{
    if (x.nutrients){ a.calories+=x.nutrients.calories||0; a.protein_g+=x.nutrients.protein_g||0;
      a.fat_g+=x.nutrients.fat_g||0; a.carbs_g+=x.nutrients.carbs_g||0; a.fiber_g+=x.nutrients.fiber_g||0; }
    return a;
  }, { calories:0, protein_g:0, fat_g:0, carbs_g:0, fiber_g:0 });

  return { items: results, aggregates: agg, reasons };
}
