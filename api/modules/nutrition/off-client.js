import { getByBarcode as fetchByBarcode } from './off/client/barcodes.js';
import { searchByNamePipeline } from './off/client/search-pipeline.js';

export { canonicalizeQuery } from './off/client/text.js';
export { normalizeBrandForSearch } from './off/brand.js';

export async function getByBarcode(barcode, options = {}) {
  return fetchByBarcode(barcode, options);
}

export async function searchByNameV1(query, options = {}) {
  return searchByNamePipeline(query, options);
}
