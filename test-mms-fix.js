console.log("Testing M&Ms Peanut Butter fix...");
import { resolveOneItemOFF } from "./api/modules/nutrition/off-resolver.js";

async function testMMs() {
  const item = {
    name: "m&m's peanut butter",
    brand: "m&m's", 
    brand_normalized: "m&m's",
    off_primary_tokens: ["m&m's", "peanut butter"],
    off_alt_tokens: ["peanut", "pb", "candies"],
    off_neg_tokens: ["plain", "milk chocolate"],
    canonical_category: "snack-sweet",
    food_form: "raw",
    off_candidate: true
  };
  
  try {
    const result = await resolveOneItemOFF(item);
    console.log("Result:", result?.item?.code || "no_candidates", result?.reason);
    if (result?.item?.code === "0040000579816") {
      console.log("✅ SUCCESS: Found target M&M's Peanut Butter!");
    } else {
      console.log("❌ FAILED: Wrong product selected");
    }
  } catch (error) {
    console.log("❌ ERROR:", error.message);
  }
}

testMMs();
