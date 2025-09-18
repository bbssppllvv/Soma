# Оптимизированные примеры для GPT

## 🎯 **Цель: 4 слова максимум в поисковом запросе**

### **Формула:** `brand_normalized + clean_name + required_tokens ≤ 4 words`

---

## ✅ **Правильные примеры**

### **M&M's Peanut Butter:**
```javascript
// ✅ ОПТИМАЛЬНО:
{
  name: "M&M's Peanut Butter",
  brand_normalized: "m&m's",           // 1 word
  clean_name: "chocolate",             // 1 word  
  required_tokens: ["peanut", "butter"] // 2 words
}
// → Query: "m&m's chocolate peanut butter" (4 words) ✅

// ❌ БЫЛО (слишком длинно):
{
  clean_name: "chocolate candies",     // 2 words
  required_tokens: ["peanut", "butter"] // 2 words
}
// → Query: "m&m's chocolate candies peanut butter" (6 words) ❌
```

### **Coca-Cola Zero:**
```javascript
// ✅ ОПТИМАЛЬНО:
{
  name: "Coca-Cola Zero",
  brand_normalized: "coca-cola",       // 1 word (hyphenated)
  clean_name: "cola",                  // 1 word
  required_tokens: ["zero"]            // 1 word
}
// → Query: "coca-cola cola zero" (3 words) ✅
```

### **Central Lechera Semi Desnatada:**
```javascript
// ✅ ОПТИМАЛЬНО:
{
  name: "Central Lechera Asturiana Semi Desnatada",
  brand_normalized: "central lechera asturiana", // 3 words
  clean_name: "milk",                  // 1 word
  required_tokens: ["semi"]            // 1 word (выбираем главный)
}
// → Query: "central lechera asturiana milk" (4 words) ✅
// Note: 'semi' будет добавлен через variant system

// ❌ БЫЛО (слишком длинно):
{
  clean_name: "leche",
  required_tokens: ["semi", "desnatada"] // 2 words
}
// → Query: "central lechera asturiana leche semi desnatada" (6 words) ❌
```

---

## 🎯 **Новые правила для GPT**

### **1. Word Limits:**
- `clean_name`: **1 word preferred, 2 maximum**
- `required_tokens`: **1-2 essential terms only**
- Total query: **4 words maximum**

### **2. Prioritization:**
- **Most important modifier** goes in required_tokens
- **Secondary modifiers** ignored for search efficiency
- **Generic product type** in clean_name

### **3. Language optimization:**
- Use **shorter English equivalents** when available:
  - `"leche"` → `"milk"` (shorter and universal)
  - `"mantequilla"` → `"butter"` (shorter)
  - `"chocolate candies"` → `"chocolate"` (1 word vs 2)

---

## 📊 **Expected Results**

### **M&M's case:**
```
Input: M&M's Peanut Butter package
GPT output: brand_normalized: "m&m's", clean_name: "chocolate", required_tokens: ["peanut"]
Search query: "m&m's chocolate peanut" (3 words)
Expected result: Strong brand match with M&M's products ✅
```

### **Central Lechera case:**
```
Input: Central Lechera Semi Desnatada
GPT output: brand_normalized: "central lechera asturiana", clean_name: "milk", required_tokens: ["semi"]  
Search query: "central lechera asturiana milk" (4 words)
Expected result: Find Central Lechera milk products ✅
```

---

**Key insight:** Tell GPT exactly what we need for search efficiency, not just general field separation rules.
