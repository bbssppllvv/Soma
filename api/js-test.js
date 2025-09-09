export default async function handler(req, res) {
  return res.status(200).json({
    message: 'JavaScript test works',
    timestamp: new Date().toISOString(),
    method: req.method,
    env_check: {
      telegram: !!process.env.TELEGRAM_BOT_TOKEN,
      openai: !!process.env.OPENAI_API_KEY,
      supabase_url: !!process.env.SUPABASE_URL,
      supabase_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY
    }
  });
}
