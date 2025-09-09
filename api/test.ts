import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Test environment variables
    const envCheck = {
      telegram: !!process.env.TELEGRAM_BOT_TOKEN,
      openai: !!process.env.OPENAI_API_KEY,
      supabase_url: !!process.env.SUPABASE_URL,
      supabase_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      timezone: process.env.TIMEZONE_DEFAULT || 'not set'
    };

    // Test basic functionality
    const response = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'unknown',
      envVariables: envCheck,
      message: 'Test endpoint working'
    };

    return res.status(200).json(response);
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : 'No stack trace'
    });
  }
}
