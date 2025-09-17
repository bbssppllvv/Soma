-- SQL script to update the Soma Diet Tracker schema
-- Adds onboarding fields and personalized goal columns

-- Update users table with profile fields
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS age INTEGER,
  ADD COLUMN IF NOT EXISTS gender VARCHAR,
  ADD COLUMN IF NOT EXISTS height_cm INTEGER,
  ADD COLUMN IF NOT EXISTS weight_kg INTEGER,
  ADD COLUMN IF NOT EXISTS fitness_goal VARCHAR,
  ADD COLUMN IF NOT EXISTS activity_level VARCHAR,
  ADD COLUMN IF NOT EXISTS profile_completed_at TIMESTAMPTZ;

-- Document the new columns
COMMENT ON COLUMN users.age IS 'User age in years';
COMMENT ON COLUMN users.gender IS 'User gender self-description';
COMMENT ON COLUMN users.height_cm IS 'User height in centimeters';
COMMENT ON COLUMN users.weight_kg IS 'User weight in kilograms';
COMMENT ON COLUMN users.fitness_goal IS 'Weight objective: lose, gain, maintain';
COMMENT ON COLUMN users.activity_level IS 'Activity level enum';
COMMENT ON COLUMN users.profile_completed_at IS 'Timestamp when onboarding finished';

-- Create helper indexes
CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_entries_user_day ON entries(user_id, day_local);

-- Existing columns reference (run if needed)
-- ALTER TABLE users ADD COLUMN ...;

-- Set default values for legacy users
UPDATE users
SET
  cal_goal = COALESCE(cal_goal, 2000),
  protein_goal_g = COALESCE(protein_goal_g, 150),
  fiber_goal_g = COALESCE(fiber_goal_g, 25),
  fat_goal_g = COALESCE(fat_goal_g, 65),
  carbs_goal_g = COALESCE(carbs_goal_g, 250)
WHERE cal_goal IS NULL
   OR protein_goal_g IS NULL
   OR fiber_goal_g IS NULL
   OR fat_goal_g IS NULL
   OR carbs_goal_g IS NULL;

-- Inspect updated columns
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'users'
  AND column_name IN (
    'age','gender','height_cm','weight_kg',
    'fitness_goal','activity_level','profile_completed_at'
  )
ORDER BY column_name;
