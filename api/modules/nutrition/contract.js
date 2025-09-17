// Unified GPT response contract (shared with the resolver)
export const GPT_NUTRITION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name:            { type: "string",  maxLength: 80 },
          portion:         { type: "number",  minimum: 0 },
          unit:            { type: "string",  maxLength: 16 },
          brand:           { type: ["string", "null"],  maxLength: 64 },
          brand_normalized: { type: ["string", "null"],  maxLength: 64 },
          clean_name:      { type: ["string", "null"],  maxLength: 80 },
          required_tokens: { type: "array", items: { type: "string", maxLength: 20 }, maxItems: 10 },
          upc:             { type: ["string", "null"],  maxLength: 22 },
          cooking_method:  { type: ["string", "null"],  maxLength: 24 },
          confidence:      { type: "number",  minimum: 0, maximum: 1 },
          occluded:        { type: "boolean" },
          locale:          { type: "string",  maxLength: 8 },
          item_role: {
            type: "string",
            enum: [
              "ingredient",
              "dish"
            ]
          },
          canonical_category: {
            type: "string",
            enum: [
              "grain",
              "porridge",
              "rice",
              "pasta",
              "bread",
              "meat",
              "seafood",
              "egg",
              "dairy",
              "legume",
              "vegetable",
              "fruit",
              "salad",
              "soup",
              "snack-sweet",
              "snack-savory",
              "cookie-biscuit",
              "dessert",
              "beverage",
              "condiment",
              "breakfast-cereal",
              "protein-drink",
              "unknown"
            ]
          },
          food_form: {
            type: "string",
            enum: [
              "hot-cereal",
              "flakes",
              "granola",
              "bar",
              "cookie",
              "cracker",
              "loaf",
              "patty",
              "grilled",
              "fried",
              "boiled",
              "steamed",
              "roasted",
              "baked",
              "raw",
              "stewed",
              "soup",
              "smoothie",
              "drink",
              "salad",
              "sandwich",
              "wrap",
              "unknown"
            ]
          }
        },
        // strict:true requires every property to be listed in required.
        // Optionality is handled through nullable fields.
        required: [
          "name","portion","unit","brand","brand_normalized","clean_name","required_tokens","upc","cooking_method","confidence","occluded","locale","item_role","canonical_category","food_form"
        ]
      }
    },

    calories:     { type: "integer", minimum: 0 },
    protein_g:    { type: "number",  minimum: 0 },
    fat_g:        { type: "number",  minimum: 0 },
    carbs_g:      { type: "number",  minimum: 0 },
    fiber_g:      { type: "number",  minimum: 0 },

    advice_short:       { type: "string", maxLength: 120 },
    needs_clarification:{ type: "boolean" },
    assumptions:        { type: "array", items: { type: "string", maxLength: 120 } }
  },

  // List every top-level key as required as well.
  required: [
    "items",
    "calories","protein_g","fat_g","carbs_g","fiber_g",
    "advice_short","needs_clarification","assumptions"
  ]
};
