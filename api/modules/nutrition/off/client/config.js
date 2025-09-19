export const PRODUCT_BASE = process.env.OFF_BASE_URL || 'https://world.openfoodfacts.org';
export const SEARCH_BASE = process.env.OFF_SEARCH_BASE_URL || 'https://search.openfoodfacts.org';
export const USER_AGENT = process.env.OFF_USER_AGENT || 'SomaDietTracker/1.0 (support@yourdomain.com)';
export const DEFAULT_LANG = (process.env.OFF_LANG || 'en').toLowerCase();

export const HTTP_TIMEOUT_MS = Number(process.env.OFF_TIMEOUT_MS || 6000);
export const CACHE_TTL_MS = Number(process.env.OFF_CACHE_TTL_MS || 10800000);

export const SEARCH_BUCKET_CAPACITY = Number(process.env.OFF_SEARCH_MAX_TOKENS || 2);
export const SEARCH_BUCKET_REFILL_MS = Number(process.env.OFF_SEARCH_REFILL_MS || 25000);
export const SEARCH_BUCKET_POLL_MS = Number(process.env.OFF_SEARCH_POLL_MS || 1500);

export const SEARCH_PAGE_SIZE = Number(process.env.OFF_SEARCH_PAGE_SIZE || 40);
export const SAL_TIMEOUT_MS = Number(process.env.OFF_SAL_TIMEOUT_MS || 600);
export const V2_STRICT_TIMEOUT_MS = Number(process.env.OFF_V2_STRICT_TIMEOUT_MS || 250);
export const V2_RELAX_TIMEOUT_MS = Number(process.env.OFF_V2_RELAX_TIMEOUT_MS || 250);
export const V2_BRANDLESS_TIMEOUT_MS = Number(process.env.OFF_V2_BRANDLESS_TIMEOUT_MS || 250);
export const LEGACY_TIMEOUT_MS = Number(process.env.OFF_LEGACY_TIMEOUT_MS || 400);
export const GLOBAL_BUDGET_MS = Number(process.env.OFF_GLOBAL_BUDGET_MS || 8000);
export const HEDGE_DELAY_MS = Number(process.env.OFF_HEDGE_DELAY_MS || 350);
export const HEDGE_TIMEOUT_MS = Number(process.env.OFF_HEDGE_TIMEOUT_MS || 400);

// Флаг для переключения на CGI API вместо SAL
export const USE_CGI_SEARCH = process.env.OFF_USE_CGI_SEARCH === 'true' || false;

// Флаги для улучшений продакшена
export const ENFORCE_BRAND_GATE_V2 = process.env.OFF_ENFORCE_BRAND_GATE_V2 === 'true';
export const CATEGORY_HARD_BLOCKS_ENABLED = process.env.OFF_CATEGORY_HARD_BLOCKS_ENABLED === 'true';
export const SPLIT_OR_REQUIRE_BRAND = process.env.OFF_SPLIT_OR_REQUIRE_BRAND === 'true';

// Параметры Category Guard
export const CATEGORY_MATCH_BOOST = Number(process.env.OFF_CATEGORY_MATCH_BOOST || 3);
export const CATEGORY_CONFLICT_PENALTY = Number(process.env.OFF_CATEGORY_CONFLICT_PENALTY || 5);
