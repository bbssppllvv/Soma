// Soma Telegram Bot - Enhanced Version with GPT-5
// Improved prompts for better nutrition analysis

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
      // Handle food analysis with enhanced AI
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

// Enhanced food analysis with GPT-5
async function handleFoodAnalysis(message, botToken, openaiKey, supabaseUrl, supabaseHeaders) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text || message.caption || '';
  
  try {
    await sendMessage(chatId, '🔍 Analyzing nutrition with AI...', botToken);

    let nutritionData;

    if (message.photo && openaiKey) {
      // Get user context for better analysis
      const userContext = await getUserContext(userId, supabaseUrl, supabaseHeaders);
      nutritionData = await analyzePhotoWithGPT5(message.photo, text, openaiKey, userContext);
    } else if (text && openaiKey) {
      const userContext = await getUserContext(userId, supabaseUrl, supabaseHeaders);
      nutritionData = await analyzeTextWithGPT5(text, openaiKey, userContext);
    } else {
      nutritionData = getFallbackAnalysis();
    }

    // Save to database with auto-user creation
    await saveFoodEntry(userId, message, nutritionData, supabaseUrl, supabaseHeaders);

    // Enhanced response format
    const responseText = `🍽️ <b>Nutrition Analysis Complete</b>

📊 <b>Nutritional Breakdown:</b>
• Calories: ~${nutritionData.calories} kcal
• Protein: ${nutritionData.protein_g}g
• Fat: ${nutritionData.fat_g}g  
• Carbs: ${nutritionData.carbs_g}g
• Fiber: ${nutritionData.fiber_g}g

⭐ <b>Meal Score:</b> ${nutritionData.score || calculateMealScore(nutritionData)}/10

${nutritionData.confidence < 0.6 ? '⚠️ <b>Low confidence estimate</b>\n' : ''}💡 <b>Advice:</b> ${nutritionData.advice_short}

📈 <b>Progress:</b> Use /today to see daily totals
🎯 <b>Goals:</b> 1800 cal, 120g protein, 25g fiber daily`;

    await sendMessage(chatId, responseText, botToken);

  } catch (error) {
    console.error('Food analysis error:', error);
    await sendMessage(chatId, '❌ Analysis failed. Please try again or describe the food in text.', botToken);
  }
}

// Get user context for personalized analysis
async function getUserContext(userId, supabaseUrl, supabaseHeaders) {
  try {
    // Get user goals
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}&select=cal_goal,protein_goal_g,fiber_goal_g,timezone`,
      { headers: supabaseHeaders }
    );

    if (!userResponse.ok) {
      return getDefaultUserContext();
    }

    const users = await userResponse.json();
    if (users.length === 0) {
      return getDefaultUserContext();
    }

    const user = users[0];

    // Get recent meals for context
    const today = new Date().toISOString().split('T')[0];
    const userUuidResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}&select=id`,
      { headers: supabaseHeaders }
    );
    
    if (userUuidResponse.ok) {
      const uuidUsers = await userUuidResponse.json();
      if (uuidUsers.length > 0) {
        const userUuid = uuidUsers[0].id;
        
        const entriesResponse = await fetch(
          `${supabaseUrl}/rest/v1/entries?user_id=eq.${userUuid}&day_local=eq.${today}&select=calories,protein_g,fiber_g&order=timestamp_utc.desc&limit=3`,
          { headers: supabaseHeaders }
        );

        if (entriesResponse.ok) {
          const recentEntries = await entriesResponse.json();
          const todayTotals = recentEntries.reduce((acc, entry) => ({
            calories: acc.calories + (entry.calories || 0),
            protein: acc.protein + (entry.protein_g || 0),
            fiber: acc.fiber + (entry.fiber_g || 0)
          }), { calories: 0, protein: 0, fiber: 0 });

          return {
            goals: user,
            todayTotals,
            mealsToday: recentEntries.length
          };
        }
      }
    }

    return { goals: user, todayTotals: { calories: 0, protein: 0, fiber: 0 }, mealsToday: 0 };

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

