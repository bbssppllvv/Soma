# 📡 Remote Logging Setup - Versailles → Local

Система для просмотра логов из Vercel (продакшн) прямо в локальной среде разработки.

## 🚀 Быстрый старт

### 1. Установка зависимостей

```bash
npm install --save-dev express socket.io cors chalk
```

### 2. Запуск локального сервера логов

```bash
npm run logs
```

Сервер запустится на `http://localhost:3001`

### 3. Настройка туннеля (ngrok)

В отдельном терминале:

```bash
npm run logs:tunnel
```

Скопируйте URL вида: `https://abc123.ngrok.io`

### 4. Настройка переменных окружения в Vercel

Добавьте в Vercel Dashboard:

```bash
LOCAL_LOG_WEBHOOK_URL=https://abc123.ngrok.io/webhook/logs
LOG_WEBHOOK_SECRET=your-secret-key
```

## 🎯 Использование

### Веб-интерфейс

Откройте `http://localhost:3001` для просмотра логов в реальном времени:

- 🔴 **Ошибки** - выделены красным
- 🟡 **Предупреждения** - выделены желтым  
- 🔵 **Информация** - синим цветом
- 🔍 **Поиск** - фильтрация по тексту
- 📊 **Статистика** - счетчики логов

### API эндпоинты

```bash
# Получить последние логи
curl http://localhost:3001/api/logs?limit=50

# Только ошибки
curl http://localhost:3001/api/logs?level=error

# Webhook для Vercel
POST http://localhost:3001/webhook/logs
```

### Консольный вывод

Все логи также дублируются в консоль с цветовой подсветкой:

```
📡 Received 5 logs from vercel-api:
────────────────────────────────────────
14:30:15 INFO [production] [fra1] [OFF] Input item: Coca-Cola Zero Sugar
14:30:16 INFO [production] [fra1] [OFF] Search strategy found 40 products
14:30:16 ERROR [production] [fra1] [OFF] Required tokens penalty applied: -200
────────────────────────────────────────
```

## 🛠️ Интеграция в код

### Базовое логирование

```javascript
import remoteLogger from './modules/remote-logger.js';

// Обычные логи
remoteLogger.info('User action completed', { userId: 123 });
remoteLogger.warn('Rate limit approaching', { remaining: 10 });
remoteLogger.error('Database connection failed', { error: err.message });

// OFF-специфичные логи
remoteLogger.offLog('search', 'Found 5 products', { brand: 'Coca-Cola' });
remoteLogger.offError('timeout', error, { stage: 'v2_strict' });

// GPT логи
remoteLogger.gptLog('Analysis completed', { items: 3, confidence: 0.9 });

// Метрики
remoteLogger.metric('off_search_duration', 1250, { stage: 'sal' });
```

### Замена console.log

```javascript
// Было:
console.log(`[OFF] Found ${products.length} products`);

// Стало:
remoteLogger.offLog('search', `Found ${products.length} products`, { 
  strategy: 'brand_primary' 
});
```

## 🔧 Конфигурация

### Переменные окружения

```bash
# Локально (.env.local)
LOG_SERVER_PORT=3001
LOG_WEBHOOK_SECRET=your-secret-key

# В Vercel
LOCAL_LOG_WEBHOOK_URL=https://your-ngrok-url.ngrok.io/webhook/logs
LOG_WEBHOOK_SECRET=your-secret-key
VERCEL_ENV=production
```

### Настройки логгера

```javascript
// api/modules/remote-logger.js
const remoteLogger = new RemoteLogger({
  maxBufferSize: 100,        // Макс логов в буфере
  flushIntervalMs: 2000,     // Интервал отправки (мс)
  timeout: 5000              // Таймаут HTTP запроса
});
```

## 📊 Особенности

### Автоматическая буферизация
- Логи накапливаются в буфере и отправляются пачками
- Ошибки отправляются немедленно
- Graceful shutdown с финальной отправкой

### Фильтрация и поиск
- Фильтр по уровню логов (error, warn, info, debug)
- Полнотекстовый поиск по сообщениям и метаданным
- Автопрокрутка к новым логам

### Отказоустойчивость
- Продолжает работать при недоступности webhook'а
- Retry логика для неудачных отправок
- Локальное дублирование в console

## 🎨 Кастомизация

### Цветовая схема

Измените CSS в `local-log-server.js`:

```css
.log-error { border-left-color: #f44336; }  /* Красный */
.log-warn { border-left-color: #FF9800; }   /* Оранжевый */
.log-info { border-left-color: #2196F3; }   /* Синий */
.log-debug { border-left-color: #666; }     /* Серый */
```

### Дополнительные поля

Добавьте новые поля в логи:

```javascript
remoteLogger.info('Custom event', {
  userId: 123,
  sessionId: 'abc-123',
  feature: 'nutrition-analysis',
  duration: 1500
});
```

## 🚨 Безопасность

- Используйте HTTPS туннель (ngrok автоматически)
- Установите надежный `LOG_WEBHOOK_SECRET`
- Не логируйте чувствительные данные (токены, пароли)
- Ограничьте размер логов и частоту отправки

## 🐛 Отладка

### Проверка подключения

```bash
# Тест webhook'а
curl -X POST http://localhost:3001/webhook/logs \
  -H "Authorization: Bearer your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"logs":[{"timestamp":"2024-01-01T12:00:00Z","level":"info","message":"Test log","meta":{}}],"source":"test"}'
```

### Проблемы с ngrok

```bash
# Проверить статус туннеля
curl http://localhost:4040/api/tunnels

# Перезапустить туннель
pkill ngrok && npm run logs:tunnel
```

### Логи не приходят

1. Проверьте переменные в Vercel Dashboard
2. Убедитесь что ngrok туннель активен
3. Проверьте что код использует `remoteLogger` вместо `console.log`
4. Посмотрите логи Vercel Functions для ошибок HTTP

## 📈 Мониторинг

Веб-интерфейс показывает:
- Общее количество логов
- Количество ошибок
- Время последнего обновления
- Статус подключения (WebSocket)

Идеально для отладки продакшн проблем в реальном времени! 🎉
