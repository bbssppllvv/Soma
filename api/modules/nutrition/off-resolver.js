import { getByBarcode, searchByNameV1, canonicalizeQuery } from './off-client.js';
import { mapOFFProductToPer100g } from './off-map.js';
import { getCachedOffProduct, upsertOffProduct } from './off-supabase-cache.js';
import { isVariantToken } from './variant-rules.js';
import { BRAND_ACCEPT_SCORE, CATEGORY_POSITIVE_HINTS, OFF_BUDGET_MS, REQUIRE_BRAND } from './off/constants.js';
import { collectBrandSearchVariants, buildBrandContext, computeBrandScore } from './off/brand.js';
import { deriveCategoryFilters } from './off/categories.js';
import { hasUsefulNutriments } from './off/nutrients.js';
import { scoreProduct } from './off/scoring.js';
import { limitTokens, normalizeForMatch } from './off/text.js';

function buildVariantWhitelistTokens(item) {
  if (!Array.isArray(item?.required_tokens)) return [];
  const normalized = item.required_tokens
    .filter(token => isVariantToken(token))
    .map(token => canonicalizeQuery(token))
    .filter(Boolean);
  return [...new Set(normalized)];
}

function buildNameContext(cleanName, brandName, variantWhitelistTokens) {
  const brandTokens = brandName
    ? new Set(brandName.replace(/[-_]/g, ' ').split(/\s+/).filter(Boolean))
    : null;
  const cleanTokens = cleanName ? cleanName.split(' ') : [];
  let nameWithoutBrand = cleanTokens.filter(token => !brandTokens || !brandTokens.has(token)).join(' ');
  if (!nameWithoutBrand && cleanName) {
    nameWithoutBrand = cleanName;
  }

  const variantWordSet = new Set();
  for (const token of variantWhitelistTokens) {
    const parts = canonicalizeQuery(token).split(' ').filter(Boolean);
    for (const part of parts) {
      variantWordSet.add(part);
    }
  }

  const nameTokens = new Set(
    cleanTokens
      .filter(Boolean)
      .filter(token => !brandTokens || !brandTokens.has(token))
      .filter(token => !variantWordSet.has(token))
  );

  if (nameTokens.size === 0) {
    cleanTokens.filter(Boolean).forEach(token => nameTokens.add(token));
  }

  const limitedProductTerm = limitTokens(nameWithoutBrand);
  const limitedCleanTerm = limitTokens(cleanName);

  return {
    brandTokens,
    nameTokens,
    nameWithoutBrand,
    limitedProductTerm,
    limitedCleanTerm
  };
}

