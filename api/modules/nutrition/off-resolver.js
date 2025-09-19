import { getByBarcode, searchByNameV1 } from './off-client.js';
import { mapOFFProductToPer100g } from './off-map.js';
import { hasUsefulNutriments } from './off/nutrients.js';
import { normalizeForMatch, normalizeCompoundSeparators, expandCompoundEquivalents } from './off/text.js';
import { REQUIRE_BRAND } from './off/constants.js';
import { applyBrandGateV2, shouldEnforceBrandGate, generateBrandSynonyms, checkBrandMatchWithSynonyms } from './off/brand-synonyms.js';
import { applyCategoryGuard, applyCategoryScoring } from './off/category-guard.js';

const DEFAULT_CONFIDENCE_FLOOR = 0.65;
const MAX_PRODUCTS_CONSIDERED = 12;
const MAX_SEARCH_PAGES = Number(process.env.OFF_SEARCH_MAX_PAGES || 5);
const MAX_BRAND_VARIANT_PAGES = Number(process.env.OFF_BRAND_VARIANT_MAX_PAGES || 20); // Увеличенная глубина для brand+variant
const RESCUE_EXTRA_PAGES = Number(process.env.OFF_RESCUE_EXTRA_PAGES || 3);
const NAME_SIMILARITY_THRESHOLD = Number(process.env.OFF_NAME_SIM_THRESHOLD || 0.6);
const NEGATIVE_TOKEN_PENALTY = Number(process.env.OFF_NEGATIVE_TOKEN_PENALTY || 4);
const BRAND_BOOST_MULTIPLIER = Number(process.env.OFF_BRAND_BOOST_MULTIPLIER || 2.0); // Бонус за точное совпадение бренда

// Compound Variant Guard config
const COMPOUND_GUARD_ENABLED = (process.env.OFF_COMPOUND_GUARD_ENABLED || 'true') === 'true';
const COMPOUND_FULL_BONUS = Number(process.env.OFF_COMPOUND_FULL_BONUS || 8);
const COMPOUND_PARTIAL_PENALTY = Number(process.env.OFF_COMPOUND_PARTIAL_PENALTY || 6);
const COMPOUND_DEGRADE_AFTER_PAGES = Number(process.env.OFF_COMPOUND_DEGRADE_AFTER_PAGES || 2);

// Critical fixes config
const ENABLE_BRAND_COMPOUND_TEXT = (process.env.OFF_ENABLE_BRAND_COMPOUND_TEXT || 'true') === 'true';
const PHASED_SM = (process.env.OFF_PHASED_SM || 'true') === 'true';
const SERVER_BRAND_GUARD = (process.env.OFF_SERVER_BRAND_GUARD || 'true') === 'true';
const RESCUE_COMPOUND_1P = (process.env.OFF_RESCUE_COMPOUND_1P || 'true') === 'true';
const COMPOUND_MATCHER_V11 = (process.env.OFF_COMPOUND_MATCHER_V11 || 'true') === 'true';
const PHASE_SUMMARY_LOGS = (process.env.OFF_PHASE_SUMMARY_LOGS || 'true') === 'true';

// Phase enum for state machine
const Phase = {
  COMPOUND: 'COMPOUND',
  BRAND_COMPOUND_TEXT: 'BRAND_COMPOUND_TEXT', 
  BRAND_FILTER: 'BRAND_FILTER',
  RESCUE_NO_BRAND: 'RESCUE_NO_BRAND',
  DEGRADE: 'DEGRADE',
  DONE: 'DONE'
};

function getAttemptPhase(attempt) {
  if (attempt.reason === 'brand_compound_text') return Phase.BRAND_COMPOUND_TEXT;
  if (attempt.reason?.includes('compound_phrase')) return Phase.COMPOUND;
  if (attempt.brand || attempt.reason?.includes('brand')) return Phase.BRAND_FILTER;
  if (attempt.reason?.includes('rescue')) return Phase.RESCUE_NO_BRAND;
  return Phase.DEGRADE;
}

function isCompoundScenario(compound) {
  return compound && compound.roots && compound.roots.length >= 2;
}

function checkCompoundWithinWindow(text, roots, windowSize = 3) {
  if (!text || !Array.isArray(roots) || roots.length < 2) return false;
  
  const words = text.split(/\s+/).filter(Boolean);
  const expandedRoots = roots.map(root => expandCompoundEquivalents(root)).flat();
  
  // Check all permutations of roots within window
  for (let i = 0; i < words.length - 1; i++) {
    const window = words.slice(i, i + windowSize);
    const windowText = window.join(' ');
    
    // Check if all roots (or their equivalents) appear in this window
    const foundRoots = expandedRoots.filter(root => windowText.includes(root));
    const uniqueOriginalRoots = new Set();
    
    for (const foundRoot of foundRoots) {
      for (const originalRoot of roots) {
        const equivalents = expandCompoundEquivalents(originalRoot);
        if (equivalents.includes(foundRoot)) {
          uniqueOriginalRoots.add(originalRoot);
        }
      }
    }
    
    if (uniqueOriginalRoots.size >= 2) {
      return true;
    }
  }
  
  return false;
}

function getDynamicSearchDepth(attempt, hasVariantTokens = false) {
  // Динамическая глубина поиска на основе типа запроса
  if (attempt.maxPagesOverride) {
    return attempt.maxPagesOverride;
  }
  if (attempt.brand && hasVariantTokens) {
    // Для brand + variant используем увеличенную глубину
    return MAX_BRAND_VARIANT_PAGES;
  } else if (attempt.brand) {
    // Для brand-only используем стандартную глубину + небольшой буфер
    return Math.min(MAX_SEARCH_PAGES + 5, 12);
  }
  // Для generic поиска используем стандартную глубину
  return MAX_SEARCH_PAGES;
}

function shouldContinueSearch(aggregated, page, maxPages, attempt) {
  // Продолжаем поиск если:
  // 1. Не достигли лимита страниц
  // 2. И либо нет хороших кандидатов, либо есть бренд и мало результатов
  if (page >= maxPages) return false;
  
  if (aggregated.length === 0) return true;
  
  // Для brand+variant запросов всегда ищем глубже
  if (attempt.brand && page < 3) return true;
  
  // Для compound-запросов не останавливаемся слишком рано
  if (attempt.isCompound && page < COMPOUND_DEGRADE_AFTER_PAGES) return true;
  
  // Если есть бренд-фильтр, продолжаем поиск дольше
  if (attempt.brand && aggregated.length < 20) return true;
  
  // Для первых 2 страниц всегда продолжаем
  if (page <= 2) return true;
  
  // Проверяем качество топ-кандидатов только после 3 страниц
  const topCandidates = aggregated.slice(0, 10);
  const hasGoodMatches = topCandidates.some(prod => {
    const corpus = buildProductCorpus(prod);
    // Простая проверка на наличие ключевых токенов
    return corpus.length > 10; // Минимальная проверка качества
  });
  
  return !hasGoodMatches;
}

