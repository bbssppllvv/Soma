# ⚙️ Настройка Vercel для удаленных логов

## 🎯 Быстрая настройка

### 1. Запустите watcher
```bash
npm run watch-versailles
```

Вы увидите что-то вроде:
```
✅ Tunnel active: https://abc123.ngrok.io
```

### 2. Скопируйте URL и добавьте в Vercel

Перейдите в [Vercel Dashboard](https://vercel.com/dashboard) → Ваш проект → Settings → Environment Variables

Добавьте эти переменные:

```bash
LOCAL_LOG_WEBHOOK_URL=https://abc123.ngrok.io/webhook/logs
LOG_WEBHOOK_SECRET=dev-secret
```

### 3. Redeploy проект

В Vercel Dashboard → Deployments → нажмите "Redeploy" на последнем деплойменте.

**Готово!** Теперь все логи из продакшена будут появляться в вашей консоли.

## 🔍 Что вы увидите

```
📡 5 logs from vercel-api:
2:20:15 PM INFO  [production] [fra1] [OFF] === RESOLVING ITEM START === {"stage":"resolve_start"}
2:20:15 PM INFO  [production] [fra1] [OFF] Input item: Coca-Cola Zero Sugar {"brand":"Coca-Cola","clean_name":"cola"}
2:20:15 PM INFO  [production] [fra1] [OFF] Search strategy found products {"strategy":"brand_primary","products_found":40}
2:20:15 PM WARN  [production] [fra1] [OFF] Required tokens penalty applied {"penalty":-200,"missing_tokens":["semi"]}
2:20:15 PM ERROR [production] [fra1] [OFF] timeout error: Rate limit wait aborted {"stage":"v2_strict","error":"Rate limit wait aborted"}
```

## 🎨 Цветовая схема

- **🔵 INFO** - Обычная информация (синий)
- **🟡 WARN** - Предупреждения (желтый)  
- **🔴 ERROR** - Ошибки (красный)
- **⚫ DEBUG** - Отладочная информация (серый)

## 🏷️ Теги

- **[OFF]** - Логи поиска продуктов (зеленый)
- **[GPT]** - Логи анализа GPT (фиолетовый)
- **[METRIC]** - Метрики производительности (синий)

## 🐛 Устранение проблем

### Логи не приходят
1. Проверьте переменные в Vercel Dashboard
2. Убедитесь что ngrok туннель активен
3. Сделайте redeploy в Vercel
4. Проверьте что бот получает запросы

### Ошибка "Port 3001 in use"
```bash
# Найти и убить процесс на порту 3001
lsof -ti:3001 | xargs kill -9
npm run watch-versailles
```

### ngrok не работает
```bash
# Установить ngrok
npm install -g @ngrok/ngrok

# Или использовать npx (автоматически)
npx ngrok http 3001
```

## 🔄 Альтернативные команды

```bash
# Простой watcher (только консоль)
npm run watch-versailles

# Полный log server (с веб-интерфейсом)
npm run logs

# Только туннель
npm run logs:tunnel
```

---

**Готово!** Теперь вы можете отлаживать продакшн в реальном времени! 🎉
