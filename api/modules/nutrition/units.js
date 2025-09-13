const MAP = {
  g: 1, gram: 1, grams: 1,
  tbsp: 15, tablespoon: 15,
  tsp: 5, teaspoon: 5,
  cup: 240, cups: 240,
  slice: 30, piece: 50
};

const DENSITY_HINTS = [
  { key: /oil|olive|масло/i, g_per_ml: 0.91 },
  { key: /honey|мёд|мед/i,   g_per_ml: 1.42 },
  { key: /milk|молоко/i,     g_per_ml: 1.03 },
  { key: /yogurt|йогурт/i,   g_per_ml: 1.03 },
  { key: /water|вода/i,      g_per_ml: 1.00 }
];

export function parseNumberMaybeFraction(v){
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  const f = s.match(/^(\d+)\s*\/\s*(\d+)$/); if (f) return (+f[1])/(+f[2]);
  const m = s.match(/^(\d+(?:\.\d+)?)$/);    if (m) return +m[1];
  return NaN;
}

export function toGrams(portion, unit, name) {
  const normalizedPortion = parseNumberMaybeFraction(portion);
  if (!Number.isFinite(normalizedPortion) || !unit) return null;
  const u = String(unit).toLowerCase();
  if (u in MAP) return normalizedPortion * MAP[u];

  if (u === 'ml' || u.endsWith('ml')) {
    let d = 1.0;
    if (name) {
      const hint = DENSITY_HINTS.find(h => h.key.test(name));
      if (hint) d = hint.g_per_ml;
    }
    return normalizedPortion * d;
  }
  if (u === 'g' || u.endsWith('g')) return normalizedPortion;
  return null; // попросим уточнение позже
}
