// Единый контракт ответа от GPT (и для резолвера позже)
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
          upc:             { type: ["string", "null"],  maxLength: 22 },
          cooking_method:  { type: ["string", "null"],  maxLength: 24 },
          confidence:      { type: "number",  minimum: 0, maximum: 1 },
          occluded:        { type: "boolean" },
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
        // В strict:true required должен перечислять ВСЕ ключи из properties.
        // Опциональность решаем через nullable:true.
        required: [
          "name","portion","unit","brand","upc","cooking_method","confidence","occluded","canonical_category","food_form"
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

  // Тоже перечисляем ВСЕ ключи верхнего уровня.
  required: [
    "items",
    "calories","protein_g","fat_g","carbs_g","fiber_g",
    "advice_short","needs_clarification","assumptions"
  ]
};