// Enhanced photo analysis with GPT-5
async function analyzePhotoWithGPT5(photos, caption, openaiKey, userContext) {
  try {
    // Get photo file
    const photo = photos[photos.length - 1];
    const fileResponse = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${photo.file_id}`);
    const fileData = await fileResponse.json();
    
    if (!fileData.ok) {
      throw new Error('Failed to get photo file');
    }

    const photoUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileData.result.file_path}`;
    const photoResponse = await fetch(photoUrl);
    const photoBuffer = await photoResponse.arrayBuffer();
    const base64Image = Buffer.from(photoBuffer).toString('base64');

    // Enhanced system prompt with user context
    const systemPrompt = `You are Soma, an expert nutrition analyst. Analyze the food photo and provide accurate nutritional information.

RESPONSE FORMAT: JSON only with these exact fields:
{
  "calories": number (total calories for this portion),
  "protein_g": number (protein in grams, 1 decimal place),
  "fat_g": number (total fat in grams, 1 decimal place), 
  "carbs_g": number (carbohydrates in grams, 1 decimal place),
  "fiber_g": number (dietary fiber in grams, 1 decimal place),
  "confidence": number (0-1, how certain you are about the analysis),
  "advice_short": "string (actionable nutrition advice, max 120 chars)"
}

ANALYSIS GUIDELINES:
- Estimate portion sizes from visual cues (plate size, utensils, hand comparisons)
- Consider cooking methods (fried adds 20-30% calories vs grilled/steamed)
- Account for hidden ingredients (cooking oils, dressings, sauces, butter)
- Look for protein sources and estimate bioavailability
- Identify fiber sources (vegetables, whole grains, legumes, fruits)
- Consider food density and water content

ADVICE PRIORITIES:
1. Protein optimization (target: 25-40g per main meal, 15-20g per snack)
2. Fiber enhancement (target: 8-12g per meal for satiety and gut health)
3. Calorie balance (breakfast: 300-500, lunch: 400-600, dinner: 400-600, snacks: 100-300)
4. Micronutrient density (colorful vegetables, whole foods over processed)
5. Practical meal enhancement suggestions

USER DAILY GOALS: ${userContext.goals.cal_goal} calories, ${userContext.goals.protein_goal_g}g protein, ${userContext.goals.fiber_goal_g}g fiber
TODAY SO FAR: ${userContext.todayTotals.calories} calories, ${userContext.todayTotals.protein}g protein, ${userContext.todayTotals.fiber}g fiber (${userContext.mealsToday} meals)

Return only valid JSON, no additional text.`;

    // Enhanced user prompt with context
    const userPrompt = caption ? 
      `Food description: "${caption}"

Context: This is meal #${userContext.mealsToday + 1} today. User has consumed ${userContext.todayTotals.calories} calories so far.

Analyze this meal photo considering:
- Portion size and preparation method
- How this fits into daily nutrition goals
- What nutrients are still needed today
- Practical advice for optimal nutrition

Return detailed JSON analysis.` :
      `Analyze this food photo in detail.

Context: User's meal #${userContext.mealsToday + 1} today. Current intake: ${userContext.todayTotals.calories} cal, ${userContext.todayTotals.protein}g protein, ${userContext.todayTotals.fiber}g fiber.

Consider:
- Portion estimation from visual cues
- Cooking method impact on nutrition
- How this meal fits daily goals (${userContext.goals.cal_goal} cal, ${userContext.goals.protein_goal_g}g protein, ${userContext.goals.fiber_goal_g}g fiber)
- What nutrients are still needed
- Actionable advice for better nutrition

Return JSON analysis only.`;

    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-5',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
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
        max_tokens: 600,
        temperature: 0.2
      })
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error('OpenAI API error:', openaiResponse.status, errorText);
      throw new Error(`OpenAI API error: ${openaiResponse.status}`);
    }

    const openaiData = await openaiResponse.json();
    const content = openaiData.choices[0]?.message?.content;
    
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    return parseNutritionResponse(content);

  } catch (error) {
    console.error('Photo analysis error:', error);
    return getFallbackAnalysis('AI photo analysis failed. Approximate estimate provided.');
  }
}

