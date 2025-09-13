// Commands Module - All bot commands handlers

import { sendMessage, sendMessageWithKeyboard } from './telegram-helpers.js';
import { getUserContext, ensureUserExists } from './database.js';

export async function handleHelpCommand(chatId, botToken) {
  const helpText = `<b>Soma - Your Nutrition Assistant</b>

<b>Food Analysis:</b>
Send photos or describe your meals to get detailed nutrition breakdowns with portion estimates.

<b>Meal Management:</b>
View and manage your recent meals with simple delete functionality.

<b>Commands:</b>
/start - get started or return home
/meals - view recent meals
/today - daily nutrition summary
/goals - view your targets  
/profile - manage your profile
/reset - reset all data
/help - this reference

<b>Examples:</b>
"Scrambled eggs with toast"
"Caesar salad, large portion" 
"Protein shake with banana"

Just send a photo or description to get started.`;

  await sendMessage(chatId, helpText, botToken);
}

export async function handleTestCommand(chatId, botToken, openaiKey, supabaseUrl) {
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

// Handle /meals command - show recent meals with management options
export async function handleMealsCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Get user UUID
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}&select=id`,
      { headers: supabaseHeaders }
    );

    if (!userResponse.ok) {
      await sendMessage(chatId, 'User not found. Send /start to register.', botToken);
      return;
    }

    const users = await userResponse.json();
    if (users.length === 0) {
      await sendMessage(chatId, 'User not found. Send /start to register.', botToken);
      return;
    }

    const userUuid = users[0].id;
    
    // Get recent meals (last 10)
    const entriesResponse = await fetch(
      `${supabaseUrl}/rest/v1/entries?user_id=eq.${userUuid}&select=*&order=timestamp_utc.desc&limit=10`,
      { headers: supabaseHeaders }
    );

    if (!entriesResponse.ok) {
      await sendMessage(chatId, 'Failed to fetch meals.', botToken);
      return;
    }

    const entries = await entriesResponse.json();

    if (entries.length === 0) {
      await sendMessage(chatId, 
        '<b>Your Recent Meals</b>\n\n' +
        'No meals found.\n' +
        'Send a photo or describe what you ate to get started!', 
        botToken);
      return;
    }

    // Create meal list with delete buttons
    let mealsText = '<b>Your Recent Meals</b>\n\n';
    const keyboard = [];

    entries.forEach((entry, index) => {
      const date = new Date(entry.timestamp_utc);
      const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const foodDescription = entry.text ? 
        (entry.text.length > 25 ? entry.text.substring(0, 25) + '...' : entry.text) : 
        'Food photo';
      
      const portionInfo = entry.portion_size ? ` • ${entry.portion_size}` : '';
      mealsText += `<b>${entry.food_name || foodDescription}</b> (${timeStr})\n`;
      mealsText += `${entry.calories}kcal • ${entry.protein_g}g protein${portionInfo}\n\n`;

      // Delete button for each meal
      keyboard.push([
        { text: `Delete`, callback_data: `quick_delete_${entry.id}` }
      ]);
    });

    await sendMessageWithKeyboard(chatId, mealsText, keyboard, botToken);

  } catch (error) {
    console.error('Meals command error:', error);
    await sendMessage(chatId, 'Failed to fetch meals.', botToken);
  }
}

// Handle /today command - daily nutrition summary
export async function handleTodayCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Get user UUID and goals
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}&select=id,cal_goal,protein_goal_g,fiber_goal_g`,
      { headers: supabaseHeaders }
    );

    if (!userResponse.ok) {
      await sendMessage(chatId, 'User not found. Send /start to register.', botToken);
      return;
    }

    const users = await userResponse.json();
    if (users.length === 0) {
      await sendMessage(chatId, 'User not found. Send /start to register.', botToken);
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
      await sendMessage(chatId, 'Failed to fetch today\'s data.', botToken);
      return;
    }

    const entries = await entriesResponse.json();

    if (entries.length === 0) {
      await sendMessage(chatId, 
        `<b>Today (${today})</b>\n\n` +
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
    const goals = { cal: user.cal_goal || 2000, protein: user.protein_goal_g || 150, fiber: user.fiber_goal_g || 25 };

    const todayText = `<b>Today (${today})</b>

<b>Meals logged:</b> ${entries.length}

<b>Daily totals:</b>
Calories: ${Math.round(totals.calories)} / ${goals.cal} kcal (${Math.round((totals.calories / goals.cal) * 100)}%)
Protein: ${Math.round(totals.protein * 10) / 10} / ${goals.protein}g (${Math.round((totals.protein / goals.protein) * 100)}%)
Fat: ${Math.round(totals.fat * 10) / 10}g
Carbs: ${Math.round(totals.carbs * 10) / 10}g
Fiber: ${Math.round(totals.fiber * 10) / 10} / ${goals.fiber}g (${Math.round((totals.fiber / goals.fiber) * 100)}%)

<b>Average meal score:</b> ${avgScore}/10

<b>Progress:</b> ${
  totals.calories < goals.cal * 0.7 ? 'Add more calories for the day' :
  totals.calories > goals.cal * 1.2 ? 'Calorie goal exceeded' :
  'Good calorie balance'
}`;

    await sendMessage(chatId, todayText, botToken);

  } catch (error) {
    console.error('Today command error:', error);
    await sendMessage(chatId, 'Failed to fetch today\'s summary.', botToken);
  }
}

