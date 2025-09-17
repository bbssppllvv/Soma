# 🚀 Vercel Deployment Guide

## После обновления OFF интеграции

### 📋 Environment Variables для Vercel Dashboard

Добавьте следующие переменные в Vercel Dashboard (`Settings` → `Environment Variables`):

#### Обязательные OFF настройки:
```bash
OFF_ENABLED=true
OFF_BASE_URL=https://world.openfoodfacts.org
OFF_SEARCH_BASE_URL=https://search.openfoodfacts.org
OFF_USER_AGENT=SomaDietTracker/1.0 (support@yourdomain.com)
OFF_LANG=en
OFF_TIMEOUT_MS=3000
OFF_GLOBAL_BUDGET_MS=3000
OFF_REQUIRE_BRAND=false
```

#### Рекомендуемые настройки производительности:
```bash
OFF_SEARCH_TIMEOUT_MS=600
OFF_SEARCH_PAGE_SIZE=5
OFF_CACHE_TTL_MS=10800000
OFF_BRAND_THRESHOLD=0.7
OFF_SEARCH_MAX_TOKENS=10
OFF_SEARCH_REFILL_MS=60000
OFF_SEARCH_POLL_MS=500
```

#### Другие необходимые переменные:
```bash
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
OPENAI_API_KEY=your_openai_api_key_here
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
TIMEZONE_DEFAULT=Europe/Madrid
NODE_ENV=production
```

### 🔧 Настройки Vercel

#### vercel.json обновлен с:
- ✅ Кеширование API ответов (60s + stale-while-revalidate)
- ✅ Memory: 1024MB (достаточно для OFF requests)
- ✅ MaxDuration: 30s (больше чем OFF_GLOBAL_BUDGET_MS=3s)

#### Новые возможности после обновления:
- ✅ **Search-a-licious POST API** - современный поиск продуктов
- ✅ **Автоматический fallback** - на legacy API при сбоях
- ✅ **Улучшенная производительность** - 79-229ms ответы
- ✅ **Лучшая обработка ошибок** - graceful degradation

### 🚀 Deployment Steps

1. **Commit changes:**
```bash
git add .
git commit -m "feat: Complete OFF Search-a-licious integration"
git push origin master
```

2. **В Vercel Dashboard:**
   - Перейти в `Settings` → `Environment Variables`
   - Добавить все переменные из списка выше
   - Нажать `Save`

3. **Redeploy:**
   - Vercel автоматически пересоберет при push
   - Или вручную: `Deployments` → `Redeploy`

### ✅ Проверка после деплоя

Протестируйте в Telegram боте:
- 📊 Поиск по штрихкоду
- 🔍 Поиск продуктов по названию
- 🏷️ Поиск с брендом (Philadelphia, Coca-Cola)
- 🍅 Поиск без бренда (tomato, yogurt)

### 🔍 Мониторинг

В Vercel Functions logs ищите:
- `[OFF] search v3 POST` - успешные поиски
- `[OFF] Falling back to legacy search` - фоллбеки
- Время ответа должно быть < 3000ms

### 🛠 Troubleshooting

**Если OFF не работает:**
1. Проверьте `OFF_ENABLED=true` в Environment Variables
2. Убедитесь что все OFF_* переменные установлены
3. Проверьте Function logs в Vercel Dashboard

**Если медленно:**
- Уменьшите `OFF_SEARCH_PAGE_SIZE` до 3
- Увеличьте `OFF_CACHE_TTL_MS` для лучшего кеширования
