// Soma Telegram Bot - Full Functionality
// OpenAI Vision + Supabase + Complete Commands

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const update = req.body;
    
    if (!update || !update.message) {
      return res.status(200).json({ ok: true });
    }

    const message = update.message;
    const chatId = message.chat.id;
    const text = message.text || message.caption || '';
    const userId = message.from.id;
    const userName = message.from.first_name || 'User';
    const messageId = message.message_id;
    
    console.log(`Message from ${userName} (${userId}): ${text}`);

    // Check environment
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const openaiKey = process.env.OPENAI_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!botToken) {
      return await sendMessage(chatId, '❌ Bot token не настроен', botToken);
    }

    // Initialize Supabase client (simplified)
    const supabaseHeaders = {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`
    };

    // Handle commands
    if (text === '/start') {
      await handleStartCommand(chatId, userId, userName, botToken, supabaseUrl, supabaseHeaders);
    } else if (text === '/help') {
      await handleHelpCommand(chatId, botToken);
    } else if (text === '/test') {
      await handleTestCommand(chatId, botToken, openaiKey, supabaseUrl);
    } else if (text === '/today') {
      await handleTodayCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders);
    } else if (text === '/goals') {
      await handleGoalsCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders);
    } else if (message.photo || (text && !text.startsWith('/'))) {
      // Handle food analysis
      await handleFoodAnalysis(message, botToken, openaiKey, supabaseUrl, supabaseHeaders);
    } else {
      await sendMessage(chatId, 'Неизвестная команда. Используйте /help для справки.', botToken);
    }

    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ 
      error: error.message,
      stack: error.stack?.substring(0, 500)
    });
  }
}

// Helper function to send messages
async function sendMessage(chatId, text, botToken) {
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

// Start command - create user if needed
async function handleStartCommand(chatId, userId, userName, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Check if user exists
    const userResponse = await fetch(`${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}&select=*`, {
      headers: supabaseHeaders
    });

    const users = await userResponse.json();
    
    if (users.length === 0) {
      // Create new user
      const newUser = {
        telegram_user_id: userId,
        display_name: userName,
        timezone: 'Europe/Madrid',
        cal_goal: 1800,
        protein_goal_g: 120,
        fiber_goal_g: 25,
        daily_digest_time: '21:30',
        first_seen_utc: new Date().toISOString(),
        last_seen_utc: new Date().toISOString()
      };

      const createResponse = await fetch(`${supabaseUrl}/rest/v1/users`, {
        method: 'POST',
        headers: supabaseHeaders,
        body: JSON.stringify(newUser)
      });

      if (createResponse.ok) {
        console.log(`Created new user: ${userId}`);
      } else {
        console.error('Failed to create user:', await createResponse.text());
      }
    } else {
      // Update last seen
      await fetch(`${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}`, {
        method: 'PATCH',
        headers: supabaseHeaders,
        body: JSON.stringify({
          last_seen_utc: new Date().toISOString(),
          display_name: userName
        })
      });
    }

    const welcomeText = `👋 Привет, ${userName}! Я Soma - ваш персональный трекер питания.

📸 <b>Отправьте фото еды</b> - я проанализирую калории, белки, жиры, углеводы и клетчатку
💬 <b>Опишите блюдо текстом</b> - например "гречка с курицей, 200г"
📊 <b>Получите оценку</b> - балл от 0 до 10 и персональный совет

🎯 <b>Ваши цели по умолчанию:</b>
• Калории: 1800 ккал
• Белок: 120 г
• Клетчатка: 25 г

📋 <b>Команды:</b>
/today - отчёт за сегодня
/goals - показать цели
/help - полная справка

🚀 <b>Начните с фото вашего приёма пищи!</b>`;

    await sendMessage(chatId, welcomeText, botToken);
  } catch (error) {
    console.error('Start command error:', error);
    await sendMessage(chatId, '❌ Ошибка при инициализации. Попробуйте ещё раз.', botToken);
  }
}

// Help command
async function handleHelpCommand(chatId, botToken) {
  const helpText = `🤖 <b>Soma - помощник по питанию</b>

📸 <b>Анализ питания:</b>
• Отправьте фото еды
• Опишите блюдо текстом
• Получите анализ калорий, БЖУ, клетчатки
• Персональные советы

📋 <b>Команды:</b>
/start - знакомство с ботом
/today - отчёт за сегодня  
/goals - показать цели питания
/test - проверка работы систем
/help - эта справка

💡 <b>Примеры:</b>
"Омлет из 2 яиц с помидором"
"Салат цезарь, средняя порция"
"Борщ с мясом, тарелка"

🎯 Цель: помочь вам контролировать питание и достигать целей по здоровью!`;

  await sendMessage(chatId, helpText, botToken);
}

// Test command with full system check
async function handleTestCommand(chatId, botToken, openaiKey, supabaseUrl) {
  const now = new Date();
  const timeStr = now.toLocaleString('ru-RU', { 
    timeZone: 'Europe/Madrid',
    day: '2-digit',
    month: '2-digit', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  // Test OpenAI
  let openaiStatus = '❌ Не настроен';
  if (openaiKey) {
    try {
      const testResponse = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${openaiKey}` }
      });
      openaiStatus = testResponse.ok ? '✅ Работает' : '⚠️ Ошибка API';
    } catch {
      openaiStatus = '⚠️ Недоступен';
    }
  }

  // Test Supabase
  let supabaseStatus = '❌ Не настроен';
  if (supabaseUrl) {
    try {
      const testResponse = await fetch(`${supabaseUrl}/rest/v1/users?select=count`, {
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
        }
      });
      supabaseStatus = testResponse.ok ? '✅ Подключена' : '⚠️ Ошибка подключения';
    } catch {
      supabaseStatus = '⚠️ Недоступна';
    }
  }

  const testText = `🧪 <b>Полный тест систем Soma</b>

🕐 <b>Время:</b> ${timeStr} (Madrid)
🌐 <b>Сервер:</b> Vercel (США)
🔧 <b>Runtime:</b> Node.js ${process.version}

🔐 <b>Статус систем:</b>
${botToken ? '✅' : '❌'} Telegram Bot API
${openaiStatus} OpenAI GPT-4o Vision
${supabaseStatus} Supabase Database
${process.env.TIMEZONE_DEFAULT ? '✅' : '❌'} Timezone (${process.env.TIMEZONE_DEFAULT || 'не настроен'})

📡 <b>Webhook:</b> Активен и работает
🚀 <b>Готовность:</b> Готов к анализу питания!

Попробуйте отправить фото еды! 📸`;

  await sendMessage(chatId, testText, botToken);
}

