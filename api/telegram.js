// Soma Telegram Bot - Final Working Version
// Complete functionality with working OpenAI integration

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const update = req.body;
    
    if (!update) {
      return res.status(200).json({ ok: true });
    }

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

    // Handle callback queries first
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query, botToken, supabaseUrl, supabaseHeaders);
      return res.status(200).json({ ok: true });
    }

    if (!update.message) {
      return res.status(200).json({ ok: true });
    }

    const message = update.message;
    const chatId = message.chat.id;
    const text = message.text || message.caption || '';
    const userId = message.from.id;
    const userName = message.from.first_name || 'User';
    
    console.log(`Message from ${userName} (${userId}): ${text}`);

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
    } else if (text === '/meals') {
      await handleMealsCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders);
    } else if (text === '/reset') {
      await handleResetCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders);
    } else if (text === '/profile') {
      await handleProfileCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders);
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

    // Don't save yet - show analysis and ask for confirmation
    const confidenceText = nutritionData.confidence < 0.6 ? '⚠️ <b>Low confidence estimate</b>\n' : 
                          nutritionData.confidence > 0.8 ? '✅ <b>High confidence analysis</b>\n' : '';

    const responseText = `🍽️ <b>Nutrition Analysis</b>

📊 <b>Nutritional Breakdown:</b>
🔥 Calories: ${nutritionData.calories} kcal
🥩 Protein: ${nutritionData.protein_g}g
🧈 Fat: ${nutritionData.fat_g}g  
🍞 Carbs: ${nutritionData.carbs_g}g
🌾 Fiber: ${nutritionData.fiber_g}g

⭐ <b>Meal Score:</b> ${nutritionData.score}/10

${confidenceText}💡 <b>Advice:</b> ${nutritionData.advice_short}

❓ <b>Add to diet or modify data?</b>`;

    // Store analysis data temporarily with unique ID
    const analysisId = `${userId}_${message.message_id}_${Date.now()}`;
    global.tempAnalysisData = global.tempAnalysisData || {};
    global.tempAnalysisData[analysisId] = {
      ...nutritionData, 
      messageId: message.message_id, 
      chatId, 
      userId,
      originalText: message.text || message.caption
    };

    // Create confirmation keyboard with edit options
    const keyboard = [
      [
        { text: '✅ Add to Diet', callback_data: `confirm_save_${analysisId}` },
        { text: '❌ Cancel', callback_data: 'cancel_analysis' }
      ],
      [
        { text: '✏️ Edit Calories', callback_data: `edit_analysis_calories_${analysisId}` },
        { text: '✏️ Edit Protein', callback_data: `edit_analysis_protein_${analysisId}` }
      ],
      [
        { text: '📊 Edit Portion', callback_data: `edit_analysis_portion_${analysisId}` }
      ]
    ];

    await sendMessageWithKeyboard(chatId, responseText, keyboard, botToken);

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

    // Use GPT-5 with Responses API for proper image analysis
    const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        reasoning: { effort: "minimal" },
        text: { verbosity: "low" },
        tools: [{
          type: "function",
          name: "food_analysis",
          description: "Return nutrition estimation for the photo",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              calories: { type: "integer" },
              protein_g: { type: "number" },
              fat_g: { type: "number" },
              carbs_g: { type: "number" },
              fiber_g: { type: "number" },
              confidence: { type: "number" },
              advice_short: { type: "string" }
            },
            required: ["calories", "protein_g", "fat_g", "carbs_g", "fiber_g", "confidence", "advice_short"]
          }
        }],
        tool_choice: { type: "function", name: "food_analysis" },
        input: [{
          role: "user",
          content: [
            { 
              type: "input_text", 
              text: `Analyze this food photo and return nutrition data.
              
${caption ? `User description: "${caption}"` : ''}

User context: Daily goals ${userContext.goals.cal_goal} cal, ${userContext.goals.protein_goal_g}g protein, ${userContext.goals.fiber_goal_g}g fiber. Today consumed: ${userContext.todayTotals.calories} cal, ${userContext.todayTotals.protein}g protein, ${userContext.todayTotals.fiber}g fiber. Profile complete: ${userContext.hasProfile ? 'Yes' : 'No'}.

Estimate calories, macronutrients, fiber and provide brief advice. Return JSON per schema.`
            },
            { 
              type: "input_image", 
              image_url: `data:image/jpeg;base64,${base64Image}`
            }
          ]
        }],
        max_output_tokens: 400
      })
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error('OpenAI API error:', openaiResponse.status, errorText);
      throw new Error(`OpenAI API error: ${openaiResponse.status} - ${errorText}`);
    }

    const openaiData = await openaiResponse.json();
    console.log('GPT-5 Responses API response:', JSON.stringify(openaiData, null, 2));
    
    // For function calling, extract from function_call arguments
    const functionCall = openaiData.output?.find(o => o.type === "function_call");
    const functionArgs = functionCall?.arguments;
    
    console.log('Extracted function arguments:', functionArgs);
    
    if (!functionArgs) {
      // Fallback to output_text if no tool call
      const content = openaiData.output_text;
      if (content) {
        return parseNutritionResponse(content, 'photo');
      }
      
      console.error('No function_call or output_text in GPT-5 response:', Object.keys(openaiData));
      throw new Error(`No function call from GPT-5. Response keys: ${Object.keys(openaiData).join(', ')}`);
    }
    
    // Parse function arguments as JSON
    const parsed = JSON.parse(functionArgs);
    
    // Add meal score
    parsed.score = calculateMealScore(parsed);
    
    console.log('Final parsed result:', parsed);
    return parsed;

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
        model: 'gpt-5-mini',
        input: `Analyze this food description: "${text}"

USER CONTEXT:
- Daily nutrition goals: ${userContext.goals.cal_goal} calories, ${userContext.goals.protein_goal_g}g protein, ${userContext.goals.fiber_goal_g}g fiber
- Today's progress: ${userContext.todayTotals.calories} calories, ${userContext.todayTotals.protein}g protein, ${userContext.todayTotals.fiber}g fiber consumed
- This is meal #${userContext.mealsToday + 1} today
- Remaining needs: ${userContext.goals.cal_goal - userContext.todayTotals.calories} calories, ${userContext.goals.protein_goal_g - userContext.todayTotals.protein}g protein, ${userContext.goals.fiber_goal_g - userContext.todayTotals.fiber}g fiber
- Profile personalized: ${userContext.hasProfile ? 'Yes (goals are calculated for user)' : 'No (using defaults)'}

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

    // Use personalized goals if profile is complete, otherwise defaults
    const hasProfile = user.age && user.weight_kg && user.height_cm && user.fitness_goal;
    let goals;
    
    if (hasProfile) {
      goals = {
        cal_goal: user.cal_goal || 1800,
        protein_goal_g: user.protein_goal_g || 120,
        fiber_goal_g: user.fiber_goal_g || 25,
        fat_goal_g: user.fat_goal_g || 60,
        carbs_goal_g: user.carbs_goal_g || 200
      };
    } else {
      // Default goals for users without complete profile
      goals = {
        cal_goal: 2000,
        protein_goal_g: 150,
        fiber_goal_g: 25,
        fat_goal_g: 65,
        carbs_goal_g: 250
      };
    }

    return {
      goals,
      todayTotals,
      mealsToday,
      hasProfile
    };

  } catch (error) {
    console.error('Error getting user context:', error);
    return getDefaultUserContext();
  }
}

function getDefaultUserContext() {
  return {
    goals: { 
      cal_goal: 2000, 
      protein_goal_g: 150, 
      fiber_goal_g: 25,
      fat_goal_g: 65,
      carbs_goal_g: 250
    },
    todayTotals: { calories: 0, protein: 0, fiber: 0 },
    mealsToday: 0,
    hasProfile: false
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
    // Check if user exists and has completed onboarding
    const userExists = await checkUserProfile(userId, supabaseUrl, supabaseHeaders);
    
    if (!userExists.exists) {
      // New user - start onboarding
      await ensureUserExists(userId, userName, supabaseUrl, supabaseHeaders);
      await startOnboarding(chatId, userId, userName, botToken, supabaseUrl, supabaseHeaders);
    } else if (!userExists.hasProfile) {
      // Existing user without profile - start onboarding
      await startOnboarding(chatId, userId, userName, botToken, supabaseUrl, supabaseHeaders);
    } else {
      // Existing user with profile - show welcome back message
      const welcomeText = `👋 Welcome back ${userName}! I'm Soma - your personal nutrition tracker.

📸 <b>Send food photos</b> - I'll analyze calories, protein, fat, carbs, and fiber
💬 <b>Describe meals in text</b> - e.g. "grilled chicken with rice, 200g"
📊 <b>Get personalized insights</b> - score 0-10 and tailored advice
🍽️ <b>Manage your meals</b> - edit, delete, adjust portions, or repeat favorites

