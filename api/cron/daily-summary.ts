import { VercelRequest, VercelResponse } from '@vercel/node';
import TelegramBot from 'node-telegram-bot-api';
import { supabaseService } from '../../services/supabase';
import { LLMService } from '../../services/llm';
import { ScoringService } from '../../services/scoring';
import { TimeService } from '../../services/time';
import { TelegramUtils } from '../../utils/telegram';
import { DailyEntry, User, LogEntry } from '../../types';

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN || '', { polling: false });
const llmService = new LLMService();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify this is a cron request (Vercel adds this header)
  if (req.headers['user-agent'] !== 'Vercel-Cron/1.0') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('Starting daily summary cron job...');
    
    const users = await supabaseService.getAllUsersForDigest();
    const processedUsers = [];
    const errors = [];

    for (const user of users) {
      try {
        if (user.silent_mode) {
          continue; // Skip users who have disabled notifications
        }

        const shouldSendDigest = await checkIfTimeForDigest(user);
        if (!shouldSendDigest) {
          continue;
        }

        await sendDailyDigest(user);
        processedUsers.push(user.user_id);
        
        // Add small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`Error processing user ${user.user_id}:`, error);
        errors.push({ userId: user.user_id, error: error.message });
      }
    }

    console.log(`Daily summary completed. Processed: ${processedUsers.length}, Errors: ${errors.length}`);
    
    return res.status(200).json({
      success: true,
      processedUsers: processedUsers.length,
      errors: errors.length,
      details: { processedUsers, errors }
    });

  } catch (error) {
    console.error('Daily summary cron error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
}

async function checkIfTimeForDigest(user: User): boolean {
  try {
    const currentLocalTime = TimeService.getCurrentLocalTime(user.timezone);
    const targetTime = user.daily_digest_time;
    
    // Check if current time is within 5 minutes of target time
    return TimeService.isTimeInRange(currentLocalTime, targetTime, 5);
  } catch (error) {
    console.error(`Error checking time for user ${user.user_id}:`, error);
    return false;
  }
}

async function sendDailyDigest(user: User) {
  const currentDate = TimeService.getCurrentLocalDate(user.timezone);
  
  try {
    // Get today's data
    let todayData = await supabaseService.getDailyEntry(user.user_id, currentDate);
    
    // If no daily entry exists, try to aggregate from log entries
    if (!todayData) {
      const logEntries = await supabaseService.getLogEntriesForDay(user.user_id, currentDate);
      if (logEntries.length > 0) {
        todayData = aggregateLogEntriesToDaily(logEntries, user, currentDate);
        await supabaseService.upsertDailyEntry(todayData);
      }
    }

    // If still no data, send a gentle reminder instead
    if (!todayData || todayData.meals_count === 0) {
      const reminderMessage = `📝 Сегодня (${currentDate}) ещё нет записей о питании.\n\n` +
                             `💡 Не забывайте фиксировать приёмы пищи для лучшего контроля!\n\n` +
                             `Отключить напоминания: /setgoals silent=true`;
      
      await bot.sendMessage(user.user_id, reminderMessage);
      return;
    }

    // Get recent days for context
    const { startDate } = TimeService.getLastNDaysRange(user.timezone, 3);
    const recentDays = await supabaseService.getDailyEntriesForPeriod(user.user_id, startDate, currentDate);
    
    // Generate personalized advice for tomorrow
    let tomorrowAdvice: string;
    try {
      tomorrowAdvice = await llmService.generateDailyAdvice(user, todayData, recentDays);
    } catch (error) {
      console.error('Error generating daily advice:', error);
      tomorrowAdvice = generateFallbackAdvice(todayData, user);
    }

    // Format and send the daily report
    const reportMessage = TelegramUtils.formatDailyReport(currentDate, todayData, user, tomorrowAdvice);
    
    await bot.sendMessage(user.user_id, reportMessage);
    
    console.log(`Daily digest sent to user ${user.user_id}`);

  } catch (error) {
    console.error(`Error sending daily digest to user ${user.user_id}:`, error);
    
    // Send a fallback message if something goes wrong
    try {
      await bot.sendMessage(user.user_id, 
        '📊 Не удалось сформировать подробный отчёт за день.\n' +
        'Используйте /today для просмотра статистики.\n\n' +
        'Если проблема повторяется, обратитесь к /help'
      );
    } catch (fallbackError) {
      console.error(`Failed to send fallback message to user ${user.user_id}:`, fallbackError);
    }
  }
}

function aggregateLogEntriesToDaily(logEntries: LogEntry[], user: User, dayLocal: string): DailyEntry {
  const totals = logEntries.reduce((acc, entry) => ({
    calories: acc.calories + entry.calories,
    protein: acc.protein + entry.protein_g,
    fat: acc.fat + entry.fat_g,
    carbs: acc.carbs + entry.carbs_g,
    fiber: acc.fiber + entry.fiber_g,
  }), { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 });

  const dailyEntry: DailyEntry = {
    day_local: dayLocal,
    user_id: user.user_id,
    calories_sum: Math.round(totals.calories),
    protein_sum: Math.round(totals.protein * 10) / 10,
    fat_sum: Math.round(totals.fat * 10) / 10,
    carbs_sum: Math.round(totals.carbs * 10) / 10,
    fiber_sum: Math.round(totals.fiber * 10) / 10,
    meals_count: logEntries.length,
    daily_score: 0,
    notes: '',
  };

  dailyEntry.daily_score = ScoringService.calculateDailyScore(dailyEntry, user);
  return dailyEntry;
}

function generateFallbackAdvice(todayData: DailyEntry, user: User): string {
  const advice: string[] = [];
  
  // Check calorie balance
  const calorieRatio = todayData.calories_sum / user.cal_goal;
  if (calorieRatio < 0.85) {
    advice.push('добавьте калорий');
  } else if (calorieRatio > 1.15) {
    advice.push('снизьте калорийность');
  }
  
  // Check protein
  if (todayData.protein_sum < user.protein_goal_g * 0.8) {
    advice.push('больше белка');
  }
  
  // Check fiber
  if (todayData.fiber_sum < user.fiber_goal_g * 0.6) {
    advice.push('добавьте клетчатки');
  }
  
  if (advice.length === 0) {
    return 'Продолжайте в том же духе!';
  }
  
  return 'Завтра: ' + advice.join(', ') + '.';
}

// Health check endpoint for monitoring
export async function healthCheck(req: VercelRequest, res: VercelResponse) {
  try {
    // Basic connectivity test
    const users = await supabaseService.getAllUsersForDigest();
    
    return res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      totalUsers: users.length,
      activeUsers: users.filter(u => !u.silent_mode).length
    });
  } catch (error) {
    return res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
