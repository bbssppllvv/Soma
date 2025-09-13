-- Критическая миграция: единые UUID ключи для пользователей
-- Выполнять в транзакции для безопасности

BEGIN;

-- 1. Добавляем UUID колонку в users
ALTER TABLE users ADD COLUMN id UUID DEFAULT gen_random_uuid();

-- 2. Заполняем UUID для существующих пользователей
UPDATE users SET id = gen_random_uuid() WHERE id IS NULL;

-- 3. Делаем UUID первичным ключом
ALTER TABLE users ADD PRIMARY KEY (id);

-- 4. Добавляем уникальность для telegram_user_id
ALTER TABLE users ADD CONSTRAINT users_telegram_uid_unique UNIQUE (telegram_user_id);

-- 5. Добавляем UUID колонку в entries
ALTER TABLE entries ADD COLUMN user_uuid UUID;

-- 6. Связываем entries с users через UUID
UPDATE entries e
SET user_uuid = u.id
FROM users u
WHERE u.telegram_user_id = e.chat_id;

-- 7. Делаем user_uuid обязательным и добавляем FK
ALTER TABLE entries
  ALTER COLUMN user_uuid SET NOT NULL,
  ADD CONSTRAINT entries_user_fk FOREIGN KEY (user_uuid) REFERENCES users(id);

-- 8. Добавляем идемпотентность для сообщений (предотвращаем дубликаты)
ALTER TABLE entries ADD CONSTRAINT uniq_chat_msg UNIQUE (chat_id, message_id);

COMMIT;

-- Проверочные запросы после миграции:
-- SELECT COUNT(*) FROM users WHERE id IS NOT NULL;
-- SELECT COUNT(*) FROM entries WHERE user_uuid IS NOT NULL;
-- SELECT u.telegram_user_id, e.message_id FROM users u JOIN entries e ON u.id = e.user_uuid LIMIT 5;