📋 <b>Commands:</b>
/meals - manage your recent meals
/today - today's nutrition summary
/goals - view nutrition targets
/profile - view/edit your profile
/help - full command reference

🚀 <b>Start by sending a photo of your meal!</b>`;

      await sendMessage(chatId, welcomeText, botToken);
    }
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

🍽️ <b>Meal Management:</b>
• View and edit recent meals
• Delete unwanted entries
• Adjust portion sizes (25%, 50%, 75%, etc.)
• Duplicate favorite meals
• Modify calories and macros

📋 <b>Commands:</b>
/start - introduction and setup
/meals - manage your recent meals
/today - daily nutrition summary
/goals - view nutrition targets
/profile - view/edit your profile
/reset - reset all your data
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
        cal_goal: 2000, // Default for users without profile
        protein_goal_g: 150,
        fiber_goal_g: 25,
        fat_goal_g: 65,
        carbs_goal_g: 250,
        daily_digest_time: '21:30',
        first_seen_utc: new Date().toISOString(),
        last_seen_utc: new Date().toISOString(),
        // Profile fields - will be filled during onboarding
        age: null,
        gender: null,
        height_cm: null,
        weight_kg: null,
        fitness_goal: null,
        activity_level: null,
        profile_completed_at: null
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
    const userCheck = await checkUserProfile(userId, supabaseUrl, supabaseHeaders);
    
    if (!userCheck.exists || !userCheck.hasProfile) {
      // User doesn't have a complete profile
      const setupText = `🎯 <b>Nutrition Goals</b>

⚠️ <b>Profile not set up yet!</b>

I'm currently using default goals:
🔥 Calories: 2000 kcal/day
💪 Protein: 150g/day  
🧈 Fat: 65g/day
🍞 Carbs: 250g/day
🌾 Fiber: 25g/day

💡 <b>Want personalized goals?</b>
Complete your profile to get targets calculated specifically for your body, goals, and activity level!`;

      const keyboard = [
        [
          { text: '🚀 Set Up Profile', callback_data: 'onboarding_start' }
        ]
      ];

      await sendMessageWithKeyboard(chatId, setupText, keyboard, botToken);
      return;
    }

    const user = userCheck.user;
    const targets = calculateNutritionTargets(
      user.weight_kg,
      user.height_cm,
      user.age,
      user.gender,
      user.fitness_goal,
      user.activity_level
    );

    const goalsText = `🎯 <b>Your Personalized Goals</b>

📊 <b>Daily Targets:</b>
🔥 Calories: ${targets.calories} kcal/day
💪 Protein: ${targets.protein}g/day  
🧈 Fat: ${targets.fat}g/day
🍞 Carbs: ${targets.carbs}g/day
🌾 Fiber: ${targets.fiber}g/day

👤 <b>Based on your profile:</b>
• ${user.age} year old ${user.gender}
• ${user.height_cm}cm, ${user.weight_kg}kg
• Goal: ${user.fitness_goal} weight
• Activity: ${user.activity_level}

📊 These personalized goals are used for analysis scoring and advice.`;

    const keyboard = [
      [
        { text: '✏️ Edit Profile', callback_data: 'profile_edit' },
        { text: '🔄 Recalculate', callback_data: 'profile_recalculate' }
      ]
    ];

    await sendMessageWithKeyboard(chatId, goalsText, keyboard, botToken);

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

// Send message with inline keyboard helper
async function sendMessageWithKeyboard(chatId, text, keyboard, botToken) {
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
async function answerCallbackQuery(callbackQueryId, text, botToken) {
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
async function editMessageWithKeyboard(chatId, messageId, text, keyboard, botToken) {
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

// Handle /meals command - show recent meals with management options
async function handleMealsCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Get user UUID
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}&select=id`,
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

    const userUuid = users[0].id;
    
    // Get recent meals (last 10)
    const entriesResponse = await fetch(
      `${supabaseUrl}/rest/v1/entries?user_id=eq.${userUuid}&select=*&order=timestamp_utc.desc&limit=10`,
      { headers: supabaseHeaders }
    );

    if (!entriesResponse.ok) {
      await sendMessage(chatId, '❌ Failed to fetch meals.', botToken);
      return;
    }

    const entries = await entriesResponse.json();

    if (entries.length === 0) {
      await sendMessage(chatId, 
        '📝 <b>Your Recent Meals</b>\n\n' +
        'No meals found.\n' +
        'Send a photo or describe what you ate to get started!', 
        botToken);
      return;
    }

    // Simple meal list with actions right next to each meal
    let mealsText = '🍽️ <b>Your Meals</b>\n\n';
    const keyboard = [];

    entries.forEach((entry, index) => {
      const date = new Date(entry.timestamp_utc);
      const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const foodDescription = entry.text ? 
        (entry.text.length > 25 ? entry.text.substring(0, 25) + '...' : entry.text) : 
        'Food photo';
      
      mealsText += `<b>${foodDescription}</b> (${timeStr})\n`;
      mealsText += `${entry.calories}kcal • ${entry.protein_g}g protein\n\n`;

      // Only delete button - simple and clear
      keyboard.push([
        { text: `❌ Delete`, callback_data: `quick_delete_${entry.id}` }
      ]);
    });

    await sendMessageWithKeyboard(chatId, mealsText, keyboard, botToken);

  } catch (error) {
    console.error('Meals command error:', error);
    await sendMessage(chatId, '❌ Failed to fetch meals.', botToken);
  }
}

// Handle callback queries from inline keyboards
async function handleCallbackQuery(callbackQuery, botToken, supabaseUrl, supabaseHeaders) {
  try {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;

    console.log(`Callback query from ${userId}: ${data}`);

    // Answer the callback query first
    await answerCallbackQuery(callbackQuery.id, 'Обработка...', botToken);

    if (data.startsWith('quick_delete_')) {
      const entryId = data.replace('quick_delete_', '');
      await quickDeleteMeal(chatId, messageId, userId, entryId, botToken, supabaseUrl, supabaseHeaders);
    } else if (data.startsWith('delete_meal_')) {
      const entryId = data.replace('delete_meal_', '');
      await handleDeleteMeal(chatId, messageId, userId, entryId, botToken, supabaseUrl, supabaseHeaders);
    } else if (data.startsWith('confirm_delete_')) {
      const entryId = data.replace('confirm_delete_', '');
      await confirmDeleteMeal(chatId, messageId, userId, entryId, botToken, supabaseUrl, supabaseHeaders);
    } else if (data.startsWith('cancel_delete_')) {
      await cancelDelete(chatId, messageId, userId, botToken, supabaseUrl, supabaseHeaders);
    } else if (data.startsWith('edit_meal_')) {
      const entryId = data.replace('edit_meal_', '');
      await handleEditMeal(chatId, messageId, userId, entryId, botToken, supabaseUrl, supabaseHeaders);
    } else if (data.startsWith('edit_calories_')) {
      const entryId = data.replace('edit_calories_', '');
      await handleEditCalories(chatId, messageId, userId, entryId, botToken, supabaseUrl, supabaseHeaders);
    } else if (data.startsWith('edit_protein_')) {
      const entryId = data.replace('edit_protein_', '');
      await handleEditProtein(chatId, messageId, userId, entryId, botToken, supabaseUrl, supabaseHeaders);
    } else if (data.startsWith('edit_portion_')) {
      const entryId = data.replace('edit_portion_', '');
      await handleEditPortion(chatId, messageId, userId, entryId, botToken, supabaseUrl, supabaseHeaders);
    } else if (data.startsWith('confirm_save_')) {
      const analysisId = data.replace('confirm_save_', '');
      const analysisData = global.tempAnalysisData?.[analysisId];
      if (analysisData) {
        await confirmSaveAnalysis(chatId, messageId, analysisData, botToken, supabaseUrl, supabaseHeaders);
        delete global.tempAnalysisData[analysisId];
      }
    } else if (data === 'cancel_analysis') {
      await cancelAnalysis(chatId, messageId, botToken);
    } else if (data.startsWith('edit_analysis_calories_')) {
      const analysisId = data.replace('edit_analysis_calories_', '');
      const analysisData = global.tempAnalysisData?.[analysisId];
      if (analysisData) {
        await editAnalysisCalories(chatId, messageId, analysisData, analysisId, botToken, supabaseUrl, supabaseHeaders);
      }
    } else if (data.startsWith('edit_analysis_protein_')) {
      const analysisId = data.replace('edit_analysis_protein_', '');
      const analysisData = global.tempAnalysisData?.[analysisId];
      if (analysisData) {
        await editAnalysisProtein(chatId, messageId, analysisData, analysisId, botToken, supabaseUrl, supabaseHeaders);
      }
    } else if (data.startsWith('edit_analysis_portion_')) {
      const analysisId = data.replace('edit_analysis_portion_', '');
      const analysisData = global.tempAnalysisData?.[analysisId];
      if (analysisData) {
        await editAnalysisPortion(chatId, messageId, analysisData, analysisId, botToken, supabaseUrl, supabaseHeaders);
      }
    } else if (data.startsWith('save_edited_')) {
      const analysisId = data.replace('save_edited_', '');
      const analysisData = global.tempAnalysisData?.[analysisId];
      if (analysisData) {
        await confirmSaveAnalysis(chatId, messageId, analysisData, botToken, supabaseUrl, supabaseHeaders);
        delete global.tempAnalysisData[analysisId];
      }
    } else if (data.startsWith('confirm_reset_')) {
      const userId = data.replace('confirm_reset_', '');
      await confirmDatabaseReset(chatId, messageId, userId, botToken, supabaseUrl, supabaseHeaders);
    } else if (data === 'cancel_reset') {
      await cancelDatabaseReset(chatId, messageId, botToken);
    } else if (data.startsWith('onboarding_')) {
      await handleOnboardingStep(data, chatId, messageId, userId, botToken, supabaseUrl, supabaseHeaders);
    } else if (data.startsWith('profile_')) {
      await handleProfileEdit(data, chatId, messageId, userId, botToken, supabaseUrl, supabaseHeaders);
    } else if (data === 'back_to_meals') {
      // Refresh meals list
      await handleMealsCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders);
    }

  } catch (error) {
    console.error('Callback query error:', error);
    await answerCallbackQuery(callbackQuery.id, 'Ошибка обработки запроса', botToken);
  }
}

