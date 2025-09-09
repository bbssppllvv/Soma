// Soma Telegram Bot - Final Working Version
// Complete functionality with working OpenAI integration

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
    
    console.log(`Message from ${userName} (${userId}): ${text}`);

    // Environment check
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const openaiKey = process.env.OPENAI_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!botToken) {
      return res.status(500).json({ error: 'Bot token missing' });
    }

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
    } else if (text === '/debug') {
      await handleDebugCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders);
    } else if (message.photo || (text && !text.startsWith('/'))) {
      // Handle food analysis
      await handleFoodAnalysis(message, botToken, openaiKey, supabaseUrl, supabaseHeaders);
    } else {
      await sendMessage(chatId, 'Unknown command. Use /help for reference.', botToken);
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

// Send message helper
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

// Enhanced food analysis with working OpenAI
async function handleFoodAnalysis(message, botToken, openaiKey, supabaseUrl, supabaseHeaders) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text || message.caption || '';
  
  try {
    await sendMessage(chatId, '🔍 Analyzing nutrition with AI...', botToken);

    // Get user context for personalized analysis
    const userContext = await getUserContext(userId, supabaseUrl, supabaseHeaders);
    let nutritionData;

    if (message.photo && openaiKey) {
      console.log('Starting photo analysis with GPT-5...');
      nutritionData = await analyzePhotoWithOpenAI(message.photo, text, openaiKey, userContext);
    } else if (text && openaiKey) {
      console.log('Starting text analysis with OpenAI...');
      nutritionData = await analyzeTextWithOpenAI(text, openaiKey, userContext);
    } else {
      console.log('No OpenAI key - using fallback');
      nutritionData = getFallbackAnalysis('OpenAI not configured. Using approximate values.');
    }

    console.log('Analysis result:', nutritionData);

    // Save to database
    await saveFoodEntry(userId, message, nutritionData, supabaseUrl, supabaseHeaders);

    // Format response
    const confidenceText = nutritionData.confidence < 0.6 ? '⚠️ <b>Low confidence estimate</b>\n' : 
                          nutritionData.confidence > 0.8 ? '✅ <b>High confidence analysis</b>\n' : '';

    const responseText = `🍽️ <b>Nutrition Analysis Complete</b>

📊 <b>Nutritional Breakdown:</b>
• Calories: ~${nutritionData.calories} kcal
• Protein: ${nutritionData.protein_g}g
• Fat: ${nutritionData.fat_g}g  
• Carbs: ${nutritionData.carbs_g}g
• Fiber: ${nutritionData.fiber_g}g

⭐ <b>Meal Score:</b> ${nutritionData.score}/10

${confidenceText}💡 <b>Advice:</b> ${nutritionData.advice_short}

📈 <b>Progress:</b> Use /today to see daily totals
🎯 <b>Goals:</b> 1800 cal, 120g protein, 25g fiber daily`;

    await sendMessage(chatId, responseText, botToken);

  } catch (error) {
    console.error('Food analysis error:', error);
    await sendMessage(chatId, `❌ Analysis failed: ${error.message}. Please try again.`, botToken);
  }
}

