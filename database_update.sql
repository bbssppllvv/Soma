-- SQL скрипт для обновления схемы базы данных Soma Diet Tracker
-- Добавляет поля для onboarding системы и персонализированных целей

-- Обновляем таблицу users, добавляя поля для профиля пользователя
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS age INTEGER,
ADD COLUMN IF NOT EXISTS gender VARCHAR(10),
ADD COLUMN IF NOT EXISTS height_cm INTEGER,
ADD COLUMN IF NOT EXISTS weight_kg INTEGER,
ADD COLUMN IF NOT EXISTS fitness_goal VARCHAR(20),
ADD COLUMN IF NOT EXISTS activity_level VARCHAR(20),
ADD COLUMN IF NOT EXISTS fat_goal_g INTEGER,
ADD COLUMN IF NOT EXISTS carbs_goal_g INTEGER,
ADD COLUMN IF NOT EXISTS profile_completed_at TIMESTAMP WITH TIME ZONE;

-- Добавляем комментарии для документации
COMMENT ON COLUMN users.age IS 'User age for BMR calculation';
COMMENT ON COLUMN users.gender IS 'User gender (male/female) for BMR calculation';
COMMENT ON COLUMN users.height_cm IS 'User height in centimeters';
COMMENT ON COLUMN users.weight_kg IS 'User weight in kilograms';
COMMENT ON COLUMN users.fitness_goal IS 'User fitness goal (lose/maintain/gain)';
COMMENT ON COLUMN users.activity_level IS 'User activity level (sedentary/light/moderate/very/extreme)';
COMMENT ON COLUMN users.fat_goal_g IS 'Daily fat goal in grams';
COMMENT ON COLUMN users.carbs_goal_g IS 'Daily carbohydrates goal in grams';
COMMENT ON COLUMN users.profile_completed_at IS 'Timestamp when user completed profile setup';

-- Создаем индексы для оптимизации запросов
CREATE INDEX IF NOT EXISTS idx_users_profile_completed ON users(profile_completed_at) WHERE profile_completed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_fitness_goal ON users(fitness_goal) WHERE fitness_goal IS NOT NULL;

-- Проверяем существующие поля (должны уже существовать)
-- Если нужно, раскомментируйте и добавьте недостающие поля:

-- ALTER TABLE users ADD COLUMN IF NOT EXISTS cal_goal INTEGER DEFAULT 2000;
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS protein_goal_g INTEGER DEFAULT 150;  
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS fiber_goal_g INTEGER DEFAULT 25;

-- Обновляем дефолтные значения для пользователей без профиля
UPDATE users 
SET 
    cal_goal = COALESCE(cal_goal, 2000),
    protein_goal_g = COALESCE(protein_goal_g, 150),
    fiber_goal_g = COALESCE(fiber_goal_g, 25),
    fat_goal_g = COALESCE(fat_goal_g, 65),
    carbs_goal_g = COALESCE(carbs_goal_g, 250)
WHERE profile_completed_at IS NULL;

-- Показать структуру обновленной таблицы
-- SELECT column_name, data_type, is_nullable, column_default 
-- FROM information_schema.columns 
-- WHERE table_name = 'users' 
-- ORDER BY ordinal_position;
