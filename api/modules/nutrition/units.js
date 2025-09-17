const UNIT_SYNONYMS = {
  gram: 'g', grams: 'g', g: 'g',
  kilogram: 'kg', kilograms: 'kg', kg: 'kg',
  milligram: 'mg', milligrams: 'mg', mg: 'mg',
  ounce: 'oz', ounces: 'oz', oz: 'oz',
  pound: 'lb', pounds: 'lb', lb: 'lb', lbs: 'lb',
  milliliter: 'ml', milliliters: 'ml', ml: 'ml',
  liter: 'l', liters: 'l', l: 'l',
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbsp: 'tbsp',
  teaspoon: 'tsp', teaspoons: 'tsp', tsp: 'tsp',
  cup: 'cup', cups: 'cup',
  slice: 'slice', slices: 'slice',
  piece: 'piece', pieces: 'piece', pc: 'piece', pcs: 'piece', unit: 'piece', units: 'piece',
  serving: 'serving', servings: 'serving'
};

const MASS_MAP = {
  g: 1,
  kg: 1000,
  mg: 0.001,
  oz: 28.35,
  lb: 453.59
};

const VOLUME_MAP = {
  tbsp: 15,
  tsp: 5,
  cup: 240,
  l: 1000
};

const SLICE_DEFAULTS = {
  bread: 35,
  cheese: 28,
  meat: 45,
  vegetable: 30,
  fruit: 40,
  unknown: 30
};

const PIECE_WEIGHTS_BY_CATEGORY = {
  egg: 52,
  bread: 40,
  dairy: 30,
  meat: 85,
  seafood: 80,
  fruit: 120,
  vegetable: 80,
  legume: 60,
  grain: 55,
  porridge: 55,
  pasta: 70,
  snack_sweet: 30,
  snack_savory: 28,
  cookie_biscuit: 25,
  dessert: 35,
  beverage: 240
};

const PIECE_KEYWORD_HINTS = [
  { key: /egg/i, weight: 52 },
  { key: /toast|bread|bun|bagel/i, weight: 40 },
  { key: /cheese|mozzarella|cheddar/i, weight: 28 },
  { key: /meat|chicken|beef|cutlet|steak/i, weight: 90 },
  { key: /shrimp|prawn|salmon|fish/i, weight: 80 },
  { key: /apple|orange|pear|fruit/i, weight: 130 },
  { key: /tomato|pepper|cucumber|vegetable/i, weight: 90 },
  { key: /cookie|biscuit|cracker/i, weight: 25 },
  { key: /bar|granola/i, weight: 50 }
];

const DENSITY_HINTS = [
  { key: /oil|olive|butterfat/i, g_per_ml: 0.91 },
  { key: /honey/i,               g_per_ml: 1.42 },
  { key: /milk/i,                g_per_ml: 1.03 },
  { key: /yogurt/i,              g_per_ml: 1.03 },
  { key: /water/i,               g_per_ml: 1.00 }
];

export function parseNumberMaybeFraction(v){
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  const f = s.match(/^(\d+)\s*\/\s*(\d+)$/); if (f) return (+f[1])/(+f[2]);
  const m = s.match(/^(\d+(?:\.\d+)?)$/);    if (m) return +m[1];
  return NaN;
}

function normalizeUnit(unit) {
  if (!unit) return '';
  const raw = String(unit).trim().toLowerCase();
  return UNIT_SYNONYMS[raw] || raw;
}

function weightFromSlice(context = {}) {
  const { canonical_category: cat = 'unknown', name = '' } = context;
  const normalizedCat = String(cat || 'unknown').replace(/-/g, '_');
  if (normalizedCat in SLICE_DEFAULTS) return SLICE_DEFAULTS[normalizedCat];
  if (/cheese/i.test(name)) return SLICE_DEFAULTS.cheese;
  if (/bread|toast/i.test(name)) return SLICE_DEFAULTS.bread;
  return SLICE_DEFAULTS.unknown;
}

function weightFromPiece(context = {}) {
  const { canonical_category: cat = 'unknown', food_form: form = 'unknown', name = '' } = context;
  const normalizedCat = String(cat || 'unknown').replace(/-/g, '_');

  for (const hint of PIECE_KEYWORD_HINTS) {
    if (hint.key.test(name)) return hint.weight;
  }

  if (normalizedCat in PIECE_WEIGHTS_BY_CATEGORY) {
    return PIECE_WEIGHTS_BY_CATEGORY[normalizedCat];
  }

  if (form === 'bar') return 50;
  if (form === 'cookie') return 25;

  return 50; // universal fallback weight
}

export function toGrams(portion, unit, name, context = {}) {
  const normalizedPortion = parseNumberMaybeFraction(portion);
  if (!Number.isFinite(normalizedPortion) || !unit) return null;
  const u = normalizeUnit(unit);

  if (u in MASS_MAP) {
    return normalizedPortion * MASS_MAP[u];
  }

  if (u in VOLUME_MAP) {
    return normalizedPortion * VOLUME_MAP[u];
  }

  if (u === 'ml') {
    let d = 1.0;
    if (name) {
      const hint = DENSITY_HINTS.find(h => h.key.test(name));
      if (hint) d = hint.g_per_ml;
    }
    return normalizedPortion * d;
  }

  if (u === 'slice') {
    return normalizedPortion * weightFromSlice({ ...context, name });
  }

  if (u === 'piece' || u === 'serving') {
    return normalizedPortion * weightFromPiece({ ...context, name });
  }

  return null; // ask the user for clarification later
}
