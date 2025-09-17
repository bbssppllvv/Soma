-- Script to inspect the current database schema
-- Run this before applying updates to capture the existing structure

-- 1. Inspect available tables
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- 2. Inspect the structure of the users table
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'users'
ORDER BY ordinal_position;

-- 3. Sample existing users
SELECT id, telegram_user_id, display_name, cal_goal, protein_goal_g, fiber_goal_g
FROM users
LIMIT 20;

-- 4. Inspect entries table records
SELECT id, user_id, calories, protein_g, fat_g, carbs_g
FROM entries
LIMIT 20;

-- 5. Inspect daily aggregation records
SELECT user_id, day_local, calories_sum, protein_sum, fat_sum, carbs_sum
FROM daily
LIMIT 20;
