# GPT Pipeline Improvements - Рекомендации

## 🎯 **Проблемы в GPT Pipeline (из продакшн логов)**

### **1. Противоречивые данные**
```javascript
// ❌ Проблема:
{
  name: 'Coca-Cola',
  clean_name: 'Coca-Cola',        // Дублирование
  required_tokens: ['zero']       // Но 'zero' нет в названии!
}

// ✅ Должно быть:
{
  name: 'Coca-Cola Zero',         // Полное название с фото
  clean_name: 'cola',             // Тип продукта
  required_tokens: ['zero']       // Варианты/модификации
}
```

### **2. Неконсистентная brand_normalized**
```javascript
// ❌ Сейчас:
"M&M's" → "mms"                    // Агрессивно
"Central Lechera" → "central lechera asturiana" // Полностью
"Coca-Cola" → "cocacola"           // Средне

// ✅ Нужно:
Единые правила нормализации для всех брендов
```

---

## 🛠️ **Конкретные улучшения GPT**

### **1. Улучшить prompt структуру**
```
CURRENT PROMPT ISSUES:
- name vs clean_name confusion
- required_tokens duplication
- Inconsistent brand_normalized

IMPROVED PROMPT STRUCTURE:
{
  "full_name": "что написано на упаковке полностью",
  "brand": "точный бренд с упаковки", 
  "product_type": "тип продукта (молоко, шоколад, etc)",
  "variants": ["конкретные варианты: zero, light, tradicional"],
  "confidence": "уверенность в распознавании"
}
```

### **2. Добавить валидацию GPT ответов**
```javascript
function validateGPTResponse(item) {
  const issues = [];
  
  // Check for name/clean_name duplication
  if (item.name === item.clean_name) {
    issues.push('name_clean_name_duplicate');
  }
  
  // Check for required_tokens in name
  if (item.required_tokens?.length > 0) {
    const nameWords = item.name.toLowerCase().split(' ');
    const missingTokens = item.required_tokens.filter(token => 
      !nameWords.some(word => word.includes(token.toLowerCase()))
    );
    if (missingTokens.length > 0) {
      issues.push(`required_tokens_not_in_name: ${missingTokens.join(', ')}`);
    }
  }
  
  return issues;
}
```

---

## 🔍 **Дополнительные улучшения OFF API**

### **1. Более умная обработка null brands**
```javascript
// В продакшн логах видим:
{
  product_name: 'Mantequilla tradicional',
  brands: null,  // ← Но это правильный продукт!
  brands_tags: []
}

// Решение: Использовать поиск по product_name + category
// вместо отклонения по null brand
```

### **2. Fallback стратегии для timeout'ов**
```javascript
// Проблема: Central Lechera часто timeout
// Решение: Упрощенный поиск при timeout

async function timeoutFallback(brand, product, required_tokens) {
  // Простейший запрос без бренда
  const simpleQuery = `${product} ${required_tokens.join(' ')}`;
  return await searchByNameV1(simpleQuery, { brand: null });
}
```

### **3. Кеширование популярных брендов**
```javascript
// Central Lechera, M&M's, Coca-Cola часто повторяются
// Кешировать результаты поиска на 1 час

const POPULAR_BRANDS_CACHE = new Map();
```

### **4. Улучшенная обработка испанских продуктов**
```javascript
// Проблема: 'tradicional' vs 'traditional'
// Решение: Мультиязычные варианты

const SPANISH_VARIANTS = {
  'tradicional': ['traditional', 'classic'],
  'desnatada': ['skimmed', 'skim'],
  'semidesnatada': ['semi-skimmed', 'semi'],
  'mantequilla': ['butter']
};
```

---

## 🎯 **Приоритетные исправления**

### **Высокий приоритет (эта неделя):**
1. **Валидация GPT ответов** перед OFF поиском
2. **Timeout fallback** для сложных брендов
3. **Улучшенная обработка null brands**

### **Средний приоритет (месяц):**
1. **Улучшение GPT prompt** для консистентности
2. **Кеширование популярных брендов**
3. **Мультиязычные варианты** токенов

### **Низкий приоритет (квартал):**
1. **A/B тест разных prompt стратегий**
2. **ML-подход к brand matching**
3. **Crowd-sourcing правил нормализации**

---

## 🚀 **Готовые к реализации исправления**

Хотите, чтобы я реализовал **валидацию GPT ответов** и **timeout fallback** прямо сейчас?

Это решит основные проблемы:
- Противоречивые данные от GPT
- Timeout'ы на сложных брендах  
- Null brands в правильных продуктах
