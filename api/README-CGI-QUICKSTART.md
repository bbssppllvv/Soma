# 🚀 CGI Search Quick Start

## Активация CGI поиска

```bash
# Установить переменную среды
export OFF_USE_CGI_SEARCH=true

# Или в .env файле
echo "OFF_USE_CGI_SEARCH=true" >> .env
```

## Тестирование

```bash
# Сравнительный тест SAL vs CGI
./run-sal-vs-cgi-test.sh

# Тест CGI интеграции
./run-cgi-test.sh
```

## Результаты

**CGI API в 216 раз точнее для нишевых брендов!**

| Продукт | SAL | CGI | Улучшение |
|---------|-----|-----|-----------|
| Central Lechera Asturiana | позиция 216 | **позиция 1** | **216x** |

## Логи

```
[OFF] CGI query - используется CGI API ✅
[OFF] query - используется SAL API
```

## Подробности

См. `CGI-SEARCH-IMPLEMENTATION.md` для полной документации.
