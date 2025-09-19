// Simple smoke test for Compound Variant Guard
import { resolveOneItemOFF } from './modules/nutrition/off-resolver.js';

async function main() {
  const item = {
    name: "M&M's peanut butter",
    brand: "M&M's",
    brand_normalized: 'm-m-s',
    brand_synonyms: ['m&ms', "m m's", 'mms', 'm-and-ms'],
    clean_name: 'peanut butter chocolate',
    off_primary_tokens: ['peanut butter'],
    off_alt_tokens: ['peanut-butter', 'peanutbutter'],
    off_neg_tokens: ['sugar-free', 'diet'],
    off_attr_avoid: [],
    canonical_category: 'snack-sweet',
    food_form: 'bar',
    locale: 'en'
  };

  try {
    const res = await resolveOneItemOFF(item, { signal: AbortSignal.timeout(25000) });
    console.log('\nRESULT:', {
      code: res.product?.code,
      name: res.product?.product_name,
      confidence: res.confidence
    });
  } catch (err) {
    console.error('Smoke test failed:', err?.message || err);
    process.exitCode = 1;
  }
}

const isMainModule = import.meta.url.startsWith('file:') &&
  (import.meta.url.includes(process.argv[1]?.replace(/\\/g, '/')) ||
   process.argv[1]?.endsWith('test-compound-guard.js'));

if (isMainModule) {
  main();
}