function toBrandSlug(value) {
  if (!value) return '';
  
  // Normalize brand for OFF brands_tags format
  const normalized = value
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/&/g, '-')
    .replace(/["'''`´]/g, '')
    .replace(/_/g, '-')
    .replace(/[^a-z0-9\s-]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim();

  return normalized || '';
}

function generateBrandSlugs(value) {
  if (!value) return [];
  
  const primary = toBrandSlug(value);
  const alternatives = [];
  
  // Universal rule: for brands with single letters separated by &, generate both formats
  // Examples: "A&B" → ["a-b", "a-b-s"], "M&M's" → ["m-ms", "m-m-s"]
  const singleLetterPattern = /^([a-z])\s*&\s*([a-z])('?s)?$/i;
  const match = value.match(singleLetterPattern);
  
  if (match) {
    const letter1 = match[1].toLowerCase();
    const letter2 = match[2].toLowerCase();
    const hasPossessive = match[3]; // 's
    
    // Format 1: letters joined with single dash
    const joined = hasPossessive ? `${letter1}-${letter2}s` : `${letter1}-${letter2}`;
    
    // Format 2: each letter separated by dashes  
    const separated = hasPossessive ? `${letter1}-${letter2}-s` : `${letter1}-${letter2}`;
    
    alternatives.push(joined, separated);
  }
  
  return [primary, ...alternatives].filter((v, i, arr) => arr.indexOf(v) === i);
}

function normalizeUPC(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function buildSearchTerm(item) {
  const direct = typeof item?.off_query === 'string' ? item.off_query.trim() : '';
  if (direct) return direct;
  
  // Build descriptive query: product name first, then variants
  const parts = [];
  
  // Приоритет: название продукта, а не бренд
  if (item?.clean_name) parts.push(item.clean_name);
  else if (item?.name) parts.push(item.name);
  
  if (Array.isArray(item?.required_tokens) && item.required_tokens.length > 0) {
    parts.push(item.required_tokens.join(' '));
  }
  
  const combined = parts.join(' ').trim();
  return combined || item?.name || '';
}

/**
 * Обнаруживает смешение языков в запросе
 */
function detectLanguageMixing(query, cleanName, locale) {
  if (!query || !cleanName) return false;
  
  // Простая эвристика: если clean_name на английском, а исходное название на другом языке
  const queryLower = query.toLowerCase();
  const cleanLower = cleanName.toLowerCase();
  
  // Проверяем наличие английских слов в clean_name при неанглийском locale
  const englishWords = ['cream', 'milk', 'chocolate', 'cheese', 'bread', 'water', 'sugar', 'salt'];
  const hasEnglishInClean = englishWords.some(word => cleanLower.includes(word));
  
  // Проверяем наличие неанглийских слов в исходном запросе
  const spanishWords = ['nata', 'leche', 'chocolate', 'queso', 'pan', 'agua', 'azucar', 'sal'];
  const hasSpanishInQuery = spanishWords.some(word => queryLower.includes(word));
  
  // Смешение если clean_name переведен на английский, а query на испанском
  const isMixed = hasEnglishInClean && hasSpanishInQuery && locale === 'es';
  
  if (isMixed) {
    console.log('[OFF] Language mixing detected', {
      query: query,
      clean_name: cleanName,
      locale: locale,
      has_english_clean: hasEnglishInClean,
      has_spanish_query: hasSpanishInQuery
    });
  }
  
  return isMixed;
}

/**
 * Фильтрует avoided термы из fallback фраз
 */
function filterOutAvoidedTerms(phrases, item) {
  if (!Array.isArray(phrases) || phrases.length === 0) return phrases;
  
  const avoidedTerms = [
    ...(Array.isArray(item?.off_attr_avoid) ? item.off_attr_avoid : []),
    ...(Array.isArray(item?.off_neg_tokens) ? item.off_neg_tokens : [])
  ].map(term => term.toLowerCase().trim()).filter(Boolean);
  
  if (avoidedTerms.length === 0) return phrases;
  
  const cleanedPhrases = phrases.filter(phrase => {
    if (!phrase) return false;
    const phraseLower = phrase.toLowerCase();
    
    // Исключаем фразы содержащие avoided термы
    const hasAvoidedTerm = avoidedTerms.some(avoided => 
      phraseLower.includes(avoided) || phrase.includes(avoided)
    );
    
    return !hasAvoidedTerm;
  });
  
  console.log('[OFF] Filtered avoided terms', {
    original_phrases: phrases.length,
    avoided_terms: avoidedTerms,
    cleaned_phrases: cleanedPhrases.length,
    removed: phrases.length - cleanedPhrases.length
  });
  
  return cleanedPhrases;
}

function normalizeValue(value) {
  return normalizeForMatch(value || '').replace(/\s+/g, ' ').trim();
}

/**
 * Извлекает атрибуты продукта для проверки avoided terms
 */
function extractProductAttributes(product) {
  if (!product) return [];
  
  const attributes = [];
  
  // Название продукта
  if (product.product_name) {
    attributes.push(normalizeValue(product.product_name));
  }
  
  // Labels (light, zero, bio, etc.)
  if (Array.isArray(product.labels_tags)) {
    attributes.push(...product.labels_tags.map(tag => 
      tag.replace(/^[a-z]{2}:/, '').replace(/-/g, ' ')
    ));
  }
  
  // Categories
  if (Array.isArray(product.categories_tags)) {
    attributes.push(...product.categories_tags.map(tag => 
      tag.replace(/^[a-z]{2}:/, '').replace(/-/g, ' ')
    ));
  }
  
  // Ingredients analysis (vegan, vegetarian, etc.)
  if (Array.isArray(product.ingredients_analysis_tags)) {
    attributes.push(...product.ingredients_analysis_tags.map(tag => 
      tag.replace(/^[a-z]{2}:/, '').replace(/-/g, ' ')
    ));
  }
  
  // Brands (для исключения неправильных брендов)
  if (product.brands) {
    if (Array.isArray(product.brands)) {
      attributes.push(...product.brands.map(normalizeValue));
    } else {
      attributes.push(normalizeValue(product.brands));
    }
  }
  
  return attributes
    .map(attr => normalizeValue(attr))
    .filter(Boolean)
    .filter(attr => attr.length > 1); // Исключаем слишком короткие
}

function quoteForQuery(value) {
  const str = typeof value === 'string' ? value.trim() : '';
  if (!str) return null;
  return `"${str.replace(/"/g, '\\"')}"`;
}

// ===== Compound Variant Guard helpers =====
function expandCompoundForms(phrase) {
  const forms = new Set();
  const base = normalizeValue(phrase);
  if (!base) return forms;
  const canonical = base.replace(/\s+/g, ' ').trim();
  const joiners = [' and ', ' & ', " 'n' ", ' n '];
  const creamVariants = ['cream', 'creme', 'crème'];
  const hyphenate = (s) => s.replace(/\s+/g, '-');
  const concat = (s) => s.replace(/\s+/g, '');

  // Include canonical
  forms.add(canonical);
  forms.add(hyphenate(canonical));
  forms.add(concat(canonical));

  // Replace connectors
  for (const join of joiners) {
    const parts = canonical.split(/\s+(?:&|and|'n'|n)\s+/);
    if (parts.length === 2) {
      const j = `${parts[0]}${join}${parts[1]}`.replace(/\s+/g, ' ').trim();
      forms.add(j);
      forms.add(hyphenate(j));
      forms.add(concat(j));
    }
  }

  // Cream/creme/crème variants
  if (/\b(cr[ea]me|crème)\b/.test(canonical)) {
    for (const cv of creamVariants) {
      const j = canonical.replace(/\b(cr[ea]me|crème)\b/g, cv);
      forms.add(j);
      forms.add(hyphenate(j));
      forms.add(concat(j));
    }
  }

  return new Set([...forms].map(normalizeValue));
}

function deriveCompoundBlocks(item) {
  if (!COMPOUND_GUARD_ENABLED) return null;
  const candidates = [];
  const addFromArray = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const s of arr) {
      if (typeof s !== 'string') continue;
      const norm = normalizeValue(s);
      if (!norm) continue;
      // Skip phrases where all tokens are 2 chars or less
      const tokens = norm.split(' ').filter(Boolean);
      const allShort = tokens.length > 0 && tokens.every(t => t.length <= 2);
      if (allShort) continue;
      const hasJoiner = /\b(&|and|'n|n)\b|-/i.test(s);
      if (tokens.length >= 2 || hasJoiner) {
        candidates.push(norm);
      }
    }
  };
  addFromArray(item?.off_primary_tokens);
  addFromArray(item?.off_alt_tokens);

  // Also attempt from name excluding brand words
  const name = normalizeValue(item?.name || item?.clean_name || '');
  if (name) {
    const brandValues = [item?.off_brand_filter, item?.brand, item?.brand_normalized, ...(Array.isArray(item?.brand_synonyms) ? item.brand_synonyms : [])]
      .map(normalizeValue)
      .filter(Boolean);
    const brandWords = new Set();
    brandValues.forEach(val => val.split(' ').forEach(w => { if (w.length > 1) brandWords.add(w); }));
    const words = name.split(' ').filter(w => w.length > 1 && !brandWords.has(w));
    // Do not generate from name if it reduces to brand-only fragments
    if (words.length >= 2) candidates.push(words.join(' '));
  }

  if (candidates.length === 0) return null;
  // Pick the first distinct candidate
  const canonical = candidates[0];
  const forms = expandCompoundForms(canonical);
  const words = new Set(canonical.split(' ').filter(Boolean));
  console.log('[COMPOUND_GUARD] phrase', { phrase: canonical });
  return { canonical, forms, words };
}

function expandVariantToken(token) {
  const variants = new Set();
  const raw = (token || '').toString().toLowerCase().trim();
  if (!raw) return variants;

  const rawCandidates = new Set([raw]);

  if (raw.includes('&')) {
    rawCandidates.add(raw.replace(/&/g, 'and'));
  }
  if (raw.includes(' and ')) {
    rawCandidates.add(raw.replace(/\sand\s/g, ' & '));
  }
  if (raw.includes('creme')) {
    rawCandidates.add(raw.replace(/creme/g, 'cream'));
  }
  if (raw.includes('cream')) {
    rawCandidates.add(raw.replace(/cream/g, 'creme'));
  }

  // Расширяем варианты для Cookies & Creme / Cookies & Cream
  const hasCookies = /\bcookies?\b/.test(raw);
  const hasCream = /\bcreme\b|\bcream\b|\bcrème\b/.test(raw);
  if (hasCookies && hasCream) {
    const bases = [
      raw,
      raw.replace(/crème/g, 'creme'),
      raw.replace(/crème/g, 'cream').replace(/creme/g, 'cream')
    ];
    for (const base of bases) {
      const normalizedBase = base
        .replace(/\s+&\s+/g, ' & ')
        .replace(/\s+and\s+/g, ' and ')
        .trim();
      const pairs = [
        [' & ', 'creme'],
        [' & ', 'cream'],
        [' and ', 'creme'],
        [' and ', 'cream'],
        [' n ', 'creme'],
        [' n ', 'cream'],
        [" 'n' ", 'creme'],
        [" 'n' ", 'cream']
      ];
      for (const [joiner, creamWord] of pairs) {
        rawCandidates.add(`cookies${joiner}${creamWord}`);
        rawCandidates.add(`cookie${joiner}${creamWord}`);
      }
    }
  }

  for (const candidate of rawCandidates) {
    const normalized = normalizeValue(candidate);
    if (normalized) {
      variants.add(normalized);
    }
  }

  return variants;
}

function collectVariantTokens(item) {
  const tokens = new Set();

  const addPhrase = (phrase) => {
    if (!phrase) return;
    expandVariantToken(phrase).forEach(value => {
      if (value.length > 2) tokens.add(value);
    });
  };

  const addFromArray = (source) => {
    if (!Array.isArray(source) || source.length === 0) return;
    source.forEach(token => addPhrase(token));
    const joined = source.join(' ').trim();
    if (joined) addPhrase(joined);
  };

  addFromArray(item?.off_variant_tokens);
  addFromArray(item?.required_tokens);
  addFromArray(item?.off_primary_tokens);

  const name = typeof item?.name === 'string' ? item.name : '';
  if (name) {
    const normalizedName = normalizeValue(name);
    if (normalizedName) {
      const brandValues = [item?.off_brand_filter, item?.brand, item?.brand_normalized]
        .map(normalizeValue)
        .filter(Boolean);
      const brandWords = new Set();
      brandValues.forEach(value => {
        value.split(' ').forEach(word => {
          if (word.length > 1) brandWords.add(word);
        });
      });

      const availableWords = normalizedName
        .split(' ')
        .filter(word => word.length > 1 && !brandWords.has(word));

      if (availableWords.length > 0) {
        addPhrase(availableWords.join(' '));
      }
    }
  }

  return [...tokens];
}

function normalizeNegativeToken(token) {
  const normalized = normalizeValue(token || '');
  if (!normalized) return null;
  if (normalized.length <= 1) return null;
  return normalized;
}

function collectFallbackPhrases(item) {
  const phrases = [];
  const seen = new Set();

  const addPhrase = (phrase) => {
    if (phrase == null) return;
    const trimmed = phrase.toString().trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    phrases.push(trimmed);
  };

  const addFromArray = (source) => {
    if (!Array.isArray(source)) return;
    source.forEach(addPhrase);
  };

  addFromArray(item?.off_primary_tokens);
  addFromArray(item?.off_alt_tokens);

  if (phrases.length === 0) {
    const variantArray = Array.isArray(item?.off_variant_tokens) ? item.off_variant_tokens : [];
    const multiWordVariant = variantArray.filter(token => typeof token === 'string' && token.trim().includes(' '));
    addFromArray(multiWordVariant);
  }

  if (phrases.length === 0) {
    const requiredArray = Array.isArray(item?.required_tokens) ? item.required_tokens : [];
    const multiWordRequired = requiredArray.filter(token => typeof token === 'string' && token.trim().includes(' '));
    addFromArray(multiWordRequired);
  }

  if (phrases.length === 0) {
    addPhrase(item?.clean_name);
    addPhrase(item?.name);
  }

  return phrases.slice(0, 6);
}

function buildOrQuery(phrases) {
  if (!Array.isArray(phrases) || phrases.length === 0) return null;
  const quoted = phrases.map(quoteForQuery).filter(Boolean);
  if (quoted.length === 0) return null;
  return quoted.join(' OR ');
}

function splitOrQuery(phrases, maxChunkSize = 3) {
  if (!Array.isArray(phrases) || phrases.length === 0) return [];
  
  const quoted = phrases.map(quoteForQuery).filter(Boolean);
  if (quoted.length === 0) return [];
  
  // If small enough, return as single query
  if (quoted.length <= maxChunkSize) {
    return [quoted.join(' OR ')];
  }
  
  // Split into chunks
  const chunks = [];
  for (let i = 0; i < quoted.length; i += maxChunkSize) {
    const chunk = quoted.slice(i, i + maxChunkSize);
    if (chunk.length > 0) {
      chunks.push(chunk.join(' OR '));
    }
  }
  
  return chunks;
}

async function searchWithRetry(query, options, signal, maxRetries = 2) {
  let lastError = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await searchByNameV1(query, { ...options, signal });
      
      // Log successful retry if this wasn't the first attempt
      if (attempt > 0) {
        console.log(`[OFF] Search succeeded on retry ${attempt} for query: ${query.substring(0, 50)}...`);
      }
      
      return response;
    } catch (error) {
      lastError = error;
      
      // Check if this is a retryable error (500, 502, 503, 504, 429)
      const isRetryable = error?.status >= 500 || error?.status === 429;
      
      if (!isRetryable || attempt === maxRetries) {
        console.log(`[OFF] Search failed (non-retryable or max retries reached): ${error.message} for query: ${query.substring(0, 50)}...`);
        throw error;
      }
      
      // Log retry attempt
      console.log(`[OFF] Search failed with ${error.status || 'unknown'}, retrying attempt ${attempt + 1} for query: ${query.substring(0, 50)}...`);
      
      // Exponential backoff with jitter
      const baseDelay = Math.min(1000 * Math.pow(2, attempt), 5000);
      const jitter = Math.random() * 500;
      await new Promise(resolve => setTimeout(resolve, baseDelay + jitter));
    }
  }
  
  throw lastError;
}

function tokenizeNormalized(value) {
  const normalized = normalizeValue(value || '');
  if (!normalized) return [];
  return normalized.split(' ').filter(token => token.length > 1);
}

function gatherCandidateNames(product) {
  const names = [];
  const pushName = (name) => {
    const normalized = normalizeValue(name);
    if (normalized) names.push(normalized);
  };

  if (product?.product_name) pushName(product.product_name);
  if (product?.generic_name) pushName(product.generic_name);

  for (const key of Object.keys(product || {})) {
    if (key.startsWith('product_name_') && typeof product[key] === 'string') {
      pushName(product[key]);
    }
    if (key.startsWith('generic_name_') && typeof product[key] === 'string') {
      pushName(product[key]);
    }
  }

  return [...new Set(names)];
}

function computeNameMetrics(names, targetNormalized, targetTokenSet) {
  let bestJaccard = 0;
  let exact = false;
  let contains = false;
  const hasTargetTokens = targetTokenSet && targetTokenSet.size > 0;

  for (const name of names) {
    if (!name) continue;
    if (targetNormalized && name === targetNormalized) {
      exact = true;
    }
    if (targetNormalized && name.includes(targetNormalized)) {
      contains = true;
    }

    if (!hasTargetTokens) continue;

    const tokens = tokenizeNormalized(name);
    if (tokens.length === 0) continue;

    let intersection = 0;
    for (const token of tokens) {
      if (targetTokenSet.has(token)) intersection += 1;
    }
    if (intersection === 0) continue;

    const unionSize = new Set([...tokens, ...targetTokenSet]).size;
    if (unionSize === 0) continue;

    const jaccard = intersection / unionSize;
    if (jaccard > bestJaccard) {
      bestJaccard = jaccard;
    }
  }

  return { bestJaccard, exact, contains };
}

function determineSelectionReason(info) {
  if (info.brandMatch && info.tokenMatch && info.exactMatch) return 'brand_variant_exact';
  if (info.brandMatch && info.tokenMatch) return 'brand_variant';
  if (info.brandMatch && info.containsTarget) return 'brand_contains';
  if (info.brandMatch) return 'brand_only';
  if (info.tokenMatch && info.exactMatch) return 'variant_exact';
  if (info.tokenMatch) return 'variant_only';
  return 'best_available';
}

function buildSearchAttempts(item) {
  const attempts = [];
  
  // Extract brand information
  const brandCandidates = [item?.off_brand_filter, item?.brand, item?.brand_normalized]
    .map(value => value ? value.toString().trim() : '')
    .filter(Boolean);
  const brandSlugs = brandCandidates.length > 0 ? generateBrandSlugs(brandCandidates[0]) : [];
  const brandName = brandCandidates.length > 0 ? brandCandidates[0] : '';
  const canonicalBrand = typeof item?.brand_canonical === 'string' ? item.brand_canonical.trim() : '';
  const brandFilters = [canonicalBrand, ...brandSlugs].filter(Boolean);
  const brandFilterObject = brandFilters.length > 0 ? { brands_tags: brandFilters } : null;
  
  // 0. EARLY: Brand+Compound text search (critical fix #1)
  const compound = deriveCompoundBlocks(item);
  if (ENABLE_BRAND_COMPOUND_TEXT && compound && compound.canonical && brandName) {
    const phrase = compound.canonical;
    const pageSize = Number(process.env.OFF_COMPOUND_PAGE_SIZE || 20);
    
    // Generate brand forms for text search - используем оригинальный бренд для текстового поиска
    const brandForms = generateBrandSynonyms(brandName, Array.isArray(item?.brand_synonyms) ? item.brand_synonyms : []);
    // Для текстового поиска используем оригинальный бренд, а не нормализованный
    const primaryBrandForm = brandName.toLowerCase();
    
    attempts.push({
      query: `"${primaryBrandForm}" "${phrase}"`,
      brand: null, // No server brand_filter
      brandName: null,
      reason: 'brand_compound_text',
      pageSize,
      filters: null,
      preferCGI: true,
      isExactPhrase: true,
      isCompound: true,
      isBrandCompoundText: true,
      maxPagesOverride: 1
    });
  }

  // 1. EARLY: Compound phrase exact search (one page)
  if (compound && compound.canonical) {
    const phrase = compound.canonical;
    const pageSize = Number(process.env.OFF_COMPOUND_PAGE_SIZE || 20);
    attempts.push({
      query: `"${phrase}"`,
      brand: null,
      brandName: null,
      reason: 'compound_phrase_exact',
      pageSize,
      filters: null,
      preferCGI: true,
      isExactPhrase: true,
      isCompound: true,
      maxPagesOverride: 1
    });
    const hyphen = phrase.replace(/\s+/g, '-');
    if (hyphen && hyphen !== phrase) {
      attempts.push({
        query: `"${hyphen}"`,
        brand: null,
        brandName: null,
        reason: 'compound_phrase_hyphen',
        pageSize,
        filters: null,
        preferCGI: true,
        isExactPhrase: true,
        isCompound: true,
        maxPagesOverride: 1
      });
    }
    const concat = phrase.replace(/\s+/g, '');
    if (concat && concat !== phrase) {
      attempts.push({
        query: `"${concat}"`,
        brand: null,
        brandName: null,
        reason: 'compound_phrase_concat',
        pageSize,
        filters: null,
        preferCGI: true,
        isExactPhrase: true,
        isCompound: true,
        maxPagesOverride: 1
      });
    }
  }
  
  // Page sizes
  const brandPageSize = Number(process.env.OFF_BRAND_PAGE_SIZE || 40);
  const fallbackOrPageSize = Number(process.env.OFF_FALLBACK_PAGE_SIZE || 20);
  
  // НОВАЯ СТРАТЕГИЯ: Locale-safe CGI-first без смешения языков
  
  // 1. PRIMARY: CGI с точной фразой из off_primary_tokens[0] в кавычках
  const primaryToken = Array.isArray(item?.off_primary_tokens) && item.off_primary_tokens.length > 0 
    ? item.off_primary_tokens[0].trim() 
    : null;
    
  if (primaryToken && brandName) {
    attempts.push({
      query: `"${primaryToken}"`, // В кавычках для точного поиска
      brand: brandSlugs[0] || null,
      brandName: brandName, // Для CGI API
      reason: 'cgi_primary_exact_phrase',
      pageSize: brandPageSize,
      filters: brandFilterObject,
      preferCGI: true, // Флаг для smart routing
      isExactPhrase: true
    });
  }
  
  // 2. SECONDARY: CGI без кавычек, но с исходной фразой (не переводом)
  if (primaryToken && brandName && primaryToken !== `"${primaryToken}"`) {
    attempts.push({
      query: primaryToken,
      brand: brandSlugs[0] || null,
      brandName: brandName,
      reason: 'cgi_primary_no_quotes',
      pageSize: brandPageSize,
      filters: brandFilterObject,
      preferCGI: true
    });
  }
  
  // 3. FALLBACK: только если нет primaryToken, используем buildSearchTerm
  const baseQuery = buildSearchTerm(item);
  if (!primaryToken && baseQuery && brandSlugs.length > 0) {
    // Проверяем, не смешанный ли язык
    const isLanguageMixed = detectLanguageMixing(baseQuery, item?.clean_name, item?.locale);
    
    if (!isLanguageMixed) {
      attempts.push({
        query: baseQuery,
        brand: brandSlugs[0] || null,
        brandName: brandName,
        reason: 'brand_filtered_search_safe',
        pageSize: brandPageSize,
        filters: brandFilterObject,
        preferCGI: true
      });
    } else {
      console.log('[OFF] Language mixing detected, skipping mixed query', {
        base_query: baseQuery,
        clean_name: item?.clean_name,
        locale: item?.locale
      });
    }
  }
  
  // 4. SAL FALLBACK: только при низкой отдаче CGI
  // Используем исходную фразу, не clean_name если он переведен
  const salQuery = primaryToken || item?.name || baseQuery;
  if (salQuery) {
    attempts.push({
      query: salQuery,
      brand: brandSlugs[0] || null,
      reason: 'sal_fallback_controlled',
      pageSize: brandPageSize,
      filters: brandFilterObject,
      preferSAL: true,
      fallbackOnly: true // Используется только при неудаче CGI
    });
  }
  
  // 5. RESCUE: точная фраза без бренда (если CGI+brand не дал результатов)
  if (primaryToken) {
    attempts.push({
      query: `"${primaryToken}"`,
      brand: null,
      reason: 'rescue_exact_phrase_no_brand',
      pageSize: fallbackOrPageSize,
      preferCGI: true,
      isRescue: true
    });
  }
  
  // 6. DEEP FALLBACK: OR-запросы без avoided термов
  const fallbackPhrases = collectFallbackPhrases(item);
  const cleanedPhrases = filterOutAvoidedTerms(fallbackPhrases, item);
  
  if (cleanedPhrases.length > 0) {
    if (cleanedPhrases.length > 3) {
      const splitQueries = splitOrQuery(cleanedPhrases, 3);
      console.log(`[OFF] Using cleaned split-OR: ${cleanedPhrases.length} phrases → ${splitQueries.length} queries`);
      
      splitQueries.forEach((splitQuery, index) => {
        if (splitQuery) {
          attempts.push({
            query: splitQuery,
            brand: null,
            reason: `fallback_clean_split_or_${index + 1}`,
            pageSize: fallbackOrPageSize,
            isSplitOr: true,
            splitIndex: index,
            isDeepFallback: true
          });
        }
      });
    } else {
      const cleanOrQuery = buildOrQuery(cleanedPhrases);
      if (cleanOrQuery) {
        attempts.push({
          query: cleanOrQuery,
          brand: null,
          reason: 'fallback_clean_or_tokens',
          pageSize: fallbackOrPageSize,
          isDeepFallback: true
        });
      }
    }
  }

  console.log('[OFF] Search attempts built', {
    total_attempts: attempts.length,
    primary_token: primaryToken || 'none',
    brand: brandName || 'none',
    cgi_preferred: attempts.filter(a => a.preferCGI).length,
    sal_fallback: attempts.filter(a => a.preferSAL).length,
    rescue_attempts: attempts.filter(a => a.isRescue).length
  });

  return attempts;
}

function buildRescueAttempts(item, originalAttempts) {
  const rescueAttempts = [];
  const brandCandidates = [item?.off_brand_filter, item?.brand, item?.brand_normalized]
    .map(value => value ? value.toString().trim() : '')
    .filter(Boolean);
  const brandSlugs = brandCandidates.length > 0 ? generateBrandSlugs(brandCandidates[0]) : [];
  const canonicalBrand = typeof item?.brand_canonical === 'string' ? item.brand_canonical.trim() : '';
  const brandFilters = [canonicalBrand, ...brandSlugs].filter(Boolean);
  const brandFilterObject = brandFilters.length > 0 ? { brands_tags: brandFilters } : null;
  
  // Strategy 1: Brand filter without problematic attributes (if OFF supports exclusion)
  if (brandSlugs.length > 0 && Array.isArray(item?.off_neg_tokens) && item.off_neg_tokens.length > 0) {
    const baseQuery = buildSearchTerm(item);
    if (baseQuery) {
      // Remove negative tokens from query for rescue attempt
      let cleanQuery = baseQuery;
      for (const negToken of item.off_neg_tokens) {
        const regex = new RegExp(`\\b${negToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        cleanQuery = cleanQuery.replace(regex, '').replace(/\s+/g, ' ').trim();
      }
      
      if (cleanQuery && cleanQuery !== baseQuery) {
        rescueAttempts.push({
          query: cleanQuery,
          brand: brandSlugs[0] || null,
          reason: 'rescue_clean_query',
          pageSize: Number(process.env.OFF_BRAND_PAGE_SIZE || 40),
          filters: brandFilterObject
        });
      }
    }
  }
  
  // Strategy 2: Compound rescue with category (critical fix #4)
  const compound = deriveCompoundBlocks(item);
  if (RESCUE_COMPOUND_1P && compound && compound.canonical) {
    const categoryFilters = item?.canonical_category ? 
      { categories_tags: [item.canonical_category] } : null;
    rescueAttempts.push({
      query: `"${compound.canonical}"`,
      brand: null,
      brandName: null,
      reason: 'rescue_compound_with_category',
      pageSize: 20,
      filters: categoryFilters,
      isRescue: true,
      maxPagesOverride: 1
    });
  }
  
  // Strategy 3: GPT Fallback Rescue - узкий поиск с fallback phrases
  if (brandSlugs.length > 0 && Array.isArray(item?.off_fallback_phrases) && item.off_fallback_phrases.length > 0) {
    const brandSynonyms = generateBrandSynonyms(brandCandidates[0], Array.isArray(item?.brand_synonyms) ? item.brand_synonyms : []);
    // Для текстового поиска используем оригинальный бренд
    const primaryBrandForm = brandCandidates[0].toLowerCase();
    
    for (const fallbackPhrase of item.off_fallback_phrases) {
      if (fallbackPhrase && fallbackPhrase.trim()) {
        rescueAttempts.push({
          query: `"${primaryBrandForm}" "${fallbackPhrase.trim()}"`,
          brand: null, // Без server brand_filter
          brandName: null,
          reason: 'rescue_gpt_fallback',
          pageSize: 20,
          filters: null,
          isRescue: true,
          maxPagesOverride: 1,
          fallbackPhrase: fallbackPhrase.trim()
        });
      }
    }
  }

  // Strategy 3: Exact phrase search without brand (like browser search)
  const primaryTokens = Array.isArray(item?.off_primary_tokens) ? item.off_primary_tokens : [];
  if (primaryTokens.length >= 2) {
    const exactPhrase = primaryTokens.slice(0, 2).join(' ');
    rescueAttempts.push({
      query: `"${exactPhrase}"`,
      brand: null,
      reason: 'rescue_exact_phrase_no_brand',
      pageSize: Number(process.env.OFF_FALLBACK_PAGE_SIZE || 30),
      filters: { categories_tags: ['whipped-creams', 'dairy-products', 'creams'] }
    });
  }
  
  // Strategy 3: Core tokens only with brand (simplified query)
  if (brandSlugs.length > 0 && primaryTokens.length > 0) {
    const coreQuery = primaryTokens.slice(0, 2).join(' ');
    if (coreQuery) {
      rescueAttempts.push({
        query: coreQuery,
        brand: brandSlugs[0] || null,
        reason: 'rescue_core_tokens_with_brand',
        pageSize: Number(process.env.OFF_BRAND_PAGE_SIZE || 40),
        filters: brandFilterObject
      });
    }
  }

  // Strategy 4: Fallback without brand filter but with strong anchor tokens
  const fallbackPhrases = collectFallbackPhrases(item);
  if (fallbackPhrases.length > 0) {
    if (primaryTokens.length > 0) {
      const anchorQuery = primaryTokens.slice(0, 2).map(token => `"${token}"`).join(' ');
      if (anchorQuery) {
        rescueAttempts.push({
          query: anchorQuery,
          brand: null,
          reason: 'rescue_anchor_only',
          pageSize: Number(process.env.OFF_FALLBACK_PAGE_SIZE || 20)
        });
      }
    }
  }
  
  // Strategy 3: Brand-only search (most permissive)
  if (brandSlugs.length > 0) {
    rescueAttempts.push({
      query: brandSlugs[0],
      brand: brandSlugs[0] || null,
      reason: 'rescue_brand_only',
      pageSize: Number(process.env.OFF_BRAND_PAGE_SIZE || 40),
      filters: brandFilterObject
    });
  }
  
  return rescueAttempts;
}

function shouldTriggerRescue(selected, selectedMeta) {
  if (!selected) return false;
  
  // Trigger rescue if the selected candidate has negative matches (penalties)
  if (selected.negativeMatch) {
    console.log('[OFF] Rescue triggered: selected candidate has negative matches');
    return true;
  }
  
  // Trigger rescue if the selected candidate has avoided attributes
  if (selected.avoidedAttrMatch) {
    console.log('[OFF] Rescue triggered: selected candidate has avoided attributes');
    return true;
  }
  
  // Trigger rescue if confidence is low and we have negative tokens
  if (selected.nameSimilarity < 0.4 && selected.score < 3) {
    console.log('[OFF] Rescue triggered: low confidence score');
    return true;
  }
  
  return false;
}


function buildProductCorpus(product) {
  const fields = [product?.product_name, product?.brands];
  if (Array.isArray(product?.brands_tags)) fields.push(product.brands_tags.join(' '));
  if (Array.isArray(product?.labels_tags)) fields.push(product.labels_tags.join(' '));
  if (Array.isArray(product?.categories_tags)) fields.push(product.categories_tags.join(' '));
  return normalizeForMatch(fields.filter(Boolean).join(' '));
}

function findFirstMatch(products, predicate) {
  for (const product of products) {
    if (predicate(product)) return product;
  }
  return null;
}

function toConfidence({ brandMatch, tokenMatch, hasNutrients }) {
  if (brandMatch && tokenMatch) return 0.95;
  if (brandMatch) return 0.9;
  if (tokenMatch) return 0.85;
  if (hasNutrients) return 0.75;
  return DEFAULT_CONFIDENCE_FLOOR;
}

export async function resolveOneItemOFF(item, { signal } = {}) {
  if (!item) {
    return { item: null, reason: 'invalid_item' };
  }

  if (REQUIRE_BRAND && !item.off_candidate) {
    return { item, reason: 'skipped_no_brand' };
  }

  if (item?.upc) {
    const code = normalizeUPC(item.upc);
    if (code) {
      try {
        const byCode = await getByBarcode(code, { signal });
        if (byCode && hasUsefulNutriments(byCode)) {
          return { product: byCode, score: 1, confidence: 0.95 };
        }
      } catch (error) {
        console.log('[OFF] Barcode lookup failed', {
          code,
          error: error?.message || 'unknown'
        });
      }
    }
  }

  const searchTerm = buildSearchTerm(item);
  if (!searchTerm) {
    return { item, reason: 'empty_query' };
  }

  const attempts = buildSearchAttempts(item);
  const preferredBrand = normalizeValue(item?.off_brand_filter || item?.brand || item?.brand_normalized || '');
  const variantTokens = collectVariantTokens(item);
  const attemptSummaries = [];
  
  // Объявляем compoundLocal в глобальной области видимости функции
  const compoundLocal = deriveCompoundBlocks(item);

  if (attempts.length > 0) {
    console.log('[OFF] search attempts planned', attempts.map(attempt => ({
      reason: attempt.reason,
      query: attempt.query,
      brand: attempt.brand,
      pageSize: attempt.pageSize,
      filters: attempt.filters || null
    })));
  }

  const debugTokens = [...variantTokens];

  let targetNameNormalized = normalizeValue(item?.name || '');
  if (!targetNameNormalized) targetNameNormalized = normalizeValue(item?.clean_name || '');
  if (!targetNameNormalized) targetNameNormalized = normalizeValue(searchTerm);

  const targetTokenSet = new Set(tokenizeNormalized(targetNameNormalized));
  if (targetTokenSet.size === 0 && Array.isArray(item?.required_tokens)) {
    for (const token of item.required_tokens) {
      tokenizeNormalized(token).forEach(val => targetTokenSet.add(val));
    }
  }

  const negativeTokens = new Set();
  if (Array.isArray(item?.off_neg_tokens)) {
    for (const token of item.off_neg_tokens) {
      const normalized = normalizeNegativeToken(token);
      if (normalized) negativeTokens.add(normalized);
    }
  }

  const productNameMatches = (product) => {
    if (variantTokens.length === 0) return false;
    const multiWordTokens = variantTokens.filter(token => token.includes(' '));
    const tokensToUse = multiWordTokens.length > 0 ? multiWordTokens : variantTokens;
    const names = [];
    if (product?.product_name) names.push(normalizeValue(product.product_name));
    for (const key of Object.keys(product || {})) {
      if (key.startsWith('product_name_') && typeof product[key] === 'string') {
        names.push(normalizeValue(product[key]));
      }
    }
    // Compound: strict gating (используем compoundLocal из evaluateCandidates)
    if (compoundLocal && compoundLocal.forms && compoundLocal.forms.size > 0) {
      const normalizedNames = names.map(n => normalizeValue(n));
      const hasFull = normalizedNames.some(n => Array.from(compoundLocal.forms).some(form => form && n.includes(form)));
      if (hasFull) return true;
      // Require proximity of all roots if no exact form
      const words = Array.from(compoundLocal.words || []);
      if (words.length >= 2) {
        const passesProximity = normalizedNames.some(n => words.every(w => n.includes(w)));
        if (passesProximity) return true;
      }
      // Otherwise do not pass as variant
      return false;
    }
    // Non-compound fallback
    return names.some(name => tokensToUse.some(token => token && name.includes(token)));
  };

  const categoryMatches = (product) => {
    if (variantTokens.length === 0) return false;
    const multiWordTokens = variantTokens.filter(token => token.includes(' '));
    const tokensToUse = multiWordTokens.length > 0 ? multiWordTokens : variantTokens;
    const categories = Array.isArray(product?.categories_tags)
      ? product.categories_tags.map(normalizeValue)
      : [];
    return categories.some(category => tokensToUse.some(token => token && category.includes(token)));
  };

  const isBrandMatch = (product) => {
    const brandName = item?.brand || item?.brand_normalized || item?.off_brand_filter;
    if (!brandName) return false;
    const result = checkBrandMatchWithSynonyms(product, brandName, Array.isArray(item?.brand_synonyms) ? item.brand_synonyms : []);
    
    
    return Boolean(result && result.match);
  };

  const evaluateCandidates = (products, attempt) => {
    if (!Array.isArray(products) || products.length === 0) {
      return {
        success: false,
        failure: { item, reason: 'no_candidates', canonical: attempt.query || searchTerm },
        meta: { totalCandidates: 0, brandMatchCount: 0, tokenMatchCount: 0, candidateRanking: [] }
      };
    }

    const requireBrand = Boolean(preferredBrand && attempt.brand);
    const requireVariant = variantTokens.length > 0;

    // ИНТЕГРИРОВАННАЯ ЛОГИКА: Brand Gate v2 + Attribute Gate + Category Guard
    
    // 1. BRAND GATE V2: строгая фильтрация при известном бренде
    const enforceBrandGate = shouldEnforceBrandGate(item);
    const brandName = item?.brand || item?.brand_normalized || item?.off_brand_filter;
    const gptSynonyms = Array.isArray(item?.brand_synonyms) ? item.brand_synonyms : [];
    
    let brandFilteredProducts = products;
    let brandGateStats = null;
    
    if (enforceBrandGate) {
      const brandGateResult = applyBrandGateV2(products, brandName, gptSynonyms, true);
      brandFilteredProducts = brandGateResult.validCandidates;
      brandGateStats = brandGateResult.stats;
      
      console.log('[OFF] Brand Gate v2 applied', {
        brand: brandName,
        original_count: products.length,
        after_brand_gate: brandFilteredProducts.length,
        blocked: brandGateResult.stats.blocked,
        salvaged: brandGateResult.stats.salvaged
      });
    }
    
    // 2. CATEGORY GUARD: предотвращение конфликтов категорий
    const expectedCategory = item?.canonical_category;
    const expectedFoodForm = item?.food_form;
    const brandKnown = Boolean(brandName);
    
    let categoryFilteredProducts = brandFilteredProducts;
    let categoryGateStats = null;
    
    if (expectedCategory) {
      const categoryGuardResult = applyCategoryGuard(
        brandFilteredProducts, 
        expectedCategory, 
        expectedFoodForm, 
        brandKnown
      );
      categoryFilteredProducts = categoryGuardResult.validCandidates;
      categoryGateStats = categoryGuardResult.stats;
      
      console.log('[OFF] Category Guard applied', {
        expected_category: expectedCategory,
        brand_known: brandKnown,
        original_count: brandFilteredProducts.length,
        after_category_guard: categoryFilteredProducts.length,
        blocked: categoryGuardResult.stats.blocked
      });
    }
    
    // 3. ATTRIBUTE GATE V2: жёсткие/мягкие фильтры через off_attr_avoid + labels_tags
    const avoidedTerms = [
      ...(Array.isArray(item?.off_attr_avoid) ? item.off_attr_avoid : []),
      ...(Array.isArray(item?.off_neg_tokens) ? item.off_neg_tokens : [])
    ].map(term => term.toLowerCase().trim()).filter(Boolean);

    // Фаза А: фильтруем "чистые" кандидаты (без avoided атрибутов)
    const cleanCandidates = categoryFilteredProducts.filter(product => {
      if (avoidedTerms.length === 0) return true;
      
      const productAttrs = extractProductAttributes(product);
      const hasAvoidedAttr = avoidedTerms.some(avoided => 
        productAttrs.some(attr => attr.includes(avoided) || avoided.includes(attr))
      );
      
      if (hasAvoidedAttr) {
        console.log('[ATTRIBUTE_GATE] avoided=' + avoidedTerms.join(',') + ' removed (clean phase)', {
          product_code: product.code,
          product_name: product.product_name,
          avoided_attrs: productAttrs.filter(attr => 
            avoidedTerms.some(avoided => attr.includes(avoided) || avoided.includes(attr))
          )
        });
      }
      
      return !hasAvoidedAttr;
    });

    // Фаза B: если нет чистых кандидатов, разрешаем "грязные" с пониженной уверенностью
    const candidatesToEvaluate = cleanCandidates.length > 0 ? cleanCandidates : categoryFilteredProducts;
    const isCleanPhase = cleanCandidates.length > 0;
    
    if (!isCleanPhase && avoidedTerms.length > 0) {
      console.log('[ATTRIBUTE_GATE] entering dirty phase - avoided attributes allowed with penalty', {
        clean_candidates: cleanCandidates.length,
        total_candidates: categoryFilteredProducts.length,
        avoided_terms: avoidedTerms
      });
    }
    
    console.log('[OFF] Multi-gate filtering summary', {
      original_products: products.length,
      after_brand_gate: brandFilteredProducts.length,
      after_category_guard: categoryFilteredProducts.length,
      after_attribute_gate: candidatesToEvaluate.length,
      avoided_terms: avoidedTerms,
      using_clean_phase: isCleanPhase,
      degraded_selection: !isCleanPhase,
      brand_gate_enforced: enforceBrandGate,
      category_guard_active: Boolean(expectedCategory)
    });

    const candidateInfos = [];

    for (const product of candidatesToEvaluate) {
      const brandMatch = isBrandMatch(product);
      const nameMatch = productNameMatches(product);
      const categoryMatch = categoryMatches(product);
      let tokenMatch = variantTokens.length === 0
        ? Boolean(nameMatch || categoryMatch || brandMatch)
        : Boolean(nameMatch || categoryMatch);
      const names = gatherCandidateNames(product);
      const { bestJaccard, exact, contains } = computeNameMetrics(names, targetNameNormalized, targetTokenSet);
      let negativeMatches = false;
      if (negativeTokens.size > 0) {
        negativeMatches = names.some(name => {
          const tokens = tokenizeNormalized(name);
          return tokens.some(token => negativeTokens.has(token));
        });
      }

      // Check for wanted/avoided attributes
      const wantedAttrs = Array.isArray(item?.off_attr_want) ? item.off_attr_want : [];
      const avoidedAttrs = Array.isArray(item?.off_attr_avoid) ? item.off_attr_avoid : [];
      
      let wantedAttrMatch = false;
      let avoidedAttrMatch = false;
      
      if (wantedAttrs.length > 0 || avoidedAttrs.length > 0) {
        const corpus = buildProductCorpus(product);
        
        for (const attr of wantedAttrs) {
          if (corpus.includes(normalizeValue(attr))) {
            wantedAttrMatch = true;
            break;
          }
        }
        
        for (const attr of avoidedAttrs) {
          if (corpus.includes(normalizeValue(attr))) {
            avoidedAttrMatch = true;
            break;
          }
        }
      }

      let score = 0;
      
      // ОБНОВЛЕННАЯ ЛОГИКА: снижаем бренд-бусты для грязной фазы
      const brandBoostMultiplier = isCleanPhase ? BRAND_BOOST_MULTIPLIER : (BRAND_BOOST_MULTIPLIER * 0.5);
      
      if (brandMatch) {
        // Базовый бонус за бренд (снижен для грязной фазы)
        score += isCleanPhase ? 5 : 2;
        
        // Дополнительный boost для точного совпадения бренда при brand+variant запросах
        if (attempt.brand && variantTokens.length > 0) {
          const boost = 3 * brandBoostMultiplier;
          score += boost;
          console.log('[OFF] Brand boost applied', {
            product_code: product?.code,
            brand_boost: boost,
            phase: isCleanPhase ? 'clean' : 'degraded',
            reason: 'exact_brand_match_with_variant'
          });
        }
      }
      
      if (tokenMatch) score += 4;
      if (nameMatch) score += 1;
      if (categoryMatch) score += 0.5;
      if (exact) score += 3;
      else if (contains) score += 2;
      score += bestJaccard * 3;
      
      // Дополнительный бонус за точное соответствие бренда в названии продукта
      if (brandMatch && product?.product_name) {
        const productNameLower = product.product_name.toLowerCase();
        const originalBrand = item?.brand || '';
        
        // Проверяем различные варианты бренда в названии
        const brandVariants = [
          originalBrand.toLowerCase(),
          originalBrand.toLowerCase().replace(/&/g, '&'), // M&Ms -> M&Ms
          originalBrand.toLowerCase().replace(/&/g, ' and '), // M&Ms -> m and ms
          originalBrand.toLowerCase().replace(/'/g, ''), // M&Ms -> M&Ms
          originalBrand.toLowerCase() + "'s", // M&Ms -> m&ms's
          originalBrand.toLowerCase().replace(/s$/, "'s"), // M&Ms -> m&m's
        ];
        
        const hasBrandInName = brandVariants.some(variant => 
          variant && productNameLower.includes(variant)
        );
        
        if (hasBrandInName) {
          score += 1; // Небольшой бонус за точное соответствие бренда в названии
        }
      }
      
      // DATA-DRIVEN SCORING: популярность и качество данных
      let popularityBonus = 0;
      let dataQualityBonus = 0;
      
      // Популярность через unique_scans_n
      if (product.unique_scans_n && product.unique_scans_n > 10) {
        popularityBonus = Math.log10(product.unique_scans_n) * 0.5;
        score += popularityBonus;
      }
      
      // Качество данных через states_tags
      if (Array.isArray(product.states_tags)) {
        const qualityIndicators = [
          'en:complete',
          'en:nutrition-facts-completed', 
          'en:ingredients-completed',
          'en:photos-validated'
        ];
        
        const completedStates = product.states_tags.filter(
          tag => qualityIndicators.includes(tag)
        ).length;
        
        if (completedStates > 0) {
          dataQualityBonus = completedStates * 0.2;
          score += dataQualityBonus;
        }
      }
      
      if (popularityBonus > 0 || dataQualityBonus > 0) {
        console.log('[SCORING] popularity_bonus=' + popularityBonus.toFixed(1) + ', data_quality_bonus=' + dataQualityBonus.toFixed(1), {
          product_code: product.code,
          unique_scans: product.unique_scans_n,
          completed_states: product.states_tags?.filter(tag => 
            ['en:complete', 'en:nutrition-facts-completed', 'en:ingredients-completed', 'en:photos-validated'].includes(tag)
          ).length || 0
        });
      }
      
      // Attribute scoring
      if (wantedAttrMatch) score += 2; // Boost for wanted attributes
      
      // ЖЁСТКИЙ ШТРАФ: в грязной фазе сильно штрафуем avoided атрибуты
      if (avoidedAttrMatch) {
        const penalty = isCleanPhase ? 3 : 10; // Больше штраф в грязной фазе
        score -= penalty;
        console.log('[OFF] Avoided attribute penalty', {
          product_code: product?.code,
          penalty: penalty,
          phase: isCleanPhase ? 'clean' : 'degraded'
        });
      }
      
      // Soft-negatives для chocolate: если совпал вариант cookies & creme, негативы про шоколад -> штраф, не бан
      if (negativeMatches) {
        const hasCookiesCremeVariant = variantTokens.some(v => /cookies?\s*(?:&|and|n|'n')\s*(?:creme|cream|crème)/.test(v));
        const isChocolateNeg = Array.from(negativeTokens).some(t => /(white|milk|dark)\s+chocolate/.test(t));
        if (hasCookiesCremeVariant && isChocolateNeg) {
          score -= Math.max(1, Math.floor(NEGATIVE_TOKEN_PENALTY / 2)); // мягкий штраф
        } else {
          score -= NEGATIVE_TOKEN_PENALTY;
        }
      }

      // Negative relaxation: if no variant passed anywhere and many brand candidates exist, relax generic negatives
      // This is applied later at selection time; here we just record flags
      
      // Общий штраф за грязную фазу
      if (!isCleanPhase) {
        score *= 0.7; // 30% штраф за использование "грязных" кандидатов
      }
      
      // CATEGORY SCORING: интегрируем категорийные бонусы/штрафы
      score = applyCategoryScoring(score, product);

      // COMPOUND GUARD V2: Строгий вариант-матч с GPT токенами
      // Используем уже объявленный compoundLocal из строки 1197
      let compoundFull = false;
      let compoundPartial = false;
      let variantPassed = false;
      
      if (COMPOUND_MATCHER_V11 && compoundLocal && compoundLocal.canonical) {
        // Используем GPT токены: off_primary_tokens + off_alt_tokens
        const primaryTokens = Array.isArray(item?.off_primary_tokens) ? item.off_primary_tokens : [];
        const altTokens = Array.isArray(item?.off_alt_tokens) ? item.off_alt_tokens : [];
        
        // Expand search corpus: names + categories + labels
        const extendedCorpus = [
          ...names.map(n => normalizeCompoundSeparators(n)),
          ...(Array.isArray(product?.categories_tags) ? product.categories_tags.map(c => normalizeCompoundSeparators(c)) : []),
          ...(Array.isArray(product?.labels_tags) ? product.labels_tags.map(l => normalizeCompoundSeparators(l)) : [])
        ];
        
        const compoundPhrase = compoundLocal.canonical;
        const roots = compoundLocal.roots || [];
        
        // 1. Проверяем точные формы compound (peanut butter / peanut-butter / peanutbutter)
        const compoundVariants = [
          compoundPhrase,
          compoundPhrase.replace(/\s+/g, '-'),
          compoundPhrase.replace(/\s+/g, ''),
          compoundPhrase.replace(/\s+/g, ' and '),
          ...primaryTokens,
          ...altTokens
        ].map(v => normalizeCompoundSeparators(v));
        
        compoundFull = extendedCorpus.some(text => 
          compoundVariants.some(variant => text.includes(variant))
        );
        
        if (compoundFull) {
          variantPassed = true;
          if (PHASE_SUMMARY_LOGS) {
            console.log('[COMPOUND_GUARD] phrase="' + compoundPhrase + '" full_match bonus=' + COMPOUND_FULL_BONUS);
          }
        } else if (roots.length >= 2) {
          // 2. Проверяем proximity: оба корня рядом (окно ≤3 слов)
          const windowSize = 3;
          const proximityMatch = extendedCorpus.some(text => {
            return checkCompoundWithinWindow(text, roots, windowSize);
          });
          
          if (proximityMatch) {
            compoundFull = true;
            variantPassed = true;
            if (PHASE_SUMMARY_LOGS) {
              console.log('[COMPOUND_GUARD] phrase="' + compoundPhrase + '" proximity_match bonus=' + COMPOUND_FULL_BONUS);
            }
          } else {
            // 3. Частичное совпадение - только один токен найден
            const allCorpusText = extendedCorpus.join(' ');
            const foundRoots = roots.filter(root => {
              const equivalents = expandCompoundEquivalents(root);
              return equivalents.some(equiv => allCorpusText.includes(equiv));
            });
            
            if (foundRoots.length > 0 && foundRoots.length < roots.length) {
              // Частичное совпадение - penalty, НЕ variant_passed
              compoundPartial = true;
              variantPassed = false;
              if (PHASE_SUMMARY_LOGS) {
                console.log('[COMPOUND_GUARD] phrase="' + compoundPhrase + '" partial_penalty=' + COMPOUND_PARTIAL_PENALTY);
              }
            }
          }
        }
        
        // Обновляем tokenMatch для compound сценариев
        if (variantPassed) {
          tokenMatch = true;
        }
      } else if (compoundLocal && compoundLocal.forms && compoundLocal.forms.size > 0) {
        // Fallback to old logic if v1.1 disabled
        const normalizedNames = names.map(n => normalizeValue(n));
        compoundFull = normalizedNames.some(n => Array.from(compoundLocal.forms).some(f => n.includes(f)));
        if (!compoundFull) {
          const words = Array.from(compoundLocal.words || []);
          const count = words.length;
          const needed = Math.max(2, Math.ceil(count / 2));
          const containsCount = (n) => words.filter(w => n.includes(w)).length;
          compoundPartial = normalizedNames.some(n => containsCount(n) >= needed);
        }
      }

      // COMPOUND GUARD V2: Scoring adjustments
      if (compoundLocal && (compoundFull || compoundPartial)) {
        if (compoundFull && variantPassed) {
          score += COMPOUND_FULL_BONUS;
          // Логирование уже выполнено выше
        } else if (compoundPartial && !variantPassed) {
          // Частичное совпадение - penalty
          score -= COMPOUND_PARTIAL_PENALTY;
          // Логирование уже выполнено выше
        }
      }

      // v1.2: Update tokenMatch to include compound matches for variant_passed
      const enhancedTokenMatch = tokenMatch || compoundFull || (compoundPartial && compoundLocal && compoundLocal.roots && compoundLocal.roots.length >= 2);
      
      candidateInfos.push({
        product,
        brandMatch,
        nameMatch,
        categoryMatch,
        tokenMatch: enhancedTokenMatch,
        nameSimilarity: bestJaccard,
        exactMatch: exact,
        containsTarget: contains,
        negativeMatch: negativeMatches,
        wantedAttrMatch,
        avoidedAttrMatch,
        compoundFull,
        compoundPartial,
        score
      });
    }

    if (candidateInfos.length === 0) {
      return {
        success: false,
        failure: { item, reason: 'no_candidates', canonical: attempt.query || searchTerm },
        meta: { totalCandidates: 0, brandMatchCount: 0, tokenMatchCount: 0, candidateRanking: [] }
      };
    }

    const sortedCandidates = [...candidateInfos].sort((a, b) => b.score - a.score);
    const overallTop = sortedCandidates.slice(0, 5).map(info => ({
      code: info.product?.code || null,
      score: Number(info.score.toFixed(3)),
      brand: info.brandMatch,
      variant: info.tokenMatch,
      name_similarity: Number(info.nameSimilarity.toFixed(3)),
      negative_penalty: info.negativeMatch
    }));

    const brandMatchCount = candidateInfos.filter(info => info.brandMatch).length;
    const tokenMatchCount = candidateInfos.filter(info => info.tokenMatch).length;

    const brandEligible = candidateInfos.filter(info => !requireBrand || info.brandMatch);
    if (brandEligible.length === 0) {
      return {
        success: false,
        failure: { item, reason: 'brand_mismatch', canonical: attempt.query || searchTerm },
        meta: {
          totalCandidates: candidateInfos.length,
          brandMatchCount,
          tokenMatchCount,
          candidateRanking: overallTop
        }
      };
    }

    // Brand-first degrade: если бренд совпал, но вариант нет – берём лучший бренд-кандидат вместо no_candidates
    const variantEligible = brandEligible.filter(info => !requireVariant || info.tokenMatch);
    if (variantEligible.length === 0) {
      // State machine: compound scenario must have variant_passed=true to finalize
      const compound = deriveCompoundBlocks(item);
      const isCompound = isCompoundScenario(compound);
      const currentPhase = getAttemptPhase(attempt);
      
      if (PHASED_SM && isCompound && getAttemptPhase(attempt) !== Phase.DEGRADE) {
        console.log('[PHASE_SM] compound scenario requires variant_passed, continuing search', {
          phase: currentPhase,
          brand_matches: brandEligible.length,
          variant_matches: 0
        });
        return {
          success: false,
          failure: { item, reason: 'no_variant', canonical: attempt.query || searchTerm },
          meta: {
            totalCandidates: candidateInfos.length,
            brandMatchCount,
            tokenMatchCount,
            candidateRanking: overallTop
          }
        };
      }
      // Negative relaxation: convert generic negatives to soft when brand candidates are many
      // Only allowed in DEGRADE phase
      const genericNegatives = ['chocolate', 'bar', 'candy'];
      const brandCount = brandEligible.length;
      if (brandCount >= 3 && (!PHASED_SM || getAttemptPhase(attempt) === Phase.DEGRADE)) {
        console.log('[NEGATIVE_RELAX] applying soft negatives for generic tokens', { tokens: genericNegatives });
        const relaxed = brandEligible.map(info => {
          const corpus = buildProductCorpus(info.product);
          const hits = genericNegatives.some(t => corpus.includes(normalizeValue(t)));
          const adjusted = { ...info };
          if (hits && info.negativeMatch) {
            adjusted.negativeMatch = false;
            adjusted.score = adjusted.score + Math.max(1, Math.floor(NEGATIVE_TOKEN_PENALTY / 2));
          }
          return adjusted;
        });
        const resorted = [...relaxed].sort((a, b) => b.score - a.score);
        const eligibleTop = resorted.slice(0, 5).map(info => ({
          code: info.product?.code || null,
          score: Number(info.score.toFixed(3)),
          brand: info.brandMatch,
          variant: info.tokenMatch,
          name_similarity: Number(info.nameSimilarity.toFixed(3)),
          negative_penalty: info.negativeMatch
        }));
        const bestRelaxed = resorted[0];
        return {
          success: true,
          selection: {
            product: bestRelaxed.product,
            brandMatch: true,
            tokenMatch: false,
            hasNutrients: hasUsefulNutriments(bestRelaxed.product),
            nameSimilarity: bestRelaxed.nameSimilarity,
            exactMatch: bestRelaxed.exactMatch,
            containsTarget: bestRelaxed.containsTarget,
            negativeMatch: bestRelaxed.negativeMatch,
            score: bestRelaxed.score,
            insightReason: 'brand_first_degrade_with_negative_relax'
          },
          meta: {
            totalCandidates: candidateInfos.length,
            brandMatchCount,
            tokenMatchCount,
            brandEligibleCount: relaxed.length,
            variantEligibleCount: 0,
            candidateRanking: eligibleTop
          }
        };
      }
      // Form-aware degrade: cluster by form
      const getFormCluster = (product) => {
        const corpus = buildProductCorpus(product);
        if (/(bar|tablet|tableta|tab|barra)/.test(corpus)) return 'bar';
        if (/(gumm(y|ies)|gelat|chew)/.test(corpus)) return 'gummies';
        if (/(pieces|candy|bites|drops)/.test(corpus)) return 'candy';
        if (/(drink|beverage|soda|milkshake)/.test(corpus)) return 'beverage';
        if (/(spread|butter|paste|puree)/.test(corpus)) return 'spread';
        return 'unknown';
      };
      const expectedCluster = getFormCluster(findFirstMatch(products, () => true) || {});
      let filtered = brandEligible;
      if (expectedCluster !== 'unknown') {
        filtered = brandEligible.filter(i => getFormCluster(i.product) === expectedCluster);
        if (filtered.length === 0) {
          console.log('[DEGRADE_BLOCKED_BY_FORM]', { expected: expectedCluster });
          // продлеваем поиск вместо деградации по форме
          return {
            success: false,
            failure: { item, reason: 'variant_mismatch', canonical: attempt.query || searchTerm },
            meta: {
              totalCandidates: candidateInfos.length,
              brandMatchCount,
              tokenMatchCount,
              candidateRanking: overallTop
            }
          };
        }
      }
      const brandOnlySorted = [...filtered].sort((a, b) => b.score - a.score);
      if (brandOnlySorted.length > 0) {
        const bestBrandOnly = brandOnlySorted[0];
        const eligibleTop = brandOnlySorted.slice(0, 5).map(info => ({
          code: info.product?.code || null,
          score: Number(info.score.toFixed(3)),
          brand: info.brandMatch,
          variant: info.tokenMatch,
          name_similarity: Number(info.nameSimilarity.toFixed(3)),
          negative_penalty: info.negativeMatch
        }));
        console.log('[OFF] BRAND-FIRST DEGRADE applied: variant mismatch, selecting best brand candidate');
        return {
          success: true,
          selection: {
            product: bestBrandOnly.product,
            brandMatch: true,
            tokenMatch: false,
            hasNutrients: hasUsefulNutriments(bestBrandOnly.product),
            nameSimilarity: bestBrandOnly.nameSimilarity,
            exactMatch: bestBrandOnly.exactMatch,
            containsTarget: bestBrandOnly.containsTarget,
            negativeMatch: bestBrandOnly.negativeMatch,
            score: bestBrandOnly.score,
            insightReason: 'brand_first_degrade'
          },
          meta: {
            totalCandidates: candidateInfos.length,
            brandMatchCount,
            tokenMatchCount,
            brandEligibleCount: brandEligible.length,
            variantEligibleCount: 0,
            candidateRanking: eligibleTop
          }
        };
      }
      return {
        success: false,
        failure: { item, reason: 'variant_mismatch', canonical: attempt.query || searchTerm },
        meta: {
          totalCandidates: candidateInfos.length,
          brandMatchCount,
          tokenMatchCount,
          candidateRanking: overallTop
        }
      };
    }

    const sortedEligible = [...variantEligible].sort((a, b) => b.score - a.score);
    // Compound degrade logging (используем compoundLocal из evaluateCandidates)
    if (compoundLocal) {
      const fullCount = sortedEligible.filter(i => i.compoundFull).length;
      const partialCount = sortedEligible.filter(i => i.compoundPartial && !i.compoundFull).length;
      console.log('[COMPOUND_GUARD] blocks', { blocks: [compoundLocal.canonical], full: fullCount, partial: partialCount });
    }
    
    // CLEAN-FIRST ВЫБОР: приоритет кандидатам без avoided атрибутов
    let best = null;
    
    if (isCleanPhase) {
      // В чистой фазе выбираем лучший без негативных совпадений
      if (compoundLocal) {
        best = sortedEligible.find(i => i.compoundFull && !i.negativeMatch) ||
               sortedEligible.find(i => i.compoundFull) ||
               sortedEligible.find(info => !info.negativeMatch && info.brandMatch) || 
               sortedEligible.find(info => !info.negativeMatch) || 
               sortedEligible[0];
      } else {
        best = sortedEligible.find(info => !info.negativeMatch && info.brandMatch) || 
               sortedEligible.find(info => !info.negativeMatch) || 
               sortedEligible[0];
      }
    } else {
      // В грязной фазе предупреждаем о деградации
      if (compoundLocal) {
        const anyFull = sortedEligible.some(i => i.compoundFull);
        const anyPartial = sortedEligible.some(i => i.compoundPartial);
        if (!anyFull && anyPartial) {
          best = sortedEligible.find(i => i.compoundPartial) || sortedEligible[0];
          console.log('[COMPOUND_GUARD] degrade_to_partial');
        } else {
          best = sortedEligible[0];
        }
      } else {
        best = sortedEligible[0];
      }
      console.log('[OFF] DEGRADED SELECTION WARNING', {
        product_code: best?.product?.code,
        reason: 'no_clean_candidates_available',
        avoided_terms: avoidedTerms,
        confidence_penalty: 'applied'
      });
    }
    
    const hasNutrients = hasUsefulNutriments(best.product);
    const insightReason = determineSelectionReason(best);
    
    // Добавляем метаданные о фазе отбора
    const selectionMeta = {
      selection_phase: isCleanPhase ? 'clean' : 'degraded',
      avoided_terms_count: avoidedTerms.length,
      clean_candidates_available: cleanCandidates.length,
      degraded_pick: !isCleanPhase
    };
    const eligibleTop = sortedEligible.slice(0, 5).map(info => ({
      code: info.product?.code || null,
      score: Number(info.score.toFixed(3)),
      brand: info.brandMatch,
      variant: info.tokenMatch,
      name_similarity: Number(info.nameSimilarity.toFixed(3)),
      negative_penalty: info.negativeMatch
    }));

    return {
      success: true,
      selection: {
        product: best.product,
        brandMatch: best.brandMatch,
        tokenMatch: best.tokenMatch,
        hasNutrients,
        nameSimilarity: best.nameSimilarity,
        exactMatch: best.exactMatch,
        containsTarget: best.containsTarget,
        negativeMatch: best.negativeMatch,
        score: best.score,
        insightReason
      },
      meta: {
        totalCandidates: candidateInfos.length,
        brandMatchCount,
        tokenMatchCount,
        brandEligibleCount: brandEligible.length,
        variantEligibleCount: variantEligible.length,
        candidateRanking: eligibleTop
      }
    };
  };

  let selected = null;
  let selectedMeta = null;
  let selectedAttempt = null;
  let lastFailure = null;
  
  // Phase summary logging
  const loggedPhrases = new Set(); // For dedup
  let currentPhase = null;
  let phaseResults = { brand_passed: 0, variant_passed: 0, candidates: [] };

  for (const attempt of attempts) {
    try {
      const seenCodes = new Set();
      const aggregated = [];
      let aggregatedCount = 0;
      let pagesUsed = 0;
      let successThisAttempt = false;
      
      // Phase tracking for summary logs
      const attemptPhase = getAttemptPhase(attempt);
      if (PHASE_SUMMARY_LOGS && currentPhase !== attemptPhase) {
        if (currentPhase && phaseResults.candidates.length > 0) {
          console.log(`[PHASE_END ${currentPhase}] variant_passed=${phaseResults.variant_passed} brand_passed=${phaseResults.brand_passed} next=${attemptPhase}`);
          console.log(`Top: ${phaseResults.candidates.slice(0, 5).map(c => `${c.code}(${c.brand ? '+' : '-'}brand ${c.variant ? '+' : '-'}variant)`).join(', ')}`);
          if (phaseResults.variant_passed === 0) {
            console.log('Reasons: no_variant');
          }
        }
        currentPhase = attemptPhase;
        phaseResults = { brand_passed: 0, variant_passed: 0, candidates: [] };
      }

      // Определяем динамическую глубину поиска
      const hasVariantTokens = Array.isArray(debugTokens) && debugTokens.length > 1;
      const maxPages = getDynamicSearchDepth(attempt, hasVariantTokens);
      
      for (let page = 1; page <= maxPages; page += 1) {
        const response = await searchWithRetry(attempt.query, {
          brand: attempt.brand,
          locale: item?.locale || null,
          page,
          pageSize: attempt.pageSize,
          filters: attempt.filters
        }, signal);

        pagesUsed = page;
        const products = Array.isArray(response?.products) ? response.products : [];
        const pageCodes = products.map(prod => prod?.code).filter(Boolean).slice(0, 10);
        const responseCount = Number(response?.count);
        if (Number.isFinite(responseCount) && responseCount > aggregatedCount) {
          aggregatedCount = responseCount;
        }

        for (const prod of products) {
          const code = typeof prod?.code === 'string' ? prod.code : null;
          if (code && seenCodes.has(code)) continue;
          if (code) seenCodes.add(code);
          aggregated.push(prod);
        }

        // Проверяем, стоит ли продолжать поиск на основе качества результатов
        if (!shouldContinueSearch(aggregated, page, maxPages, attempt)) {
          console.log('[OFF] Early termination: sufficient quality results found', {
            page,
            aggregated: aggregated.length,
            reason: 'quality_threshold_met'
          });
          break;
        }

        console.log('[OFF] detailed candidate analysis', {
          attempt: attempt.reason,
          page,
          looking_for_tokens: debugTokens,
          candidates: products.slice(0, 3).map(prod => {
            const corpus = buildProductCorpus(prod);

            return {
              code: prod?.code,
              name: prod?.product_name,
              corpus_normalized: corpus,
              contains_tokens: debugTokens.map(token => ({
                token,
                found_in_corpus: corpus.includes(normalizeValue(token))
              })),
              why_status: debugTokens.some(token => corpus.includes(normalizeValue(token))) ? 'should_match' : 'no_token_match'
            };
          })
        });

        const evaluation = evaluateCandidates(aggregated, attempt);
        
        // Update phase results for summary logging
        if (PHASE_SUMMARY_LOGS && evaluation.meta) {
          phaseResults.brand_passed = Math.max(phaseResults.brand_passed, evaluation.meta.brandMatchCount || 0);
          phaseResults.variant_passed = Math.max(phaseResults.variant_passed, evaluation.meta.tokenMatchCount || 0);
          if (evaluation.meta.candidateRanking) {
            phaseResults.candidates = evaluation.meta.candidateRanking.slice(0, 5);
          }
        }

        // Server brand guard: retry without brand_filter if many brands but no variant_passed
        if (!evaluation.success && SERVER_BRAND_GUARD && attempt.brand && 
            evaluation.failure?.reason === 'variant_mismatch' && 
            evaluation.meta?.brandMatchCount > 0 && evaluation.meta?.tokenMatchCount === 0) {
          console.log('[SERVER_BRAND_GUARD] retrying without server brand_filter', {
            attempt: attempt.reason,
            brand_matches: evaluation.meta.brandMatchCount,
            variant_matches: evaluation.meta.tokenMatchCount
          });
          
          try {
            const retryResponse = await searchWithRetry(attempt.query, {
              brand: null, // Remove server brand_filter
              locale: item?.locale || null,
              page: 1,
              pageSize: attempt.pageSize,
              filters: null
            }, signal);
            
            const retryProducts = Array.isArray(retryResponse?.products) ? retryResponse.products : [];
            if (retryProducts.length > 0) {
              const retryEvaluation = evaluateCandidates(retryProducts, { ...attempt, brand: null });
              if (retryEvaluation.success && retryEvaluation.selection?.tokenMatch) {
                console.log('[SERVER_BRAND_GUARD] retry successful', {
                  code: retryEvaluation.selection.product?.code,
                  variant_match: retryEvaluation.selection.tokenMatch
                });
                // Use retry result instead
                selected = retryEvaluation.selection;
                selectedMeta = retryEvaluation.meta;
                selectedAttempt = { ...attempt, reason: `${attempt.reason}_no_server_filter` };
                successThisAttempt = true;
              }
            }
          } catch (retryError) {
            console.log('[SERVER_BRAND_GUARD] retry failed', { error: retryError.message });
          }
        }

        if (evaluation.success) {
          const successLog = {
            attempt: attempt.reason,
            page,
            aggregated_candidates: aggregated.length,
            brand_passed: evaluation.meta?.brandMatchCount ?? 0,
            variant_passed: evaluation.meta?.tokenMatchCount ?? 0,
            result_code: evaluation.selection?.product?.code || null,
            ranking: evaluation.meta?.candidateRanking || [],
            page_codes: pageCodes
          };
          console.log('[OFF] page result', successLog);
          selected = evaluation.selection;
          selectedMeta = evaluation.meta;
          selectedAttempt = attempt;
          successThisAttempt = true;
          
          const shouldFinalize = Boolean(
            evaluation.selection?.exactMatch
            || (evaluation.selection?.nameSimilarity ?? 0) >= NAME_SIMILARITY_THRESHOLD
            || (evaluation.selection?.brandMatch && evaluation.selection?.containsTarget)
            || (evaluation.selection?.brandMatch && evaluation.selection?.tokenMatch && evaluation.selection?.compoundFull)
            || (evaluation.selection?.brandMatch && evaluation.selection?.tokenMatch && evaluation.selection?.score > 20)
          );
          
          // For split-OR queries, also finalize if we found a good candidate without negative matches
          const isSplitOrSuccess = attempt.isSplitOr && !evaluation.selection?.negativeMatch && evaluation.selection?.score > 3;
          
          if (shouldFinalize || isSplitOrSuccess) {
            if (isSplitOrSuccess) {
              console.log('[OFF] Split-OR early success - good candidate found without penalties');
            }
            break;
          }
        } else {
          lastFailure = evaluation.failure;

          console.log('[OFF] page result', {
            attempt: attempt.reason,
            page,
            aggregated_candidates: aggregated.length,
            brand_passed: evaluation.meta?.brandMatchCount ?? 0,
            variant_passed: evaluation.meta?.tokenMatchCount ?? 0,
            next_page: page < MAX_SEARCH_PAGES ? page + 1 : null,
            reason: evaluation.failure?.reason || null,
            ranking: evaluation.meta?.candidateRanking || [],
            page_codes: pageCodes
          });
        }

        const pageSizeUsed = Number(response?.page_size) || attempt.pageSize || null;
        const noMorePages = (pageSizeUsed && products.length < pageSizeUsed)
          || (aggregatedCount > 0 && pageSizeUsed && page * pageSizeUsed >= aggregatedCount);

        if (noMorePages) {
          break;
        }
      }

      if (successThisAttempt) {
        attemptSummaries.push({
          attempt: attempt.reason,
          query: attempt.query,
          brand: attempt.brand,
          result: `success_pages_${pagesUsed}`
        });
        
        // For split-OR queries, break early if we found an excellent candidate
        const isExcellentSplitOrResult = attempt.isSplitOr && selected && 
          !selected.negativeMatch && selected.score > 5 && selected.nameSimilarity > 0.7;
        
        if (isExcellentSplitOrResult) {
          console.log('[OFF] Excellent split-OR result found, skipping remaining attempts');
          break;
        }
        
        // Always break for non-split-OR successful attempts
        if (!attempt.isSplitOr) {
          break;
        }
      }

      if (aggregated.length === 0) {
        attemptSummaries.push({ attempt: attempt.reason, query: attempt.query, brand: attempt.brand, result: 'no_hits' });
      } else {
        attemptSummaries.push({
          attempt: attempt.reason,
          query: attempt.query,
          brand: attempt.brand,
          result: `exhausted_pages_${pagesUsed}_candidates_${aggregated.length}`
        });
      }
    } catch (error) {
      attemptSummaries.push({ attempt: attempt.reason, query: attempt.query, brand: attempt.brand, result: error?.message || 'unknown_error' });
      lastFailure = { item, reason: 'http_or_json_error', canonical: attempt.query || searchTerm, error: error?.message };
    }
  }

  if (attemptSummaries.length > 1) {
    console.log('[OFF] search attempts summary', {
      total_attempts: attemptSummaries.length,
      attempts: attemptSummaries,
      selected: selectedAttempt?.reason || null
    });
  }

  if (!selected) {
    if (lastFailure) {
      console.log('[OFF] all search attempts failed', { attempts: attemptSummaries, canonical: searchTerm, last_reason: lastFailure.reason || null });
      return lastFailure;
    }
    console.log('[OFF] all search attempts failed', { attempts: attemptSummaries, canonical: searchTerm, last_reason: null });
    return { item, reason: 'no_hits', canonical: searchTerm };
  }

  // RESCUE QUERIES: Check if we need to trigger rescue search
  if (shouldTriggerRescue(selected, selectedMeta)) {
    const rescueAttempts = buildRescueAttempts(item, attempts);
    
    if (rescueAttempts.length > 0) {
      try {
        let bestRescue = null;
        let bestRescueMeta = null;
        let bestRescueAttempt = null;
        
        console.log('[OFF] Starting rescue search with', rescueAttempts.length, 'rescue attempts');
        
        for (const rescueAttempt of rescueAttempts) {
          try {
            console.log('[OFF] Rescue attempt:', {
              reason: rescueAttempt.reason,
              query: rescueAttempt.query,
              brand: rescueAttempt.brand,
              fallback_phrase: rescueAttempt.fallbackPhrase
            });
            
            if (rescueAttempt.reason === 'rescue_gpt_fallback') {
              console.log('[RESCUE] GPT_fallback phrase="' + rescueAttempt.fallbackPhrase + '"', {
                brand_form: rescueAttempt.query.split('"')[1],
                fallback_phrase: rescueAttempt.fallbackPhrase
              });
            }
            
            const seenCodes = new Set();
            const aggregated = [];
            let pagesUsed = 0;
            
            // Use extended page limit for rescue
            const maxRescuePages = Math.min(MAX_SEARCH_PAGES + RESCUE_EXTRA_PAGES, 8);
            
            for (let page = 1; page <= maxRescuePages; page += 1) {
              const response = await searchWithRetry(rescueAttempt.query, {
                brand: rescueAttempt.brand,
                locale: item?.locale || null,
                page,
                pageSize: rescueAttempt.pageSize,
                filters: rescueAttempt.filters
              }, signal);
              
              pagesUsed = page;
              const products = Array.isArray(response?.products) ? response.products : [];
              
              for (const prod of products) {
                const code = typeof prod?.code === 'string' ? prod.code : null;
                if (code && seenCodes.has(code)) continue;
                if (code) seenCodes.add(code);
                aggregated.push(prod);
              }
              
              // Early termination if we have enough candidates
              if (aggregated.length >= MAX_PRODUCTS_CONSIDERED) break;
              
              const pageSizeUsed = Number(response?.page_size) || rescueAttempt.pageSize || null;
              const noMorePages = (pageSizeUsed && products.length < pageSizeUsed);
              if (noMorePages) break;
            }
            
            // Evaluate rescue candidates using the same logic
            const evaluation = evaluateCandidates(aggregated, rescueAttempt);
            
            if (evaluation.success) {
              const candidate = evaluation.selection;
              
              // Accept rescue candidate if it's better (no negative matches or higher score)
              if (!candidate.negativeMatch || (bestRescue && candidate.score > bestRescue.score)) {
                bestRescue = candidate;
                bestRescueMeta = evaluation.meta;
                bestRescueAttempt = rescueAttempt;
                
                console.log('[OFF] Rescue candidate found:', {
                  attempt: rescueAttempt.reason,
                  code: candidate.product?.code,
                  score: candidate.score,
                  negative_match: candidate.negativeMatch,
                  pages_used: pagesUsed
                });
                
                // If we found a clean candidate, stop rescue search
                if (!candidate.negativeMatch) {
                  break;
                }
              }
            }
          } catch (error) {
            console.log('[OFF] Rescue attempt failed:', rescueAttempt.reason, error.message);
            continue;
          }
        }
        
        // Use rescue result if it's better than original
        if (bestRescue && (!bestRescue.negativeMatch || bestRescue.score > selected.score)) {
          console.log('[OFF] Using rescue result instead of original:', {
            original_score: selected.score,
            original_negative: selected.negativeMatch,
            rescue_score: bestRescue.score,
            rescue_negative: bestRescue.negativeMatch
          });
          
          selected = bestRescue;
          selectedMeta = bestRescueMeta;
          selectedAttempt = bestRescueAttempt;
        } else {
          console.log('[OFF] Rescue search completed but original candidate is still better');
        }
        
      } catch (rescueError) {
        console.log('[OFF] Rescue search failed:', rescueError.message);
        // Continue with original selected candidate
      }
    }
  }

  const finalConfidence = toConfidence({
    brandMatch: selected.brandMatch,
    tokenMatch: selected.tokenMatch,
    hasNutrients: selected.hasNutrients
  });

  console.log('[OFF] selected candidate', {
    attempt: selectedAttempt?.reason || null,
    code: selected.product?.code || null,
    name: selected.product?.product_name || null,
    brandMatch: selected.brandMatch,
    tokenMatch: selected.tokenMatch,
    nameSimilarity: Number((selected.nameSimilarity || 0).toFixed(3)),
    reason: selected.insightReason,
    confidence: Number(finalConfidence.toFixed(3)),
    ranking: selectedMeta?.candidateRanking || []
  });

  return {
    product: selected.product,
    score: selected.brandMatch || selected.tokenMatch ? 1 : 0.5,
    confidence: finalConfidence
  };
}

export function scalePerPortionOFF(prod, grams) {
  const per100 = mapOFFProductToPer100g(prod);
  const k = grams / 100;
  const round = (n, d = 0) => {
    const m = 10 ** d;
    return Math.round((n + Number.EPSILON) * m) / m;
  };
  return {
    calories: round((per100.ENERC_KCAL || 0) * k),
    protein_g: round((per100.PROCNT || 0) * k, 1),
    fat_g: round((per100.FAT || 0) * k, 1),
    carbs_g: round((per100.CHOCDF || 0) * k, 1),
    fiber_g: round((per100.FIBTG || 0) * k, 1),
    meta: per100.meta,
    serving_size_label: per100.serving_size
  };
}
