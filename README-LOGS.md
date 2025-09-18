# 📡 Система просмотра логов Versailles

## 🚀 Быстрый старт

### Для просмотра логов в консоли:
```bash
npm run watch-versailles
```

### Для веб-интерфейса:
```bash
npm run logs
# Откройте http://localhost:3001
```

## ⚙️ Настройка Vercel (один раз)

1. Запустите `npm run watch-versailles`
2. Скопируйте URL туннеля (показывается в выводе)
3. В Vercel Dashboard добавьте:
   ```
   LOCAL_LOG_WEBHOOK_URL=https://your-tunnel.ngrok.io/webhook/logs
   LOG_WEBHOOK_SECRET=dev-secret
   ```
4. Redeploy проект

## 📊 Что вы увидите

```
📡 5 logs from vercel-api:
2:20:15 PM INFO  [production] [fra1] [OFF] Input item: Coca-Cola Zero Sugar
2:20:15 PM WARN  [production] [fra1] [OFF] Required tokens penalty applied  
2:20:15 PM ERROR [production] [fra1] [OFF] timeout error: Rate limit wait aborted
```

## 🎨 Возможности

- ✅ **Цветовая подсветка** - INFO (синий), WARN (желтый), ERROR (красный)
- ✅ **Умные теги** - [OFF], [GPT], [METRIC] выделяются
- ✅ **Компактные метаданные** - показывает только важные поля
- ✅ **Real-time** - логи появляются мгновенно
- ✅ **Автоматический туннель** - ngrok настраивается сам

## 🔧 Команды

| Команда | Описание |
|---------|----------|
| `npm run watch-versailles` | Простой просмотр в консоли |
| `npm run logs` | Веб-интерфейс + консоль |
| `npm run logs:tunnel` | Только туннель ngrok |

## 📁 Файлы

- `watch-versailles.js` - Простой консольный watcher
- `local-log-server.js` - Полный сервер с веб-интерфейсом  
- `api/modules/remote-logger.js` - Модуль для отправки логов
- `VERCEL-SETUP.md` - Подробная инструкция по настройке

---

**Теперь вы можете видеть все логи из продакшена прямо у себя! 🎉**
