# Issues and Recommendations
Generated: 2025-09-17T23:50:03.342Z

## Issues Found (3)
⚠️ **central_lechera_mantequilla**: No brand matches found (expected: central-lechera-asturiana)
⚠️ **mms_peanut_butter**: No brand matches found (expected: m-m-s, mars)
⚠️ **special_chars_stress**: No brand matches found (expected: ben-jerry-s, ben-jerrys)

## Error Patterns

## Best Practices
1. **Brand Normalization**: Handle special characters (M&M's → m-m-s)
2. **Timeout Management**: SaL often fails with 500ms, consider 800ms+
3. **Category Filtering**: v2 strict requires both brand and category
4. **Variant Tokens**: Use variant rules for better matching (light, zero, etc.)
5. **Fallback Strategy**: Always have legacy as final fallback