// Handle meal deletion with confirmation
async function handleDeleteMeal(chatId, messageId, userId, entryId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Get meal details
    const entryResponse = await fetch(
      `${supabaseUrl}/rest/v1/entries?id=eq.${entryId}&select=*`,
      { headers: supabaseHeaders }
    );

    if (!entryResponse.ok) {
      await sendMessage(chatId, '❌ Блюдо не найдено.', botToken);
      return;
    }

    const entries = await entryResponse.json();
    if (entries.length === 0) {
      await sendMessage(chatId, '❌ Блюдо не найдено.', botToken);
      return;
    }

    const entry = entries[0];
    const date = new Date(entry.timestamp_utc);
    const timeStr = date.toLocaleDateString('ru-RU') + ' ' + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const foodDescription = entry.text || 'Фото еды';

    const confirmText = `⚠️ <b>Подтверждение удаления</b>

🍽️ <b>Блюдо:</b> ${foodDescription}
📅 <b>Время:</b> ${timeStr}
🔥 <b>Калории:</b> ${entry.calories} ккал
🥩 <b>Белок:</b> ${entry.protein_g}г

❗ Это действие нельзя отменить. Удалить блюдо?`;

    const keyboard = [
      [
        { text: '✅ Да, удалить', callback_data: `confirm_delete_${entryId}` },
        { text: '❌ Отмена', callback_data: `cancel_delete_${entryId}` }
      ]
    ];

    await editMessageWithKeyboard(chatId, messageId, confirmText, keyboard, botToken);

  } catch (error) {
    console.error('Delete meal error:', error);
    await sendMessage(chatId, '❌ Ошибка при удалении блюда.', botToken);
  }
}

// Confirm meal deletion
async function confirmDeleteMeal(chatId, messageId, userId, entryId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Get user UUID
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}&select=id`,
      { headers: supabaseHeaders }
    );

    const users = await userResponse.json();
    if (users.length === 0) {
      await sendMessage(chatId, '❌ Пользователь не найден.', botToken);
      return;
    }

    const userUuid = users[0].id;

    // Delete the entry
    const deleteResponse = await fetch(
      `${supabaseUrl}/rest/v1/entries?id=eq.${entryId}`,
      {
        method: 'DELETE',
        headers: supabaseHeaders
      }
    );

    if (!deleteResponse.ok) {
      await sendMessage(chatId, '❌ Не удалось удалить блюдо.', botToken);
      return;
    }

    // Update daily aggregates
    const today = new Date().toISOString().split('T')[0];
    await updateDailyAggregates(userUuid, today, supabaseUrl, supabaseHeaders);

    const successText = `✅ <b>Блюдо удалено</b>

Блюдо успешно удалено из вашего дневника питания.
Дневная статистика обновлена.

Используйте /today для просмотра обновленной статистики.`;

    const keyboard = [
      [{ text: '🍽️ Вернуться к блюдам', callback_data: 'back_to_meals' }]
    ];

    await editMessageWithKeyboard(chatId, messageId, successText, keyboard, botToken);

  } catch (error) {
    console.error('Confirm delete error:', error);
    await sendMessage(chatId, '❌ Ошибка при удалении блюда.', botToken);
  }
}

// Cancel deletion
async function cancelDelete(chatId, messageId, userId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    const cancelText = `❌ <b>Удаление отменено</b>

Блюдо не было удалено.`;

    const keyboard = [
      [{ text: '🍽️ Вернуться к блюдам', callback_data: 'back_to_meals' }]
    ];

    await editMessageWithKeyboard(chatId, messageId, cancelText, keyboard, botToken);

  } catch (error) {
    console.error('Cancel delete error:', error);
    await sendMessage(chatId, '❌ Ошибка отмены.', botToken);
  }
}

// Handle meal editing options
async function handleEditMeal(chatId, messageId, userId, entryId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Get meal details
    const entryResponse = await fetch(
      `${supabaseUrl}/rest/v1/entries?id=eq.${entryId}&select=*`,
      { headers: supabaseHeaders }
    );

    if (!entryResponse.ok) {
      await sendMessage(chatId, '❌ Блюдо не найдено.', botToken);
      return;
    }

    const entries = await entryResponse.json();
    if (entries.length === 0) {
      await sendMessage(chatId, '❌ Блюдо не найдено.', botToken);
      return;
    }

    const entry = entries[0];
    const date = new Date(entry.timestamp_utc);
    const timeStr = date.toLocaleDateString('ru-RU') + ' ' + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const foodDescription = entry.text || 'Фото еды';

    const editText = `✏️ <b>Редактирование блюда</b>

🍽️ <b>Блюдо:</b> ${foodDescription}
📅 <b>Время:</b> ${timeStr}

📊 <b>Текущие значения:</b>
🔥 Калории: ${entry.calories} ккал
🥩 Белок: ${entry.protein_g}г
🧈 Жиры: ${entry.fat_g}г
🍞 Углеводы: ${entry.carbs_g}г
🌾 Клетчатка: ${entry.fiber_g}г

Что хотите изменить?`;

    const keyboard = [
      [
        { text: '🔥 Калории', callback_data: `edit_calories_${entryId}` },
        { text: '🥩 Белок', callback_data: `edit_protein_${entryId}` }
      ],
      [
        { text: '📊 Размер порции', callback_data: `edit_portion_${entryId}` },
        { text: '📋 Дублировать', callback_data: `duplicate_${entryId}` }
      ],
      [
        { text: '🔙 Назад к блюдам', callback_data: 'back_to_meals' }
      ]
    ];

    await editMessageWithKeyboard(chatId, messageId, editText, keyboard, botToken);

  } catch (error) {
    console.error('Edit meal error:', error);
    await sendMessage(chatId, '❌ Ошибка при редактировании блюда.', botToken);
  }
}

// Handle portion adjustment for a specific meal
async function handleEditPortion(chatId, messageId, userId, entryId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    const portionText = `📊 <b>Изменение размера порции</b>

Выберите, какую часть от исходной порции вы съели:

