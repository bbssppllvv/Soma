# 🚀 Deployment Checklist for Soma Diet Tracker

## Prerequisites
- Telegram account
- OpenAI account with an API key and at least $10 balance
- Google account
- Vercel account
- Git repository access

## 1. Create the Telegram bot
1. Open @BotFather in Telegram
2. Send `/newbot`
3. Choose a name: `Soma Diet Tracker`
4. Choose a unique username: `soma_diet_tracker_bot`
5. Save the token `123456789:ABC...`

## 2. Configure OpenAI API
1. Visit [OpenAI Platform](https://platform.openai.com/api-keys)
2. Create a new API key
3. Fund the account (minimum $10 recommended)
4. Save the key (`sk-...`)

## 3. Prepare Google Sheets
1. Open [Google Sheets](https://sheets.google.com)
2. Create a new spreadsheet named `Soma`
3. Add three sheets:
   - `users`
   - `log`
   - `daily`
4. Copy the Sheet ID from the URL `https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit`

## 4. Create a Google Service Account
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (auto-generated Project ID is fine)
3. Enable the **Google Sheets API**
4. Create a Service Account and generate a JSON key
5. Share your spreadsheet with the `client_email` from the JSON (Editor access, no notifications)

## 5. Local setup
```bash
git clone <repo>
cd soma-diet-tracker
npm install
cp env.example .env
```
Fill `.env` with your tokens and URLs, then run:
```bash
npm run type-check
npm run build
```

## 6. Deploy to Vercel
1. Install Vercel CLI: `npm i -g vercel`
2. Run `vercel` and follow prompts (select scope, project name, etc.)
3. In the Vercel dashboard set all environment variables from `.env`
4. Redeploy after saving env vars

## 7. Configure the Telegram webhook
```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://your-vercel-domain/api/telegram"}'
```
Expect `{"ok":true,"result":true,"description":"Webhook was set"}`

## 8. Smoke test
- `/start` → onboarding flow
- Send a meal photo or text description
- `/today`, `/week`, `/goals` should respond

## Troubleshooting
- **Unauthorized webhook:** double-check the bot token and webhook URL
- **Google Sheets error:** confirm service account access and API enablement
- **OpenAI error:** verify balance and quota
- **Cron job missing:** confirm `vercel.json` cron configuration and check Vercel logs

## Monitoring
- Vercel Functions → Logs for runtime errors
- Vercel Analytics for usage
- Review Google Sheet entries periodically (10M cell limit)

## Support checklist
1. Validate environment variables
2. Inspect Vercel logs
3. Confirm third-party services are configured correctly
4. Check API balances (OpenAI)

Happy launching! 🚀