function buildSearchStrategies({ brandVariants, limitedProductTerm, limitedCleanTerm, brandName, variantWhitelistTokens }) {
  const strategies = [];
  const seen = new Set();

  const pushStrategy = (termValue, brandValue, strategy) => {
    if (!termValue) return;
    const limitedTerm = limitTokens(termValue);
    if (!limitedTerm) return;
    const normalizedBrand = brandValue ? limitTokens(brandValue) : null;
    const key = `${limitedTerm}::${normalizedBrand || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    strategies.push({ term: limitedTerm, brand: normalizedBrand, strategy });
  };

  if (brandVariants.length > 0 && limitedProductTerm) {
    brandVariants.slice(0, 3).forEach((variant, idx) => {
      pushStrategy(limitedProductTerm, variant, idx === 0 ? 'brand_primary' : `brand_alt_${idx}`);
    });
  }

  if (variantWhitelistTokens.length > 0 && brandVariants.length > 0) {
    const variantPhrase = variantWhitelistTokens.join(' ');
    brandVariants.slice(0, 2).forEach((variant, idx) => {
      const combined = `${variant} ${variantPhrase}`.trim();
      pushStrategy(combined, variant, idx === 0 ? 'brand_variant_tokens' : `brand_variant_tokens_${idx}`);
    });
  }

  if (brandName) {
    pushStrategy(brandName, brandName, 'brand_only');
  }

  if (limitedCleanTerm) {
    pushStrategy(limitedCleanTerm, null, 'clean_name');
  }

  if (brandName && limitedCleanTerm) {
    pushStrategy(`${brandName} ${limitedCleanTerm}`, brandName, 'brand_plus_clean');
  }

  if (!strategies.length && limitedProductTerm) {
    pushStrategy(limitedProductTerm, null, 'product_only');
  }

  return strategies.slice(0, 4);
}

async function fetchProductBatches(strategies, {
  signal,
  categoryTags,
  negativeCategoryTags,
  locale,
  variantTokens,
  brandContext,
  startedAt
}) {
  const responseBatches = [];

  for (const { term, brand, strategy } of strategies) {
    if (Date.now() - startedAt > OFF_BUDGET_MS) {
      return { responseBatches, timedOut: true };
    }

    const batch = await searchByNameV1(term, {
      signal,
      categoryTags,
      negativeCategoryTags,
      brand,
      maxPages: 1,
      locale,
      variantTokens
    });

    if (Array.isArray(batch?.products) && batch.products.length > 0) {
      console.log(`[OFF] Search strategy '${strategy}' found ${batch.products.length} products`);
      responseBatches.push({ strategy, products: batch.products });

      if (brandContext) {
        const brandScores = batch.products.map(product => {
          const score = computeBrandScore(brandContext, product);
          return { name: product.product_name, brands: product.brands, score: score.score };
        });

        const hasStrongBrand = brandScores.some(s => s.score >= BRAND_ACCEPT_SCORE);
        const maxScore = Math.max(...brandScores.map(s => s.score));

        console.log(`[OFF] Brand scores for '${strategy}': max=${maxScore}, threshold=${BRAND_ACCEPT_SCORE}`);
        console.log(`[OFF] Top brand scores:`, brandScores.slice(0, 3));

        if (hasStrongBrand) {
          console.log(`[OFF] Strategy '${strategy}' produced a strong brand match, stopping search.`);
          break;
        }

        console.log(`[OFF] Strategy '${strategy}' lacks strong brand match, continuing to next strategy.`);
      } else {
        break;
      }
    } else {
      console.log(`[OFF] Search strategy '${strategy}' found no products for term="${term}"`);
    }
  }

  return { responseBatches, timedOut: false };
}

function dedupeProducts(responseBatches) {
  const dedupedProducts = [];
  const seen = new Set();

  for (const { strategy, products } of responseBatches) {
    for (const product of products) {
      const key = product?.code || `${normalizeForMatch(product?.product_name || '')}::${normalizeForMatch(product?.brands || '')}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      dedupedProducts.push({ product, strategy });
    }
  }

  return dedupedProducts;
}

function normalizeUPC(s){ 
  return String(s||'').replace(/[^0-9]/g,''); 
}