// Today command - show daily summary
async function handleTodayCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Get today's entries
    const entriesResponse = await fetch(
      `${supabaseUrl}/rest/v1/entries?user_id=eq.${userId}&day_local=eq.${today}&select=*`,
      { headers: supabaseHeaders }
    );

    if (!entriesResponse.ok) {
      await sendMessage(chatId, '❌ Ошибка получения данных за сегодня', botToken);
      return;
    }

    const entries = await entriesResponse.json();

    if (entries.length === 0) {
      await sendMessage(chatId, 
        `📝 <b>Сегодня (${today})</b>\n\n` +
        'Ещё нет записей о питании.\n' +
        'Пришлите фото еды или опишите что съели!', 
        botToken);
      return;
    }

    // Calculate totals
    const totals = entries.reduce((acc, entry) => ({
      calories: acc.calories + (entry.calories || 0),
      protein: acc.protein + (entry.protein_g || 0),
      fat: acc.fat + (entry.fat_g || 0),
      carbs: acc.carbs + (entry.carbs_g || 0),
      fiber: acc.fiber + (entry.fiber_g || 0)
    }), { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 });

    const todayText = `📊 <b>Сегодня (${today})</b>

🍽️ <b>Приёмов пищи:</b> ${entries.length}

📈 <b>Итого:</b>
• Калории: ~${Math.round(totals.calories)} ккал
• Белок: ${Math.round(totals.protein * 10) / 10} г
• Жиры: ${Math.round(totals.fat * 10) / 10} г
• Углеводы: ${Math.round(totals.carbs * 10) / 10} г
• Клетчатка: ${Math.round(totals.fiber * 10) / 10} г

🎯 <b>Цели:</b> 1800 ккал, 120г белка, 25г клетчатки

💡 Продолжайте отслеживать питание для лучших результатов!`;

    await sendMessage(chatId, todayText, botToken);

  } catch (error) {
    console.error('Today command error:', error);
    await sendMessage(chatId, '❌ Ошибка при получении данных за сегодня', botToken);
  }
}

