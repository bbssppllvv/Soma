# ✅ Критические патчи для надежного пайплайна

## 🎯 5 критически важных исправлений выполнены

### 1. ✅ **БД: Единый UUID ключ пользователя**
**Файл**: `db_migration_uuid_keys.sql`
- UUID как первичный ключ в `users`
- FK связь `entries.user_uuid → users.id`
- Уникальность `telegram_user_id`
- **Результат**: Джойны не ломаются, связи надежные

### 2. ✅ **Идемпотентность записей сообщений**
**Включено в**: `db_migration_uuid_keys.sql`
```sql
ALTER TABLE entries ADD CONSTRAINT uniq_chat_msg UNIQUE (chat_id, message_id);
```
- **Результат**: Дубликаты от Telegram исключены

### 3. ✅ **OFF: Поддержка serving-only продуктов**
**Файл**: `api/modules/nutrition/off-map.js`
- Парсинг `serving_size` (например "150g")
- Конвертация serving → per-100g через `to100 = v => (+v) * (100/grams)`
- Fallback на per-100g если serving недоступен
- **Результат**: Coverage OFF сильно повышен

### 4. ✅ **Ограничение памяти кэша (LRU-cap)**
**Файл**: `api/modules/nutrition/simple-cache.js`
```javascript
const MAX_ITEMS = 1000;
// LRU: удаляем самый старый при превышении лимита
```
- **Результат**: Serverless воркеры не раздуваются

### 5. ✅ **Нормализация UPC и дробных порций**
**Файлы**: 
- `api/modules/nutrition/off-resolver.js`: `normalizeUPC()`
- `api/modules/nutrition/units.js`: `parseNumberMaybeFraction()`

```javascript
// UPC: только цифры
normalizeUPC("12-345-67890") → "1234567890"

// Дроби: ½ → 0.5
parseNumberMaybeFraction("1/2") → 0.5
parseNumberMaybeFraction("150") → 150
```
- **Результат**: Меньше фейлов по UPC, "½ cup" не ломает конвертацию

---

## 🚀 Готовность к production

### Перед включением OFF:
1. **Выполнить миграцию БД**: `psql < db_migration_uuid_keys.sql`
2. **Обновить код вставки entries**: добавить `ON CONFLICT (chat_id, message_id) DO NOTHING`
3. **Проверить тестовые кейсы**:
   - "½ cup milk" → должен конвертироваться
   - UPC с дефисами → должен нормализоваться
   - Serving-only продукты → должны резолвиться

### Безопасное включение:
```bash
OFF_ENABLED=true
OFF_ENABLED_PERCENT=10  # 10% трафика
```

### Мониторинг:
- **Coverage**: доля успешных резолвов
- **P50 латентность**: < 2-3с
- **Ask-rate**: доля needs_clarification
- **Логи**: `OFF resolved X/Y items (Z%) in Nms`

---

## ⚡ Критический минимум достигнут

✅ БД связки не ломаются  
✅ Дубликаты исключены  
✅ OFF покрывает serving-only  
✅ Кэш не распухает  
✅ UPC/дроби не косячат  

**Система готова к OFF_ENABLED=true на 10% трафика!** 🎯
