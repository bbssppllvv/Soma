export function parseQuantityToBase(raw) {
  if (!raw) return null;
  const value = String(raw).toLowerCase();
  const match = value.match(/(\d+(?:[\.,]\d+)?)\s*(kg|g|l|ml)\b/);
  if (!match) return null;
  const amount = parseFloat(match[1].replace(',', '.'));
  if (!Number.isFinite(amount)) return null;
  const unit = match[2];
  if (unit === 'kg') {
    return { value: amount * 1000, unit: 'g' };
  }
  if (unit === 'g') {
    return { value: amount, unit: 'g' };
  }
  if (unit === 'l') {
    return { value: amount * 1000, unit: 'ml' };
  }
  if (unit === 'ml') {
    return { value: amount, unit: 'ml' };
  }
  return null;
}

export function computeQuantityMatchScore(item, product) {
  const parsed = parseQuantityToBase(product?.quantity);
  if (!parsed) return 0;

  const portion = Number(item?.portion);
  const unit = (item?.unit || '').toLowerCase();
  if (!Number.isFinite(portion)) return 0;

  let targetValue = null;
  if (unit === 'g' || unit === 'gram' || unit === 'grams') {
    targetValue = { value: portion, unit: 'g' };
  } else if (unit === 'ml' || unit === 'milliliter' || unit === 'milliliters') {
    targetValue = { value: portion, unit: 'ml' };
  }

  if (!targetValue || targetValue.unit !== parsed.unit) return 0;

  const diff = Math.abs(parsed.value - targetValue.value);
  const tolerance = Math.max(20, targetValue.value * 0.15);
  if (diff <= tolerance) return 15;
  if (diff <= targetValue.value * 0.3) return 8;
  return 0;
}

export function hasUsefulNutriments(product) {
  const n = product?.nutriments || {};
  return n['energy-kcal_100g'] != null ||
         n['energy_100g'] != null ||
         n['energy-kj_100g'] != null ||
         n['proteins_100g'] != null ||
         n['protein_100g'] != null ||
         n['fat_100g'] != null ||
         n['carbohydrates_100g'] != null ||
         n['fiber_100g'] != null ||
         n['fibre_100g'] != null;
}