// Goals command
async function handleGoalsCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Get user data
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}&select=*`,
      { headers: supabaseHeaders }
    );

    const users = await userResponse.json();
    const user = users[0] || {
      cal_goal: 1800,
      protein_goal_g: 120,
      fiber_goal_g: 25,
      timezone: 'Europe/Madrid',
      daily_digest_time: '21:30'
    };

    const goalsText = `🎯 <b>Ваши цели питания</b>

🔥 <b>Калории:</b> ${user.cal_goal} ккал/день
💪 <b>Белок:</b> ${user.protein_goal_g} г/день  
🌾 <b>Клетчатка:</b> ${user.fiber_goal_g} г/день
🕘 <b>Отчёт в:</b> ${user.daily_digest_time}
🌍 <b>Часовой пояс:</b> ${user.timezone}

📊 Эти цели используются для расчёта оценок и советов.

💡 <b>Изменение целей:</b> Функция настройки будет добавлена в следующей версии.`;

    await sendMessage(chatId, goalsText, botToken);

  } catch (error) {
    console.error('Goals command error:', error);
    await sendMessage(chatId, '❌ Ошибка при получении целей', botToken);
  }
}

// Food analysis - main functionality
async function handleFoodAnalysis(message, botToken, openaiKey, supabaseUrl, supabaseHeaders) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text || message.caption || '';
  
  try {
    await sendMessage(chatId, '🔍 Анализирую питание...', botToken);

    let nutritionData;

    if (message.photo && openaiKey) {
      // Analyze photo with OpenAI Vision
      nutritionData = await analyzePhotoWithOpenAI(message.photo, text, openaiKey);
    } else if (text && openaiKey) {
      // Analyze text with OpenAI
      nutritionData = await analyzeTextWithOpenAI(text, openaiKey);
    } else {
      // Fallback without AI
      nutritionData = {
        calories: 300,
        protein_g: 15,
        fat_g: 10,
        carbs_g: 30,
        fiber_g: 3,
        confidence: 0.3,
        advice_short: 'Приблизительная оценка. Настройте OpenAI для точного анализа.'
      };
    }

    // Save to database
    await saveFoodEntry(userId, message, nutritionData, supabaseUrl, supabaseHeaders);

    // Format response
    const responseText = `🍽️ <b>Принял!</b>

📊 <b>Анализ:</b>
• Калории: ~${nutritionData.calories} ккал
• Белок: ${nutritionData.protein_g} г
• Жиры: ${nutritionData.fat_g} г  
• Углеводы: ${nutritionData.carbs_g} г
• Клетчатка: ${nutritionData.fiber_g} г

${nutritionData.confidence < 0.6 ? '⚠️ Низкая уверенность в оценке\n' : ''}💡 <b>Совет:</b> ${nutritionData.advice_short}

