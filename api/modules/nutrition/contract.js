// Единый контракт ответа от GPT (и для резолвера позже)
export const GPT_NUTRITION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    // Новый блок — разбивка на элементы блюда (пока optional, чтобы ничего не ломать)
    items: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", maxLength: 80 },
          portion: { type: "number", minimum: 0 },
          unit: { type: "string", maxLength: 16 },     // g, ml, cup, tbsp, slice, piece...
          brand: { type: "string", maxLength: 64 },
          upc: { type: "string", maxLength: 22 },
          cooking_method: { type: "string", maxLength: 24 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          occluded: { type: "boolean" }
        },
        required: ["name","portion","unit","confidence"]
      }
    },

    // Текущие агрегаты — оставляем, чтобы не сломать существующий UI/счётчики
    calories: { type: "integer", minimum: 0 },
    protein_g: { type: "number", minimum: 0 },
    fat_g: { type: "number", minimum: 0 },
    carbs_g: { type: "number", minimum: 0 },
    fiber_g: { type: "number", minimum: 0 },

    // Текст и флаги, которые вы уже используете
    advice_short: { type: "string", maxLength: 120 },
    needs_clarification: { type: "boolean" },
    assumptions: { type: "array", items: { type: "string", maxLength: 120 } }
  },

  // required — агрегаты обязательны, чтобы не получать нули на Шаге 1
  required: ["advice_short", "calories", "protein_g", "fat_g", "carbs_g", "fiber_g"]
};
