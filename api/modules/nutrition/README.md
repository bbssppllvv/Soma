# Nutrition Module Overview

## Phase 1: Foundation (✅ Complete)
A unified data contract and normalizer are in place, ready for future data providers.

## Phase 2: Open Food Facts Behind a Feature Flag (✅ Complete)
OpenFoodFacts integration is available behind the `OFF_ENABLED` flag (disabled by default).

## Structure
- `contract.js` – shared `GPT_NUTRITION_SCHEMA`
- `units.js` – helpers for converting units to grams
- `simple-cache.js` – in-memory cache for serverless environments
- `off-client.js` – OpenFoodFacts HTTP client with retries
- `off-map.js` – maps OFF data to standardized nutrient format
- `off-resolver.js` – resolves products by UPC/name with scoring
- `resolve-pipeline.js` – main pipeline that enriches GPT items via OFF
- `README.md` – this documentation

## Changes in `ai-analysis.js`
1. **Unified schema** – both photo and text builders use `GPT_NUTRITION_SCHEMA`
2. **Required aggregates** – calories, macros, and fiber are mandatory
3. **Robust parsing** – `extractFirstBalancedJson()` handles responses with preambles
4. **Normalizer** – `normalizeAnalysisPayload()` produces a consistent payload
5. **Safety guards** – defensive prompts reduce hallucinations for both builders
6. **Compatibility** – `cleanNutritionData()` retained as a deprecated wrapper
7. **Smart logic** – auto-sets `needs_clarification=true` when aggregates are zero
8. **Debugging** – logs `x-request-id` for easier OpenAI troubleshooting
9. **OFF integration** – `maybeResolveWithOFFIfEnabled()` enriches via OpenFoodFacts
10. **Deterministic aggregates** – OFF results override model estimates when available

## Environment variables
```
OFF_ENABLED=false                    # Enable/disable OFF
OFF_ENABLED_PERCENT=100              # Percentage of traffic hitting OFF (0-100)
OFF_TIMEOUT_MS=6000                  # OFF request timeout
OFF_CACHE_TTL_MS=10800000           # Cache TTL (3 hours)
```

## Reliability notes
- OFF is disabled by default (`OFF_ENABLED=false`)
- Gradual rollout with `OFF_ENABLED_PERCENT`
- Graceful fallback when OFF fails
- Proper AbortSignal chaining
- Filters to confidence ≥ 0.4, max 6 items
- Reject items without useful nutrients
- Density table for ml→g conversions (oil, honey, milk)
- Logging coverage, latency, and product codes

## Production rollout
1. Enable `OFF_ENABLED=true` with `OFF_ENABLED_PERCENT=10`
2. Monitor coverage, speed, and errors
3. Increase to 25%, 50%, 100% based on metrics

## Test cases
- Text: `"chicken breast 150g + rice 200g + olive oil 10ml"`
- Photo: pasta with sauce
- Item with `unit="piece"`

## Metrics
- Coverage@0.7 (share of successful resolutions)
- P50 latency < 2–3 s
- Ask-rate (`needs_clarification` frequency)
- Oil calories ≈ 90–92 kcal/10 ml (density sanity check)
