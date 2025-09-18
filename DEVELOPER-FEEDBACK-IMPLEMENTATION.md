# Реализация рекомендаций разработчика

## 🎯 **Ключевые проблемы выявлены правильно**

Разработчик точно определил корневые проблемы:
1. **Эвристический scoring** создает "качели" эффект
2. **Избыточные brand variants** добавляют шум
3. **Case sensitivity** в required_tokens
4. **Неэффективный budget management** 
5. **Несогласованная нормализация** между GPT и OFF

---

## 🛠️ **План реализации улучшений**

### **1. ПРИОРИТЕТ 1: Упрощение brand variants**
```javascript
// Сейчас: 3+ варианта создают шум
['central lechera asturiana', 'central-lechera-asturiana', 'centrallecheraasturiana']

// Предложение: Только 2 основных
[normalizeBrandForSearch(brand), toBrandSlug(brand)]
```

### **2. ПРИОРИТЕТ 2: Фиксированная нормализация required_tokens**
```javascript
// Проблема: GPT дает "Tradicional", OFF ищет "Tradicional"
// Решение: Всегда canonicalizeQuery для всех токенов
```

### **3. ПРИОРИТЕТ 3: Оптимизация budget management**
```javascript
// Сейчас: Каждый stage получает полный budget
// Предложение: SaL(600ms) + parallel v2(250ms) + legacy(fallback)
```

### **4. ПРИОРИТЕТ 4: Детерминированный фильтр вместо scoring**
```javascript
// Вместо сложного scoring:
function isGoodMatch(product, item) {
  const brandMatch = checkBrandMatch(product.brands, item.brand);
  const tokensMatch = checkRequiredTokens(product.product_name, item.required_tokens);
  const hasNutrients = hasUsefulNutriments(product);
  
  return brandMatch && tokensMatch && hasNutrients;
}
```

---

## 🚀 **Немедленные действия**
