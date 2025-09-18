import { normalizeBrandForSearch } from '../off-client.js';
import { BRAND_MISS_PENALTY } from './constants.js';
import { normalizeForMatch, stripLangPrefix } from './text.js';

export function collectBrandSearchVariants(item) {
  const variants = [];
  const brand = item?.brand_normalized || item?.brand;
  if (brand) {
    const normalized = normalizeBrandForSearch(brand);
    if (normalized) {
      variants.push(normalized);
    }
  }

  if (brand) {
    const slug = brand
      .toLowerCase()
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '');

    if (slug && slug !== variants[0]) {
      variants.push(slug);
    }
  }

  if (brand) {
    const collapsed = brand.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (collapsed && collapsed !== variants[0] && !variants.includes(collapsed)) {
      variants.push(collapsed);
    }
  }

  if (variants.length === 0 && item?.brand) {
    variants.push(item.brand.toLowerCase());
  }

  return variants.slice(0, 2);
}

export function buildBrandContext(item) {
  const raw = item?.brand_normalized || item?.brand;
  const normalized = normalizeForMatch(raw);
  if (!normalized) return null;
  const tokens = normalized.split(/\s+/).filter(token => token.length > 2);
  return {
    full: normalized,
    collapsed: normalized.replace(/\s+/g, ''),
    tokens: new Set(tokens)
  };
}

function extractProductBrandData(product) {
  const values = new Set();
  const words = new Set();

  const push = (value) => {
    const normalized = normalizeForMatch(value);
    if (!normalized) return;
    values.add(normalized);
    const collapsed = normalized.replace(/\s+/g, '');
    if (collapsed) values.add(collapsed);
    normalized.split(/\s+/).filter(token => token.length > 2).forEach(token => words.add(token));
  };

  if (typeof product?.brands === 'string') {
    product.brands.split(',').forEach(part => push(part));
  }
  if (Array.isArray(product?.brands_tags)) {
    product.brands_tags.forEach(tag => push(stripLangPrefix(tag)));
  }

  return { values, words };
}

export function computeBrandScore(brandContext, product) {
  if (!brandContext) {
    return { score: 0, exact: false, partialHits: 0 };
  }

  const brandData = extractProductBrandData(product);
  let score = 0;
  let exact = false;

  if (brandData.values.has(brandContext.full) || brandData.values.has(brandContext.collapsed)) {
    score += 500;
    exact = true;
  }

  let partialHits = 0;
  if (!exact) {
    for (const token of brandContext.tokens) {
      if (token.length <= 2) continue;
      if (brandData.words.has(token) || [...brandData.values].some(value => value.includes(token))) {
        partialHits += 1;
      }
    }
    if (partialHits > 0) {
      score += Math.min(400, partialHits * 180);
    }
  }

  if (!exact && partialHits === 0) {
    score -= BRAND_MISS_PENALTY;
  } else if (!exact && partialHits > 0) {
    score += Math.min(200, partialHits * 50);
  }

  return { score, exact, partialHits };
}