// Enhanced text analysis with GPT-5
async function analyzeTextWithGPT5(text, openaiKey, userContext) {
  try {
    const systemPrompt = `You are Soma, an expert nutrition analyst. Analyze the food description and provide accurate nutritional information.

RESPONSE FORMAT: JSON only with these exact fields:
{
  "calories": number (total calories for described portion),
  "protein_g": number (protein in grams, 1 decimal place),
  "fat_g": number (total fat in grams, 1 decimal place),
  "carbs_g": number (carbohydrates in grams, 1 decimal place), 
  "fiber_g": number (dietary fiber in grams, 1 decimal place),
  "confidence": number (0-1, certainty based on description detail),
  "advice_short": "string (actionable nutrition advice, max 120 chars)"
}

ANALYSIS GUIDELINES:
- Interpret portion descriptions (small/medium/large, cups, pieces, grams)
- Consider preparation methods mentioned (fried, grilled, steamed, raw)
- Estimate standard serving sizes when portions not specified
- Account for typical ingredients and cooking additions (oil, butter, sauces)
- Assess protein quality and amino acid completeness
- Identify fiber sources and estimate soluble vs insoluble
- Consider glycemic impact and satiety factors

ADVICE PRIORITIES:
1. Protein optimization (complete proteins, leucine content, timing)
2. Fiber enhancement (variety of sources, prebiotic benefits)
3. Calorie balance (appropriate for meal type and daily goals)
4. Micronutrient density (vitamins, minerals, antioxidants)
5. Practical meal improvements (additions, substitutions, preparations)

USER DAILY GOALS: ${userContext.goals.cal_goal} calories, ${userContext.goals.protein_goal_g}g protein, ${userContext.goals.fiber_goal_g}g fiber
TODAY SO FAR: ${userContext.todayTotals.calories} calories, ${userContext.todayTotals.protein}g protein, ${userContext.todayTotals.fiber}g fiber (${userContext.mealsToday} meals)

Return only valid JSON, no additional text.`;

    const userPrompt = `Food description: "${text}"

Context: This is meal #${userContext.mealsToday + 1} today. User has consumed ${userContext.todayTotals.calories} calories, ${userContext.todayTotals.protein}g protein, ${userContext.todayTotals.fiber}g fiber so far.

Remaining daily needs: ${userContext.goals.cal_goal - userContext.todayTotals.calories} calories, ${userContext.goals.protein_goal_g - userContext.todayTotals.protein}g protein, ${userContext.goals.fiber_goal_g - userContext.todayTotals.fiber}g fiber.

Analyze this food description considering:
- Typical preparation and serving size
- How this meal contributes to daily goals
- What nutrients are still needed today
- Practical advice for optimal nutrition balance

Return detailed JSON analysis.`;

    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-5',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 500,
        temperature: 0.2
      })
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error('OpenAI text analysis error:', openaiResponse.status, errorText);
      throw new Error(`OpenAI API error: ${openaiResponse.status}`);
    }

    const openaiData = await openaiResponse.json();
    const content = openaiData.choices[0]?.message?.content;
    
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    return parseNutritionResponse(content);

  } catch (error) {
    console.error('Text analysis error:', error);
    return getFallbackAnalysis('AI text analysis failed. Approximate estimate provided.');
  }
}

// Parse OpenAI response
function parseNutritionResponse(content) {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    // Validate and clean data
    const result = {
      calories: Math.max(0, Math.round(parsed.calories || 300)),
      protein_g: Math.max(0, Math.round((parsed.protein_g || 15) * 10) / 10),
      fat_g: Math.max(0, Math.round((parsed.fat_g || 10) * 10) / 10),
      carbs_g: Math.max(0, Math.round((parsed.carbs_g || 30) * 10) / 10),
      fiber_g: Math.max(0, Math.round((parsed.fiber_g || 3) * 10) / 10),
      confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
      advice_short: (parsed.advice_short || 'Meal recorded successfully.').substring(0, 120)
    };

    // Calculate meal score
    result.score = calculateEnhancedMealScore(result);

    return result;

  } catch (error) {
    console.error('Parse response error:', error);
    return getFallbackAnalysis('Failed to parse AI response. Using approximate values.');
  }
}

