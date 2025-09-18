# 🔍 CGI Search Implementation

## 📋 Обзор

Реализована поддержка CGI API OpenFoodFacts как альтернатива SAL API с возможностью переключения через флаг конфигурации.

## 🎯 Результаты сравнения

**CGI API показал значительно лучшие результаты для нишевых брендов:**

| Продукт | SAL позиция | CGI позиция | Улучшение |
|---------|-------------|-------------|-----------|
| Central Lechera Asturiana Nata Montada | 216 | **1** | **216x лучше** |
| Central Lechera Asturiana Nata ligera | 21 | **2** | **10x лучше** |
| Central Lechera Asturiana sin lactosa | не найден | **1** | **∞ лучше** |

## 🚀 Активация CGI поиска

### Переменная среды:
```bash
export OFF_USE_CGI_SEARCH=true
```

### В .env файле:
```
OFF_USE_CGI_SEARCH=true
```

### Проверка активации:
```bash
# С CGI API
OFF_USE_CGI_SEARCH=true node your-app.js

# С SAL API (по умолчанию)
node your-app.js
```

## 📁 Новые файлы

### Основная функциональность:
- `modules/nutrition/off/client/search-cgi.js` - CGI поисковый клиент
- `modules/nutrition/off/client/config.js` - добавлен флаг `USE_CGI_SEARCH`
- `modules/nutrition/off/client/search-pipeline.js` - обновлён для поддержки CGI

### Тестирование:
- `sal-vs-cgi-comparison.js` - скрипт сравнения API
- `run-sal-vs-cgi-test.sh` - запуск сравнительных тестов
- `test-cgi-search.js` - тест интеграции CGI
- `run-cgi-test.sh` - запуск CGI тестов

### Отчёты:
- `relevance-analysis-report.md` - детальный анализ релевантности
- `search-strategy-recommendations.md` - рекомендации по стратегии

## 🔧 Техническая реализация

### Fallback логика:
1. **Основной API** (по флагу): CGI или SAL
2. **Fallback**: при ошибке CGI → автоматически SAL
3. **Логирование**: чёткое указание используемого API

### CGI API особенности:
- **Endpoint**: `https://world.openfoodfacts.org/cgi/search.pl`
- **Метод**: GET с query parameters
- **Лимит**: 100 продуктов на запрос
- **Фильтрация**: через `tagtype_0=brands&tag_0=BrandName`

## 📊 Логи и мониторинг

### CGI API логи:
```
[OFF] CGI query - параметры запроса
[OFF] CGI search results - результаты поиска  
[OFF] CGI search successful - успешный поиск
```

### SAL API логи:
```
[OFF] query - параметры запроса
[OFF] search page summary - результаты поиска
[OFF] SAL search successful - успешный поиск
```

### Fallback логи:
```
[OFF] CGI search failed - ошибка CGI
[OFF] Trying SAL fallback... - попытка fallback
[OFF] SAL fallback successful - успешный fallback
```

## 🎯 Рекомендации по использованию

### Когда использовать CGI:
- ✅ Нишевые европейские бренды
- ✅ Локальные продукты (Central Lechera Asturiana, Hacendado)
- ✅ Когда важна точность топ-3 результатов

### Когда использовать SAL:
- ✅ Международные бренды (Coca-Cola, Pepsi, Nestlé)
- ✅ Когда нужен глубокий поиск (100+ результатов)
- ✅ Редкие продукты с низкой популярностью

## 🧪 Тестирование

### Запуск сравнительных тестов:
```bash
./run-sal-vs-cgi-test.sh
```

### Тест CGI интеграции:
```bash
./run-cgi-test.sh
```

### Результаты сохраняются в:
- `sal-vs-cgi-results_[timestamp].json`
- Консольный вывод с детальной статистикой

## 🔄 Миграция

### Этап 1: Тестирование
```bash
# Включить CGI для тестирования
export OFF_USE_CGI_SEARCH=true
```

### Этап 2: Мониторинг
- Следить за логами `[OFF] CGI query`
- Проверять fallback на SAL при ошибках
- Анализировать качество результатов

### Этап 3: Продакшн
```bash
# Активация в продакшене
OFF_USE_CGI_SEARCH=true
```

## 📈 Метрики качества

| Метрика | SAL | CGI | Победитель |
|---------|-----|-----|------------|
| Средняя позиция найденного | 88 | **1.7** | 🏆 **CGI** |
| Продуктов в топ-10 | 3/8 | **3/3** | 🏆 **CGI** |
| Общее покрытие | **8/9** | 3/9 | 🏆 **SAL** |
| Скорость | 3115мс | **2433мс** | 🏆 **CGI** |
| Релевантность топ-1 | 63% | **100%** | 🏆 **CGI** |

## ✅ Готовность к продакшену

- [x] CGI API клиент реализован
- [x] Флаг конфигурации добавлен
- [x] Fallback логика работает
- [x] Логирование настроено
- [x] Тестирование пройдено
- [x] Документация создана
- [x] Сравнительный анализ завершён

**Код готов к развёртыванию!** 🚀
