import {
  CATEGORY_POSITIVE_HINTS,
  FLAVOR_KEYWORDS,
  PLAIN_ELIGIBLE_CATEGORIES,
  SWEET_CATEGORY_TAGS,
  SWEET_NAME_KEYWORDS,
  SWEET_SENSITIVE_CATEGORIES
} from './constants.js';
import { normalizeForMatch, normalizeText, stripLangPrefix } from './text.js';

export function deriveCategoryFilters(item, variantTokens = []) {
  let primary = null;
  const secondary = new Set();
  const exclude = new Set();
  const canonical = item?.canonical_category || 'unknown';
  const combinedText = normalizeText([
    item?.brand,
    item?.brand_normalized,
    item?.clean_name,
    item?.name
  ].filter(Boolean).join(' '));

  if (canonical === 'dairy') {
    exclude.add('en:plant-based-milk-alternatives');

    const isButter = /\bmantequilla\b|\bbutter\b/.test(combinedText);
    const isCheese = /\bqueso\b|\bcheese\b|\bphiladelphia\b|cream\s*cheese/.test(combinedText);
    const milkSignals = /\bleche\b|\bmilk\b|\blacteo\b/.test(combinedText);

    const variantSignal = variantTokens.some(token => {
      const normalized = normalizeText(token);
      return normalized.includes('semidesnat') ||
             normalized.includes('semi') ||
             normalized.includes('desnatada') ||
             normalized.includes('entera') ||
             normalized.includes('light');
    });

    if (isButter) {
      primary = 'en:butters';
    }

    if (isCheese) {
      primary = primary || 'en:cheeses';
      secondary.add('en:cream-cheeses');
    }

    if (!primary && (milkSignals || variantSignal || (!isButter && !isCheese))) {
      primary = 'en:milks';
    }
  }

  if (!primary) {
    const hint = CATEGORY_POSITIVE_HINTS[canonical];
    if (hint?.tags?.length) {
      primary = hint.tags[0];
      hint.tags.slice(1).forEach(tag => secondary.add(tag));
    }
  }

  return {
    primary: primary || null,
    secondary: [...secondary],
    exclude: [...exclude]
  };
}

export function computeCategoryPenalty(product, negativeCategoryTags = []) {
  if (!negativeCategoryTags?.length) return 0;
  const categories = Array.isArray(product.categories_tags) ? product.categories_tags : [];
  if (categories.length === 0) return 0;

  const normalizedCategories = categories
    .map(tag => normalizeForMatch(stripLangPrefix(tag)))
    .filter(Boolean);

  for (const tag of negativeCategoryTags) {
    const normalized = normalizeForMatch(stripLangPrefix(tag));
    if (!normalized) continue;
    if (normalizedCategories.some(cat => cat === normalized || cat.includes(normalized))) {
      return -200;
    }
  }

  if (normalizedCategories.some(cat => cat.includes('plant based'))) {
    return -200;
  }

  return 0;
}

export function computeCategorySpecificityScore(categories = []) {
  let bestDepth = 0;
  for (const raw of categories) {
    const value = stripLangPrefix(raw || '').toLowerCase();
    if (!value) continue;
    const depth = value.split('-').length;
    if (depth > bestDepth) bestDepth = depth;
  }
  if (bestDepth <= 1) return 0;
  return Math.min(20, (bestDepth - 1) * 5);
}

export function computePreferenceAdjustments(item, product) {
  const canonical = item?.canonical_category || 'unknown';
  const categories = Array.isArray(product.categories_tags) ? product.categories_tags : [];
  const productName = (product.product_name || '').toLowerCase();
  const nutriments = product?.nutriments || {};

  let bonus = 0;
  let penalty = 0;

  if (!SWEET_SENSITIVE_CATEGORIES.has(canonical)) {
    const hasSweetTag = categories.some(tag => SWEET_CATEGORY_TAGS.has(tag));
    const hasSweetKeyword = SWEET_NAME_KEYWORDS.some(word => productName.includes(word));
    if (hasSweetTag || hasSweetKeyword) {
      penalty += 120;
    }
  }

  const positiveHints = CATEGORY_POSITIVE_HINTS[canonical];
  if (positiveHints) {
    const hasPosTag = categories.some(tag => positiveHints.tags.includes(tag));
    const hasPosKeyword = positiveHints.keywords.some(word => productName.includes(word));
    if (hasPosTag || hasPosKeyword) {
      bonus += 30;
    } else {
      penalty += 60;
    }
  }

  const plainSensitive = PLAIN_ELIGIBLE_CATEGORIES.has(canonical) && !item?.brand;
  if (plainSensitive) {
    if (FLAVOR_KEYWORDS.some(word => productName.includes(word))) {
      penalty += 120;
    }
    const sugars = Number(nutriments['sugars_100g']);
    if (Number.isFinite(sugars) && sugars > 5) {
      penalty += 80;
    }
  }

  return { bonus, penalty };
}
