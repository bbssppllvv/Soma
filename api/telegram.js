// Soma Telegram Bot - Modular Version
// Clean, organized code with separated concerns

import { sendMessage, sendMessageWithKeyboard, answerCallbackQuery, editMessageWithKeyboard } from './modules/telegram-helpers.js';
import { analyzeWithGPT5, getFallbackAnalysis } from './modules/ai-analysis.js';
import { getUserContext, saveFoodEntry, ensureUserExists, updateDailyAggregates } from './modules/database.js';
import { calculateMealScore, getScoreExplanation } from './modules/utils.js';
import { handleHelpCommand, handleTestCommand, handleMealsCommand, handleTodayCommand, handleStartCommand, handleGoalsCommand, handleProfileCommand } from './modules/commands.js';

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
    
    // console.log(`Message from ${userName} (${userId}): ${text}`);

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
      // Handle food analysis - CLEAN and simple
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

// CLEAN food analysis without infinite loops
async function handleFoodAnalysis(message, botToken, openaiKey, supabaseUrl, supabaseHeaders) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text || message.caption || '';
  
  try {
    const analyzingMessage = await sendMessage(chatId, 'Analyzing your food...', botToken);

    // Get user context for personalized analysis
    const userContext = await getUserContext(userId, supabaseUrl, supabaseHeaders);
    let nutritionData;

    if (openaiKey && (message.photo || text)) {
      try {
        // Universal GPT-5 pipeline for both photo and text
        nutritionData = await analyzeWithGPT5(message, openaiKey, userContext, botToken);
      } catch (analysisError) {
        console.error('GPT-5 analysis failed:', analysisError.message);
        
        // Don't show useless fallback - tell user to try again
        await sendMessage(chatId, `Analysis failed: ${analysisError.message}\n\nPlease try again with a clearer description or different photo.`, botToken);
        return; // Exit without showing fallback
      }
    } else {
      // console.log('No OpenAI key - using fallback');
      nutritionData = getFallbackAnalysis('OpenAI not configured');
    }

    // console.log('Analysis result:', nutritionData);

    // Don't save yet - show analysis and ask for confirmation
    const confidenceText = nutritionData.confidence < 0.6 ? 'Low confidence estimate\n' : 
                          nutritionData.confidence > 0.8 ? 'High confidence analysis\n' : '';

    // Calculate score explanation
    const scoreExplanation = getScoreExplanation(nutritionData, userContext);
    
    const primaryItem = (nutritionData.items || []).find(i => i.item_role === 'dish')
      || (nutritionData.items || [])[0] || null;
    const recognizedLabel = primaryItem ? `${primaryItem.name || nutritionData.food_name || 'Food'} (${primaryItem.canonical_category || 'unknown'})` : (nutritionData.food_name || 'Food');
    const offStatus = nutritionData.off_status || 'skipped';
    const offReasons = Array.isArray(nutritionData.off_reasons) ? nutritionData.off_reasons.map(r => r.reason).filter(Boolean) : [];

    if (analyzingMessage?.message_id) {
      const checkingLine = offStatus === 'used'
        ? '✅ Found precise nutrition in Open Food Facts.'
        : offStatus === 'fallback'
          ? '⚠️ Could not find a precise match in Open Food Facts — using AI estimate.'
          : 'ℹ️ Using AI estimate for nutrition.';
      const recognizedText = `🔎 <b>Recognized:</b> ${recognizedLabel}\n${checkingLine}`;
      await editMessageWithKeyboard(chatId, analyzingMessage.message_id, recognizedText, [], botToken);
    }

    const sourceLine = offStatus === 'used'
      ? 'Source: Open Food Facts match'
      : offStatus === 'disabled'
        ? 'Source: AI estimate (OFF disabled)'
        : offStatus === 'fallback'
          ? `Source: AI estimate (OFF fallback${offReasons.length ? `: ${offReasons.join(', ')}` : ''})`
          : 'Source: AI estimate';

    const responseText = `<b>Nutrition Analysis</b>

<b>Food:</b> ${nutritionData.food_name || 'Mixed Food'}
<b>Portion:</b> ${nutritionData.portion_size || 'Standard'} (${nutritionData.portion_description || 'medium serving'})
<b>${sourceLine}</b>

<b>Nutritional Breakdown:</b>
Calories: ${nutritionData.calories} kcal
Protein: ${nutritionData.protein_g}g
Fat: ${nutritionData.fat_g}g  
Carbs: ${nutritionData.carbs_g}g
Fiber: ${nutritionData.fiber_g}g

<b>Meal Score:</b> ${nutritionData.score}/10 ${scoreExplanation}

${confidenceText}<b>Advice:</b> ${nutritionData.advice_short}

Ready to add this to your diet?`;

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
        { text: 'Add to Diet', callback_data: `confirm_save_${analysisId}` },
        { text: 'Cancel', callback_data: 'cancel_analysis' }
      ],
      [
        { text: 'Edit Calories', callback_data: `edit_analysis_calories_${analysisId}` },
        { text: 'Edit Protein', callback_data: `edit_analysis_protein_${analysisId}` }
      ],
      [
        { text: 'Edit Portion', callback_data: `edit_analysis_portion_${analysisId}` }
      ]
    ];

    await sendMessageWithKeyboard(chatId, responseText, keyboard, botToken);

  } catch (error) {
    console.error('Food analysis error:', error);
    // Simple error message - NO LOOPS
    await sendMessage(chatId, 'Analysis failed. Please try again with a clearer description.', botToken);
  }
}

