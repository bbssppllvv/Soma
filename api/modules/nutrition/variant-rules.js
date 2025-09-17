const VARIANT_RULES = [
  {
    id: 'light',
    matchers: ['light', 'lite', 'ligera', 'ligero'],
    productTerms: ['"light"^3', 'ligera^2', 'ligero^2', 'lite^2'],
    labelTerms: ['en:light', 'es:ligera', 'es:ligero']
  },
  {
    id: 'zero',
    matchers: ['zero'],
    productTerms: ['"zero"^2'],
    labelTerms: ['en:zero']
  },
  {
    id: 'semi_desnatada',
    matchers: ['semi', 'semi desnatada', 'semidesnatada', 'semi-desnatada'],
    productTerms: ['"semi desnatada"~1', 'semidesnatada', '"semi-desnatada"'],
    labelTerms: ['es:semidesnatada']
  },
  {
    id: 'desnatada',
    matchers: ['desnatada'],
    productTerms: ['desnatada'],
    labelTerms: ['es:desnatada']
  },
  {
    id: 'entera',
    matchers: ['entera'],
    productTerms: ['entera'],
    labelTerms: ['es:entera']
  },
  {
    id: 'tradicional',
    matchers: ['tradicional'],
    productTerms: ['tradicional'],
    labelTerms: ['es:tradicional']
  }
];

function normalizeVariantToken(raw) {
  return (raw || '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const MATCHER_LOOKUP = new Map();
for (const rule of VARIANT_RULES) {
  for (const matcher of rule.matchers) {
    const normalized = normalizeVariantToken(matcher);
    if (!normalized) continue;
    MATCHER_LOOKUP.set(normalized, rule);
    const collapsed = normalized.replace(/[\s-]/g, '');
    if (collapsed && collapsed !== normalized) {
      if (!MATCHER_LOOKUP.has(collapsed)) {
        MATCHER_LOOKUP.set(collapsed, rule);
      }
    }
  }
}

export function matchVariantRules(tokens = []) {
  const matches = new Set();
  for (const token of tokens) {
    const normalized = normalizeVariantToken(token);
    if (!normalized) continue;
    const direct = MATCHER_LOOKUP.get(normalized);
    if (direct) {
      matches.add(direct);
      continue;
    }
    const collapsed = normalized.replace(/[\s-]/g, '');
    const collapsedRule = MATCHER_LOOKUP.get(collapsed);
    if (collapsedRule) {
      matches.add(collapsedRule);
    }
  }
  return [...matches];
}

export function isVariantToken(token) {
  const normalized = normalizeVariantToken(token);
  if (!normalized) return false;
  if (MATCHER_LOOKUP.has(normalized)) return true;
  const collapsed = normalized.replace(/[\s-]/g, '');
  return collapsed ? MATCHER_LOOKUP.has(collapsed) : false;
}

export { VARIANT_RULES, normalizeVariantToken };