// Working OpenAI photo analysis
async function analyzePhotoWithOpenAI(photos, caption, openaiKey, userContext) {
  try {
    console.log('Getting photo file...');
    
    // Get photo file
    const photo = photos[photos.length - 1];
    const fileResponse = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${photo.file_id}`);
    const fileData = await fileResponse.json();
    
    if (!fileData.ok) {
      throw new Error('Failed to get photo file from Telegram');
    }

    console.log('Downloading photo...');
    const photoUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileData.result.file_path}`;
    const photoResponse = await fetch(photoUrl);
    
    if (!photoResponse.ok) {
      throw new Error('Failed to download photo');
    }
    
    const photoBuffer = await photoResponse.arrayBuffer();
    const base64Image = Buffer.from(photoBuffer).toString('base64');

    console.log('Calling OpenAI Vision API...');

    // Use GPT-5 with Chat Completions API for image analysis (as per documentation)
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-5',
        messages: [
          {
            role: 'system',
            content: `You are Soma, an expert nutrition analyst. Analyze food photos with precision and provide actionable advice.

RESPONSE FORMAT: Return ONLY valid JSON:
{
  "calories": number,
  "protein_g": number,
  "fat_g": number,
  "carbs_g": number,
  "fiber_g": number,
  "confidence": number,
  "advice_short": "string"
}

ANALYSIS EXPERTISE:
- Estimate portions using visual cues (plate size, utensil scale, hand comparisons)
- Account for cooking methods (fried +30% calories, grilled baseline, steamed -10%)
- Detect hidden calories (cooking oils, sauces, dressings, butter)
- Identify protein sources (meat, fish, eggs, dairy, legumes, nuts)
- Recognize fiber sources (vegetables, fruits, whole grains, legumes)
- Consider food density and water content

SCORING FACTORS:
- Protein: 25-40g per main meal is excellent
- Fiber: 8-12g per meal supports satiety and health
- Calories: 300-600 per meal depending on meal type
- Balance: Variety of nutrients and food groups

Return precise analysis with actionable advice.`
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `NUTRITION ANALYSIS REQUEST

${caption ? `Food description: "${caption}"` : 'Please analyze this food photo.'}

PERSONAL CONTEXT:
• Daily goals: ${userContext.goals.cal_goal} calories, ${userContext.goals.protein_goal_g}g protein, ${userContext.goals.fiber_goal_g}g fiber
• Today's progress: ${userContext.todayTotals.calories} calories, ${userContext.todayTotals.protein}g protein, ${userContext.todayTotals.fiber}g fiber
• This is meal #${userContext.mealsToday + 1} today
• Still need: ${userContext.goals.cal_goal - userContext.todayTotals.calories} calories, ${userContext.goals.protein_goal_g - userContext.todayTotals.protein}g protein, ${userContext.goals.fiber_goal_g - userContext.todayTotals.fiber}g fiber

ANALYSIS FOCUS:
- Accurate portion size estimation from visual cues
- Complete macronutrient breakdown
- Fiber content assessment
- Personalized advice for reaching daily goals

Return JSON analysis with confidence score and specific advice.`
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`,
                  detail: 'high'
                }
              }
            ]
          }
        ],
        max_completion_tokens: 1500
      })
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error('OpenAI API error:', openaiResponse.status, errorText);
      throw new Error(`OpenAI API error: ${openaiResponse.status} - ${errorText}`);
    }

    const openaiData = await openaiResponse.json();
    console.log('GPT-5 full response:', JSON.stringify(openaiData, null, 2));
    
    // Check different possible response formats
    const content = openaiData.choices?.[0]?.message?.content || 
                   openaiData.output_text || 
                   openaiData.text ||
                   openaiData.response;
    
    console.log('Extracted content:', content);
    
    if (!content) {
      console.error('No content found in GPT-5 response structure:', Object.keys(openaiData));
      throw new Error(`No response content from GPT-5. Response keys: ${Object.keys(openaiData).join(', ')}`);
    }

    return parseNutritionResponse(content, 'photo');

  } catch (error) {
    console.error('Photo analysis error:', error);
    return getFallbackAnalysis(`Photo analysis failed: ${error.message}`);
  }
}

// Working OpenAI text analysis
async function analyzeTextWithOpenAI(text, openaiKey, userContext) {
  try {
    console.log('Calling OpenAI for text analysis...');

    const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-5',
        input: `Analyze this food description: "${text}"

USER CONTEXT:
- Daily nutrition goals: ${userContext.goals.cal_goal} calories, ${userContext.goals.protein_goal_g}g protein, ${userContext.goals.fiber_goal_g}g fiber
- Today's progress: ${userContext.todayTotals.calories} calories, ${userContext.todayTotals.protein}g protein, ${userContext.todayTotals.fiber}g fiber consumed
- This is meal #${userContext.mealsToday + 1} today
- Remaining needs: ${userContext.goals.cal_goal - userContext.todayTotals.calories} calories, ${userContext.goals.protein_goal_g - userContext.todayTotals.protein}g protein, ${userContext.goals.fiber_goal_g - userContext.todayTotals.fiber}g fiber

ANALYSIS REQUIREMENTS:
- Interpret portion descriptions (small/medium/large, cups, pieces, grams)
- Consider preparation methods (fried, grilled, steamed, raw)
- Account for typical cooking additions (oil, butter, sauces)
- Estimate standard serving sizes when not specified
- Assess protein quality and completeness
- Identify fiber sources and estimate content
- Provide personalized advice based on remaining daily needs

Return ONLY a JSON object with exact format:
{
  "calories": number,
  "protein_g": number (1 decimal place),
  "fat_g": number (1 decimal place),
  "carbs_g": number (1 decimal place),
  "fiber_g": number (1 decimal place),
  "confidence": number (0-1 based on description detail),
  "advice_short": "string (actionable advice max 120 chars)"
}`,
        reasoning: { effort: "high" },
        text: { verbosity: "low" }
      })
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error('OpenAI text API error:', openaiResponse.status, errorText);
      throw new Error(`OpenAI API error: ${openaiResponse.status}`);
    }

    const openaiData = await openaiResponse.json();
    console.log('GPT-5 text response:', openaiData.output_text?.substring(0, 200));
    
    const content = openaiData.output_text;
    
    if (!content) {
      throw new Error('No output_text from GPT-5 response');
    }

    return parseNutritionResponse(content, 'text');

  } catch (error) {
    console.error('Text analysis error:', error);
    return getFallbackAnalysis(`Text analysis failed: ${error.message}`);
  }
}

// Parse OpenAI response with better error handling
function parseNutritionResponse(content, type) {
  try {
    console.log(`Parsing ${type} response:`, content);
    
    // Try to extract JSON from response
    let jsonString = content.trim();
    
    // Remove markdown formatting if present
    jsonString = jsonString.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    
    // Find JSON object
    const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('No JSON found in response:', content);
      throw new Error('No JSON object found in OpenAI response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    console.log('Parsed JSON:', parsed);
    
    // Validate required fields
    if (typeof parsed.calories !== 'number' || 
        typeof parsed.protein_g !== 'number' || 
        typeof parsed.confidence !== 'number') {
      throw new Error('Invalid JSON structure from OpenAI');
    }

    // Clean and validate data
    const result = {
      calories: Math.max(50, Math.min(2000, Math.round(parsed.calories))),
      protein_g: Math.max(0, Math.min(100, Math.round((parsed.protein_g) * 10) / 10)),
      fat_g: Math.max(0, Math.min(100, Math.round((parsed.fat_g || 0) * 10) / 10)),
      carbs_g: Math.max(0, Math.min(200, Math.round((parsed.carbs_g || 0) * 10) / 10)),
      fiber_g: Math.max(0, Math.min(50, Math.round((parsed.fiber_g || 0) * 10) / 10)),
      confidence: Math.max(0.1, Math.min(1.0, parsed.confidence)),
      advice_short: (parsed.advice_short || 'Meal analyzed successfully.').substring(0, 120)
    };

    // Calculate meal score
    result.score = calculateMealScore(result);

    console.log('Final result:', result);
    return result;

  } catch (error) {
    console.error('Parse response error:', error);
    console.error('Original content:', content);
    return getFallbackAnalysis(`Failed to parse AI response: ${error.message}`);
  }
}

// Get user context with error handling
async function getUserContext(userId, supabaseUrl, supabaseHeaders) {
  try {
    // Get user data
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}&select=*`,
      { headers: supabaseHeaders }
    );

    if (!userResponse.ok) {
      console.log('User not found, using defaults');
      return getDefaultUserContext();
    }

    const users = await userResponse.json();
    if (users.length === 0) {
      console.log('No users found, using defaults');
      return getDefaultUserContext();
    }

    const user = users[0];
    const userUuid = user.id;
    const today = new Date().toISOString().split('T')[0];

    // Get today's entries
    const entriesResponse = await fetch(
      `${supabaseUrl}/rest/v1/entries?user_id=eq.${userUuid}&day_local=eq.${today}&select=calories,protein_g,fiber_g`,
      { headers: supabaseHeaders }
    );

    let todayTotals = { calories: 0, protein: 0, fiber: 0 };
    let mealsToday = 0;

    if (entriesResponse.ok) {
      const entries = await entriesResponse.json();
      mealsToday = entries.length;
      todayTotals = entries.reduce((acc, entry) => ({
        calories: acc.calories + (entry.calories || 0),
        protein: acc.protein + (entry.protein_g || 0),
        fiber: acc.fiber + (entry.fiber_g || 0)
      }), { calories: 0, protein: 0, fiber: 0 });
    }

    return {
      goals: {
        cal_goal: user.cal_goal || 1800,
        protein_goal_g: user.protein_goal_g || 120,
        fiber_goal_g: user.fiber_goal_g || 25
      },
      todayTotals,
      mealsToday
    };

  } catch (error) {
    console.error('Error getting user context:', error);
    return getDefaultUserContext();
  }
}

function getDefaultUserContext() {
  return {
    goals: { cal_goal: 1800, protein_goal_g: 120, fiber_goal_g: 25 },
    todayTotals: { calories: 0, protein: 0, fiber: 0 },
    mealsToday: 0
  };
}

// Calculate meal score
function calculateMealScore(nutrition) {
  let score = 0;
  
  // Protein score (0-4 points)
  if (nutrition.protein_g >= 30) score += 4;
  else if (nutrition.protein_g >= 20) score += 3;
  else if (nutrition.protein_g >= 10) score += 2;
  else if (nutrition.protein_g >= 5) score += 1;
  
  // Fiber score (0-3 points)
  if (nutrition.fiber_g >= 10) score += 3;
  else if (nutrition.fiber_g >= 5) score += 2;
  else if (nutrition.fiber_g >= 2) score += 1;
  
  // Calorie appropriateness (0-3 points)
  if (nutrition.calories >= 250 && nutrition.calories <= 550) score += 3;
  else if (nutrition.calories >= 150 && nutrition.calories <= 700) score += 2;
  else if (nutrition.calories >= 100 && nutrition.calories <= 900) score += 1;
  
  // Confidence bonus
  score *= (0.7 + nutrition.confidence * 0.3);
  
  return Math.max(0, Math.min(10, Math.round(score * 10) / 10));
}

function getFallbackAnalysis(message) {
  return {
    calories: 300,
    protein_g: 15,
    fat_g: 10,
    carbs_g: 30,
    fiber_g: 3,
    confidence: 0.2,
    advice_short: message,
    score: 5
  };
}

// Command handlers
async function handleStartCommand(chatId, userId, userName, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Ensure user exists in database
    await ensureUserExists(userId, userName, supabaseUrl, supabaseHeaders);

    const welcomeText = `👋 Welcome ${userName}! I'm Soma - your personal nutrition tracker.

📸 <b>Send food photos</b> - I'll analyze calories, protein, fat, carbs, and fiber
💬 <b>Describe meals in text</b> - e.g. "grilled chicken with rice, 200g"
📊 <b>Get personalized insights</b> - score 0-10 and tailored advice

🎯 <b>Your default goals:</b>
• Calories: 1800 kcal/day
• Protein: 120g/day
• Fiber: 25g/day

📋 <b>Commands:</b>
/today - today's nutrition summary
/goals - view nutrition targets
/help - full command reference

🚀 <b>Start by sending a photo of your meal!</b>`;

    await sendMessage(chatId, welcomeText, botToken);
  } catch (error) {
    console.error('Start command error:', error);
    await sendMessage(chatId, '❌ Setup failed. Please try again.', botToken);
  }
}

