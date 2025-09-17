function kjToKcal(kj){ return Number.isFinite(+kj) ? +kj * 0.239006 : undefined; }
function num(v){ const n = Number(v); return Number.isFinite(n) ? n : undefined; }

function parseServingGrams(s){ 
  const m = String(s||'').match(/(\d+(?:\.\d+)?)\s*g\b/i); 
  return m ? +m[1] : null; 
}

export function mapOFFProductToPer100g(product) {
  const n = product?.nutriments || {};
  const grams = parseServingGrams(product?.serving_size);
  const to100 = v => (Number.isFinite(+v) && grams) ? (+v) * (100/grams) : undefined;

  // Конвертируем serving в per-100g если нет готовых per-100g значений
  n['energy-kcal_100g']   ??= to100(n['energy-kcal_serving']);
  n['energy-kj_100g']     ??= to100(n['energy-kj_serving']);
  n['proteins_100g']      ??= to100(n['proteins_serving'] ?? n['protein_serving']);
  n['fat_100g']           ??= to100(n['fat_serving']);
  n['carbohydrates_100g'] ??= to100(n['carbohydrates_serving']);
  n['fiber_100g']         ??= to100(n['fiber_serving']);
  n['fibre_100g']         ??= to100(n['fibre_serving']);

  const kcal =
    num(n['energy-kcal_100g']) ??
    kjToKcal(n['energy-kj_100g']) ??
    kjToKcal(n['energy_100g']) ??
    0;
  const proteins = num(n['proteins_100g'] ?? n['protein_100g']) ?? 0;
  const fiber = num(n['fiber_100g'] ?? n['fibre_100g']) ?? 0;
  return {
    ENERC_KCAL: kcal,
    PROCNT:     proteins,
    FAT:        num(n['fat_100g']) ?? 0,
    CHOCDF:     num(n['carbohydrates_100g']) ?? 0,
    FIBTG:      fiber,
    serving_size: product?.serving_size || null,
    meta: {
      code: product?.code ?? null,
      name: product?.product_name ?? null,
      brand: product?.brands ?? null,
      last_modified_t: product?.last_modified_t ?? null
    }
  };
}
