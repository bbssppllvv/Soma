# 🚀 Deployment Checklist для Soma Diet Tracker

## Предварительные требования

### 1. ✅ Аккаунты и сервисы
- [ ] Telegram аккаунт
- [ ] OpenAI аккаунт с API ключом и балансом $10+
- [ ] Google аккаунт
- [ ] Vercel аккаунт
- [ ] Git репозиторий

### 2. ✅ Создание Telegram бота

```bash
# 1. Найдите @BotFather в Telegram
# 2. Отправьте команду:
/newbot

# 3. Укажите имя бота: Soma Diet Tracker
# 4. Укажите username: soma_diet_tracker_bot (должен быть уникальным)
# 5. Сохраните токен в формате: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz
```

### 3. ✅ Настройка OpenAI API

1. Перейдите на [OpenAI Platform](https://platform.openai.com/api-keys)
2. Создайте новый API ключ
3. Пополните баланс (минимум $10 для тестирования)
4. Сохраните ключ в формате: `sk-...`

### 4. ✅ Создание Google Sheets

#### Создание таблицы:
1. Откройте [Google Sheets](https://sheets.google.com)
2. Создайте новую таблицу с названием "Soma"
3. Создайте 3 листа с точными названиями:

**Лист 1: "users"**
```
A1: user_id
B1: display_name  
C1: timezone
D1: cal_goal
E1: protein_goal_g
F1: fiber_goal_g
G1: first_seen_utc
H1: last_seen_utc
I1: silent_mode
J1: daily_digest_time
```

**Лист 2: "log"**
```
A1: timestamp_utc
B1: day_local
C1: user_id
D1: chat_id
E1: msg_id
F1: text
G1: photo_file_id
H1: photo_note
I1: calories
J1: protein_g
K1: fat_g
L1: carbs_g
M1: fiber_g
N1: score_item
O1: confidence
P1: advice_short
Q1: raw_model_json
```

**Лист 3: "daily"**
```
A1: day_local
B1: user_id
C1: calories_sum
D1: protein_sum
E1: fat_sum
F1: carbs_sum
G1: fiber_sum
H1: meals_count
I1: daily_score
J1: notes
```

4. Скопируйте Sheet ID из URL: `https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit`

### 5. ✅ Настройка Google Service Account

#### Создание Service Account:

1. Перейдите в [Google Cloud Console](https://console.cloud.google.com)
2. Создайте новый проект:
   - Project name: `soma-diet-tracker`
   - Project ID: будет сгенерирован автоматически
3. Включите Google Sheets API:
   - APIs & Services → Library
   - Найдите "Google Sheets API"
   - Нажмите Enable

#### Создание Service Account:

1. IAM & Admin → Service Accounts → Create Service Account
2. Заполните:
   - Service account name: `soma-bot`
   - Service account ID: `soma-bot`
   - Description: `Service account for Soma Diet Tracker`
3. Grant this service account access to project: **Editor**
4. Done

#### Создание ключа:

1. Найдите созданный Service Account
2. Actions → Manage keys
3. Add Key → Create new key → JSON
4. Скачайте JSON файл - это ваш `GOOGLE_SERVICE_ACCOUNT`

#### Предоставление доступа к таблице:

1. Откройте скачанный JSON файл
2. Найдите поле `client_email` (например: `soma-bot@project-id.iam.gserviceaccount.com`)
3. В Google Sheets нажмите Share
4. Добавьте этот email с правами **Editor**
5. Снимите галочку "Notify people"

## 🔧 Локальная настройка

### 1. ✅ Клонирование проекта

```bash
git clone <your-repository-url>
cd soma-diet-tracker
npm install
```

### 2. ✅ Создание .env файла

```bash
cp env.example .env
```

Заполните `.env`:

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
OPENAI_API_KEY=sk-your-openai-key-here
GOOGLE_SERVICE_ACCOUNT={"type":"service_account","project_id":"your-project","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"soma-bot@your-project.iam.gserviceaccount.com","client_id":"...","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"..."}
SHEET_ID=your-google-sheet-id-here
TIMEZONE_DEFAULT=Europe/Madrid
NODE_ENV=development
```

### 3. ✅ Тестирование локально

```bash
npm run type-check  # Проверка типов
npm run build      # Сборка проекта
```

## 🌐 Деплой на Vercel

### 1. ✅ Установка Vercel CLI

```bash
npm i -g vercel
vercel login
```

### 2. ✅ Первый деплой

```bash
vercel --prod
```

Следуйте инструкциям:
- Set up and deploy? **Y**
- Which scope? Выберите свой аккаунт
- Link to existing project? **N**
- What's your project's name? `soma-diet-tracker`
- In which directory is your code located? `./`

### 3. ✅ Настройка переменных окружения

В Vercel Dashboard:
1. Перейдите в Settings → Environment Variables
2. Добавьте все переменные из `.env`:

```
TELEGRAM_BOT_TOKEN → 123456789:ABCdefGHIjklMNOpqrsTUVwxyz
OPENAI_API_KEY → sk-your-key
GOOGLE_SERVICE_ACCOUNT → {"type":"service_account",...}
SHEET_ID → your-sheet-id
TIMEZONE_DEFAULT → Europe/Madrid
```

3. Нажмите Save для каждой переменной

### 4. ✅ Повторный деплой

```bash
vercel --prod
```

Теперь переменные окружения будут доступны.

## 🔗 Настройка Telegram Webhook

После успешного деплоя:

```bash
# Замените YOUR_BOT_TOKEN и your-vercel-domain
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url": "https://your-vercel-domain.vercel.app/api/telegram"}'
```

Успешный ответ:
```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

## ✅ Проверка работоспособности

### 1. Проверка webhook
```bash
curl -X GET "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
```

### 2. Проверка cron job
```bash
curl "https://your-vercel-domain.vercel.app/api/cron/daily-summary"
```

### 3. Тестирование бота
1. Найдите вашего бота в Telegram
2. Отправьте `/start`
3. Отправьте фото еды или текст
4. Проверьте команды `/today`, `/week`, `/goals`

## 🐛 Troubleshooting

### Ошибка "Unauthorized" при webhook
- Проверьте правильность токена бота
- Убедитесь что URL webhook корректный

### Ошибка Google Sheets API
- Проверьте что Service Account имеет доступ к таблице
- Убедитесь что JSON ключ корректный
- Проверьте что Google Sheets API включен в проекте

### Ошибка OpenAI API
- Проверьте баланс аккаунта
- Убедитесь что API ключ активен
- Проверьте лимиты использования

### Cron job не работает
- Убедитесь что в `vercel.json` правильно настроен cron
- Проверьте логи в Vercel Dashboard
- Проверьте часовые пояса пользователей

## 📊 Мониторинг

### Vercel Dashboard
- Functions → Logs для просмотра ошибок
- Analytics для статистики использования

### Health Check
```bash
curl "https://your-domain.vercel.app/api/cron/daily-summary"
```

### Google Sheets
- Проверяйте заполнение данных в таблице
- Следите за размером таблицы (лимит 10M ячеек)

## 🎉 Готово!

Ваш Soma Diet Tracker готов к использованию! 

Поделитесь ботом с друзьями и начните отслеживать питание. Помните:
- Лимит 10 пользователей в MVP версии
- Рекомендуется мониторить расходы OpenAI API
- Регулярно проверяйте логи на ошибки

## 📞 Поддержка

Если что-то пошло не так:
1. Проверьте все переменные окружения
2. Посмотрите логи в Vercel Dashboard  
3. Убедитесь что все сервисы настроены правильно
4. Проверьте балансы API (OpenAI)

Удачи с запуском! 🚀
