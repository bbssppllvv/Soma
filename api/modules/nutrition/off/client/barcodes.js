import { PRODUCT_BASE } from './config.js';
import { fetchWithBackoff } from './http.js';

export async function getByBarcode(barcode, { signal } = {}) {
  const params = new URLSearchParams({ fields: PRODUCT_FIELDS_V3 });
  const url = `${PRODUCT_BASE}/api/v3/product/${encodeURIComponent(barcode)}?${params.toString()}`;
  const json = await fetchWithBackoff(url, { signal });
  if (!json || json.status !== 'success' || !json.product) return null;
  return json.product;
}

export const PRODUCT_FIELDS_V3 = 'code,product_name,brands,quantity,serving_size,nutriments,categories_tags,last_modified_t,nutriscore_grade,nutriscore_score,nutriscore_data,ecoscore_grade,ecoscore_score,nova_group,nova_groups,additives_tags,additives_n,allergens_tags,ingredients_analysis_tags,ingredients_text,labels_tags,nutrition_grades_tags,data_quality_score,countries_tags,languages_tags';
