-- Скрипт для проверки текущей схемы базы данных
-- Запустите этот скрипт ПЕРЕД обновлением, чтобы увидеть текущую структуру

-- 1. Проверяем существующие таблицы
SELECT table_name, table_type 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- 2. Проверяем структуру таблицы users
SELECT 
    column_name,
    data_type,
    character_maximum_length,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'users' 
ORDER BY ordinal_position;

-- 3. Проверяем существующих пользователей
SELECT 
    telegram_user_id,
    display_name,
    cal_goal,
    protein_goal_g,
    fiber_goal_g,
    first_seen_utc,
    last_seen_utc
FROM users 
ORDER BY first_seen_utc DESC 
LIMIT 10;

-- 4. Проверяем записи в таблице entries
SELECT COUNT(*) as total_entries FROM entries;
SELECT COUNT(DISTINCT user_id) as unique_users_with_entries FROM entries;

-- 5. Проверяем записи в таблице daily
SELECT COUNT(*) as total_daily_records FROM daily;
SELECT COUNT(DISTINCT user_id) as unique_users_with_daily FROM daily;