export async function resolveOneItemOFF(item, { signal } = {}) {
  // Use clean_name + required_tokens for better search query
  const fullProductName = item.clean_name && item.required_tokens?.length > 0
    ? `${item.clean_name} ${item.required_tokens.join(' ')}`
    : item.name;
  
  const canonicalQuery = canonicalizeQuery(fullProductName);
  
  // COMPREHENSIVE LOGGING for troubleshooting
  console.log(`[OFF] === RESOLVING ITEM START ===`);
  console.log(`[OFF] Input item:`, { 
    name: item.name, 
    brand: item.brand,
    brand_normalized: item.brand_normalized,
    clean_name: item.clean_name,
    required_tokens: item.required_tokens,
    canonical_category: item.canonical_category,
    confidence: item.confidence,
    locale: item.locale
  });
  console.log(`[OFF] Canonical query: "${canonicalQuery}" (from: "${fullProductName}")`);
  
  // DEFENSIVE: Check if clean_name contains brand name (GPT error)
  if (item.clean_name && item.brand) {
    const cleanLower = item.clean_name.toLowerCase();
    const brandWords = item.brand.toLowerCase().split(/[\s&'-]+/);
    const brandInClean = brandWords.some(word => 
      word.length > 2 && cleanLower.includes(word)
    );
    
    if (brandInClean) {
      console.log(`[OFF] WARNING: clean_name contains brand name - GPT field separation error`);
      console.log(`[OFF] clean_name: "${item.clean_name}", brand: "${item.brand}"`);
      // Use generic product type instead
      const genericType = item.canonical_category === 'snack-sweet' ? 'chocolate' :
                         item.canonical_category === 'dairy' ? 'milk' :
                         item.canonical_category === 'beverage' ? 'drink' : 'product';
      console.log(`[OFF] Using generic type: "${genericType}" instead of "${item.clean_name}"`);
    }
  }

  if (REQUIRE_BRAND && !item.off_candidate) {
    console.log(`[OFF] Skipping (no brand/upc): ${item.name}`);
    return { item, reason: 'skipped_no_brand', canonical: canonicalQuery };
  }
  
  if (item.upc) {
    const normalizedUPC = normalizeUPC(item.upc);
    if (normalizedUPC) {
      // CACHE DISABLED FOR TESTING
      // const cached = await getCachedOffProduct(normalizedUPC, { signal });
      // if (cached?.product && cached.isFresh) {
      //   console.log(`[OFF] Cache hit for UPC ${normalizedUPC}`);
      //   return { product: cached.product, score: 1.0 };
      // }

      const prod = await getByBarcode(normalizedUPC, { signal });
      if (prod && hasUsefulNutriments(prod)) {
        // CACHE DISABLED FOR TESTING - await upsertOffProduct(prod, { previousLastModified: null, signal });
        return { product: prod, score: 1.0 };
      }

      // CACHE DISABLED FOR TESTING
      // if (cached?.product) {
      //   console.log(`[OFF] Using stale cache for UPC ${normalizedUPC}`);
      //   return { product: cached.product, score: Math.max(item.confidence ?? 0.6, 0.85) };
      // }
    }
  }

  // Primary OFF search with canonical query
  try {
    const startedAt = Date.now();
    const positiveHints = CATEGORY_POSITIVE_HINTS[item?.canonical_category || ''] || null;
    const brandVariants = collectBrandSearchVariants(item);
    if (brandVariants.length > 0) {
      console.log(`[OFF] Brand variants:`, brandVariants.slice(0, 5));
    }
    const brandName = brandVariants[0] || null;
    const cleanName = canonicalQuery || canonicalizeQuery(item.name || '');
    const locale = typeof item.locale === 'string' && item.locale.trim() ? item.locale.trim().toLowerCase() : 'en';

    const variantWhitelistTokens = buildVariantWhitelistTokens(item);
    const categoryFilters = deriveCategoryFilters(item, variantWhitelistTokens);
    const categoryTags = [];
    if (categoryFilters.primary) {
      categoryTags.push(categoryFilters.primary);
    } else if (positiveHints?.tags?.length) {
      categoryTags.push(positiveHints.tags[0]);
    }
    const negativeCategoryTags = [...new Set(categoryFilters.exclude)];
    const brandContext = buildBrandContext(item);

    const { nameTokens, limitedProductTerm, limitedCleanTerm } = buildNameContext(
      cleanName,
      brandName,
      variantWhitelistTokens
    );

    const finalQueries = buildSearchStrategies({
      brandVariants,
      limitedProductTerm,
      limitedCleanTerm,
      brandName,
      variantWhitelistTokens
    });

    console.log(`[OFF] Search strategies generated:`, finalQueries.map(q => ({
      strategy: q.strategy,
      term: q.term,
      brand: q.brand
    })));

    if (finalQueries.length === 0) {
      console.log(`[OFF] No search strategies generated - empty query`);
      return { item, reason: 'empty_query', canonical: canonicalQuery };
    }

    const { responseBatches, timedOut } = await fetchProductBatches(finalQueries, {
      signal,
      categoryTags,
      negativeCategoryTags,
      locale,
      variantTokens: variantWhitelistTokens,
      brandContext,
      startedAt
    });

    if (timedOut) {
      console.log(`[OFF] Search timed out, but attempting to use partial results if available`);
      // Don't immediately return - try to use whatever we got
      if (responseBatches.length === 0) {
        return { item, reason: 'timeout', canonical: canonicalQuery, error: 'budget_exceeded' };
      }
    }

    if (responseBatches.length === 0) {
      console.log(`[OFF] No response batches - trying broader search without required tokens`);
      // FALLBACK: Try one more search without variant constraints
      if (variantWhitelistTokens.length > 0 && brandName) {
        console.log(`[OFF] Attempting fallback search without required tokens: "${brandName}"`);
        try {
          const fallbackBatch = await fetchProductBatches([{
            term: limitTokens(brandName),
            brand: brandName,
            strategy: 'brand_fallback'
          }], {
            signal,
            categoryTags: [],
            negativeCategoryTags: [],
            locale,
            variantTokens: [], // No variant requirements
            brandContext,
            startedAt: Date.now()
          });
          
          if (fallbackBatch.responseBatches.length > 0) {
            console.log(`[OFF] Fallback search found ${fallbackBatch.responseBatches[0]?.products?.length || 0} products`);
            responseBatches.push(...fallbackBatch.responseBatches);
          }
        } catch (fallbackError) {
          console.log(`[OFF] Fallback search also failed:`, fallbackError.message);
        }
      }
      
      if (responseBatches.length === 0) {
        const reason = brandName ? 'off_not_found_brand' : 'no_hits';
        return {
          item,
          reason,
          canonical: canonicalQuery,
          error: `OFF not found for brand="${brandName || 'none'}" name="${item.name}"`
        };
      }
    }

    const dedupedProducts = dedupeProducts(responseBatches);

    if (dedupedProducts.length === 0) {
      return { item, reason: 'no_candidates', canonical: canonicalQuery };
    }

    console.log(`[OFF] Search returned ${dedupedProducts.length} unique products across ${responseBatches.length} strategies`);

    // Log raw response (top-N documents)
    console.log(`[OFF] Raw Response top-${Math.min(dedupedProducts.length, 5)}:`, dedupedProducts.slice(0, 5).map(({ product, strategy }) => ({
      strategy,
      code: product.code,
      product_name: product.product_name,
      brands: product.brands,
      brands_tags: product.brands_tags?.slice(0, 3),
      categories_tags: product.categories_tags?.slice(0, 3)
    })));

    // Require at least one useful per-100g nutrient value
    const useful = dedupedProducts
      .filter(({ product }) => hasUsefulNutriments(product))
      .map(({ product, strategy }) => ({ product, strategy }));
    console.log(`[OFF] Nutrient filter: ${useful.length}/${dedupedProducts.length} products have useful nutrients`);

    if (useful.length === 0) {
      console.log(`[OFF] No useful nutrients for "${canonicalQuery}" (${dedupedProducts.length} products found)`);
      return { item, reason: 'no_useful_nutrients', canonical: canonicalQuery };
    }

    const scoringContext = {
      brandContext,
      variantTokens: variantWhitelistTokens,
      negativeCategoryTags,
      nameTokens
    };

    const scoredCandidates = useful
      .map(({ product, strategy }) => {
        const { score, breakdown, brandExact } = scoreProduct(item, product, scoringContext);
        return { product, score, breakdown, brandExact, strategy };
      })
      .sort((a, b) => {
        // CRITICAL FIX: If required_tokens exist, prioritize products that match them
        const aHasRequiredTokens = variantWhitelistTokens.length === 0 || 
          (a.breakdown.variant_phrase > 0 || a.breakdown.variant_tokens > 0);
        const bHasRequiredTokens = variantWhitelistTokens.length === 0 || 
          (b.breakdown.variant_phrase > 0 || b.breakdown.variant_tokens > 0);
        
        // If only one has required tokens, it wins regardless of score
        if (aHasRequiredTokens && !bHasRequiredTokens) return -1;
        if (bHasRequiredTokens && !aHasRequiredTokens) return 1;
        
        // Both have or both don't have required tokens - sort by score
        return b.score - a.score;
      });

    if (scoredCandidates.length === 0) {
      console.log(`[OFF] No candidates after scoring for "${canonicalQuery}"`);
      return { item, reason: 'no_candidates', canonical: canonicalQuery };
    }

    console.log(`[OFF] Rerank top candidates:`, scoredCandidates.slice(0, 3).map(({ product, score, brandExact, breakdown, strategy }) => ({
      strategy,
      product_name: product.product_name,
      score,
      brandExact,
      brands: product.brands,
      breakdown
    })));

    const best = scoredCandidates[0];
    // REDUCED THRESHOLDS: More lenient acceptance criteria
    const scoreThreshold = brandContext ? 150 : 60;

    // IMPROVED: More lenient required tokens check with intelligent fallback
    if (variantWhitelistTokens.length > 0 && best) {
      const hasRequiredTokens = best.breakdown.variant_phrase > 0 || best.breakdown.variant_tokens > 0;
      const hasStrongBrand = best.breakdown.brand >= 400; // Strong brand match
      const isReasonableScore = best.score >= 100; // Minimum acceptable score
      
      // Only reject if: no required tokens AND (weak brand OR very low score)
      if (!hasRequiredTokens && (!hasStrongBrand || !isReasonableScore)) {
        console.log(`[OFF] Final Decision: REJECTED, reason=missing_required_tokens, score=${best.score?.toFixed(2)}`);
        console.log(`[OFF] Missing required tokens: ${variantWhitelistTokens.join(', ')} in "${best.product.product_name}"`);
        console.log(`[OFF] Brand strength: ${best.breakdown.brand}, Score acceptable: ${isReasonableScore}`);
        
        // UNIVERSAL: Deterministic fallback - return top 3 candidates for user override
        const fallbackCandidates = scoredCandidates.slice(0, 3).map(candidate => ({
          product: candidate.product,
          score: candidate.score,
          reason: 'missing_required_tokens_fallback'
        }));
        
        if (fallbackCandidates.length > 0) {
          console.log(`[OFF] Providing ${fallbackCandidates.length} fallback candidates for manual override`);
          return { 
            item, 
            reason: 'missing_required_tokens', 
            canonical: canonicalQuery, 
            score: best?.score,
            fallback_candidates: fallbackCandidates 
          };
        }
        
        return { item, reason: 'missing_required_tokens', canonical: canonicalQuery, score: best?.score };
      } else if (!hasRequiredTokens && hasStrongBrand && isReasonableScore) {
        console.log(`[OFF] ACCEPTING despite missing required tokens: strong brand (${best.breakdown.brand}) + reasonable score (${best.score?.toFixed(2)})`);
      }
    }

    // CRITICAL FIX: If product has required_tokens, allow it even with poor brand score
    const hasRequiredTokensInBest = variantWhitelistTokens.length === 0 || 
      (best?.breakdown?.variant_phrase > 0 || best?.breakdown?.variant_tokens > 0);
    
    if (brandContext && best && best.breakdown?.brand < -200 && !hasRequiredTokensInBest) {
      // Only reject if brand component is very negative AND no required_tokens match
      const bestScoreText = best?.score != null ? best.score.toFixed(2) : 'null';
      console.log(`[OFF] Final Decision: REJECTED, reason=severe_brand_mismatch, score=${bestScoreText}, brand_component=${best.breakdown.brand}`);
      return { item, reason: 'severe_brand_mismatch', canonical: canonicalQuery, score: best.score };
    }
    
    // Special case: If best candidate has required_tokens but poor brand, accept it
    if (hasRequiredTokensInBest && best?.breakdown?.brand < 0) {
      console.log(`[OFF] Accepting product with required_tokens despite poor brand score (${best.breakdown.brand})`);
    }

    if (!best || best.score < scoreThreshold) {
      console.log(`[OFF] Final Decision: REJECTED, reason=low_score, score=${best?.score ?? 'null'}, threshold=${scoreThreshold}, candidates=${scoredCandidates.length}`);
      console.log(`[OFF] Low score for "${canonicalQuery}": ${best?.score ?? 'null'} (${scoredCandidates.length} candidates)`);
      
      // UNIVERSAL: Deterministic fallback - return top 3 candidates for user override
      const fallbackCandidates = scoredCandidates.slice(0, 3).map(candidate => ({
        product: candidate.product,
        score: candidate.score,
        reason: 'low_score_fallback'
      }));
      
      if (fallbackCandidates.length > 0) {
        console.log(`[OFF] Providing ${fallbackCandidates.length} fallback candidates for manual override`);
        return { 
          item, 
          reason: 'low_score', 
          canonical: canonicalQuery, 
          score: best?.score,
          fallback_candidates: fallbackCandidates 
        };
      }
      
      return { item, reason: 'low_score', canonical: canonicalQuery, score: best?.score };
    }

    console.log(`[OFF] Best candidate breakdown:`, best.breakdown);

    if (best.product?.code) {
      // CACHE DISABLED FOR TESTING
      // const cached = await getCachedOffProduct(best.product.code, { signal });
      // await upsertOffProduct(best.product, { previousLastModified: cached?.last_modified_t, signal });
    }

    console.log(`[OFF] === SUCCESS ===`);
    console.log(`[OFF] Final Decision: selected product_code=${best.product.code}, final_score=${best.score.toFixed(2)}, reason=highest_rerank_score`);
    console.log(`[OFF] Found: "${best.product.product_name}" (code: ${best.product.code}, score: ${best.score.toFixed(2)})`);
    console.log(`[OFF] Product data:`, {
      code: best.product.code,
      brands: best.product.brands,
      brands_tags: best.product.brands_tags,
      nutriscore: best.product.nutriscore_grade,
      allergens: best.product.allergens_tags,
      ingredients_analysis: best.product.ingredients_analysis_tags,
      labels_tags: best.product.labels_tags?.slice(0, 5),
      categories_tags: best.product.categories_tags?.slice(0, 5)
    });
    console.log(`[OFF] === RESOLVING ITEM END ===`);
    
    return { product: best.product, score: best.score };
    
  } catch (e) {
    const isAbort = e?.name === 'AbortError';
    console.log(`[OFF] Error for "${canonicalQuery}": ${isAbort ? 'timeout' : 'http_or_json_error'} - ${e.message}`);
    return { item, reason: isAbort ? 'timeout' : 'http_or_json_error', canonical: canonicalQuery, error: e.message };
  }
}

export function scalePerPortionOFF(prod, grams) {
  const per100 = mapOFFProductToPer100g(prod);
  const k = grams / 100;
  const round = (n,d=0)=>{ const m=10**d; return Math.round((n+Number.EPSILON)*m)/m; };
  return {
    calories:  round((per100.ENERC_KCAL||0) * k),
    protein_g: round((per100.PROCNT||0) * k,1),
    fat_g:     round((per100.FAT||0) * k,1),
    carbs_g:   round((per100.CHOCDF||0) * k,1),
    fiber_g:   round((per100.FIBTG||0) * k,1),
    meta: per100.meta,
    serving_size_label: per100.serving_size
  };
}
