import {
  GLOBAL_BUDGET_MS,
  HEDGE_DELAY_MS,
  HEDGE_TIMEOUT_MS,
  LEGACY_TIMEOUT_MS,
  SAL_TIMEOUT_MS,
  V2_BRANDLESS_TIMEOUT_MS,
  V2_RELAX_TIMEOUT_MS,
  V2_STRICT_TIMEOUT_MS
} from './config.js';
import { emitMetric } from './metrics.js';
import { runSearchV3 } from './search-sal.js';
import { runSearchV2 } from './search-v2.js';
import { searchByNameLegacy } from './search-legacy.js';
import { buildSearchQueries, collectVariantLabelFilters, normalizeLocale, toBrandSlug } from './queries.js';
import { combineSignals } from './throttle.js';

export async function searchByNamePipeline(query, {
  signal,
  categoryTags = [],
  negativeCategoryTags = [],
  brand = null,
  maxPages = 1,
  locale = null,
  variantTokens = []
} = {}) {
  const localeParam = normalizeLocale(locale);
  const cleanQuery = query.trim();
  const brandSlug = brand ? toBrandSlug(brand) : null;
  const primaryCategory = Array.isArray(categoryTags) ? categoryTags[0] : categoryTags;
  const labelFilters = collectVariantLabelFilters(variantTokens);
  const attemptedResults = [];
  const stageUsed = [];
  const startedAt = Date.now();

  const remainingBudget = () => GLOBAL_BUDGET_MS - (Date.now() - startedAt);
  const canRunStage = (desiredTimeout) => Math.max(0, remainingBudget()) > 50 && desiredTimeout > 0;
  const adjustedTimeout = (desiredTimeout) => {
    const remaining = Math.max(0, remainingBudget());
    return Math.max(100, Math.min(desiredTimeout, remaining));
  };

  const queries = buildSearchQueries(cleanQuery, brand).slice(0, 1);
  const salTerm = queries[0] || cleanQuery;

  const runHedgedSalAndStrict = async () => {
    return new Promise((resolve) => {
      let resolved = false;
      let winner = null;
      let v2Timer = null;
      let active = 0;
      const abortFns = new Map();

      const settle = (value) => {
        if (resolved) return;
        resolved = true;
        if (v2Timer) clearTimeout(v2Timer);
        resolve(value);
      };

      const launchStage = (stageName, controller, runner) => {
        const abortFn = () => {
          if (!controller.signal.aborted) controller.abort('hedge_cancelled');
        };
        abortFns.set(stageName, abortFn);
        active += 1;
        runner()
          .then(res => {
            if (res?.products?.length && !winner) {
              stageUsed.push(stageName);
              winner = { stage: stageName, result: res };
              abortFns.forEach((fn, key) => {
                if (key !== stageName) fn();
              });
              settle(winner);
            } else if (res) {
              stageUsed.push(`${stageName}_empty`);
              attemptedResults.push(res);
            }
          })
          .catch(error => {
            stageUsed.push(`${stageName}_error`);
            console.log(`[OFF] Hedged stage ${stageName} failed`, {
              error: error?.code || error?.message || 'unknown'
            });
          })
          .finally(() => {
            active -= 1;
            if (!winner && active === 0) {
              settle(null);
            }
          });
      };

      emitMetric('off_budget_remaining', { stage: 'sal_hedged', ms: Math.max(0, remainingBudget()) });
      const salController = new AbortController();
      const salSignal = combineSignals(signal, salController.signal);
      launchStage('sal', salController, () => runSearchV3(salTerm, {
        signal: salSignal,
        locale: localeParam,
        categoryTags: primaryCategory ? [primaryCategory] : [],
        negativeCategoryTags,
        brandFilter: brand,
        variantTokens
      }));

      if (brandSlug && primaryCategory && canRunStage(V2_STRICT_TIMEOUT_MS)) {
        v2Timer = setTimeout(() => {
          if (resolved) return;
          const v2Controller = new AbortController();
          const v2Signal = combineSignals(signal, v2Controller.signal);
          const hedgeTimeout = adjustedTimeout(Math.min(HEDGE_TIMEOUT_MS, V2_STRICT_TIMEOUT_MS));
          launchStage('v2_strict', v2Controller, () => runSearchV2({
            signal: v2Signal,
            locale: localeParam,
            stage: 'v2_strict',
            brandSlug,
            primaryCategory,
            labelFilters,
            timeoutMs: hedgeTimeout,
            negativeCategoryTags
          }));
        }, HEDGE_DELAY_MS);
      }
    });
  };

  let hedgedResult = null;
  let hedgedTried = false;
  if (brandSlug && primaryCategory && canRunStage(SAL_TIMEOUT_MS)) {
    hedgedResult = await runHedgedSalAndStrict();
    hedgedTried = true;
    if (hedgedResult?.stage === 'sal') {
      console.log('[OFF] Hedged winner: Search-a-licious');
      return hedgedResult.result;
    }
    if (hedgedResult?.stage === 'v2_strict') {
      console.log('[OFF] Hedged winner: v2_strict');
      return hedgedResult.result;
    }
  }

  if ((!hedgedTried || hedgedResult === null) && canRunStage(SAL_TIMEOUT_MS)) {
    emitMetric('off_budget_remaining', { stage: 'sal', ms: Math.max(0, remainingBudget()) });
    try {
      const salResult = await runSearchV3(salTerm, {
        signal,
        locale: localeParam,
        categoryTags: primaryCategory ? [primaryCategory] : [],
        negativeCategoryTags,
        brandFilter: brand,
        variantTokens
      });

      if (salResult?.products?.length) {
        stageUsed.push(hedgedTried ? 'sal_retry' : 'sal');
        console.log('[OFF] Stage A (Search-a-licious) succeeded');
        return salResult;
      }

      if (salResult) {
        stageUsed.push(hedgedTried ? 'sal_empty_retry' : 'sal_empty');
        attemptedResults.push(salResult);
      }
    } catch (error) {
      stageUsed.push('sal_error');
      console.log('[OFF] Stage A (Search-a-licious) failed', {
        status: error?.status || null,
        error: error?.message || error || 'unknown'
      });
    }
  }

  const runV2Stage = async (stage, { brandSlug: stageBrand, labelFilters: stageLabels, timeoutMs }) => {
    if (!canRunStage(timeoutMs)) {
      console.log(`[OFF] Stage ${stage} skipped (budget exhausted)`);
      emitMetric('off_stage_skipped', { stage, reason: 'budget' });
      return null;
    }

    emitMetric('off_budget_remaining', { stage, ms: Math.max(0, remainingBudget()) });

    try {
      const result = await runSearchV2({
        signal,
        locale: localeParam,
        stage,
        brandSlug: stageBrand,
        primaryCategory,
        labelFilters: stageLabels,
        timeoutMs: adjustedTimeout(timeoutMs),
        negativeCategoryTags
      });

      if (result?.products?.length) {
        stageUsed.push(stage);
        return result;
      }

      if (result) {
        attemptedResults.push(result);
      }
    } catch (error) {
      stageUsed.push(`${stage}_error`);
      console.log(`[OFF] Stage ${stage} failed`, {
        error: error?.code || error?.message || 'unknown'
      });
    }

    return null;
  };

  if (brandSlug && primaryCategory) {
    const strictResult = await runV2Stage('v2_strict', {
      brandSlug,
      labelFilters,
      timeoutMs: V2_STRICT_TIMEOUT_MS
    });
    if (strictResult) return strictResult;
  }

  if (brandSlug && primaryCategory) {
    const relaxResult = await runV2Stage('v2_relax', {
      brandSlug,
      labelFilters: [],
      timeoutMs: V2_RELAX_TIMEOUT_MS
    });
    if (relaxResult) return relaxResult;
  }

  if (primaryCategory) {
    const brandlessResult = await runV2Stage('v2_brandless', {
      brandSlug: null,
      labelFilters,
      timeoutMs: V2_BRANDLESS_TIMEOUT_MS
    });
    if (brandlessResult) return brandlessResult;
  }

  if (canRunStage(LEGACY_TIMEOUT_MS)) {
    emitMetric('off_budget_remaining', { stage: 'legacy', ms: Math.max(0, remainingBudget()) });
    try {
      console.log(`[OFF] Falling back to legacy search for "${cleanQuery}"`);
      const legacyResult = await searchByNameLegacy(cleanQuery, {
        signal,
        categoryTags: primaryCategory ? [primaryCategory] : [],
        brand,
        maxPages,
        locale: localeParam,
        timeoutMs: adjustedTimeout(LEGACY_TIMEOUT_MS)
      });
      if (legacyResult?.products?.length) {
        stageUsed.push('legacy');
        console.log('[OFF] Legacy search SUCCESS');
        emitMetric('off_fallback_step_used', { step: 'legacy', hits: legacyResult.products.length });
        return legacyResult;
      }
      if (legacyResult) {
        attemptedResults.push(legacyResult);
      }
    } catch (legacyError) {
      stageUsed.push('legacy_error');
      console.log(`[OFF] legacy search error term="${cleanQuery}" brand="${brand || 'none'}"`, {
        error: legacyError?.message || 'unknown'
      });
    }
  }

  console.log('[OFF] No OFF results after staged fallback', { stageUsed });
  emitMetric('off_pipeline_empty', {
    brand: brandSlug || 'none',
    category: primaryCategory || 'none',
    stages: stageUsed.join(',')
  });

  if (attemptedResults.length > 0) {
    return attemptedResults[attemptedResults.length - 1];
  }

  return { count: 0, products: [], query_term: cleanQuery, brand_filter: brand || null };
}
