# Nutrition Analysis Module

## Шаг 1: Фундамент (✅ Завершен)

Создан единый контракт данных и нормализатор, готовый к подключению внешних провайдеров питания.

## Шаг 2: OFF под фичефлагом (✅ Завершен)

Подключен OpenFoodFacts API под фичефлагом `OFF_ENABLED=false` (выключен по умолчанию).

### Структура

- `contract.js` - Единый контракт `GPT_NUTRITION_SCHEMA` для всех провайдеров
- `units.js` - Утилиты для конвертации единиц измерения в граммы
- `simple-cache.js` - In-memory кеш для serverless окружения
- `off-client.js` - HTTP клиент для OpenFoodFacts API с retry логикой
- `off-map.js` - Маппинг данных OFF в стандартный формат нутриентов
- `off-resolver.js` - Резолв продуктов по UPC/названию + скоринг
- `resolve-pipeline.js` - Главный пайплайн обработки items[] через OFF
- `README.md` - Документация модуля

### Изменения в ai-analysis.js

1. **Единая схема**: Оба билдера (фото и текст) используют `GPT_NUTRITION_SCHEMA`
2. **Обязательные поля**: Агрегаты (calories, protein_g, fat_g, carbs_g, fiber_g) теперь required
3. **Надежный парсинг**: `extractFirstJson()` обрабатывает ответы с преамбулой
4. **Нормализатор**: `normalizeAnalysisPayload()` приводит ответы к единому формату
5. **Безопасность**: Микро-гарды в обоих билдерах (фото и текст) для уменьшения галлюцинаций
6. **Совместимость**: `cleanNutritionData()` сохранен как deprecated wrapper
7. **Умная логика**: Автоматическое выставление `needs_clarification=true` при нулевых агрегатах
8. **Дебаг**: Логирование x-request-id для упрощения отладки OpenAI API
9. **OFF интеграция**: `maybeResolveWithOFFIfEnabled()` - условный резолв через OpenFoodFacts
10. **Детерминированные агрегаты**: При `OFF_ENABLED=true` и наличии items[] - точный подсчет из реальных нутриентов

### Переменные окружения

```bash
OFF_ENABLED=false                    # Включение/выключение OFF
OFF_ENABLED_PERCENT=100              # Процент трафика для OFF (0-100)
OFF_BASE_URL=https://world.openfoodfacts.org
OFF_USER_AGENT=SomaDietTracker/1.0 (support@yourdomain.com)
OFF_LANG=en
OFF_TIMEOUT_MS=3500                  # Таймаут запросов к OFF
OFF_CACHE_TTL_MS=10800000           # TTL кеша (3 часа)
```

### Безопасность и надежность

- **По умолчанию выключено**: `OFF_ENABLED=false`
- **Процентный rollout**: `OFF_ENABLED_PERCENT` для постепенного включения
- **Graceful fallback**: При ошибках OFF молча возвращаемся к модельным агрегатам
- **Комбинированные таймауты**: Правильное объединение AbortSignal
- **Фильтрация items**: Только confidence ≥ 0.4, максимум 6 позиций
- **Проверка нутриентов**: Отклонение продуктов без полезных данных
- **Умная конвертация**: Таблица плотностей для ml→g (масло, мед, молоко)
- **Логирование метрик**: Coverage, время, product codes для анализа

### Включение в продакшене

**Постепенный rollout:**
1. `OFF_ENABLED=true` + `OFF_ENABLED_PERCENT=10` (10% трафика)
2. Мониторить логи: coverage, скорость, ошибки
3. Увеличивать до 25%, 50%, 100% по результатам

**Тестовые кейсы:**
- Текст: "chicken breast 150g + rice 200g + olive oil 10ml"
- Фото: паста с соусом
- Item с unit="piece"

**Метрики для мониторинга:**
- Coverage@0.7 (доля успешных резолвов)
- P50 латентность < 2-3с
- Ask-rate (доля needs_clarification)
- Калории масла ≈ 90-92 ккал/10ml (проверка плотности)
