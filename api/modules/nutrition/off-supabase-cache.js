const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OFF_CACHE_TABLE = process.env.OFF_CACHE_TABLE || 'off_products';
const MAX_AGE_MS = Number(process.env.OFF_CACHE_MAX_AGE_MS || 86400000); // default 24h

const baseHeaders = SUPABASE_KEY ? {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`
} : null;

function canUseCache() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY && baseHeaders);
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export async function getCachedOffProduct(code, { signal } = {}) {
  if (!canUseCache() || !code) return null;

  try {
    const url = `${SUPABASE_URL}/rest/v1/${OFF_CACHE_TABLE}?code=eq.${encodeURIComponent(code)}&select=code,last_modified_t,updated_at,product_json`;
    const res = await fetch(url, { headers: baseHeaders, signal });
    if (!res.ok) {
      console.log('OFF cache fetch error:', res.status);
      return null;
    }

    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const row = rows[0];
    const updatedAt = row.updated_at ? Date.parse(row.updated_at) : 0;
    const isFresh = updatedAt > 0 ? (Date.now() - updatedAt) < MAX_AGE_MS : false;

    return {
      product: row.product_json || null,
      last_modified_t: toNumber(row.last_modified_t),
      isFresh,
      updated_at: row.updated_at || null
    };
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.log('OFF cache read failed:', error.message);
    }
    return null;
  }
}

export async function upsertOffProduct(product, { previousLastModified, signal } = {}) {
  if (!canUseCache() || !product?.code) return;

  const productCode = String(product.code);
  const lastModified = toNumber(product.last_modified_t);

  if (previousLastModified != null && lastModified != null && lastModified === previousLastModified) {
    return; // nothing new to store
  }

  const payload = {
    code: productCode,
    last_modified_t: lastModified,
    product_json: product,
    updated_at: new Date().toISOString()
  };

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/${OFF_CACHE_TABLE}`, {
      method: 'POST',
      headers: {
        ...baseHeaders,
        Prefer: 'resolution=merge-duplicates'
      },
      signal,
      body: JSON.stringify(payload)
    });
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.log('OFF cache write failed:', error.message);
    }
  }
}
