# Migration from Google Sheets to Supabase

This guide covers the complete migration from Google Sheets storage to Supabase PostgreSQL database.

## Overview

The migration replaces Google Sheets with Supabase for:
- User data storage
- Food entries logging  
- Daily aggregates
- Analytics queries

All bot functionality remains identical from the user perspective.

## Prerequisites

1. Supabase account and project
2. Existing Soma bot setup
3. Access to current environment variables

## Step 1: Create Supabase Project

1. Go to [Supabase](https://supabase.com)
2. Create new project
3. Choose region (closest to your users)
4. Set database password
5. Wait for project initialization

## Step 2: Set Up Database Schema

1. Open Supabase SQL Editor
2. Copy and run the complete schema from `database/schema.sql`
3. Verify tables are created:
   - `users` (with indexes)
   - `entries` (with indexes)  
   - `daily` (with indexes)
   - Views: `user_stats`, `recent_activity`

## Step 3: Update Environment Variables

### Local Development (.env)
```bash
# Add new Supabase variables
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Keep existing variables
TELEGRAM_BOT_TOKEN=your-bot-token
OPENAI_API_KEY=your-openai-key
TIMEZONE_DEFAULT=Europe/Madrid
```

### Vercel Deployment
1. Go to Vercel Dashboard → Project Settings → Environment Variables
2. Add:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Remove old Google Sheets variables (optional):
   - `GOOGLE_SERVICE_ACCOUNT` 
   - `SHEET_ID`

## Step 4: Deploy Updated Code

```bash
# Install new dependencies
npm install

# Deploy to Vercel
vercel --prod
```

## Step 5: Test Migration

### Basic Functionality Tests

1. **New User Creation**
   ```
   /start → Should create user in Supabase users table
   ```

2. **Food Entry**
   ```
   Send photo/text → Should create entries record and update daily
   ```

3. **Commands**
   ```
   /today → Should show today's data from daily table
   /week → Should aggregate from daily table  
   /month → Should show trends from daily table
   /goals → Should update user record
   ```

4. **Daily Digest**
   ```
   Wait for cron or test endpoint directly
   Should send daily summary based on Supabase data
   ```

### Health Check
```bash
curl https://your-domain.vercel.app/api/health
```

Should return:
```json
{
  "status": "healthy",
  "services": {
    "database": "healthy",
    "supabase": "configured"
  },
  "stats": {
    "totalUsers": 0
  }
}
```

## Step 6: Data Migration (Optional)

If you have existing Google Sheets data to migrate:

### Export from Google Sheets
1. Download each sheet as CSV:
   - `users.csv`
   - `log.csv` 
   - `daily.csv`

### Import to Supabase
1. Use Supabase Dashboard → Table Editor
2. Import CSV files to corresponding tables
3. Map columns correctly:

**Users mapping:**
```
user_id → telegram_user_id
display_name → display_name  
timezone → timezone
cal_goal → cal_goal
protein_goal_g → protein_goal_g
fiber_goal_g → fiber_goal_g
first_seen_utc → first_seen_utc
last_seen_utc → last_seen_utc
silent_mode → silent_mode
daily_digest_time → daily_digest_time
```

**Entries mapping:**
```
timestamp_utc → timestamp_utc
day_local → day_local
user_id → Need to lookup UUID from users table
chat_id → chat_id
msg_id → msg_id
text → text
photo_file_id → photo_file_id
photo_note → photo_note
calories → calories
protein_g → protein_g
fat_g → fat_g
carbs_g → carbs_g
fiber_g → fiber_g
score_item → score_item
confidence → confidence
advice_short → advice_short
raw_model_json → raw_model_json (convert to JSONB)
```

**Daily mapping:**
```
day_local → day_local
user_id → Need to lookup UUID from users table
calories_sum → calories_sum
protein_sum → protein_sum
fat_sum → fat_sum
carbs_sum → carbs_sum
fiber_sum → fiber_sum
meals_count → meals_count
daily_score → daily_score
notes → notes
```

## Step 7: Verify Migration

1. **User Count**: Check users table has expected records
2. **Data Integrity**: Verify foreign key relationships work
3. **Bot Functionality**: Test all commands with existing users
4. **Performance**: Monitor response times (should be faster than Sheets)

## Step 8: Cleanup (After Successful Migration)

1. **Remove Google Sheets Dependencies**:
   ```bash
   npm uninstall googleapis
   ```

2. **Update package.json** (already done in migration)

3. **Remove Old Service** (keep as backup initially):
   - Rename `services/sheets.ts` → `services/sheets.ts.backup`

4. **Update Documentation**:
   - README.md references
   - DEPLOYMENT.md instructions

## Rollback Plan

If issues occur during migration:

1. **Revert Environment Variables**:
   ```bash
   # Remove Supabase vars, restore Google Sheets vars
   GOOGLE_SERVICE_ACCOUNT=your-service-account-json
   SHEET_ID=your-sheet-id
   ```

2. **Revert Code**:
   ```bash
   git revert <migration-commit-hash>
   vercel --prod
   ```

3. **Restore Service**:
   - Rename `sheets.ts.backup` → `sheets.ts`
   - Update imports back to `sheetsService`

## Benefits of Migration

1. **Performance**: Faster queries and better indexing
2. **Scalability**: No Google Sheets row limits
3. **Features**: Real foreign keys, triggers, views
4. **Reliability**: Better uptime and consistency
5. **Cost**: More predictable pricing at scale
6. **Development**: Better local development with real database

## Monitoring Post-Migration

1. **Supabase Dashboard**: Monitor database performance
2. **Vercel Logs**: Check for any database connection issues
3. **User Feedback**: Monitor bot responsiveness
4. **Health Endpoint**: Regular automated checks

## Troubleshooting

### Common Issues

1. **Connection Errors**:
   - Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
   - Check Supabase project is active

2. **Permission Errors**:
   - Verify Row Level Security policies
   - Ensure service role has proper access

3. **Migration Data Issues**:
   - Check foreign key constraints
   - Verify UUID mappings for user references

4. **Performance Issues**:
   - Check indexes are created
   - Monitor query performance in Supabase

### Support

- Supabase Documentation: https://supabase.com/docs
- Supabase Discord: https://discord.supabase.com
- PostgreSQL Documentation: https://www.postgresql.org/docs/

## Success Criteria

Migration is successful when:
- ✅ All bot commands work correctly
- ✅ New users can register and use the bot
- ✅ Food entries are saved and retrieved properly  
- ✅ Daily/weekly/monthly analytics work
- ✅ Cron jobs send daily summaries
- ✅ Health check returns "healthy" status
- ✅ No errors in Vercel logs
- ✅ Response times are acceptable (< 2s)

The migration maintains 100% backward compatibility from the user perspective while providing a more robust and scalable backend infrastructure.