📈 Данные сохранены. Используйте /today для просмотра дневной статистики.`;

    await sendMessage(chatId, responseText, botToken);

  } catch (error) {
    console.error('Food analysis error:', error);
    await sendMessage(chatId, '❌ Ошибка при анализе питания. Попробуйте ещё раз.', botToken);
  }
}

// OpenAI photo analysis
async function analyzePhotoWithOpenAI(photos, caption, openaiKey) {
  try {
    // Get largest photo
    const photo = photos[photos.length - 1];
    
    // Get photo file
    const fileResponse = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${photo.file_id}`);
    const fileData = await fileResponse.json();
    
    if (!fileData.ok) {
      throw new Error('Failed to get photo file');
    }

    // Download photo
    const photoUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileData.result.file_path}`;
    const photoResponse = await fetch(photoUrl);
    const photoBuffer = await photoResponse.arrayBuffer();
    const base64Image = Buffer.from(photoBuffer).toString('base64');

    // Analyze with OpenAI Vision
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'Analyze food photo and return JSON with calories, protein_g, fat_g, carbs_g, fiber_g, confidence (0-1), advice_short (max 120 chars in Russian). Be conservative with estimates.'
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: caption ? `Food description: "${caption}"\n\nAnalyze and return JSON only.` : 'Analyze this food photo and return JSON only.'
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`,
                  detail: 'low'
                }
              }
            ]
          }
        ],
        max_tokens: 400,
        temperature: 0.3
      })
    });

    if (!openaiResponse.ok) {
      throw new Error(`OpenAI API error: ${openaiResponse.status}`);
    }

    const openaiData = await openaiResponse.json();
    const content = openaiData.choices[0]?.message?.content;
    
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    // Parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in OpenAI response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    return {
      calories: Math.round(parsed.calories || 300),
      protein_g: Math.round((parsed.protein_g || 15) * 10) / 10,
      fat_g: Math.round((parsed.fat_g || 10) * 10) / 10,
      carbs_g: Math.round((parsed.carbs_g || 30) * 10) / 10,
      fiber_g: Math.round((parsed.fiber_g || 3) * 10) / 10,
      confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
      advice_short: (parsed.advice_short || 'Записал приём пищи.').substring(0, 120)
    };

  } catch (error) {
    console.error('OpenAI analysis error:', error);
    return {
      calories: 300,
      protein_g: 15,
      fat_g: 10,
      carbs_g: 30,
      fiber_g: 3,
      confidence: 0.2,
      advice_short: 'Ошибка анализа AI. Приблизительная оценка.'
    };
  }
}

// OpenAI text analysis
async function analyzeTextWithOpenAI(text, openaiKey) {
  try {
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Analyze food description and return JSON with calories, protein_g, fat_g, carbs_g, fiber_g, confidence (0-1), advice_short (max 120 chars in Russian). Be conservative with estimates.'
          },
          {
            role: 'user',
            content: `Food description: "${text}"\n\nAnalyze and return JSON only.`
          }
        ],
        max_tokens: 300,
        temperature: 0.3
      })
    });

    if (!openaiResponse.ok) {
      throw new Error(`OpenAI API error: ${openaiResponse.status}`);
    }

    const openaiData = await openaiResponse.json();
    const content = openaiData.choices[0]?.message?.content;
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    return {
      calories: Math.round(parsed.calories || 300),
      protein_g: Math.round((parsed.protein_g || 15) * 10) / 10,
      fat_g: Math.round((parsed.fat_g || 10) * 10) / 10,
      carbs_g: Math.round((parsed.carbs_g || 30) * 10) / 10,
      fiber_g: Math.round((parsed.fiber_g || 3) * 10) / 10,
      confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
      advice_short: (parsed.advice_short || 'Записал приём пищи.').substring(0, 120)
    };

  } catch (error) {
    console.error('Text analysis error:', error);
    return {
      calories: 300,
      protein_g: 15,
      fat_g: 10,
      carbs_g: 30,
      fiber_g: 3,
      confidence: 0.2,
      advice_short: 'Ошибка анализа AI. Приблизительная оценка.'
    };
  }
}

