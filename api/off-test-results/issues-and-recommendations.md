# Issues and Recommendations
Generated: 2025-09-17T22:16:50.716Z

## Issues Found (21)
❌ **philadelphia_light**: No results from any strategy
⚠️ **philadelphia_light**: No brand matches found (expected: philadelphia)
❌ **central_lechera_semi**: No results from any strategy
⚠️ **central_lechera_semi**: No brand matches found (expected: central-lechera-asturiana, central lechera)
❌ **central_lechera_mantequilla**: No results from any strategy
⚠️ **central_lechera_mantequilla**: No brand matches found (expected: central-lechera-asturiana)
❌ **coca_cola_original**: No results from any strategy
⚠️ **coca_cola_original**: No brand matches found (expected: coca-cola)
❌ **pepsi_zero**: No results from any strategy
⚠️ **pepsi_zero**: No brand matches found (expected: pepsi)
❌ **mms_peanut_butter**: No results from any strategy
⚠️ **mms_peanut_butter**: No brand matches found (expected: m-m-s, mars)
❌ **kitkat_chunky**: No results from any strategy
⚠️ **kitkat_chunky**: No brand matches found (expected: kitkat, nestle)
❌ **alpro_soja**: No results from any strategy
⚠️ **alpro_soja**: No brand matches found (expected: alpro)
❌ **oatly_oat_milk**: No results from any strategy
⚠️ **oatly_oat_milk**: No brand matches found (expected: oatly)
❌ **special_chars_stress**: No results from any strategy
⚠️ **special_chars_stress**: No brand matches found (expected: ben-jerry-s, ben-jerrys)
❌ **timeout_stress**: No results from any strategy

## Error Patterns

## Best Practices
1. **Brand Normalization**: Handle special characters (M&M's → m-m-s)
2. **Timeout Management**: SaL often fails with 500ms, consider 800ms+
3. **Category Filtering**: v2 strict requires both brand and category
4. **Variant Tokens**: Use variant rules for better matching (light, zero, etc.)
5. **Fallback Strategy**: Always have legacy as final fallback