// Handle /start command with onboarding
export async function handleStartCommand(chatId, userId, userName, botToken, supabaseUrl, supabaseHeaders) {
  try {
    // Ensure user exists in database
    await ensureUserExists(userId, userName, supabaseUrl, supabaseHeaders);

    const welcomeText = `Hey ${userName}! Welcome to Soma.

<b>What I can do for you:</b>
• Analyze food photos and descriptions
• Track calories, protein, and macros
• Give personalized nutrition insights
• Help you hit your goals consistently

<b>Commands:</b>
/meals - manage recent meals
/today - daily nutrition summary  
/goals - view your targets
/profile - edit your profile

Ready to track something? Send a photo or describe what you're eating.`;

    await sendMessage(chatId, welcomeText, botToken);
  } catch (error) {
    console.error('Start command error:', error);
    await sendMessage(chatId, 'Setup failed. Please try again.', botToken);
  }
}

// Handle /goals command
export async function handleGoalsCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}&select=*`,
      { headers: supabaseHeaders }
    );

    if (!userResponse.ok) {
      await sendMessage(chatId, 'User not found. Send /start to register.', botToken);
      return;
    }

    const users = await userResponse.json();
    if (users.length === 0) {
      await sendMessage(chatId, 'User not found. Send /start to register.', botToken);
      return;
    }

    const user = users[0];
    const hasProfile = user.age && user.weight_kg && user.height_cm && user.fitness_goal;
    
    if (!hasProfile) {
      // User doesn't have a complete profile
      const setupText = `<b>Your Nutrition Goals</b>

<b>Profile not set up yet</b>

I'm using these default goals for now:
Calories: 2000 kcal/day
Protein: 150g/day  
Fat: 65g/day
Carbs: 250g/day
Fiber: 25g/day

<b>Want personalized goals?</b>
Set up your profile to get targets calculated for your specific body, goals, and activity level.`;

      const keyboard = [
        [
          { text: 'Set Up Profile', callback_data: 'onboarding_start' }
        ]
      ];

      await sendMessageWithKeyboard(chatId, setupText, keyboard, botToken);
      return;
    }

    // Show personalized goals
    const goalsText = `<b>Your Personalized Goals</b>

<b>Daily Targets:</b>
Calories: ${user.cal_goal || 2000} kcal/day
Protein: ${user.protein_goal_g || 150}g/day  
Fat: ${user.fat_goal_g || 65}g/day
Carbs: ${user.carbs_goal_g || 250}g/day
Fiber: ${user.fiber_goal_g || 25}g/day

<b>Based on your profile:</b>
${user.age} year old ${user.gender}, ${user.height_cm}cm, ${user.weight_kg}kg
Goal: ${user.fitness_goal} weight, Activity: ${user.activity_level}

These targets are used for personalized analysis and recommendations.`;

    const keyboard = [
      [
        { text: 'Edit Profile', callback_data: 'profile_edit' },
        { text: 'Recalculate', callback_data: 'profile_recalculate' }
      ]
    ];

    await sendMessageWithKeyboard(chatId, goalsText, keyboard, botToken);

  } catch (error) {
    console.error('Goals command error:', error);
    await sendMessage(chatId, 'Failed to fetch goals.', botToken);
  }
}

// Handle /profile command
export async function handleProfileCommand(chatId, userId, botToken, supabaseUrl, supabaseHeaders) {
  try {
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_user_id=eq.${userId}&select=*`,
      { headers: supabaseHeaders }
    );

    if (!userResponse.ok) {
      await sendMessage(chatId, 'User not found. Send /start to register.', botToken);
      return;
    }

    const users = await userResponse.json();
    if (users.length === 0) {
      await sendMessage(chatId, 'User not found. Send /start to register.', botToken);
      return;
    }

    const user = users[0];
    const hasProfile = user.age && user.weight_kg && user.height_cm && user.fitness_goal;
    
    if (!hasProfile) {
      // Start onboarding
      const onboardingText = `<b>Let's set up your profile</b>

Hey! I'll give you way better nutrition recommendations if I know a bit about you first.

This takes like 2 minutes and gets you personalized calorie and macro targets that actually make sense for your goals.

Want to set it up now?`;

      const keyboard = [
        [
          { text: 'Let\'s Go', callback_data: 'onboarding_start' },
          { text: 'Skip for now', callback_data: 'onboarding_skip' }
        ]
      ];

      await sendMessageWithKeyboard(chatId, onboardingText, keyboard, botToken);
      return;
    }

    // Show existing profile
    const profileText = `<b>Your Profile</b>

<b>Personal Info:</b>
Age: ${user.age} years
Height: ${user.height_cm}cm
Weight: ${user.weight_kg}kg
Gender: ${user.gender}
Goal: ${user.fitness_goal}
Activity: ${user.activity_level}

<b>Your Targets:</b>
Calories: ${user.cal_goal} kcal/day
Protein: ${user.protein_goal_g}g/day
Fat: ${user.fat_goal_g}g/day
Carbs: ${user.carbs_goal_g}g/day
Fiber: ${user.fiber_goal_g}g/day`;

    const keyboard = [
      [
        { text: 'Edit Profile', callback_data: 'profile_edit' },
        { text: 'Recalculate', callback_data: 'profile_recalculate' }
      ]
    ];

    await sendMessageWithKeyboard(chatId, profileText, keyboard, botToken);

  } catch (error) {
    console.error('Profile command error:', error);
    await sendMessage(chatId, 'Error loading profile.', botToken);
  }
}
