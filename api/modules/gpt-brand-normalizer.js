/**
 * GPT Brand Normalizer - консистентные правила для brand_normalized
 * Используется как референс для GPT prompt'а
 */

export function gptNormalizeBrand(brand) {
  if (!brand) return '';
  
  return brand
    .toString()
    .toLowerCase()
    .normalize('NFKD') // Handle accents: Häagen-Dazs → haagen-dazs
    .replace(/\p{M}/gu, '') // Remove combining marks
    .replace(/\s+/g, ' ') // Multiple spaces to single
    .trim();
    
  // PRESERVE: &, ', -, numbers, spaces
  // This creates recognizable but search-friendly forms:
  // 'M&M's' → 'm&m's' (recognizable)
  // 'Central Lechera Asturiana' → 'central lechera asturiana' (preserves structure)
  // 'Coca-Cola' → 'coca-cola' (preserves hyphen)
}

// Examples for GPT prompt reference
export const BRAND_NORMALIZATION_EXAMPLES = {
  "M&M's": "m&m's",
  "Ben & Jerry's": "ben & jerry's", 
  "Coca-Cola": "coca-cola",
  "Häagen-Dazs": "häagen-dazs",
  "Central Lechera Asturiana": "central lechera asturiana",
  "Dr. Pepper": "dr. pepper",
  "7-Eleven": "7-eleven",
  "L'Oréal": "l'oréal",
  "McDonald's": "mcdonald's",
  "Kellogg's": "kellogg's"
};

// Generate examples string for prompt
export function getBrandNormalizationExamples() {
  return Object.entries(BRAND_NORMALIZATION_EXAMPLES)
    .map(([original, normalized]) => `'${original}' → '${normalized}'`)
    .join(', ');
}
