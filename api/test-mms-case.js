import { resolveOneItemOFF } from './modules/nutrition/off-resolver.js';

async function testMandMs() {
  console.log('🧪 Testing M&Ms peanut butter case...');
  
  const item = {
    name: 'M&Ms peanut butter',
    brand: 'M&Ms',
    brand_normalized: 'm and ms',
    brand_synonyms: ['m&ms', 'mandms'],
    canonical_category: 'snack-sweet',
    compound: {
      canonical: 'peanut butter',
      forms: ['peanut butter', 'peanut-butter', 'peanutbutter']
    }
  };
  
  
  try {
    const result = await resolveOneItemOFF(item);
    console.log('✅ Result:', result?.success ? result.product?.code : 'FAILED');
    console.log('📋 Product name:', result?.product?.product_name);
    console.log('🏷️ Brand match source:', result?.meta?.brand_match_source);
    
    if (result?.product?.code === '0040000579816') {
      console.log('🎯 SUCCESS: Found correct peanut butter M&Ms!');
    } else {
      console.log('❌ FAILED: Wrong product selected');
      console.log('Expected: 0040000579816');
      console.log('Got:', result?.product?.code);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testMandMs();
