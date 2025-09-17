-- Critical migration: unified UUID keys for users
-- Execute inside a transaction for safety

BEGIN;

-- 1. Add UUID column to users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();

-- 2. Populate UUID for existing users
UPDATE users
SET id = gen_random_uuid()
WHERE id IS NULL;

-- 3. Make UUID the primary key
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_pkey,
  ADD PRIMARY KEY (id);

-- 4. Ensure telegram_user_id remains unique
CREATE UNIQUE INDEX IF NOT EXISTS users_telegram_user_id_key
  ON users(telegram_user_id);

-- 5. Add UUID column to entries
ALTER TABLE entries
  ADD COLUMN IF NOT EXISTS user_id UUID;

-- 6. Link entries to users via UUID
UPDATE entries e
SET user_id = u.id
FROM users u
WHERE e.user_id = u.telegram_user_id::uuid;

-- 7. Make user_id mandatory and add FK
ALTER TABLE entries
  ALTER COLUMN user_id SET NOT NULL,
  ADD CONSTRAINT entries_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id);

-- 8. Add idempotency for messages (prevent duplicates)
CREATE UNIQUE INDEX IF NOT EXISTS entries_chat_message_uidx
  ON entries(chat_id, message_id);

COMMIT;