💡 <i>Например, если вы съели только половину блюда, выберите "50%"</i>`;

    const keyboard = [
      [
        { text: '25% (четверть)', callback_data: `portion_${entryId}_0.25` },
        { text: '50% (половина)', callback_data: `portion_${entryId}_0.5` }
      ],
      [
        { text: '75% (три четверти)', callback_data: `portion_${entryId}_0.75` },
        { text: '150% (полторы порции)', callback_data: `portion_${entryId}_1.5` }
      ],
      [
        { text: '200% (двойная порция)', callback_data: `portion_${entryId}_2.0` },
        { text: '🔙 Назад', callback_data: `edit_meal_${entryId}` }
      ]
    ];

    await editMessageWithKeyboard(chatId, messageId, portionText, keyboard, botToken);

  } catch (error) {
    console.error('Edit portion error:', error);
    await sendMessage(chatId, '❌ Ошибка при изменении порции.', botToken);
  }
}

// Apply portion adjustment
async function applyPortionAdjustment(chatId, messageId, userId, entryId, multiplier, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Get current meal data
    const entryResponse = await fetch(
      `${supabaseUrl}/rest/v1/entries?id=eq.${entryId}&select=*`,
      { headers: supabaseHeaders }
    );

    const entries = await entryResponse.json();
    if (entries.length === 0) {
      await sendMessage(chatId, '❌ Блюдо не найдено.', botToken);
      return;
    }

    const entry = entries[0];
    
    // Calculate new values
    const newValues = {
      calories: Math.round(entry.calories * multiplier),
      protein_g: Math.round(entry.protein_g * multiplier * 10) / 10,
      fat_g: Math.round(entry.fat_g * multiplier * 10) / 10,
      carbs_g: Math.round(entry.carbs_g * multiplier * 10) / 10,
      fiber_g: Math.round(entry.fiber_g * multiplier * 10) / 10
    };

    // Update the entry
    const updateResponse = await fetch(
      `${supabaseUrl}/rest/v1/entries?id=eq.${entryId}`,
      {
        method: 'PATCH',
        headers: supabaseHeaders,
        body: JSON.stringify(newValues)
      }
    );

    if (!updateResponse.ok) {
      await sendMessage(chatId, '❌ Не удалось обновить блюдо.', botToken);
      return;
    }

    // Get user UUID and update daily aggregates
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}&select=id`,
      { headers: supabaseHeaders }
    );
    
    const users = await userResponse.json();
    if (users.length > 0) {
      const userUuid = users[0].id;
      const today = new Date().toISOString().split('T')[0];
      await updateDailyAggregates(userUuid, today, supabaseUrl, supabaseHeaders);
    }

    const percentText = Math.round(multiplier * 100);
    const successText = `✅ <b>Размер порции изменен</b>

📊 <b>Новый размер:</b> ${percentText}% от исходной порции

📈 <b>Обновленные значения:</b>
🔥 Калории: ${newValues.calories} ккал
🥩 Белок: ${newValues.protein_g}г
🧈 Жиры: ${newValues.fat_g}г
🍞 Углеводы: ${newValues.carbs_g}г
🌾 Клетчатка: ${newValues.fiber_g}г

Дневная статистика обновлена.`;

    const keyboard = [
      [{ text: '🍽️ Вернуться к блюдам', callback_data: 'back_to_meals' }]
    ];

    await editMessageWithKeyboard(chatId, messageId, successText, keyboard, botToken);

  } catch (error) {
    console.error('Apply portion adjustment error:', error);
    await sendMessage(chatId, '❌ Ошибка при изменении порции.', botToken);
  }
}

// Handle meal duplication
async function handleDuplicateMeal(chatId, messageId, userId, entryId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Get user UUID
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}&select=id`,
      { headers: supabaseHeaders }
    );

    const users = await userResponse.json();
    if (users.length === 0) {
      await sendMessage(chatId, '❌ Пользователь не найден.', botToken);
      return;
    }

    const userUuid = users[0].id;

    // Get original meal data
    const entryResponse = await fetch(
      `${supabaseUrl}/rest/v1/entries?id=eq.${entryId}&select=*`,
      { headers: supabaseHeaders }
    );

    const entries = await entryResponse.json();
    if (entries.length === 0) {
      await sendMessage(chatId, '❌ Блюдо не найдено.', botToken);
      return;
    }

    const originalEntry = entries[0];
    const today = new Date().toISOString().split('T')[0];

    // Create duplicate entry
    const duplicateEntry = {
      user_id: userUuid,
      timestamp_utc: new Date().toISOString(),
      day_local: today,
      chat_id: chatId,
      message_id: null, // No original message for duplicated entries
      text: `[Повтор] ${originalEntry.text || 'Фото еды'}`,
      photo_file_id: originalEntry.photo_file_id,
      calories: originalEntry.calories,
      protein_g: originalEntry.protein_g,
      fat_g: originalEntry.fat_g,
      carbs_g: originalEntry.carbs_g,
      fiber_g: originalEntry.fiber_g,
      score_item: originalEntry.score_item,
      confidence: originalEntry.confidence,
      advice_short: originalEntry.advice_short,
      raw_model_json: originalEntry.raw_model_json
    };

    const createResponse = await fetch(`${supabaseUrl}/rest/v1/entries`, {
      method: 'POST',
      headers: supabaseHeaders,
      body: JSON.stringify(duplicateEntry)
    });

    if (!createResponse.ok) {
      await sendMessage(chatId, '❌ Не удалось создать копию блюда.', botToken);
      return;
    }

    // Update daily aggregates
    await updateDailyAggregates(userUuid, today, supabaseUrl, supabaseHeaders);

    const foodDescription = originalEntry.text || 'Фото еды';
    const successText = `✅ <b>Блюдо продублировано</b>

🍽️ <b>Добавлено:</b> ${foodDescription}
📊 <b>Питательная ценность:</b>
🔥 ${originalEntry.calories} ккал
🥩 ${originalEntry.protein_g}г белка
🌾 ${originalEntry.fiber_g}г клетчатки

Блюдо добавлено в сегодняшний дневник питания.`;

    const keyboard = [
      [{ text: '🍽️ Вернуться к блюдам', callback_data: 'back_to_meals' }]
    ];

    await editMessageWithKeyboard(chatId, messageId, successText, keyboard, botToken);

  } catch (error) {
    console.error('Duplicate meal error:', error);
    await sendMessage(chatId, '❌ Ошибка при дублировании блюда.', botToken);
  }
}

// Handle portion adjustment selection
async function handlePortionAdjustment(chatId, messageId, userId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Get user's recent meals
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}&select=id`,
      { headers: supabaseHeaders }
    );

    const users = await userResponse.json();
    if (users.length === 0) {
      await sendMessage(chatId, '❌ Пользователь не найден.', botToken);
      return;
    }

    const userUuid = users[0].id;

    const entriesResponse = await fetch(
      `${supabaseUrl}/rest/v1/entries?user_id=eq.${userUuid}&select=*&order=timestamp_utc.desc&limit=5`,
      { headers: supabaseHeaders }
    );

    const entries = await entriesResponse.json();

    if (entries.length === 0) {
      await sendMessage(chatId, 'У вас нет блюд для изменения порции.', botToken);
      return;
    }

    let portionText = '📊 <b>Изменение размера порции</b>\n\nВыберите блюдо:\n\n';
    const keyboard = [];

    entries.forEach((entry, index) => {
      const date = new Date(entry.timestamp_utc);
      const timeStr = date.toLocaleDateString('ru-RU') + ' ' + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      const foodDescription = entry.text ? 
        (entry.text.length > 25 ? entry.text.substring(0, 25) + '...' : entry.text) : 
        'Фото еды';
      
      portionText += `${index + 1}. ${foodDescription}\n   📅 ${timeStr} • 🔥 ${entry.calories}ккал\n\n`;
      
      keyboard.push([
        { text: `📊 Порция #${index + 1}`, callback_data: `edit_portion_${entry.id}` }
      ]);
    });

    keyboard.push([
      { text: '🔙 Назад к блюдам', callback_data: 'back_to_meals' }
    ]);

    await editMessageWithKeyboard(chatId, messageId, portionText, keyboard, botToken);

  } catch (error) {
    console.error('Portion adjustment error:', error);
    await sendMessage(chatId, '❌ Ошибка при изменении порции.', botToken);
  }
}

// Handle meal duplication selection
async function handleMealDuplication(chatId, messageId, userId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Get user's recent meals
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}&select=id`,
      { headers: supabaseHeaders }
    );

    const users = await userResponse.json();
    if (users.length === 0) {
      await sendMessage(chatId, '❌ Пользователь не найден.', botToken);
      return;
    }

    const userUuid = users[0].id;

    const entriesResponse = await fetch(
      `${supabaseUrl}/rest/v1/entries?user_id=eq.${userUuid}&select=*&order=timestamp_utc.desc&limit=10`,
      { headers: supabaseHeaders }
    );

    const entries = await entriesResponse.json();

    if (entries.length === 0) {
      await sendMessage(chatId, 'У вас нет блюд для повтора.', botToken);
      return;
    }

    let duplicateText = '📋 <b>Повтор блюда</b>\n\nВыберите блюдо для повтора:\n\n';
    const keyboard = [];

    entries.forEach((entry, index) => {
      const date = new Date(entry.timestamp_utc);
      const timeStr = date.toLocaleDateString('ru-RU') + ' ' + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      const foodDescription = entry.text ? 
        (entry.text.length > 25 ? entry.text.substring(0, 25) + '...' : entry.text) : 
        'Фото еды';
      
      duplicateText += `${index + 1}. ${foodDescription}\n   📅 ${timeStr} • 🔥 ${entry.calories}ккал\n\n`;
      
      keyboard.push([
        { text: `📋 Повторить #${index + 1}`, callback_data: `duplicate_${entry.id}` }
      ]);
    });

    keyboard.push([
      { text: '🔙 Назад к блюдам', callback_data: 'back_to_meals' }
    ]);

    await editMessageWithKeyboard(chatId, messageId, duplicateText, keyboard, botToken);

  } catch (error) {
    console.error('Meal duplication error:', error);
    await sendMessage(chatId, '❌ Ошибка при повторе блюда.', botToken);
  }
}

