# 👀 Watch Versailles - Simple Console Logging

Простой способ видеть логи из продакшена прямо в консоли.

## 🚀 Быстрый старт

```bash
npm run watch-versailles
```

**Всё!** Скрипт автоматически:
- ✅ Запустит webhook сервер на порту 3001
- ✅ Создаст ngrok туннель
- ✅ Покажет инструкции для настройки Vercel
- ✅ Будет выводить все логи в консоль с цветовой подсветкой

## 📋 Что нужно сделать один раз

После запуска скрипт покажет что-то вроде:

```
📋 Setup Instructions for Vercel:
──────────────────────────────────────────────────
1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add these variables:
   LOCAL_LOG_WEBHOOK_URL=https://abc123.ngrok.io/webhook/logs
   LOG_WEBHOOK_SECRET=dev-secret
3. Redeploy your project or wait for next deployment
──────────────────────────────────────────────────
🎉 Ready! Logs will appear below when received from Versailles.
```

Просто скопируйте переменные и добавьте их в Vercel Dashboard.

## 🎨 Что вы увидите

```
📡 5 logs from vercel-api:
2:15:30 PM INFO  [production] [fra1] [OFF] Input item: Coca-Cola Zero Sugar {"brand":"Coca-Cola"}
2:15:31 PM INFO  [production] [fra1] [OFF] Search strategy found products {"products_found":40}
2:15:31 PM WARN  [production] [fra1] [OFF] Required tokens penalty applied {"penalty":-200}
2:15:32 PM INFO  [production] [fra1] [OFF] Final Decision: selected product {"score":1070}
2:15:33 PM ERROR [production] [fra1] [OFF] timeout error: Rate limit wait aborted {"stage":"v2_strict"}
```

## 🎯 Особенности

- **🌈 Цветовая подсветка**: INFO (синий), WARN (желтый), ERROR (красный)
- **🔍 Умное форматирование**: Выделяет [OFF], [GPT], [METRIC] теги
- **📊 Компактная мета-информация**: Показывает только важные поля
- **🚀 Автоматическая настройка**: Ngrok туннель создается автоматически
- **⚡ Мгновенные логи**: Появляются сразу же как происходят в продакшене

## 🛑 Остановка

Просто нажмите `Ctrl+C` - всё автоматически закроется.

## 🐛 Проблемы

### ngrok не установлен
```bash
npm install -g @ngrok/ngrok
# или используйте npx (автоматически)
```

### Логи не приходят
1. Проверьте переменные в Vercel Dashboard
2. Убедитесь что ngrok туннель активен (показывает URL)
3. Попробуйте redeploy проекта в Vercel

### Порт 3001 занят
```bash
# Найти процесс на порту 3001
lsof -i :3001

# Убить процесс
kill -9 <PID>
```

---

**Готово!** Теперь у вас есть простой способ видеть все логи Versailles прямо в терминале! 🎉