// Save food entry to Supabase
async function saveFoodEntry(userId, message, nutritionData, supabaseUrl, supabaseHeaders) {
  try {
    // Get user UUID
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}&select=id`,
      { headers: supabaseHeaders }
    );

    const users = await userResponse.json();
    if (users.length === 0) {
      console.error('User not found for food entry');
      return;
    }

    const userUuid = users[0].id;
    const today = new Date().toISOString().split('T')[0];

    // Create entry
    const entry = {
      user_id: userUuid,
      timestamp_utc: new Date().toISOString(),
      day_local: today,
      chat_id: message.chat.id,
      message_id: message.message_id,
      text: message.text || message.caption || null,
      photo_file_id: message.photo ? message.photo[message.photo.length - 1].file_id : null,
      calories: nutritionData.calories,
      protein_g: nutritionData.protein_g,
      fat_g: nutritionData.fat_g,
      carbs_g: nutritionData.carbs_g,
      fiber_g: nutritionData.fiber_g,
      score_item: calculateMealScore(nutritionData),
      confidence: nutritionData.confidence,
      advice_short: nutritionData.advice_short,
      raw_model_json: nutritionData
    };

    // Save entry
    const saveResponse = await fetch(`${supabaseUrl}/rest/v1/entries`, {
      method: 'POST',
      headers: supabaseHeaders,
      body: JSON.stringify(entry)
    });

    if (saveResponse.ok) {
      console.log(`Saved food entry for user ${userId}`);
      
      // Update daily aggregates
      await updateDailyAggregates(userUuid, today, supabaseUrl, supabaseHeaders);
    } else {
      console.error('Failed to save entry:', await saveResponse.text());
    }

  } catch (error) {
    console.error('Save entry error:', error);
  }
}

// Simple meal scoring (0-10)
function calculateMealScore(nutrition) {
  let score = 5; // Base score
  
  // Protein bonus
  if (nutrition.protein_g > 20) score += 1;
  if (nutrition.protein_g > 30) score += 1;
  
  // Fiber bonus  
  if (nutrition.fiber_g > 5) score += 1;
  if (nutrition.fiber_g > 10) score += 1;
  
  // Calorie penalty for very high calories
  if (nutrition.calories > 800) score -= 1;
  if (nutrition.calories > 1200) score -= 1;
  
  // Confidence penalty
  if (nutrition.confidence < 0.5) score -= 1;
  
  return Math.max(0, Math.min(10, score));
}

// Update daily aggregates
async function updateDailyAggregates(userUuid, dayLocal, supabaseUrl, supabaseHeaders) {
  try {
    // Get all entries for today
    const entriesResponse = await fetch(
      `${supabaseUrl}/rest/v1/entries?user_id=eq.${userUuid}&day_local=eq.${dayLocal}&select=*`,
      { headers: supabaseHeaders }
    );

    const entries = await entriesResponse.json();
    
    if (entries.length === 0) return;

    // Calculate totals
    const totals = entries.reduce((acc, entry) => ({
      calories: acc.calories + (entry.calories || 0),
      protein: acc.protein + (entry.protein_g || 0),
      fat: acc.fat + (entry.fat_g || 0),
      carbs: acc.carbs + (entry.carbs_g || 0),
      fiber: acc.fiber + (entry.fiber_g || 0),
      score: acc.score + (entry.score_item || 0)
    }), { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, score: 0 });

    // Calculate daily score
    const dailyScore = Math.round((totals.score / entries.length) * 10) / 10;

    // Upsert daily record
    const dailyData = {
      user_id: userUuid,
      day_local: dayLocal,
      calories_sum: Math.round(totals.calories),
      protein_sum: Math.round(totals.protein * 10) / 10,
      fat_sum: Math.round(totals.fat * 10) / 10,
      carbs_sum: Math.round(totals.carbs * 10) / 10,
      fiber_sum: Math.round(totals.fiber * 10) / 10,
      meals_count: entries.length,
      daily_score: dailyScore,
      notes: ''
    };

    const upsertResponse = await fetch(`${supabaseUrl}/rest/v1/daily`, {
      method: 'POST',
      headers: {
        ...supabaseHeaders,
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(dailyData)
    });

    if (upsertResponse.ok) {
      console.log(`Updated daily aggregates for ${dayLocal}`);
    } else {
      console.error('Failed to update daily:', await upsertResponse.text());
    }

  } catch (error) {
    console.error('Update daily aggregates error:', error);
  }
}