async function handleHelpCommand(chatId, botToken) {
  const helpText = `🤖 <b>Soma - Nutrition Assistant</b>

📸 <b>Food Analysis:</b>
• Send photos of meals/snacks
• Describe food in text
• Get calories, macros, fiber analysis
• Receive personalized nutrition advice

📋 <b>Commands:</b>
/start - introduction and setup
/today - daily nutrition summary
/goals - view nutrition targets
/test - system status check
/debug - technical information
/help - this reference

💡 <b>Examples:</b>
"Scrambled eggs with toast"
"Caesar salad, large portion"
"Protein shake with banana"

🎯 Track your nutrition to achieve optimal health!`;

  await sendMessage(chatId, helpText, botToken);
}

async function handleTestCommand(chatId, botToken, openaiKey, supabaseUrl) {
  // Test OpenAI connection
  let openaiStatus = '❌ Not configured';
  if (openaiKey) {
    try {
      const testResponse = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${openaiKey}` }
      });
      if (testResponse.ok) {
        const models = await testResponse.json();
        const hasGPT4o = models.data.some(m => m.id === 'gpt-4o');
        openaiStatus = hasGPT4o ? '✅ GPT-4o Available' : '⚠️ Limited models';
      } else {
        openaiStatus = '❌ API Error';
      }
    } catch {
      openaiStatus = '❌ Connection failed';
    }
  }

  // Test Supabase
  let supabaseStatus = '❌ Not configured';
  if (supabaseUrl) {
    try {
      const testResponse = await fetch(`${supabaseUrl}/rest/v1/users?select=count`, {
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
        }
      });
      supabaseStatus = testResponse.ok ? '✅ Connected' : '❌ Connection error';
    } catch {
      supabaseStatus = '❌ Unavailable';
    }
  }

  const testText = `🧪 <b>Soma Systems Test</b>

🕐 <b>Time:</b> ${new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' })}
🌐 <b>Server:</b> Vercel (USA)
🔧 <b>Runtime:</b> Node.js ${process.version}

🔐 <b>System Status:</b>
✅ Telegram Bot API: Working
${openaiStatus}
${supabaseStatus}
✅ Timezone: Europe/Madrid

📡 <b>Webhook:</b> Active and responding
🚀 <b>Ready:</b> Send food photos for AI analysis!`;

  await sendMessage(chatId, testText, botToken);
}

// Ensure user exists in database
async function ensureUserExists(userId, userName, supabaseUrl, supabaseHeaders) {
  try {
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}&select=id`,
      { headers: supabaseHeaders }
    );

    const users = await userResponse.json();
    
    if (users.length === 0) {
      console.log(`Creating user ${userId}`);
      
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
        headers: {
          ...supabaseHeaders,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(newUser)
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error('Failed to create user:', errorText);
        throw new Error('Failed to create user');
      }

      console.log(`User ${userId} created successfully`);
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
  } catch (error) {
    console.error('Ensure user exists error:', error);
    throw error;
  }
}

// Save food entry with enhanced error handling
async function saveFoodEntry(userId, message, nutritionData, supabaseUrl, supabaseHeaders) {
  try {
    console.log(`Saving food entry for user ${userId}`);
    
    // Ensure user exists first
    await ensureUserExists(userId, message.from.first_name, supabaseUrl, supabaseHeaders);
    
    // Get user UUID
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}&select=id`,
      { headers: supabaseHeaders }
    );

    const users = await userResponse.json();
    if (users.length === 0) {
      throw new Error('User not found after creation');
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
      score_item: nutritionData.score,
      confidence: nutritionData.confidence,
      advice_short: nutritionData.advice_short,
      raw_model_json: nutritionData
    };

    console.log('Saving entry:', entry);

    const saveResponse = await fetch(`${supabaseUrl}/rest/v1/entries`, {
      method: 'POST',
      headers: supabaseHeaders,
      body: JSON.stringify(entry)
    });

    if (!saveResponse.ok) {
      const errorText = await saveResponse.text();
      console.error('Failed to save entry:', errorText);
      throw new Error('Failed to save food entry');
    }

    console.log('Entry saved successfully');
    
    // Update daily aggregates
    await updateDailyAggregates(userUuid, today, supabaseUrl, supabaseHeaders);

  } catch (error) {
    console.error('Save food entry error:', error);
    // Don't throw - allow response to user even if save fails
  }
}

// Update daily aggregates
async function updateDailyAggregates(userUuid, dayLocal, supabaseUrl, supabaseHeaders) {
  try {
    console.log(`Updating daily aggregates for ${dayLocal}`);
    
    // Get all entries for today
    const entriesResponse = await fetch(
      `${supabaseUrl}/rest/v1/entries?user_id=eq.${userUuid}&day_local=eq.${dayLocal}&select=*`,
      { headers: supabaseHeaders }
    );

    if (!entriesResponse.ok) {
      throw new Error('Failed to fetch entries for aggregation');
    }

    const entries = await entriesResponse.json();
    
    if (entries.length === 0) {
      console.log('No entries found for aggregation');
      return;
    }

    // Calculate totals
    const totals = entries.reduce((acc, entry) => ({
      calories: acc.calories + (entry.calories || 0),
      protein: acc.protein + (entry.protein_g || 0),
      fat: acc.fat + (entry.fat_g || 0),
      carbs: acc.carbs + (entry.carbs_g || 0),
      fiber: acc.fiber + (entry.fiber_g || 0),
      score: acc.score + (entry.score_item || 0)
    }), { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, score: 0 });

    const dailyScore = entries.length > 0 ? Math.round((totals.score / entries.length) * 10) / 10 : 0;

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
      console.log(`Updated daily aggregates: ${entries.length} meals, ${Math.round(totals.calories)} cal`);
    } else {
      const errorText = await upsertResponse.text();
      console.error('Failed to update daily aggregates:', errorText);
    }

  } catch (error) {
    console.error('Update daily aggregates error:', error);
  }
}

// Today command implementation
async function handleTodayCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Get user UUID
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}&select=id,cal_goal,protein_goal_g,fiber_goal_g`,
      { headers: supabaseHeaders }
    );

    if (!userResponse.ok) {
      await sendMessage(chatId, '❌ User not found. Send /start to register.', botToken);
      return;
    }

    const users = await userResponse.json();
    if (users.length === 0) {
      await sendMessage(chatId, '❌ User not found. Send /start to register.', botToken);
      return;
    }

    const user = users[0];
    const userUuid = user.id;
    
    // Get today's entries
    const entriesResponse = await fetch(
      `${supabaseUrl}/rest/v1/entries?user_id=eq.${userUuid}&day_local=eq.${today}&select=*&order=timestamp_utc.asc`,
      { headers: supabaseHeaders }
    );

    if (!entriesResponse.ok) {
      await sendMessage(chatId, '❌ Failed to fetch today\'s data.', botToken);
      return;
    }

    const entries = await entriesResponse.json();
    console.log(`Found ${entries.length} entries for today`);

    if (entries.length === 0) {
      await sendMessage(chatId, 
        `📝 <b>Today (${today})</b>\n\n` +
        'No food entries yet.\n' +
        'Send a photo or describe what you ate!', 
        botToken);
      return;
    }

    // Calculate totals
    const totals = entries.reduce((acc, entry) => ({
      calories: acc.calories + (entry.calories || 0),
      protein: acc.protein + (entry.protein_g || 0),
      fat: acc.fat + (entry.fat_g || 0),
      carbs: acc.carbs + (entry.carbs_g || 0),
      fiber: acc.fiber + (entry.fiber_g || 0),
      score: acc.score + (entry.score_item || 0)
    }), { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, score: 0 });

    const avgScore = entries.length > 0 ? Math.round((totals.score / entries.length) * 10) / 10 : 0;
    const goals = { cal: user.cal_goal || 1800, protein: user.protein_goal_g || 120, fiber: user.fiber_goal_g || 25 };

    const todayText = `📊 <b>Today (${today})</b>

🍽️ <b>Meals logged:</b> ${entries.length}

📈 <b>Daily totals:</b>
• Calories: ${Math.round(totals.calories)} / ${goals.cal} kcal (${Math.round((totals.calories / goals.cal) * 100)}%)
• Protein: ${Math.round(totals.protein * 10) / 10} / ${goals.protein}g (${Math.round((totals.protein / goals.protein) * 100)}%)
• Fat: ${Math.round(totals.fat * 10) / 10}g
• Carbs: ${Math.round(totals.carbs * 10) / 10}g
• Fiber: ${Math.round(totals.fiber * 10) / 10} / ${goals.fiber}g (${Math.round((totals.fiber / goals.fiber) * 100)}%)

⭐ <b>Average meal score:</b> ${avgScore}/10

💡 <b>Progress:</b> ${
  totals.calories < goals.cal * 0.7 ? 'Add more calories for the day' :
  totals.calories > goals.cal * 1.2 ? 'Calorie goal exceeded' :
  'Good calorie balance'
}`;

    await sendMessage(chatId, todayText, botToken);

  } catch (error) {
    console.error('Today command error:', error);
    await sendMessage(chatId, '❌ Failed to fetch today\'s summary.', botToken);
  }
}

