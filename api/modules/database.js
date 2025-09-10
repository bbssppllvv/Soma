// Database Operations Module - Supabase integration

// Get user context with error handling
export async function getUserContext(userId, supabaseUrl, supabaseHeaders) {
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

export function getDefaultUserContext() {
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

// Save food entry with enhanced error handling
export async function saveFoodEntry(userId, message, nutritionData, supabaseUrl, supabaseHeaders) {
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
      food_name: nutritionData.food_name || 'Unknown Food',
      portion_size: nutritionData.portion_size || 'Unknown portion',
      portion_description: nutritionData.portion_description || 'Standard serving',
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

// Ensure user exists in database
export async function ensureUserExists(userId, userName, supabaseUrl, supabaseHeaders) {
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

// Update daily aggregates
export async function updateDailyAggregates(userUuid, dayLocal, supabaseUrl, supabaseHeaders) {
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
