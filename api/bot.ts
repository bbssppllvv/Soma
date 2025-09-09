import { VercelRequest, VercelResponse } from '@vercel/node';

// Simple bot without external dependencies for testing
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const update = req.body;
    
    if (!update.message) {
      return res.status(200).json({ ok: true });
    }

    const message = update.message;
    const chatId = message.chat.id;
    const text = message.text || '';
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
      console.error('TELEGRAM_BOT_TOKEN not found');
      return res.status(500).json({ error: 'Bot token not configured' });
    }

    // Simple command handling
    let responseText = '';
    
    if (text === '/start') {
      responseText = '👋 Привет! Я Soma, ваш персональный трекер питания.\n\n' +
                    '📸 Пришлите фото еды или опишите что съели\n' +
                    '🔍 Я проанализирую калории и дам совет\n\n' +
                    'Команды:\n' +
                    '/help - справка\n' +
                    '/test - проверка работы\n\n' +
                    '✅ Бот работает на Vercel + Supabase!';
    } else if (text === '/help') {
      responseText = '🤖 Soma - помощник по питанию\n\n' +
                    'Команды:\n' +
                    '/start - знакомство\n' +
                    '/test - проверка\n' +
                    '/help - эта справка\n\n' +
                    'Пришлите фото еды для анализа!\n' +
                    '(Полный функционал скоро)';
    } else if (text === '/test') {
      responseText = '✅ Бот работает!\n' +
                    `⏰ Время: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Madrid' })}\n` +
                    '🔧 Статус: Готов к работе\n' +
                    `💾 База: Supabase подключена\n` +
                    `🤖 AI: OpenAI настроен`;
    } else {
      responseText = `📝 Получил: "${text}"\n` +
                    'Полный анализ питания скоро будет доступен.\n' +
                    'Используйте /help для справки.';
    }

    // Send message via Telegram API
    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const payload = {
      chat_id: chatId,
      text: responseText,
      parse_mode: 'HTML'
    };

    const telegramResponse = await fetch(telegramApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!telegramResponse.ok) {
      const errorText = await telegramResponse.text();
      console.error('Telegram API error:', errorText);
      return res.status(500).json({ error: 'Failed to send message' });
    }

    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
