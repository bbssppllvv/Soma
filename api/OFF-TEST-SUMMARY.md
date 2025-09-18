# OpenFoodFacts API Testing Suite - Итоговый отчет

## 🎯 Цель
Системно проверить работу OFF API на типовых сценариях, выявить паттерны ошибок и получить живую матрицу для оптимизации кода.

## 📊 Результаты тестирования

### Общая статистика
- **Протестировано продуктов:** 11
- **Общее количество API-вызовов:** 236
- **Время тестирования:** 341.6 секунд
- **Success Rate:** 100% (но 0 результатов!)

### 🚨 Критические проблемы выявлены

#### 1. Rate Limiting и Timeouts
```
[METRIC] off_rate_limit_aborts - множественные случаи
[OFF] search v2 error - Rate limit wait aborted
[OFF] legacy search aborted - Rate limit wait aborted
```

#### 2. SaL API (Search-a-licious) проблемы
```
[OFF] POST error 500 (https://search.openfoodfacts.org/search)
[METRIC] off_sal_5xx - Internal Server Error
```

#### 3. Нормализация брендов
- **M&M's** → проблемы с апострофами и амперсандами
- **Ben & Jerry's** → множественные спецсимволы
- **Central Lechera Asturiana** → многословные бренды
- **Coca-Cola** → дефисы vs пробелы

## 🔍 Ключевые находки

### Паттерны ошибок
1. **Rate Limiting**: Система сразу упирается в лимиты запросов
2. **SaL 500 ошибки**: Lucene-запросы вызывают внутренние ошибки сервера
3. **Timeout cascade**: При превышении бюджета времени все последующие этапы пропускаются
4. **Brand fragmentation**: Сложные бренды ломают поиск

### Lucene Query Problems
```lucene
// Проблематичные запросы:
brands:"Ben & Jerry's"^4 AND categories_tags:"en:ice-creams" 
AND (product_name:("cookie dough"~2^3) OR product_name:("cookie"^1.5 OR "dough"^1.5))

// Результат: 500 Internal Server Error
```

### Стратегии производительности
- **main_pipeline**: 3000ms (полный пайплайн с fallback)
- **brand_with_product**: 1000ms (комбинированный запрос)
- **product_only**: 800ms (самый быстрый)

## 💡 Рекомендации

### Высокий приоритет
1. **Увеличить timeout'ы**:
   - SaL: 500ms → 800ms+
   - v2 strict: 900ms → 1200ms
   - Legacy: 400ms → 600ms

2. **Исправить нормализацию брендов**:
   ```javascript
   function normalizeBrand(brand) {
     return brand
       .replace(/&/g, 'and')
       .replace(/'/g, '')
       .replace(/-/g, ' ')
       .toLowerCase()
       .trim();
   }
   ```

3. **Добавить rate limiting protection**:
   ```javascript
   const RATE_LIMIT_DELAY = 100; // ms между запросами
   const MAX_CONCURRENT = 2; // максимум параллельных запросов
   ```

### Средний приоритет
4. **Упростить Lucene-запросы** для SaL API
5. **Добавить fallback на простые запросы** при 500 ошибках
6. **Оптимизировать категории** - многие не находятся

### Низкий приоритет
7. **Добавить кеширование** неудачных запросов
8. **Улучшить логирование** для продакшена

## 🛠️ Конкретные исправления

### 1. Rate Limiting
```javascript
// В off-client.js, увеличить bucket capacity
const SEARCH_BUCKET_CAPACITY = 20; // было 10
const SEARCH_BUCKET_REFILL_MS = 30000; // было 60000
```

### 2. Timeouts
```javascript
// Увеличить все timeout'ы в 1.5-2 раза
const SAL_TIMEOUT_MS = 800; // было 500
const V2_STRICT_TIMEOUT_MS = 1200; // было 900
const LEGACY_TIMEOUT_MS = 600; // было 400
```

### 3. Brand Normalization
```javascript
// Улучшить функцию toBrandSlug
function toBrandSlug(value) {
  return canonicalizeQuery(value || '')
    .replace(/&/g, 'and')
    .replace(/'/g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, '-')
    .toLowerCase();
}
```

### 4. SaL Error Handling
```javascript
// Добавить fallback при 500 ошибках
if (error?.status >= 500) {
  console.log('[OFF] SaL 5xx error, skipping to v2');
  return null; // Skip to next stage
}
```

## 📈 Метрики для мониторинга

1. **off_sal_5xx** - ошибки SaL API
2. **off_rate_limit_aborts** - превышения лимитов
3. **off_pipeline_empty** - пустые результаты
4. **off_v2_timeout** - timeout'ы v2 API

## 🎯 Следующие шаги

1. ✅ **Реализовать исправления** выше
2. 🔄 **Перезапустить тесты** с новыми настройками
3. 📊 **Сравнить результаты** до/после
4. 🚀 **Развернуть в продакшен** при улучшении показателей

## 📁 Файлы результатов
- `raw-results.json` - полные данные тестов
- `results-summary.csv` - таблица результатов
- `performance-report.md` - детальная производительность
- `pattern-analysis.md` - анализ паттернов
- `issues-and-recommendations.md` - проблемы и решения

---

**Вывод**: OFF API работает, но требует серьезной настройки rate limiting'а, timeout'ов и нормализации брендов. Текущие настройки слишком агрессивные для реального использования.
