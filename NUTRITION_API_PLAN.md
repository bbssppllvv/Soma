# 🍎 План интеграции с Nutrition API

## 🎯 Цель
Подготовить систему для интеграции с внешними nutrition API (USDA FoodData Central, Edamam, Spoonacular) для более точного анализа питания на основе стандартизированных данных о продуктах.

## 📊 Текущая система (AI-based)

### ✅ Что у нас есть сейчас:
- AI анализ фото и текста с GPT-5
- Оценка калорий, макронутриентов, клетчатки
- Персонализированные советы на основе целей
- **НОВОЕ**: Стандартизированные названия продуктов
- **НОВОЕ**: Оценка размера порций в граммах и визуально
- **НОВОЕ**: Описание порций для пользователя

### 🔄 Как работает анализ сейчас:
```
1. Пользователь → Фото/текст
2. AI → Анализ + название + размер порции
3. Результат → "Grilled Chicken Breast, 150g (palm-sized)"
4. Сохранение → База данных с полной информацией
```

## 🚀 Будущая система (API + AI hybrid)

### 📋 Этапы интеграции:

#### **Этап 1: Подготовка данных** ✅ (готово)
- [x] Стандартизированные названия продуктов
- [x] Размеры порций в граммах  
- [x] Визуальные описания порций
- [x] Обновленная схема базы данных

#### **Этап 2: API интеграция** (будущее)
- [ ] Интеграция с USDA FoodData Central API
- [ ] Система поиска продуктов по названию
- [ ] Маппинг AI названий на API продукты
- [ ] Кэширование данных о продуктах

#### **Этап 3: Гибридная система** (будущее)
- [ ] AI определяет продукт + размер порции
- [ ] API предоставляет точные данные о питании
- [ ] Комбинированный результат для пользователя

## 🗄️ Структура базы данных

### 📋 Текущие поля в `entries`:
```sql
-- Основные поля питания (есть)
calories INTEGER,
protein_g NUMERIC,
fat_g NUMERIC,
carbs_g NUMERIC,
fiber_g NUMERIC,

-- НОВЫЕ поля для порций (добавлены)
food_name VARCHAR(100),           -- "Grilled Chicken Breast"
portion_size VARCHAR(50),         -- "150g" или "1 medium"
portion_description VARCHAR(100), -- "palm-sized piece"
```

### 🔮 Будущие таблицы для API:
```sql
-- Таблица стандартных продуктов (будущее)
CREATE TABLE food_database (
  id UUID PRIMARY KEY,
  api_food_id VARCHAR(50),        -- ID из внешнего API
  standardized_name VARCHAR(100), -- "Chicken Breast, Grilled"
  api_source VARCHAR(20),         -- "usda", "edamam"
  calories_per_100g INTEGER,
  protein_per_100g NUMERIC,
  fat_per_100g NUMERIC,
  carbs_per_100g NUMERIC,
  fiber_per_100g NUMERIC,
  last_updated TIMESTAMP
);

-- Таблица маппинга AI → API (будущее)  
CREATE TABLE food_mapping (
  id UUID PRIMARY KEY,
  ai_food_name VARCHAR(100),      -- Название от AI
  api_food_id VARCHAR(50),        -- Соответствующий API ID
  confidence_score NUMERIC,       -- Точность маппинга
  created_at TIMESTAMP
);
```

## 🔧 API интеграция (план)

### **1. USDA FoodData Central API**
```javascript
// Поиск продукта по названию
const searchFood = async (foodName) => {
  const response = await fetch(
    `https://api.nal.usda.gov/fdc/v1/foods/search?query=${foodName}&api_key=${API_KEY}`
  );
  return response.json();
};

// Получение детальной информации
const getFoodDetails = async (fdcId) => {
  const response = await fetch(
    `https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${API_KEY}`
  );
  return response.json();
};
```

### **2. Гибридный анализ (будущее)**
```javascript
async function hybridFoodAnalysis(photo, text, userContext) {
  // 1. AI анализ для определения продукта и порции
  const aiResult = await analyzeWithAI(photo, text, userContext);
  
  // 2. Поиск в API по стандартизированному названию
  const apiData = await searchNutritionAPI(aiResult.food_name);
  
  // 3. Расчет питания на основе API данных и AI порции
  const preciseNutrition = calculateFromAPI(apiData, aiResult.portion_size);
  
  // 4. Комбинированный результат
  return {
    ...preciseNutrition,
    portion_info: aiResult.portion_info,
    confidence: aiResult.confidence * apiData.match_confidence
  };
}
```

## 📊 Преимущества новой системы

### **Текущие улучшения:**
✅ **Лучший контекст для AI**: размеры порций помогают более точной оценке
✅ **Стандартизированные данные**: готовность к API интеграции  
✅ **Понятность для пользователя**: визуальные описания порций
✅ **База для аналитики**: можно анализировать размеры порций пользователей

### **Будущие возможности:**
🔮 **Точность питания**: API данные вместо AI оценок
🔮 **Большая база продуктов**: миллионы продуктов из USDA
🔮 **Персональные рекомендации**: на основе истории продуктов
🔮 **Умные предложения**: "Вы часто едите курицу, попробуйте рыбу"

## 🚀 Следующие шаги

### **Сейчас (готово к деплою):**
1. ✅ Обновить схему `entries` (запустить `entries_update.sql`)
2. ✅ AI теперь оценивает размеры порций
3. ✅ Пользователи видят детальную информацию о порциях
4. ✅ Данные сохраняются для будущего API использования

### **В будущем:**
1. 🔮 Выбрать nutrition API (USDA бесплатный)
2. 🔮 Создать систему маппинга AI → API
3. 🔮 Добавить кэширование популярных продуктов
4. 🔮 Реализовать гибридный анализ

## 💡 Готовность к API

Наша система уже готова к интеграции с любым nutrition API благодаря:
- Стандартизированным названиям продуктов
- Точным оценкам размеров порций
- Гибкой структуре данных
- Модульной архитектуре кода

**Когда будем готовы к API - просто добавим новый слой поверх существующей системы!** 🎯
