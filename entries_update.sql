-- SQL script to update the entries table
-- Adds columns for portion information and standardized food names

-- Add portion-related columns to the entries table
ALTER TABLE entries 
ADD COLUMN IF NOT EXISTS food_name VARCHAR(100),
ADD COLUMN IF NOT EXISTS portion_size VARCHAR(50),
ADD COLUMN IF NOT EXISTS portion_description VARCHAR(100);

-- Add documentation comments
COMMENT ON COLUMN entries.food_name IS 'Standardized food name for future API matching';
COMMENT ON COLUMN entries.portion_size IS 'Estimated portion size (e.g. 150g, 1 cup, 1 medium)';
COMMENT ON COLUMN entries.portion_description IS 'Visual portion description (e.g. palm-sized, small bowl)';

-- Create indexes for future name-based lookups
CREATE INDEX IF NOT EXISTS idx_entries_food_name ON entries(food_name) WHERE food_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entries_portion_size ON entries(portion_size) WHERE portion_size IS NOT NULL;

-- Populate existing rows with default values when absent
UPDATE entries 
SET 
    food_name = COALESCE(food_name, 'Mixed Food'),
    portion_size = COALESCE(portion_size, 'Standard'),
    portion_description = COALESCE(portion_description, 'Medium serving')
WHERE food_name IS NULL OR portion_size IS NULL OR portion_description IS NULL;

-- Show the updated structure for the new columns
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'entries' 
AND column_name IN ('food_name', 'portion_size', 'portion_description')
ORDER BY column_name;
