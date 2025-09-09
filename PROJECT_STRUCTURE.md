# 📁 Структура проекта Soma Diet Tracker

## 🗂 Обзор файлов

```
soma-diet-tracker/
├── 📁 api/                          # Vercel serverless functions
│   ├── telegram.ts                  # Основной webhook для Telegram
│   ├── health.ts                    # Health check endpoint
│   └── 📁 cron/
│       └── daily-summary.ts         # Ежедневная рассылка отчётов
├── 📁 services/                     # Бизнес-логика
│   ├── sheets.ts                    # Google Sheets интеграция
│   ├── llm.ts                       # OpenAI Vision API
│   ├── scoring.ts                   # Система оценок
│   ├── summary.ts                   # Аналитика и отчёты
│   └── time.ts                      # Работа с часовыми поясами
├── 📁 utils/                        # Вспомогательные утилиты
│   └── telegram.ts                  # Форматирование сообщений
├── 📁 types/                        # TypeScript типы
│   └── index.ts                     # Интерфейсы данных
├── 📄 package.json                  # Зависимости проекта
├── 📄 tsconfig.json                 # TypeScript конфигурация
├── 📄 vercel.json                   # Vercel конфигурация + cron
├── 📄 env.example                   # Пример переменных окружения
├── 📄 README.md                     # Документация проекта
├── 📄 DEPLOYMENT.md                 # Инструкция по деплою
└── 📄 .gitignore                    # Git исключения
```

## 🔧 Ключевые компоненты

### 🤖 API Endpoints

#### `/api/telegram.ts`
- **Назначение**: Основной webhook для получения сообщений от Telegram
- **Функции**:
  - Обработка фото и текстовых сообщений
  - Команды (/start, /today, /week, /month, /goals, /setgoals)
  - Анализ питания через LLM
  - Сохранение данных в Google Sheets
  - Ответы пользователям

#### `/api/cron/daily-summary.ts`
- **Назначение**: Ежечасный cron job для отправки ежедневных отчётов
- **Функции**:
  - Проверка времени для каждого пользователя
  - Генерация персональных отчётов
  - Отправка через Telegram Bot API
  - Обработка ошибок и логирование

#### `/api/health.ts`
- **Назначение**: Health check для мониторинга
- **Функции**:
  - Проверка подключения к Google Sheets
  - Статистика пользователей
  - Статус конфигурации сервисов

### 📊 Services (Бизнес-логика)

#### `services/sheets.ts`
- **Класс**: `SheetsService`
- **Функции**:
  - CRUD операции с пользователями
  - Запись логов приёмов пищи
  - Управление ежедневными агрегатами
  - Аналитические запросы по периодам
  - Удаление данных пользователя

#### `services/llm.ts`
- **Класс**: `LLMService`
- **Функции**:
  - Анализ фото еды через GPT-4o Vision
  - Анализ текстовых описаний
  - Генерация персональных советов
  - Обработка ошибок AI
  - Определение типов изображений

#### `services/scoring.ts`
- **Класс**: `ScoringService`
- **Функции**:
  - Оценка отдельных приёмов пищи (0-10)
  - Оценка дневного питания (0-10)
  - Контекстные советы
  - Недельная и месячная аналитика
  - Определение трендов

#### `services/time.ts`
- **Класс**: `TimeService`
- **Функции**:
  - Конвертация UTC ↔ локальное время
  - Работа с часовыми поясами
  - Определение границ дня/недели/месяца
  - Проверка времени для cron jobs
  - Форматирование дат для отображения

#### `services/summary.ts`
- **Класс**: `SummaryService`
- **Функции**:
  - Генерация недельных отчётов
  - Генерация месячных отчётов
  - Подсчёт streak (дни подряд)
  - Мотивационные сообщения
  - Агрегация данных в реальном времени

### 🛠 Utils (Утилиты)

#### `utils/telegram.ts`
- **Класс**: `TelegramUtils`
- **Функции**:
  - Форматирование ответов бота
  - Парсинг команд и параметров
  - Валидация пользовательского ввода
  - Rate limiting (30 сообщений/день)
  - Обработка естественного языка

### 📋 Types (Типы данных)

