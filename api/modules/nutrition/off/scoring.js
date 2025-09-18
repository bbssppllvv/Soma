import { computeBrandScore } from './brand.js';
import {
  computeCategoryPenalty,
  computeCategorySpecificityScore,
  computePreferenceAdjustments
} from './categories.js';
import { computeQuantityMatchScore, hasUsefulNutriments } from './nutrients.js';
import { buildPhraseRegex, normalizeForMatch, stripLangPrefix } from './text.js';

function computeVariantSignals(product, variantTokens = []) {
  if (!variantTokens?.length) {
    return { phraseMatches: 0, tokenMatches: 0 };
  }

  const normalizedName = normalizeForMatch(product.product_name);
  const labelTexts = (product.labels_tags || [])
    .map(tag => normalizeForMatch(stripLangPrefix(tag)))
    .filter(Boolean);
  const categoryTexts = (product.categories_tags || [])
    .map(tag => normalizeForMatch(stripLangPrefix(tag)))
    .filter(Boolean);

  const tokenMatches = new Set();
  let phraseMatches = 0;

  for (const rawToken of variantTokens) {
    const normalizedToken = normalizeForMatch(rawToken);
    if (!normalizedToken) continue;
    const regex = buildPhraseRegex(normalizedToken);
    let phraseFound = false;
    if (regex && regex.test(normalizedName)) {
      phraseMatches += 1;
      phraseFound = true;
    } else if (regex) {
      if (labelTexts.some(text => regex.test(text)) || categoryTexts.some(text => regex.test(text))) {
        phraseMatches += 1;
        phraseFound = true;
      }
    }

    if (
      phraseFound ||
      normalizedName.includes(normalizedToken) ||
      labelTexts.some(text => text.includes(normalizedToken)) ||
      categoryTexts.some(text => text.includes(normalizedToken))
    ) {
      tokenMatches.add(normalizedToken);
    }
  }

  return { phraseMatches, tokenMatches: tokenMatches.size };
}

function computeNameSimilarityScore(product, queryTokens = new Set()) {
  if (!queryTokens || queryTokens.size === 0) return 0;
  const productTokens = new Set(normalizeForMatch(product.product_name).split(/\s+/).filter(Boolean));
  if (productTokens.size === 0) return 0;
  let shared = 0;
  for (const token of queryTokens) {
    if (productTokens.has(token)) shared += 1;
  }
  if (shared === 0) return 0;
  const ratio = shared / Math.max(1, queryTokens.size);
  return Math.min(60, Math.round(ratio * 60));
}

export function scoreProduct(item, product, context) {
  const { brandContext, variantTokens, negativeCategoryTags, nameTokens } = context;
  const breakdown = {};

  const brandScore = computeBrandScore(brandContext, product);
  breakdown.brand = brandScore.score;
  let total = brandScore.score;

  const variantSignals = computeVariantSignals(product, variantTokens);
  const variantPhraseScore = variantSignals.phraseMatches * 200;
  const variantTokenScore = variantSignals.tokenMatches * 100;

  breakdown.variant_phrase = variantPhraseScore;
  breakdown.variant_tokens = variantTokenScore;
  total += variantPhraseScore + variantTokenScore;

  if (variantTokens?.length > 0 && variantSignals.tokenMatches === 0) {
    // REDUCED PENALTY: -200 instead of -500 to allow good brand matches through
    const requiredTokensPenalty = -200;
    breakdown.required_tokens_penalty = requiredTokensPenalty;
    total += requiredTokensPenalty;
    console.log(`[OFF] Required tokens penalty applied: ${requiredTokensPenalty} (missing: ${variantTokens.join(', ')})`);
  }

  const categoryPenalty = computeCategoryPenalty(product, negativeCategoryTags);
  breakdown.category_penalty = categoryPenalty;
  total += categoryPenalty;

  const brandTagsBonus = Array.isArray(product.brands_tags) && product.brands_tags.length > 0 ? 25 : 0;
  breakdown.brand_tags = brandTagsBonus;
  total += brandTagsBonus;

  const categorySpecificityScore = computeCategorySpecificityScore(product.categories_tags);
  breakdown.category_specificity = categorySpecificityScore;
  total += categorySpecificityScore;

  const countryBonus = Array.isArray(product.countries_tags) && product.countries_tags.some(tag => {
    const normalized = stripLangPrefix(tag || '').toLowerCase();
    return normalized === 'spain' || normalized === 'espana' || normalized === 'españa';
  }) ? 10 : 0;
  breakdown.country = countryBonus;
  total += countryBonus;

  const nutrimentCount = Object.keys(product?.nutriments || {}).filter(key => key.endsWith('_100g')).length;
  const nutrimentScore = Math.min(30, nutrimentCount);
  breakdown.nutriments = nutrimentScore;
  total += nutrimentScore;

  const quantityBonus = computeQuantityMatchScore(item, product);
  breakdown.quantity = quantityBonus;
  total += quantityBonus;

  const dataQualityBonus = typeof product.data_quality_score === 'number'
    ? Math.max(0, Math.min(20, Math.round(product.data_quality_score)))
    : 0;
  breakdown.data_quality = dataQualityBonus;
  total += dataQualityBonus;

  const nameScore = computeNameSimilarityScore(product, nameTokens);
  const enhancedNameScore = nameScore * 3;
  breakdown.name = enhancedNameScore;
  total += enhancedNameScore;

  const preference = computePreferenceAdjustments(item, product);
  const preferenceScore = preference.bonus - preference.penalty;
  breakdown.preference = preferenceScore;
  total += preferenceScore;

  const nutritionBonus = hasUsefulNutriments(product) ? 30 : 0;
  breakdown.nutrition = nutritionBonus;
  total += nutritionBonus;

  return { score: total, breakdown, brandExact: brandScore.exact };
}
