// Telegram Helpers Module - Message sending and keyboard functions

// Send message helper
export async function sendMessage(chatId, text, botToken) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Telegram API error:', response.status, errorText);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Send message error:', error);
    return false;
  }
}

// Send message with inline keyboard helper
export async function sendMessageWithKeyboard(chatId, text, keyboard, botToken) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: keyboard
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Telegram API keyboard error:', response.status, errorText);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Send keyboard message error:', error);
    return false;
  }
}

// Answer callback query helper
export async function answerCallbackQuery(callbackQueryId, text, botToken) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text,
        show_alert: false
      })
    });

    return response.ok;
  } catch (error) {
    console.error('Answer callback query error:', error);
    return false;
  }
}

// Edit message with keyboard helper
export async function editMessageWithKeyboard(chatId, messageId, text, keyboard, botToken) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: text,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: keyboard
        }
      })
    });

    return response.ok;
  } catch (error) {
    console.error('Edit message error:', error);
    return false;
  }
}