// Simple callback query handler
async function handleCallbackQuery(callbackQuery, botToken, supabaseUrl, supabaseHeaders) {
  try {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;

    // console.log(`Callback query from ${userId}: ${data}`);

    // Answer the callback query first
    await answerCallbackQuery(callbackQuery.id, 'Processing...', botToken);

    if (data.startsWith('confirm_save_')) {
      const analysisId = data.replace('confirm_save_', '');
      const analysisData = global.tempAnalysisData?.[analysisId];
      if (analysisData) {
        await confirmSaveAnalysis(chatId, messageId, analysisData, botToken, supabaseUrl, supabaseHeaders);
        delete global.tempAnalysisData[analysisId];
      }
    } else if (data === 'cancel_analysis') {
      await cancelAnalysis(chatId, messageId, botToken);
    } else if (data.startsWith('quick_delete_')) {
      const entryId = data.replace('quick_delete_', '');
      await quickDeleteMeal(chatId, messageId, userId, entryId, botToken, supabaseUrl, supabaseHeaders);
    }
    // Add other callback handlers as needed...

  } catch (error) {
    console.error('Callback query error:', error);
    await answerCallbackQuery(callbackQuery.id, 'Request processing error', botToken);
  }
}

// Simplified save confirmation
async function confirmSaveAnalysis(chatId, messageId, analysisData, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Reconstruct message object for saving
    const message = {
      chat: { id: chatId },
      message_id: analysisData.messageId,
      from: { id: analysisData.userId, first_name: 'User' },
      text: analysisData.originalText,
      photo: null
    };

    // Save to database using existing function
    await saveFoodEntry(analysisData.userId, message, analysisData, supabaseUrl, supabaseHeaders);

    const successText = `<b>Added to Diet</b>

<b>Saved:</b> ${analysisData.food_name || 'Food item'}
${analysisData.calories} kcal • ${analysisData.protein_g}g protein • ${analysisData.portion_size || 'standard portion'}

Use /today to check your daily progress`;

    await editMessageWithKeyboard(chatId, messageId, successText, [], botToken);

  } catch (error) {
    console.error('Confirm save analysis error:', error);
    await sendMessage(chatId, '❌ Error saving to diet.', botToken);
  }
}

// Cancel analysis
async function cancelAnalysis(chatId, messageId, botToken) {
  try {
    const cancelText = `<b>Analysis Cancelled</b>

Nothing was saved to your diet.
Ready for your next food when you are.`;

    await editMessageWithKeyboard(chatId, messageId, cancelText, [], botToken);

  } catch (error) {
    console.error('Cancel analysis error:', error);
    await sendMessage(chatId, '❌ Cancel error.', botToken);
  }
}

// Simple placeholder commands for less critical features
async function handleDebugCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders) {
  await sendMessage(chatId, 'Debug command - to be implemented', botToken);
}

async function handleResetCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders) {
  await sendMessage(chatId, 'Reset command - to be implemented', botToken);
}

async function quickDeleteMeal(chatId, messageId, userId, entryId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Get user UUID
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}&select=id`,
      { headers: supabaseHeaders }
    );

    const users = await userResponse.json();
    if (users.length === 0) {
      await sendMessage(chatId, 'User not found.', botToken);
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
      await sendMessage(chatId, 'Failed to delete meal.', botToken);
      return;
    }

    // Update daily aggregates
    const today = new Date().toISOString().split('T')[0];
    await updateDailyAggregates(userUuid, today, supabaseUrl, supabaseHeaders);

    // Refresh the meals list immediately
    await handleMealsCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders);

  } catch (error) {
    console.error('Quick delete error:', error);
    await sendMessage(chatId, 'Error deleting meal.', botToken);
  }
}

// Smart fallback for common foods when GPT-5 times out
function getSmartFallback(text, message) {
  const lowerText = text.toLowerCase();
  
  // Oatmeal - the problematic case
  if (lowerText.includes('oat')) {
    return {
      calories: 320,
      protein_g: 12,
      fat_g: 6,
      carbs_g: 54,
      fiber_g: 8,
      confidence: 0.7,
      advice_short: 'Excellent breakfast with sustained energy and fiber',
      food_name: 'Oatmeal',
      portion_size: '1 cup',
      portion_description: 'Standard bowl',
      score: 7.8
    };
  }
  
  // Coffee
  if (lowerText.includes('coffee') || lowerText.includes('americano')) {
    return {
      calories: 5,
      protein_g: 0.3,
      fat_g: 0,
      carbs_g: 1,
      fiber_g: 0,
      confidence: 0.9,
      advice_short: 'Perfect zero-calorie beverage choice',
      food_name: 'Black Coffee',
      portion_size: '1 cup',
      portion_description: 'Standard coffee cup',
      score: 7.5
    };
  }
  
  // Default fallback
  return getFallbackAnalysis(message);
}
