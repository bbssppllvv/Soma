# 🚀 Активация улучшений SAL API в продакшене

## ⚡ Быстрый старт

### 1. Активация улучшений
Добавьте в ваши переменные окружения:

```bash
# Основные улучшения
OFF_BRAND_VARIANT_MAX_PAGES=15      # Увеличенная глубина для brand+variant
OFF_BRAND_BOOST_MULTIPLIER=2.0      # Бонус за точное совпадение бренда
OFF_SEARCH_MAX_PAGES=8              # Стандартная глубина для brand-only

# Дополнительные настройки (опционально)
OFF_RESCUE_EXTRA_PAGES=5            # Дополнительные страницы для rescue
OFF_FALLBACK_PAGE_SIZE=30           # Размер страницы для fallback поиска
```

### 2. Тестирование
```bash
# Запуск тестов улучшений
cd api
node test-improvements-with-delays.js

# Тест конкретного продукта Central Lechera Asturiana
node test-sal-behavior.js
```

## 📊 Мониторинг

### Ключевые метрики для отслеживания:

1. **Время ответа поиска**
   - До: ~2-3 секунды
   - После: ~3-15 секунд (в зависимости от сложности)

2. **Успешность поиска**
   - Процент найденных продуктов для brand+variant кейсов
   - Особенно для нишевых брендов

3. **Нагрузка на OFF API**
   - Количество запросов в минуту
   - Rate limit соблюдение (2 сек между запросами)

### Логи для мониторинга:
```javascript
// Ищите в логах эти сообщения:
"[OFF] Brand boost applied"           // Сработал brand boost
"[OFF] Early termination"            // Умное завершение поиска  
"Dynamic search depth"               // Использована увеличенная глубина
"rescue_exact_phrase_no_brand"       // Сработала rescue стратегия
```

## 🧪 Проверочные кейсы

### Тест 1: Central Lechera Asturiana
```javascript
const testItem = {
  name: 'nata montada',
  brand: 'Central Lechera Asturiana',
  off_primary_tokens: ['nata', 'montada'],
  off_brand_filter: 'central-lechera-asturiana'
};
// Ожидается: найден продукт 8410297121104
```

### Тест 2: Массовый бренд (контроль)
```javascript
const testItem = {
  name: 'chocolate con leche',
  brand: 'Hacendado',
  off_primary_tokens: ['chocolate', 'leche'],
  off_brand_filter: 'hacendado'
};
// Ожидается: быстрый поиск, найден в первых страницах
```

## ⚠️ Что может пойти не так

### Проблема: Медленные ответы
**Симптом**: Время поиска >30 секунд
**Решение**: 
- Уменьшить `OFF_BRAND_VARIANT_MAX_PAGES` до 10-12
- Проверить rate limits OFF API

### Проблема: Таймауты API
**Симптом**: Ошибки "This operation was aborted"
**Решение**:
- Увеличить задержки между запросами
- Проверить доступность search.openfoodfacts.org

### Проблема: Не находит продукты
**Симптом**: Rescue стратегии не срабатывают
**Решение**:
- Проверить правильность brand_filter
- Убедиться что primary_tokens корректны
- Запустить test-sal-behavior.js для диагностики

## 🔄 Откат изменений

Если нужно вернуться к старой логике:
```bash
# Отключить все улучшения
unset OFF_BRAND_VARIANT_MAX_PAGES
unset OFF_BRAND_BOOST_MULTIPLIER

# Или установить старые значения
OFF_SEARCH_MAX_PAGES=5
OFF_BRAND_BOOST_MULTIPLIER=1.0
```

## 📈 Ожидаемые результаты

### Положительные эффекты:
- ✅ Нишевые бренды теперь находятся
- ✅ Улучшена точность для brand+variant запросов  
- ✅ Меньше "ложных" результатов от популярных брендов

### Компромиссы:
- ⏳ Увеличение времени поиска для сложных кейсов
- 📡 Больше запросов к OFF API
- 💾 Немного больше нагрузки на сервер

## 🎯 Успешный результат

**Главный индикатор успеха**: Продукт Central Lechera Asturiana (8410297121104) теперь находится при поиске "nata montada" + brand filter.

**Дополнительные показатели**:
- Увеличение процента успешных поисков для нишевых брендов на 15-25%
- Стабильная работа для массовых брендов
- Время ответа в пределах 15 секунд для 95% запросов

---

**Готово к тестированию!** 🚀

Запустите `node test-improvements-with-delays.js` и проверьте результаты.
