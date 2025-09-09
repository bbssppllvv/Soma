# Soma

Telegram bot for nutrition tracking with AI-powered food photo analysis.

## Tech Stack

- Node.js + JavaScript (ES6 modules)
- Vercel serverless functions
- OpenAI GPT-5 (Vision + Text analysis)
- Supabase PostgreSQL database
- Native Fetch API (no external dependencies)

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
3. Set up Supabase database
4. Configure environment variables
5. Deploy to Vercel

See `DEPLOYMENT.md` for detailed setup instructions.

## Environment Variables

```
TELEGRAM_BOT_TOKEN=your_bot_token
OPENAI_API_KEY=your_openai_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
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
npm run dev
```

## License

MIT
