const TelegramBot = require('node-telegram-bot-api');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN || '', { polling: false });

export default async function handler(req, res) {
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

    // Simple command handling
    if (text === '/start') {
      await bot.sendMessage(chatId, 
        '👋 Привет! Я Soma, ваш персональный трекер питания.\n\n' +
        '📸 Пришлите фото еды или опишите что съели\n' +
        '🔍 Я проанализирую калории и дам совет\n\n' +
        'Команды:\n' +
        '/help - справка\n' +
        '/test - проверка работы'
      );
    } else if (text === '/help') {
      await bot.sendMessage(chatId,
        '🤖 Soma - помощник по питанию\n\n' +
        'Команды:\n' +
        '/start - знакомство\n' +
        '/test - проверка\n' +
        '/help - эта справка\n\n' +
        'Пришлите фото еды для анализа!'
      );
    } else if (text === '/test') {
      await bot.sendMessage(chatId, 
        '✅ Бот работает!\n' +
        `⏰ Время: ${new Date().toLocaleString('ru-RU')}\n` +
        '🔧 Статус: Готов к анализу питания'
      );
    } else {
      await bot.sendMessage(chatId,
        '📝 Получил сообщение!\n' +
        'Полный анализ питания скоро будет доступен.\n' +
        'Используйте /help для справки.'
      );
    }
    
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