// Handle calories editing
async function handleEditCalories(chatId, messageId, userId, entryId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Get meal details
    const entryResponse = await fetch(
      `${supabaseUrl}/rest/v1/entries?id=eq.${entryId}&select=*`,
      { headers: supabaseHeaders }
    );

    const entries = await entryResponse.json();
    if (entries.length === 0) {
      await sendMessage(chatId, '❌ Блюдо не найдено.', botToken);
      return;
    }

    const entry = entries[0];
    const foodDescription = entry.text || 'Фото еды';

    const caloriesText = `🔥 <b>Изменение калорийности</b>

🍽️ <b>Блюдо:</b> ${foodDescription}
📊 <b>Текущие калории:</b> ${entry.calories} ккал

Выберите новое значение калорий:`;

    const keyboard = [
      [
        { text: '150 ккал', callback_data: `set_calories_${entryId}_150` },
        { text: '200 ккал', callback_data: `set_calories_${entryId}_200` },
        { text: '300 ккал', callback_data: `set_calories_${entryId}_300` }
      ],
      [
        { text: '400 ккал', callback_data: `set_calories_${entryId}_400` },
        { text: '500 ккал', callback_data: `set_calories_${entryId}_500` },
        { text: '600 ккал', callback_data: `set_calories_${entryId}_600` }
      ],
      [
        { text: '🔙 Назад', callback_data: `edit_meal_${entryId}` }
      ]
    ];

    await editMessageWithKeyboard(chatId, messageId, caloriesText, keyboard, botToken);

  } catch (error) {
    console.error('Edit calories error:', error);
    await sendMessage(chatId, '❌ Ошибка при изменении калорий.', botToken);
  }
}

// Handle protein editing
async function handleEditProtein(chatId, messageId, userId, entryId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Get meal details
    const entryResponse = await fetch(
      `${supabaseUrl}/rest/v1/entries?id=eq.${entryId}&select=*`,
      { headers: supabaseHeaders }
    );

    const entries = await entryResponse.json();
    if (entries.length === 0) {
      await sendMessage(chatId, '❌ Блюдо не найдено.', botToken);
      return;
    }

    const entry = entries[0];
    const foodDescription = entry.text || 'Фото еды';

    const proteinText = `🥩 <b>Изменение белка</b>

🍽️ <b>Блюдо:</b> ${foodDescription}
📊 <b>Текущий белок:</b> ${entry.protein_g}г

Выберите новое значение белка:`;

    const keyboard = [
      [
        { text: '10г', callback_data: `set_protein_${entryId}_10` },
        { text: '15г', callback_data: `set_protein_${entryId}_15` },
        { text: '20г', callback_data: `set_protein_${entryId}_20` }
      ],
      [
        { text: '25г', callback_data: `set_protein_${entryId}_25` },
        { text: '30г', callback_data: `set_protein_${entryId}_30` },
        { text: '40г', callback_data: `set_protein_${entryId}_40` }
      ],
      [
        { text: '🔙 Назад', callback_data: `edit_meal_${entryId}` }
      ]
    ];

    await editMessageWithKeyboard(chatId, messageId, proteinText, keyboard, botToken);

  } catch (error) {
    console.error('Edit protein error:', error);
    await sendMessage(chatId, '❌ Ошибка при изменении белка.', botToken);
  }
}

// Apply calories change
async function applyCaloriesChange(chatId, messageId, userId, entryId, newCalories, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Update the entry
    const updateResponse = await fetch(
      `${supabaseUrl}/rest/v1/entries?id=eq.${entryId}`,
      {
        method: 'PATCH',
        headers: supabaseHeaders,
        body: JSON.stringify({ calories: parseInt(newCalories) })
      }
    );

    if (!updateResponse.ok) {
      await sendMessage(chatId, '❌ Не удалось обновить калории.', botToken);
      return;
    }

    // Get user UUID and update daily aggregates
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}&select=id`,
      { headers: supabaseHeaders }
    );
    
    const users = await userResponse.json();
    if (users.length > 0) {
      const userUuid = users[0].id;
      const today = new Date().toISOString().split('T')[0];
      await updateDailyAggregates(userUuid, today, supabaseUrl, supabaseHeaders);
    }

    // Just refresh the meals list - no confirmation screen
    await handleMealsCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders);

  } catch (error) {
    console.error('Apply calories change error:', error);
    await sendMessage(chatId, '❌ Ошибка при изменении калорий.', botToken);
  }
}

// Apply protein change
async function applyProteinChange(chatId, messageId, userId, entryId, newProtein, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Update the entry
    const updateResponse = await fetch(
      `${supabaseUrl}/rest/v1/entries?id=eq.${entryId}`,
      {
        method: 'PATCH',
        headers: supabaseHeaders,
        body: JSON.stringify({ protein_g: parseFloat(newProtein) })
      }
    );

    if (!updateResponse.ok) {
      await sendMessage(chatId, '❌ Не удалось обновить белок.', botToken);
      return;
    }

    // Get user UUID and update daily aggregates
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}&select=id`,
      { headers: supabaseHeaders }
    );
    
    const users = await userResponse.json();
    if (users.length > 0) {
      const userUuid = users[0].id;
      const today = new Date().toISOString().split('T')[0];
      await updateDailyAggregates(userUuid, today, supabaseUrl, supabaseHeaders);
    }

    // Just refresh the meals list - no confirmation screen
    await handleMealsCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders);

  } catch (error) {
    console.error('Apply protein change error:', error);
    await sendMessage(chatId, '❌ Ошибка при изменении белка.', botToken);
  }
}

// Quick delete meal without confirmation
async function quickDeleteMeal(chatId, messageId, userId, entryId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Get user UUID
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}&select=id`,
      { headers: supabaseHeaders }
    );

    const users = await userResponse.json();
    if (users.length === 0) {
      await answerCallbackQuery(messageId, '❌ Пользователь не найден', botToken);
      return;
    }

    const userUuid = users[0].id;

    // Delete the entry immediately
    const deleteResponse = await fetch(
      `${supabaseUrl}/rest/v1/entries?id=eq.${entryId}`,
      {
        method: 'DELETE',
        headers: supabaseHeaders
      }
    );

    if (!deleteResponse.ok) {
      await answerCallbackQuery(messageId, '❌ Не удалось удалить', botToken);
      return;
    }

    // Update daily aggregates
    const today = new Date().toISOString().split('T')[0];
    await updateDailyAggregates(userUuid, today, supabaseUrl, supabaseHeaders);

    // Refresh the meals list immediately
    await handleMealsCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders);

  } catch (error) {
    console.error('Quick delete error:', error);
    await answerCallbackQuery(messageId, '❌ Ошибка удаления', botToken);
  }
}

// Confirm and save analysis to database
async function confirmSaveAnalysis(chatId, messageId, analysisData, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Reconstruct message object for saving
    const message = {
      chat: { id: chatId },
      message_id: analysisData.messageId,
      from: { id: analysisData.userId, first_name: 'User' },
      text: null, // Will be handled in saveFoodEntry
      photo: null // Will be handled in saveFoodEntry
    };

    // Save to database using existing function
    await saveFoodEntry(analysisData.userId, message, analysisData, supabaseUrl, supabaseHeaders);

    const successText = `✅ <b>Added to Diet!</b>

🍽️ <b>Saved:</b>
🔥 ${analysisData.calories} kcal
🥩 ${analysisData.protein_g}g protein
🧈 ${analysisData.fat_g}g fat
🍞 ${analysisData.carbs_g}g carbs
🌾 ${analysisData.fiber_g}g fiber

📊 Use /today to view daily stats`;

    await editMessageWithKeyboard(chatId, messageId, successText, [], botToken);

  } catch (error) {
    console.error('Confirm save analysis error:', error);
    await sendMessage(chatId, '❌ Error saving to diet.', botToken);
  }
}

// Cancel analysis
async function cancelAnalysis(chatId, messageId, botToken) {
  try {
    const cancelText = `❌ <b>Analysis Cancelled</b>

