# Soma

Telegram bot for nutrition tracking with AI-powered food photo analysis.

## Tech Stack

- Node.js + TypeScript
- Vercel serverless functions
- OpenAI GPT-4o Vision API
- Google Sheets storage
- Telegram Bot API

## Features

- Photo and text food analysis
- Daily nutrition scoring
- Weekly/monthly analytics
- Automated daily reports
- Timezone support
- Personal nutrition goals

## Setup

1. Create Telegram bot via @BotFather
2. Get OpenAI API key
3. Set up Google Sheets with service account
4. Configure environment variables
5. Deploy to Vercel

See `DEPLOYMENT.md` for detailed setup instructions.

## Environment Variables

```
TELEGRAM_BOT_TOKEN=your_bot_token
OPENAI_API_KEY=your_openai_key
GOOGLE_SERVICE_ACCOUNT=service_account_json
SHEET_ID=google_sheet_id
TIMEZONE_DEFAULT=Europe/Madrid
```

## Commands

- `/start` - Setup
- `/today` - Daily summary
- `/week` - Weekly stats
- `/month` - Monthly stats
- `/goals` - View/set nutrition goals
- `/help` - Command reference

## Development

```bash
npm install
npm run type-check
npm run build
```

## License

MIT