async function handleGoalsCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders) {
  try {
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

    const goalsText = `🎯 <b>Your Nutrition Goals</b>

🔥 <b>Calories:</b> ${user.cal_goal} kcal/day
💪 <b>Protein:</b> ${user.protein_goal_g}g/day  
🌾 <b>Fiber:</b> ${user.fiber_goal_g}g/day
🌍 <b>Timezone:</b> ${user.timezone}

📊 These goals are used for analysis scoring and advice.

💡 Goal customization will be added in the next version.`;

    await sendMessage(chatId, goalsText, botToken);

  } catch (error) {
    console.error('Goals command error:', error);
    await sendMessage(chatId, '❌ Failed to fetch goals.', botToken);
  }
}

async function handleDebugCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Get user info
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}&select=*`,
      { headers: supabaseHeaders }
    );
    
    if (!userResponse.ok) {
      await sendMessage(chatId, '❌ Database connection error.', botToken);
      return;
    }
    
    const users = await userResponse.json();
    
    if (users.length === 0) {
      await sendMessage(chatId, '❌ User not found in database. Send /start to register.', botToken);
      return;
    }
    
    const user = users[0];
    const userUuid = user.id;
    
    // Get entries
    const entriesResponse = await fetch(
      `${supabaseUrl}/rest/v1/entries?user_id=eq.${userUuid}&select=*&order=timestamp_utc.desc&limit=10`,
      { headers: supabaseHeaders }
    );
    
    const allEntries = await entriesResponse.json();
    
    const todayEntriesResponse = await fetch(
      `${supabaseUrl}/rest/v1/entries?user_id=eq.${userUuid}&day_local=eq.${today}&select=*`,
      { headers: supabaseHeaders }
    );
    
    const todayEntries = await todayEntriesResponse.json();
    
    const debugText = `🔧 <b>Debug Information</b>

👤 <b>User:</b>
• Telegram ID: ${userId}
• Database UUID: ${userUuid.substring(0, 8)}...
• Name: ${user.display_name}
• Created: ${new Date(user.first_seen_utc).toLocaleDateString()}

📊 <b>Database Stats:</b>
• Total entries: ${allEntries.length}
• Entries today: ${todayEntries.length}
• Latest entry: ${allEntries.length > 0 ? new Date(allEntries[0].timestamp_utc).toLocaleString() : 'None'}

📅 <b>Today (${today}):</b>
${todayEntries.length > 0 ? 
  todayEntries.map((entry, i) => 
    `${i+1}. ${entry.calories}kcal, ${entry.protein_g}g protein (${new Date(entry.timestamp_utc).toLocaleTimeString()})`
  ).slice(0, 3).join('\n') 
  : 'No entries'}

💾 <b>Database:</b> ✅ Connected
🔗 <b>URL:</b> ${supabaseUrl.substring(8, 35)}...

Send food photos/descriptions to test AI analysis!`;

    await sendMessage(chatId, debugText, botToken);
    
  } catch (error) {
    console.error('Debug command error:', error);
    await sendMessage(chatId, `❌ Debug error: ${error.message}`, botToken);
  }
}