Data was not saved to your diet.
Send a new photo or food description for analysis.`;

    await editMessageWithKeyboard(chatId, messageId, cancelText, [], botToken);

  } catch (error) {
    console.error('Cancel analysis error:', error);
    await sendMessage(chatId, '❌ Ошибка отмены.', botToken);
  }
}

// Edit calories in analysis
async function editAnalysisCalories(chatId, messageId, analysisData, analysisId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    const editText = `🔥 <b>Edit Calories</b>

📊 <b>Current value:</b> ${analysisData.calories} kcal

Select new value:`;

    const keyboard = [
      [
        { text: '150 kcal', callback_data: `update_calories_${analysisId}_150` },
        { text: '250 kcal', callback_data: `update_calories_${analysisId}_250` },
        { text: '350 kcal', callback_data: `update_calories_${analysisId}_350` }
      ],
      [
        { text: '450 kcal', callback_data: `update_calories_${analysisId}_450` },
        { text: '550 kcal', callback_data: `update_calories_${analysisId}_550` },
        { text: '650 kcal', callback_data: `update_calories_${analysisId}_650` }
      ],
      [
        { text: '🔙 Back', callback_data: 'cancel_analysis' }
      ]
    ];

    await editMessageWithKeyboard(chatId, messageId, editText, keyboard, botToken);

  } catch (error) {
    console.error('Edit analysis calories error:', error);
    await sendMessage(chatId, '❌ Ошибка при изменении калорий.', botToken);
  }
}

// Edit protein in analysis
async function editAnalysisProtein(chatId, messageId, analysisData, botToken, supabaseUrl, supabaseHeaders) {
  try {
    const editText = `🥩 <b>Изменение белка</b>

📊 <b>Текущее значение:</b> ${analysisData.protein_g}г

Выберите новое значение:`;

    const keyboard = [
      [
        { text: '10г', callback_data: `save_edited_${JSON.stringify({...analysisData, protein_g: 10})}` },
        { text: '20г', callback_data: `save_edited_${JSON.stringify({...analysisData, protein_g: 20})}` },
        { text: '30г', callback_data: `save_edited_${JSON.stringify({...analysisData, protein_g: 30})}` }
      ],
      [
        { text: '40г', callback_data: `save_edited_${JSON.stringify({...analysisData, protein_g: 40})}` },
        { text: '50г', callback_data: `save_edited_${JSON.stringify({...analysisData, protein_g: 50})}` },
        { text: '60г', callback_data: `save_edited_${JSON.stringify({...analysisData, protein_g: 60})}` }
      ],
      [
        { text: '🔙 Назад', callback_data: 'cancel_analysis' }
      ]
    ];

    await editMessageWithKeyboard(chatId, messageId, editText, keyboard, botToken);

  } catch (error) {
    console.error('Edit analysis protein error:', error);
    await sendMessage(chatId, '❌ Ошибка при изменении белка.', botToken);
  }
}

// Edit portion in analysis
async function editAnalysisPortion(chatId, messageId, analysisData, botToken, supabaseUrl, supabaseHeaders) {
  try {
    const editText = `📊 <b>Изменение размера порции</b>

📋 <b>Текущие значения:</b>
🔥 ${analysisData.calories} ккал
🥩 ${analysisData.protein_g}г белка

Выберите размер порции:`;

    const keyboard = [
      [
        { text: '25% (четверть)', callback_data: `save_edited_${JSON.stringify({
          ...analysisData, 
          calories: Math.round(analysisData.calories * 0.25),
          protein_g: Math.round(analysisData.protein_g * 0.25 * 10) / 10,
          fat_g: Math.round(analysisData.fat_g * 0.25 * 10) / 10,
          carbs_g: Math.round(analysisData.carbs_g * 0.25 * 10) / 10,
          fiber_g: Math.round(analysisData.fiber_g * 0.25 * 10) / 10
        })}` },
        { text: '50% (половина)', callback_data: `save_edited_${JSON.stringify({
          ...analysisData,
          calories: Math.round(analysisData.calories * 0.5),
          protein_g: Math.round(analysisData.protein_g * 0.5 * 10) / 10,
          fat_g: Math.round(analysisData.fat_g * 0.5 * 10) / 10,
          carbs_g: Math.round(analysisData.carbs_g * 0.5 * 10) / 10,
          fiber_g: Math.round(analysisData.fiber_g * 0.5 * 10) / 10
        })}` }
      ],
      [
        { text: '75% (три четверти)', callback_data: `save_edited_${JSON.stringify({
          ...analysisData,
          calories: Math.round(analysisData.calories * 0.75),
          protein_g: Math.round(analysisData.protein_g * 0.75 * 10) / 10,
          fat_g: Math.round(analysisData.fat_g * 0.75 * 10) / 10,
          carbs_g: Math.round(analysisData.carbs_g * 0.75 * 10) / 10,
          fiber_g: Math.round(analysisData.fiber_g * 0.75 * 10) / 10
        })}` },
        { text: '150% (полторы)', callback_data: `save_edited_${JSON.stringify({
          ...analysisData,
          calories: Math.round(analysisData.calories * 1.5),
          protein_g: Math.round(analysisData.protein_g * 1.5 * 10) / 10,
          fat_g: Math.round(analysisData.fat_g * 1.5 * 10) / 10,
          carbs_g: Math.round(analysisData.carbs_g * 1.5 * 10) / 10,
          fiber_g: Math.round(analysisData.fiber_g * 1.5 * 10) / 10
        })}` }
      ],
      [
        { text: '🔙 Назад', callback_data: 'cancel_analysis' }
      ]
    ];

    await editMessageWithKeyboard(chatId, messageId, editText, keyboard, botToken);

  } catch (error) {
    console.error('Edit analysis portion error:', error);
    await sendMessage(chatId, '❌ Ошибка при изменении порции.', botToken);
  }
}

// Handle database reset command
async function handleResetCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    const resetText = `⚠️ <b>Database Reset</b>

❗ <b>WARNING!</b> This action will delete:
• All your food entries
• All nutrition statistics  
• Daily summaries

This action is <b>IRREVERSIBLE</b>!

Are you sure you want to reset all data?`;

    const keyboard = [
      [
        { text: '🗑️ YES, delete ALL data', callback_data: `confirm_reset_${userId}` }
      ],
      [
        { text: '❌ Cancel', callback_data: 'cancel_reset' }
      ]
    ];

    await sendMessageWithKeyboard(chatId, resetText, keyboard, botToken);

  } catch (error) {
    console.error('Reset command error:', error);
    await sendMessage(chatId, '❌ Ошибка команды сброса.', botToken);
  }
}

// Confirm database reset
async function confirmDatabaseReset(chatId, messageId, userId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Get user UUID
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}&select=id`,
      { headers: supabaseHeaders }
    );

    const users = await userResponse.json();
    if (users.length === 0) {
      await sendMessage(chatId, '❌ Пользователь не найден.', botToken);
      return;
    }

    const userUuid = users[0].id;

    // Delete all entries for this user
    const deleteEntriesResponse = await fetch(
      `${supabaseUrl}/rest/v1/entries?user_id=eq.${userUuid}`,
      {
        method: 'DELETE',
        headers: supabaseHeaders
      }
    );

    // Delete all daily records for this user
    const deleteDailyResponse = await fetch(
      `${supabaseUrl}/rest/v1/daily?user_id=eq.${userUuid}`,
      {
        method: 'DELETE',
        headers: supabaseHeaders
      }
    );

    const successText = `✅ <b>Database Reset Complete</b>

🗑️ Deleted:
• All food entries
• All daily statistics
• All nutrition data

🚀 You can now start fresh!
Send a photo or food description for analysis.`;

    await editMessageWithKeyboard(chatId, messageId, successText, [], botToken);

  } catch (error) {
    console.error('Confirm database reset error:', error);
    await sendMessage(chatId, '❌ Ошибка при сбросе базы данных.', botToken);
  }
}

// Cancel database reset
async function cancelDatabaseReset(chatId, messageId, botToken) {
  try {
    const cancelText = `❌ <b>Reset Cancelled</b>

All your data remains safe.`;

    await editMessageWithKeyboard(chatId, messageId, cancelText, [], botToken);

  } catch (error) {
    console.error('Cancel database reset error:', error);
    await sendMessage(chatId, '❌ Error cancelling reset.', botToken);
  }
}