#### `types/index.ts`
- **Интерфейсы**:
  - `User` - данные пользователя
  - `LogEntry` - запись о приёме пищи
  - `DailyEntry` - дневной агрегат
  - `NutritionAnalysis` - результат анализа AI
  - `WeeklyStats`, `MonthlyStats` - статистика
  - `TelegramMessage` - структура сообщения

## 🗃 Структура данных Google Sheets

### Лист "users" (пользователи)
```typescript
{
  user_id: number;           // Telegram user ID (PK)
  display_name: string;      // Имя пользователя
  timezone: string;          // Часовой пояс (Europe/Madrid)
  cal_goal: number;          // Цель по калориям (1800)
  protein_goal_g: number;    // Цель по белку (120г)
  fiber_goal_g: number;      // Цель по клетчатке (25г)
  first_seen_utc: string;    // Первое обращение
  last_seen_utc: string;     // Последнее обращение
  silent_mode: boolean;      // Отключение уведомлений
  daily_digest_time: string; // Время отчёта (21:30)
}
```

### Лист "log" (лог приёмов)
```typescript
{
  timestamp_utc: string;     // Время приёма UTC
  day_local: string;         // Локальная дата (YYYY-MM-DD)
  user_id: number;           // ID пользователя
  chat_id: number;           // Telegram chat ID
  msg_id: number;            // ID сообщения
  text?: string;             // Текстовое описание
  photo_file_id?: string;    // Telegram file ID фото
  photo_note?: string;       // Подпись к фото
  calories: number;          // Калории
  protein_g: number;         // Белки (г)
  fat_g: number;             // Жиры (г)
  carbs_g: number;           // Углеводы (г)
  fiber_g: number;           // Клетчатка (г)
  score_item: number;        // Оценка приёма (0-10)
  confidence: number;        // Уверенность AI (0-1)
  advice_short: string;      // Короткий совет
  raw_model_json: string;    // Полный ответ AI (JSON)
}
```

### Лист "daily" (дневные итоги)
```typescript
{
  day_local: string;         // Дата (YYYY-MM-DD)
  user_id: number;           // ID пользователя
  calories_sum: number;      // Сумма калорий за день
  protein_sum: number;       // Сумма белков за день
  fat_sum: number;           // Сумма жиров за день
  carbs_sum: number;         // Сумма углеводов за день
  fiber_sum: number;         // Сумма клетчатки за день
  meals_count: number;       // Количество приёмов
  daily_score: number;       // Оценка дня (0-10)
  notes: string;             // Заметки (пока не используется)
}
```

## 🔄 Основные потоки данных

### 1. Анализ приёма пищи
```
Telegram → webhook → LLM анализ → запись в log → upsert в daily → ответ пользователю
```

### 2. Ежедневные отчёты
```
Cron (каждый час) → проверка времени → генерация отчёта → отправка в Telegram
```

### 3. Аналитические запросы
```
Команда (/week) → запрос к daily → расчёт статистики → форматирование → ответ
```

## ⚙️ Конфигурация

### Environment Variables
```env
TELEGRAM_BOT_TOKEN=        # Токен Telegram бота
OPENAI_API_KEY=           # API ключ OpenAI
GOOGLE_SERVICE_ACCOUNT=   # JSON ключ Service Account
SHEET_ID=                 # ID Google Sheets таблицы
TIMEZONE_DEFAULT=         # Часовой пояс по умолчанию
NODE_ENV=                 # Окружение (development/production)
```

### Vercel Configuration
- **Functions**: serverless функции с таймаутами
- **Cron**: ежечасный запуск daily-summary
- **Environment**: переменные окружения для всех функций

## 📈 Масштабирование

### Текущие лимиты (MVP)
- **Пользователи**: до 10 активных
- **Сообщения**: 30 в день на пользователя
- **Google Sheets**: до 10M ячеек
- **OpenAI**: зависит от баланса

### Планы расширения
- Миграция на полноценную БД (Supabase/PostgreSQL)
- Web интерфейс для аналитики
- Интеграция с носимыми устройствами
- Расширенная персонализация

## 🔐 Безопасность

- Фото не сохраняются (только file_id)
- Приватный доступ к Google Sheets
- Rate limiting на уровне пользователя
- Возможность полного удаления данных
- Валидация всех входящих данных