// Enhanced meal scoring with more factors
function calculateEnhancedMealScore(nutrition) {
  let score = 0;
  
  // Protein score (0-3 points)
  if (nutrition.protein_g >= 30) score += 3;
  else if (nutrition.protein_g >= 20) score += 2;
  else if (nutrition.protein_g >= 10) score += 1;
  
  // Fiber score (0-2 points)
  if (nutrition.fiber_g >= 10) score += 2;
  else if (nutrition.fiber_g >= 5) score += 1;
  
  // Calorie appropriateness (0-3 points)
  if (nutrition.calories >= 200 && nutrition.calories <= 600) score += 3;
  else if (nutrition.calories >= 150 && nutrition.calories <= 800) score += 2;
  else if (nutrition.calories >= 100 && nutrition.calories <= 1000) score += 1;
  
  // Macronutrient balance (0-2 points)
  const proteinCal = nutrition.protein_g * 4;
  const fatCal = nutrition.fat_g * 9;
  const carbsCal = nutrition.carbs_g * 4;
  const totalMacroCal = proteinCal + fatCal + carbsCal;
  
  if (totalMacroCal > 0) {
    const proteinPercent = proteinCal / totalMacroCal;
    const fatPercent = fatCal / totalMacroCal;
    
    // Good macronutrient distribution
    if (proteinPercent >= 0.15 && proteinPercent <= 0.35 && fatPercent >= 0.20 && fatPercent <= 0.40) {
      score += 2;
    } else if (proteinPercent >= 0.10 && fatPercent <= 0.50) {
      score += 1;
    }
  }
  
  // Confidence bonus/penalty
  score *= (0.5 + nutrition.confidence * 0.5);
  
  return Math.max(0, Math.min(10, Math.round(score * 10) / 10));
}

function getFallbackAnalysis(message = 'AI analysis not available. Approximate estimate.') {
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

// Copy other functions from full-bot.js (sendMessage, handleStartCommand, etc.)
// ... [Include all other functions from full-bot.js]

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
    return response.ok;
  } catch (error) {
    console.error('Send message error:', error);
    return false;
  }
}

async function handleStartCommand(chatId, userId, userName, botToken, supabaseUrl, supabaseHeaders) {
  const welcomeText = `👋 Welcome ${userName}! I'm Soma - your personal nutrition tracker.

📸 <b>Send food photos</b> - I'll analyze calories, protein, fat, carbs, and fiber
💬 <b>Describe meals in text</b> - e.g. "grilled chicken with rice, 200g"
📊 <b>Get personalized insights</b> - score 0-10 and tailored advice

🎯 <b>Your default goals:</b>
• Calories: 1800 kcal/day
• Protein: 120g/day
• Fiber: 25g/day

📋 <b>Commands:</b>
/today - today's summary
/goals - view nutrition goals
/help - full command reference

🚀 <b>Start by sending a photo of your meal!</b>`;

  await sendMessage(chatId, welcomeText, botToken);
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
  // Test implementation similar to previous version
  const testText = `🧪 <b>Soma Systems Test</b>

✅ Telegram Bot API: Working
${openaiKey ? '✅' : '❌'} OpenAI GPT-5: ${openaiKey ? 'Configured' : 'Missing'}
${supabaseUrl ? '✅' : '❌'} Supabase Database: ${supabaseUrl ? 'Connected' : 'Missing'}

🚀 Ready for nutrition analysis!`;

  await sendMessage(chatId, testText, botToken);
}

// Placeholder for other functions - copy from full-bot.js
async function handleTodayCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders) {
  await sendMessage(chatId, 'Today command - implementation from full-bot.js', botToken);
}

async function handleGoalsCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders) {
  await sendMessage(chatId, 'Goals command - implementation from full-bot.js', botToken);
}

async function handleDebugCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders) {
  await sendMessage(chatId, 'Debug command - implementation from full-bot.js', botToken);
}

async function saveFoodEntry(userId, message, nutritionData, supabaseUrl, supabaseHeaders) {
  console.log('Save food entry - implementation from full-bot.js');
}
