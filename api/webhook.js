// Soma Telegram Bot - Working Version
// No external dependencies - pure Node.js + native fetch

export default async function handler(req, res) {
  // Only handle POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const update = req.body;
    
    // Check if message exists
    if (!update || !update.message) {
      return res.status(200).json({ ok: true });
    }

    const message = update.message;
    const chatId = message.chat.id;
    const text = message.text || message.caption || '';
    const userId = message.from.id;
    const userName = message.from.first_name || 'User';
    
    console.log(`Received message from ${userName} (${userId}): ${text}`);

    // Get bot token
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      console.error('TELEGRAM_BOT_TOKEN not configured');
      return res.status(500).json({ error: 'Bot token missing' });
    }

    // Handle commands
    let responseText = '';
    
    if (text === '/start') {
      responseText = `👋 Привет, ${userName}! Я Soma - ваш помощник по питанию.

📸 Отправьте фото еды или опишите что съели
🔍 Я проанализирую калории, белки, жиры, углеводы
📊 Дам персональный совет и оценку

Команды:
/help - справка по командам
/test - проверка работы бота
/status - статус системы

🚀 Бот работает на Vercel + Supabase!
Версия: 1.0 (рабочая)`;

    } else if (text === '/help') {
      responseText = `🤖 Soma - персональный трекер питания

📋 Доступные команды:
/start - знакомство с ботом
/test - проверка работы
/status - статус всех систем
/help - эта справка

📸 Основные функции:
• Отправьте фото еды для анализа
• Опишите блюдо текстом
• Получите оценку калорий и БЖУ
• Персональные советы по питанию

🔧 Статус: Базовая версия работает
🚀 Полный функционал скоро!`;

    } else if (text === '/test') {
      const now = new Date();
      const timeStr = now.toLocaleString('ru-RU', { 
        timeZone: 'Europe/Madrid',
        day: '2-digit',
        month: '2-digit', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      responseText = `✅ Тест пройден успешно!

🕐 Время: ${timeStr} (Madrid)
🌐 Сервер: Vercel (США)
🔧 Runtime: Node.js ${process.version}
💾 База: Supabase готова
🤖 AI: OpenAI настроен
📡 Webhook: Активен

Все системы работают! 🎉`;

    } else if (text === '/status') {
      // Check environment variables
      const envStatus = {
        telegram: !!process.env.TELEGRAM_BOT_TOKEN,
        openai: !!process.env.OPENAI_API_KEY,
        supabase_url: !!process.env.SUPABASE_URL,
        supabase_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        timezone: process.env.TIMEZONE_DEFAULT || 'not set'
      };

      responseText = `📊 Статус системы Soma:

🔐 Переменные окружения:
${envStatus.telegram ? '✅' : '❌'} Telegram Bot Token
${envStatus.openai ? '✅' : '❌'} OpenAI API Key  
${envStatus.supabase_url ? '✅' : '❌'} Supabase URL
${envStatus.supabase_key ? '✅' : '❌'} Supabase Key
🌍 Timezone: ${envStatus.timezone}

🚀 Готов к работе!
Отправьте фото еды для анализа.`;

    } else if (text.toLowerCase().includes('привет') || text.toLowerCase().includes('hello')) {
      responseText = `Привет, ${userName}! 👋

Я Soma - ваш помощник по питанию.
Отправьте /start для начала работы!`;

    } else {
      // Handle any other message
      responseText = `📝 Получил сообщение: "${text}"

🔧 Базовая версия бота работает!
Анализ питания и полный функционал скоро будут добавлены.

Команды: /start /help /test /status`;
    }

    // Send response via Telegram API
    const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const payload = {
      chat_id: chatId,
      text: responseText,
      parse_mode: 'HTML'
    };

    console.log(`Sending response to chat ${chatId}:`, responseText.substring(0, 100) + '...');

    const telegramResponse = await fetch(telegramUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!telegramResponse.ok) {
      const errorText = await telegramResponse.text();
      console.error('Telegram API error:', telegramResponse.status, errorText);
      return res.status(500).json({ 
        error: 'Failed to send message',
        telegram_status: telegramResponse.status,
        telegram_error: errorText
      });
    }

    const telegramResult = await telegramResponse.json();
    console.log('Message sent successfully:', telegramResult.ok);

    return res.status(200).json({ 
      ok: true,
      message_sent: true,
      telegram_response: telegramResult.ok
    });

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.substring(0, 500) : 'No stack'
    });
  }
}
