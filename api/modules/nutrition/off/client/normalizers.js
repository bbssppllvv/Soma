export function normalizeV3Product(hit, locale) {
  if (!hit || (!hit.code && !hit.product_name)) return null;

  const normalized = { ...hit };

  const brands = Array.isArray(hit.brands)
    ? hit.brands.filter(Boolean).join(', ')
    : (typeof hit.brands === 'string' ? hit.brands : null);

  const productName = hit.product_name
    || (locale ? hit[`product_name_${locale}`] : null)
    || hit.product_name_en
    || hit.product_name_fr
    || null;

  normalized.code = hit.code != null ? String(hit.code) : null;
  normalized.product_name = productName;
  normalized.brands = brands;
  normalized.nutriments = hit.nutriments || {};
  normalized.brands_tags = Array.isArray(hit.brands_tags)
    ? hit.brands_tags
    : typeof hit.brands_tags === 'string'
      ? hit.brands_tags.split(',').map(x => x.trim()).filter(Boolean)
      : [];
  normalized.categories_tags = Array.isArray(hit.categories_tags)
    ? hit.categories_tags
    : typeof hit.categories_tags === 'string'
      ? hit.categories_tags.split(',').map(x => x.trim()).filter(Boolean)
      : [];
  normalized.languages_tags = Array.isArray(hit.languages_tags)
    ? hit.languages_tags
    : hit.lang
      ? [hit.lang]
      : [];
  normalized.countries_tags = Array.isArray(hit.countries_tags)
    ? hit.countries_tags
    : typeof hit.countries_tags === 'string'
      ? hit.countries_tags.split(',').map(x => x.trim()).filter(Boolean)
      : [];
  normalized.data_quality_score = typeof hit.data_quality_score === 'number' ? hit.data_quality_score : null;

  return normalized;
}