// Check if user exists and has completed profile
async function checkUserProfile(userId, supabaseUrl, supabaseHeaders) {
  try {
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}&select=*`,
      { headers: supabaseHeaders }
    );

    if (!userResponse.ok) {
      return { exists: false, hasProfile: false };
    }

    const users = await userResponse.json();
    if (users.length === 0) {
      return { exists: false, hasProfile: false };
    }

    const user = users[0];
    // Check if user has completed profile (has age, weight, height, goal)
    const hasProfile = user.age && user.weight_kg && user.height_cm && user.fitness_goal;
    
    return { exists: true, hasProfile, user };
  } catch (error) {
    console.error('Check user profile error:', error);
    return { exists: false, hasProfile: false };
  }
}

// Start onboarding flow
async function startOnboarding(chatId, userId, userName, botToken, supabaseUrl, supabaseHeaders) {
  try {
    const onboardingText = `🎯 <b>Let's personalize your nutrition goals!</b>

Hi ${userName}! To give you the most accurate nutrition recommendations, I need to learn a bit about you.

This will take just 2 minutes and will help me calculate your personalized calorie and macro targets.

Ready to get started?`;

    const keyboard = [
      [
        { text: '🚀 Let\'s Go!', callback_data: 'onboarding_start' },
        { text: '⏭️ Skip for now', callback_data: 'onboarding_skip' }
      ]
    ];

    await sendMessageWithKeyboard(chatId, onboardingText, keyboard, botToken);

  } catch (error) {
    console.error('Start onboarding error:', error);
    await sendMessage(chatId, '❌ Error starting onboarding.', botToken);
  }
}

// Handle onboarding steps
async function handleOnboardingStep(data, chatId, messageId, userId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    const step = data.replace('onboarding_', '');

    switch (step) {
      case 'start':
        await onboardingStepGoal(chatId, messageId, userId, botToken);
        break;
      case 'skip':
        await onboardingSkip(chatId, messageId, userId, botToken, supabaseUrl, supabaseHeaders);
        break;
      case 'goal_lose':
      case 'goal_maintain':
      case 'goal_gain':
        await onboardingStepGender(chatId, messageId, userId, step.replace('goal_', ''), botToken, supabaseUrl, supabaseHeaders);
        break;
      case 'gender_male':
      case 'gender_female':
        await onboardingStepAge(chatId, messageId, userId, step.replace('gender_', ''), botToken, supabaseUrl, supabaseHeaders);
        break;
      default:
        if (step.startsWith('age_')) {
          const age = step.replace('age_', '');
          await onboardingStepHeight(chatId, messageId, userId, age, botToken, supabaseUrl, supabaseHeaders);
        } else if (step.startsWith('height_')) {
          const height = step.replace('height_', '');
          await onboardingStepWeight(chatId, messageId, userId, height, botToken, supabaseUrl, supabaseHeaders);
        } else if (step.startsWith('weight_')) {
          const weight = step.replace('weight_', '');
          await onboardingStepActivity(chatId, messageId, userId, weight, botToken, supabaseUrl, supabaseHeaders);
        } else if (step.startsWith('activity_')) {
          const activity = step.replace('activity_', '');
          await onboardingComplete(chatId, messageId, userId, activity, botToken, supabaseUrl, supabaseHeaders);
        }
        break;
    }

  } catch (error) {
    console.error('Onboarding step error:', error);
    await sendMessage(chatId, '❌ Error in onboarding step.', botToken);
  }
}

// Calculate BMR using Mifflin-St Jeor equation
function calculateBMR(weight_kg, height_cm, age, gender) {
  if (gender === 'male') {
    return (10 * weight_kg) + (6.25 * height_cm) - (5 * age) + 5;
  } else {
    return (10 * weight_kg) + (6.25 * height_cm) - (5 * age) - 161;
  }
}

// Calculate TDEE (Total Daily Energy Expenditure)
function calculateTDEE(bmr, activityLevel) {
  const multipliers = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    very: 1.725,
    extreme: 1.9
  };
  return bmr * (multipliers[activityLevel] || 1.2);
}

// Calculate nutrition targets
function calculateNutritionTargets(weight_kg, height_cm, age, gender, goal, activityLevel) {
  const bmr = calculateBMR(weight_kg, height_cm, age, gender);
  const tdee = calculateTDEE(bmr, activityLevel);
  
  let calories;
  switch (goal) {
    case 'lose':
      calories = Math.round(tdee * 0.8); // 20% deficit
      break;
    case 'gain':
      calories = Math.round(tdee * 1.1); // 10% surplus
      break;
    default: // maintain
      calories = Math.round(tdee);
  }
  
  // Calculate macros
  const protein = Math.round(weight_kg * 2.2); // 2.2g per kg bodyweight
  const fat = Math.round(calories * 0.25 / 9); // 25% of calories from fat
  const carbs = Math.round((calories - (protein * 4) - (fat * 9)) / 4);
  const fiber = Math.round(calories / 1000 * 14); // 14g per 1000 calories
  
  return {
    calories,
    protein,
    fat,
    carbs,
    fiber
  };
}

// Onboarding step 1: Goal selection
async function onboardingStepGoal(chatId, messageId, userId, botToken) {
  try {
    const goalText = `🎯 <b>What's your main goal?</b>

Choose your primary fitness goal so I can calculate the right calorie target for you:`;

    const keyboard = [
      [
        { text: '📉 Lose Weight', callback_data: 'onboarding_goal_lose' },
        { text: '⚖️ Maintain Weight', callback_data: 'onboarding_goal_maintain' }
      ],
      [
        { text: '📈 Gain Weight/Muscle', callback_data: 'onboarding_goal_gain' }
      ]
    ];

    await editMessageWithKeyboard(chatId, messageId, goalText, keyboard, botToken);

  } catch (error) {
    console.error('Onboarding goal step error:', error);
    await sendMessage(chatId, '❌ Error in goal selection.', botToken);
  }
}

// Handle profile command
async function handleProfileCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    const userCheck = await checkUserProfile(userId, supabaseUrl, supabaseHeaders);
    
    if (!userCheck.exists || !userCheck.hasProfile) {
      await startOnboarding(chatId, userId, 'User', botToken, supabaseUrl, supabaseHeaders);
      return;
    }

    const user = userCheck.user;
    const targets = calculateNutritionTargets(
      user.weight_kg, 
      user.height_cm, 
      user.age, 
      user.gender, 
      user.fitness_goal, 
      user.activity_level
    );

    const profileText = `👤 <b>Your Profile</b>

📊 <b>Personal Info:</b>
• Age: ${user.age} years
• Height: ${user.height_cm}cm
• Weight: ${user.weight_kg}kg
• Gender: ${user.gender}
• Goal: ${user.fitness_goal}
• Activity: ${user.activity_level}

🎯 <b>Your Targets:</b>
• Calories: ${targets.calories} kcal/day
• Protein: ${targets.protein}g/day
• Fat: ${targets.fat}g/day
• Carbs: ${targets.carbs}g/day
• Fiber: ${targets.fiber}g/day`;

    const keyboard = [
      [
        { text: '✏️ Edit Profile', callback_data: 'profile_edit' },
        { text: '🔄 Recalculate', callback_data: 'profile_recalculate' }
      ]
    ];

    await sendMessageWithKeyboard(chatId, profileText, keyboard, botToken);

  } catch (error) {
    console.error('Profile command error:', error);
    await sendMessage(chatId, '❌ Error loading profile.', botToken);
  }
}

// Skip onboarding
async function onboardingSkip(chatId, messageId, userId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    const skipText = `⏭️ <b>Onboarding Skipped</b>

No problem! You can set up your profile anytime using /profile.

For now, I'll use default nutrition targets:
• 2000 calories/day
• 150g protein/day
• 25g fiber/day

🚀 <b>Ready to start tracking!</b>
Send a photo or description of your food to begin.`;

    await editMessageWithKeyboard(chatId, messageId, skipText, [], botToken);

  } catch (error) {
    console.error('Onboarding skip error:', error);
    await sendMessage(chatId, '❌ Error skipping onboarding.', botToken);
  }
}

// Onboarding step 2: Gender selection
async function onboardingStepGender(chatId, messageId, userId, goal, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Store goal temporarily
    global.tempOnboardingData = global.tempOnboardingData || {};
    global.tempOnboardingData[userId] = { goal };

    const genderText = `👤 <b>What's your gender?</b>

This helps me calculate your metabolic rate more accurately:`;

    const keyboard = [
      [
        { text: '👨 Male', callback_data: 'onboarding_gender_male' },
        { text: '👩 Female', callback_data: 'onboarding_gender_female' }
      ]
    ];

    await editMessageWithKeyboard(chatId, messageId, genderText, keyboard, botToken);

  } catch (error) {
    console.error('Onboarding gender step error:', error);
    await sendMessage(chatId, '❌ Error in gender selection.', botToken);
  }
}

// Onboarding step 3: Age selection
async function onboardingStepAge(chatId, messageId, userId, gender, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Store gender
    global.tempOnboardingData[userId].gender = gender;

    const ageText = `🎂 <b>What's your age?</b>

Select your age range:`;

    const keyboard = [
      [
        { text: '18-25', callback_data: 'onboarding_age_22' },
        { text: '26-35', callback_data: 'onboarding_age_30' },
        { text: '36-45', callback_data: 'onboarding_age_40' }
      ],
      [
        { text: '46-55', callback_data: 'onboarding_age_50' },
        { text: '56-65', callback_data: 'onboarding_age_60' },
        { text: '65+', callback_data: 'onboarding_age_70' }
      ]
    ];

    await editMessageWithKeyboard(chatId, messageId, ageText, keyboard, botToken);

  } catch (error) {
    console.error('Onboarding age step error:', error);
    await sendMessage(chatId, '❌ Error in age selection.', botToken);
  }
}

// Onboarding step 4: Height selection
async function onboardingStepHeight(chatId, messageId, userId, age, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Store age
    global.tempOnboardingData[userId].age = parseInt(age);

    const heightText = `📏 <b>What's your height?</b>

Select your height:`;

    const keyboard = [
      [
        { text: '150cm (4\'11")', callback_data: 'onboarding_height_150' },
        { text: '160cm (5\'3")', callback_data: 'onboarding_height_160' },
        { text: '170cm (5\'7")', callback_data: 'onboarding_height_170' }
      ],
      [
        { text: '180cm (5\'11")', callback_data: 'onboarding_height_180' },
        { text: '190cm (6\'3")', callback_data: 'onboarding_height_190' },
        { text: '200cm (6\'7")', callback_data: 'onboarding_height_200' }
      ]
    ];

    await editMessageWithKeyboard(chatId, messageId, heightText, keyboard, botToken);

  } catch (error) {
    console.error('Onboarding height step error:', error);
    await sendMessage(chatId, '❌ Error in height selection.', botToken);
  }
}

// Onboarding step 5: Weight selection
async function onboardingStepWeight(chatId, messageId, userId, height, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Store height
    global.tempOnboardingData[userId].height_cm = parseInt(height);

    const weightText = `⚖️ <b>What's your current weight?</b>

Select your weight range:`;

    const keyboard = [
      [
        { text: '50kg (110lbs)', callback_data: 'onboarding_weight_50' },
        { text: '60kg (132lbs)', callback_data: 'onboarding_weight_60' },
        { text: '70kg (154lbs)', callback_data: 'onboarding_weight_70' }
      ],
      [
        { text: '80kg (176lbs)', callback_data: 'onboarding_weight_80' },
        { text: '90kg (198lbs)', callback_data: 'onboarding_weight_90' },
        { text: '100kg (220lbs)', callback_data: 'onboarding_weight_100' }
      ],
      [
        { text: '110kg+ (242lbs+)', callback_data: 'onboarding_weight_110' }
      ]
    ];

    await editMessageWithKeyboard(chatId, messageId, weightText, keyboard, botToken);

  } catch (error) {
    console.error('Onboarding weight step error:', error);
    await sendMessage(chatId, '❌ Error in weight selection.', botToken);
  }
}

// Onboarding step 6: Activity level
async function onboardingStepActivity(chatId, messageId, userId, weight, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Store weight
    global.tempOnboardingData[userId].weight_kg = parseInt(weight);

    const activityText = `🏃 <b>What's your activity level?</b>

This helps calculate your daily calorie needs:`;

    const keyboard = [
      [
        { text: '😴 Sedentary (desk job)', callback_data: 'onboarding_activity_sedentary' }
      ],
      [
        { text: '🚶 Light (1-3 days/week)', callback_data: 'onboarding_activity_light' }
      ],
      [
        { text: '🏃 Moderate (3-5 days/week)', callback_data: 'onboarding_activity_moderate' }
      ],
      [
        { text: '💪 Very Active (6-7 days/week)', callback_data: 'onboarding_activity_very' }
      ],
      [
        { text: '🔥 Extremely Active (2x/day)', callback_data: 'onboarding_activity_extreme' }
      ]
    ];

    await editMessageWithKeyboard(chatId, messageId, activityText, keyboard, botToken);

  } catch (error) {
    console.error('Onboarding activity step error:', error);
    await sendMessage(chatId, '❌ Error in activity selection.', botToken);
  }
}

// Complete onboarding and save profile
async function onboardingComplete(chatId, messageId, userId, activity, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Store final activity level
    global.tempOnboardingData[userId].activity_level = activity;
    const userData = global.tempOnboardingData[userId];

    // Calculate nutrition targets
    const targets = calculateNutritionTargets(
      userData.weight_kg,
      userData.height_cm,
      userData.age,
      userData.gender,
      userData.goal,
      userData.activity_level
    );

    // Save to database
    await updateUserProfile(userId, userData, targets, supabaseUrl, supabaseHeaders);

    // Clean up temp data
    delete global.tempOnboardingData[userId];

    const completeText = `🎉 <b>Profile Complete!</b>

✅ <b>Your personalized nutrition targets:</b>
🔥 Calories: ${targets.calories} kcal/day
🥩 Protein: ${targets.protein}g/day
🧈 Fat: ${targets.fat}g/day
🍞 Carbs: ${targets.carbs}g/day
🌾 Fiber: ${targets.fiber}g/day

📊 <b>Based on your profile:</b>
• ${userData.age} year old ${userData.gender}
• ${userData.height_cm}cm, ${userData.weight_kg}kg
• Goal: ${userData.goal} weight
• Activity: ${userData.activity_level}

🚀 <b>Ready to start tracking!</b>
Send a photo or description of your food to begin.`;

    await editMessageWithKeyboard(chatId, messageId, completeText, [], botToken);

  } catch (error) {
    console.error('Onboarding complete error:', error);
    await sendMessage(chatId, '❌ Error completing onboarding.', botToken);
  }
}

// Update user profile in database
async function updateUserProfile(userId, userData, targets, supabaseUrl, supabaseHeaders) {
  try {
    const profileUpdate = {
      age: userData.age,
      gender: userData.gender,
      height_cm: userData.height_cm,
      weight_kg: userData.weight_kg,
      fitness_goal: userData.goal,
      activity_level: userData.activity_level,
      cal_goal: targets.calories,
      protein_goal_g: targets.protein,
      fat_goal_g: targets.fat,
      carbs_goal_g: targets.carbs,
      fiber_goal_g: targets.fiber,
      profile_completed_at: new Date().toISOString()
    };

    const updateResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: supabaseHeaders,
        body: JSON.stringify(profileUpdate)
      }
    );

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error('Failed to update user profile:', errorText);
      throw new Error('Failed to update user profile');
    }

    console.log(`Profile updated for user ${userId}`);

  } catch (error) {
    console.error('Update user profile error:', error);
    throw error;
  }
}

// Handle profile editing
async function handleProfileEdit(data, chatId, messageId, userId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    const action = data.replace('profile_', '');
    
    if (action === 'edit') {
      // Show profile edit options
      const editText = `✏️ <b>Edit Profile</b>

What would you like to change?`;

      const keyboard = [
        [
          { text: '🎯 Goal', callback_data: 'profile_edit_goal' },
          { text: '⚖️ Weight', callback_data: 'profile_edit_weight' }
        ],
        [
          { text: '🏃 Activity Level', callback_data: 'profile_edit_activity' },
          { text: '🔄 Complete Setup Again', callback_data: 'onboarding_start' }
        ],
        [
          { text: '🔙 Back to Profile', callback_data: 'profile_view' }
        ]
      ];

      await editMessageWithKeyboard(chatId, messageId, editText, keyboard, botToken);
      
    } else if (action === 'recalculate') {
      // Recalculate targets and update
      const userCheck = await checkUserProfile(userId, supabaseUrl, supabaseHeaders);
      if (userCheck.hasProfile) {
        const user = userCheck.user;
        const targets = calculateNutritionTargets(
          user.weight_kg,
          user.height_cm,
          user.age,
          user.gender,
          user.fitness_goal,
          user.activity_level
        );

        // Update targets in database
        await updateUserProfile(userId, user, targets, supabaseUrl, supabaseHeaders);

        const recalcText = `🔄 <b>Targets Recalculated!</b>

🎯 <b>Updated nutrition targets:</b>
🔥 Calories: ${targets.calories} kcal/day
🥩 Protein: ${targets.protein}g/day
🧈 Fat: ${targets.fat}g/day
🍞 Carbs: ${targets.carbs}g/day
🌾 Fiber: ${targets.fiber}g/day`;

        await editMessageWithKeyboard(chatId, messageId, recalcText, [], botToken);
      }
    } else if (action === 'view') {
      // Show profile again
      await handleProfileCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders);
    }

  } catch (error) {
    console.error('Profile edit error:', error);
    await sendMessage(chatId, '❌ Error editing profile.', botToken);
  }
}

