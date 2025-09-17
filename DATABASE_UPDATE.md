# Database Update Guide

## 🎯 Goal
Introduce onboarding fields and personalized nutrition targets while keeping existing users intact.

## ✅ Prerequisites
- Supabase project set up
- Access rights to run SQL migrations
- Latest code pulled locally

## 🛠️ Steps
1. Apply `db_migration_uuid_keys.sql`
2. Apply `database_update.sql`
3. Apply `entries_update.sql`

## 🔍 Data validation
- Confirm new users have profile fields populated
- Ensure existing users received default goals
- Verify `/goals` shows defaults for legacy users

## 🧪 Smoke tests
- Create a new user via `/start` → should enter onboarding
- Complete onboarding and verify goals saved
- For existing users, run `/profile` and ensure defaults appear

## 🧾 Troubleshooting
### “column already exists”
Safe to ignore — scripts use `ADD COLUMN IF NOT EXISTS`.

### Permission errors
Ensure you have alter privileges in Supabase.

### Users skip onboarding
1. Confirm columns exist in the database
2. Redeploy the bot
3. Restart Telegram client to clear cache

## 📊 Expected outcome
### New users
- Automatically enter onboarding when using `/start`
- Receive personalized goals after onboarding
- Data stored in new fields

### Existing users
- Default values populated for new fields
- `/profile` prompts to configure goals
- Users can run onboarding at any time

### Goal calculation
- BMR via Mifflin–St Jeor formula
- TDEE includes activity level
- Goals adjusted for lose/gain/maintain

## 🎉 Done!
After completing the steps above, the database is ready for the enhanced onboarding flow.
