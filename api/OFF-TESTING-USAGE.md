# OpenFoodFacts Testing Suite - Инструкция по использованию

## 🚀 Быстрый старт

### 1. Запуск полного тестирования
```bash
# Запуск всех тестов с анализом
./run-off-tests.sh

# Или вручную:
node off-search-tester.js --verbose --output-dir ./results
node off-pattern-analyzer.js ./results
```

### 2. Запуск конкретных категорий
```bash
node off-search-tester.js --categories dairy,beverages --verbose
```

### 3. Запуск конкретных стратегий
```bash
node off-search-tester.js --strategies main_pipeline,product_only --verbose
```

## 📋 Доступные опции

### off-search-tester.js
- `--output-dir DIR` - директория для результатов (по умолчанию: ./off-test-results)
- `--timeout MS` - глобальный timeout на тест (по умолчанию: 5000)
- `--verbose` - подробные логи
- `--categories CAT` - тестировать только указанные категории (через запятую)
- `--strategies STRAT` - тестировать только указанные стратегии (через запятую)
- `--help` - справка

### Доступные категории
- `dairy` - молочные продукты
- `beverages` - напитки  
- `snacks` - снеки
- `plant-based` - растительные продукты
- `test` - стресс-тесты

### Доступные стратегии
- `main_pipeline` - основной пайплайн (SaL + v2 + Legacy)
- `brand_with_product` - бренд + продукт в одном запросе
- `brand_separate` - бренд как отдельный фильтр
- `product_only` - только название продукта

## 📊 Результаты тестирования

После запуска создается директория с результатами:
```
off-test-results/
├── raw-results.json              # Полные данные тестов
├── results-summary.csv           # Таблица результатов
├── performance-report.md         # Отчет по производительности
├── issues-and-recommendations.md # Проблемы и рекомендации
├── pattern-analysis.json         # JSON анализа паттернов
└── pattern-analysis.md           # Markdown анализа паттернов
```

## 🔧 Добавление новых тестов

### 1. Добавить продукт в TEST_PRODUCTS
```javascript
{
  id: 'new_product',
  category: 'dairy',
  brand: 'Brand Name',
  product_name: 'product description',
  clean_name: 'clean product name',
  required_tokens: ['variant', 'tokens'],
  canonical_category: 'dairy',
  
  // Реальный Lucene-запрос из логов (опционально)
  expected_lucene: `brands:"brand"^4 AND categories_tags:"en:category"`,
  
  variations: [
    { query: 'Brand Name product', strategy: 'standard' },
    { query: 'brand product variant', strategy: 'with_variant' }
  ],
  
  expected_brands: ['brand-name'],
  expected_categories: ['en:category'],
  known_issues: ['normalization issue', 'special characters']
}
```

### 2. Добавить новую стратегию поиска
```javascript
new_strategy: {
  name: 'New Strategy Description',
  timeout: 1000,
  run: async (query, options) => {
    // Логика стратегии
    return await searchByNameV1(query.term, {
      signal: options.signal,
      // ... параметры
    });
  }
}
```

## 📈 Интерпретация результатов

### Success Rate
- **100% с 0 результатов** = API работает, но ничего не находит
- **<100%** = есть ошибки/timeout'ы
- **>0 результатов** = находит продукты

### Время выполнения
- **main_pipeline: ~3000ms** - полный пайплайн
- **brand_separate: ~1000ms** - один этап
- **product_only: ~800ms** - самый быстрый

### Типичные ошибки
- `Rate limit wait aborted` - превышение лимитов
- `OFF 500` - ошибки SaL API
- `timeout` - превышение времени
- `empty_query` - пустой запрос после нормализации

## 🚨 Troubleshooting

### Проблема: Rate limiting
```bash
# Увеличить интервалы между запросами
export OFF_SEARCH_REFILL_MS=30000  # было 60000
export OFF_SEARCH_MAX_TOKENS=20    # было 10
```

### Проблема: Timeout'ы
```bash
# Увеличить timeout'ы
export OFF_SAL_TIMEOUT_MS=800      # было 500
export OFF_V2_STRICT_TIMEOUT_MS=1200  # было 900
export OFF_GLOBAL_BUDGET_MS=5000   # было 3000
```

### Проблема: SaL 500 ошибки
- Упростить Lucene-запросы
- Убрать спецсимволы из брендов
- Использовать fallback на v2/legacy

## 🎯 Рекомендуемый workflow

1. **Baseline тест**: запустить с текущими настройками
2. **Анализ проблем**: изучить pattern-analysis.md
3. **Применить фиксы**: из recommendations
4. **Повторный тест**: сравнить результаты
5. **Production deploy**: при улучшении метрик

## 📝 Логирование

### Ключевые метрики для мониторинга
- `[METRIC] off_sal_5xx` - ошибки SaL
- `[METRIC] off_rate_limit_aborts` - rate limiting
- `[METRIC] off_pipeline_empty` - пустые результаты
- `[METRIC] off_v2_timeout` - timeout'ы v2

### Debug режим
```bash
# Включить verbose логи
node off-search-tester.js --verbose

# Отключить кеш для тестирования
export OFF_CACHE_TTL_MS=0
```

---

**💡 Совет**: Начните с малого набора продуктов (`--categories dairy`) для быстрой итерации, затем масштабируйте на все категории.
