# 🗄️ Обновление Базы Данных для Onboarding Системы

## 📋 Обзор изменений

Для работы новой onboarding системы с персонализированными целями питания необходимо добавить следующие поля в таблицу `users`:

### Новые поля для профиля пользователя:
- `age` (INTEGER) - возраст для расчета BMR
- `gender` (VARCHAR) - пол (male/female) для расчета BMR  
- `height_cm` (INTEGER) - рост в сантиметрах
- `weight_kg` (INTEGER) - вес в килограммах
- `fitness_goal` (VARCHAR) - цель (lose/maintain/gain)
- `activity_level` (VARCHAR) - уровень активности
- `fat_goal_g` (INTEGER) - цель по жирам в граммах
- `carbs_goal_g` (INTEGER) - цель по углеводам в граммах
- `profile_completed_at` (TIMESTAMP) - когда завершен onboarding

## 🚀 Инструкция по обновлению

### Шаг 1: Резервное копирование
```sql
-- Создайте резервную копию таблицы users
CREATE TABLE users_backup AS SELECT * FROM users;
```

### Шаг 2: Проверка текущей схемы
```bash
# Запустите скрипт проверки в Supabase SQL Editor
cat check_database.sql
```

### Шаг 3: Применение обновлений
```bash
# Запустите скрипт обновления в Supabase SQL Editor
cat database_update.sql
```

### Шаг 4: Проверка результата
```sql
-- Проверьте что все поля добавились
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'users' 
AND column_name IN ('age', 'gender', 'height_cm', 'weight_kg', 'fitness_goal', 'activity_level', 'fat_goal_g', 'carbs_goal_g', 'profile_completed_at')
ORDER BY column_name;
```

## 🔧 Как выполнить в Supabase

### Через Supabase Dashboard:
1. Откройте ваш проект в [Supabase Dashboard](https://app.supabase.com)
2. Перейдите в **SQL Editor**
3. Создайте новый запрос
4. Скопируйте содержимое `check_database.sql` и выполните
5. Проверьте результаты
6. Создайте еще один новый запрос
7. Скопируйте содержимое `database_update.sql` и выполните
8. Проверьте что все поля добавились

### Через CLI (если настроен):
```bash
# Если у вас настроен Supabase CLI
supabase db reset --local  # для локальной разработки
# или
psql "postgresql://[user]:[password]@[host]:[port]/[database]" < database_update.sql
```

## ✅ Проверка работоспособности

После обновления схемы:

1. **Перезапустите бота** (redeploy на Vercel)
2. **Протестируйте onboarding**:
   - Отправьте `/start` новому пользователю
   - Пройдите весь процесс onboarding
   - Проверьте что данные сохраняются в базе
3. **Проверьте существующих пользователей**:
   - Команда `/profile` должна предложить настройку
   - Команда `/goals` должна показать дефолтные цели

## 🔍 Проверка данных

```sql
-- Проверьте что у новых пользователей сохраняется профиль
SELECT 
    telegram_user_id,
    display_name,
    age,
    gender,
    height_cm,
    weight_kg,
    fitness_goal,
    activity_level,
    cal_goal,
    protein_goal_g,
    fat_goal_g,
    carbs_goal_g,
    fiber_goal_g,
    profile_completed_at
FROM users 
WHERE profile_completed_at IS NOT NULL
ORDER BY profile_completed_at DESC;

-- Проверьте пользователей без профиля (должны получить дефолтные значения)
SELECT 
    telegram_user_id,
    display_name,
    cal_goal,
    protein_goal_g,
    fat_goal_g,
    carbs_goal_g,
    fiber_goal_g
FROM users 
WHERE profile_completed_at IS NULL;
```

## 🚨 Troubleshooting

### Ошибка "column already exists"
Это нормально - скрипт использует `ADD COLUMN IF NOT EXISTS`, поэтому безопасно запускать несколько раз.

### Ошибка доступа к базе
Убедитесь что у вас есть права на изменение схемы в Supabase.

### Пользователи не видят onboarding
1. Проверьте что поля добавились в базу
2. Перезапустите бота (redeploy)
3. Очистите кэш Telegram: перезапустите приложение

## 📊 Ожидаемый результат

После успешного обновления:

### Новые пользователи:
- Автоматически попадают в onboarding при `/start`
- Получают персонализированные цели после завершения
- Все данные сохраняются в новых полях

### Существующие пользователи:
- Получают дефолтные значения для новых полей
- Команда `/profile` предлагает настройку
- Могут пройти onboarding в любое время

### Расчет целей:
- BMR рассчитывается по формуле Миффлина-Сан Жеора
- TDEE учитывает уровень активности
- Цели корректируются под цель (похудение/набор/поддержание)

## 🎉 Готово!

После выполнения всех шагов ваша база данных будет готова для работы с новой onboarding системой!
