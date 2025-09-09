import { VercelRequest, VercelResponse } from '@vercel/node';
import TelegramBot from 'node-telegram-bot-api';
import { sheetsService } from '../services/sheets';
import { LLMService } from '../services/llm';
import { ScoringService } from '../services/scoring';
import { TimeService } from '../services/time';
import { TelegramUtils } from '../utils/telegram';
import { TelegramMessage, LogEntry, DailyEntry, User } from '../types';

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN || '', { polling: false });
const llmService = new LLMService();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const update = req.body;
    
    if (!update.message) {
      return res.status(200).json({ ok: true });
    }

    const message: TelegramMessage = update.message;
    await processMessage(message);
    
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function processMessage(message: TelegramMessage) {
  const userId = message.from.id;
  const chatId = message.chat.id;
  const messageId = message.message_id;
  const timestamp = new Date().toISOString();

  // Rate limiting
  if (!TelegramUtils.checkRateLimit(userId)) {
    await bot.sendMessage(chatId, 'Превышен лимит сообщений на сегодня (30). Попробуйте завтра.');
    return;
  }

  try {
    // Get or create user
    let user = await sheetsService.getUser(userId);
    if (!user) {
      user = {
        user_id: userId,
        display_name: message.from.first_name || 'User',
        timezone: TimeService.getDefaultTimezone(),
        cal_goal: 1800,
        protein_goal_g: 120,
        fiber_goal_g: 25,
        first_seen_utc: timestamp,
        last_seen_utc: timestamp,
        silent_mode: false,
        daily_digest_time: '21:30',
      };
      await sheetsService.createOrUpdateUser(user);
    } else {
      // Update last seen
      await sheetsService.createOrUpdateUser({
        user_id: userId,
        last_seen_utc: timestamp,
        display_name: message.from.first_name || user.display_name,
      });
    }

    const dayLocal = TimeService.toLocalDate(timestamp, user.timezone);

    // Handle commands
    if (message.text && TelegramUtils.isCommand(message.text)) {
      await handleCommand(message.text, chatId, user, dayLocal);
      return;
    }

    // Handle natural language commands
    if (message.text && !message.photo) {
      const naturalCommand = TelegramUtils.parseNaturalCommand(message.text);
      if (naturalCommand) {
        await handleCommand(naturalCommand, chatId, user, dayLocal);
        return;
      }
    }

    // Handle food analysis (photo and/or text)
    if (message.photo || message.text || message.caption) {
      await handleFoodAnalysis(message, user, dayLocal, timestamp);
    }

  } catch (error) {
    console.error('Error processing message:', error);
    await bot.sendMessage(chatId, TelegramUtils.formatErrorMessage('Произошла ошибка при обработке сообщения.'));
  }
}

async function handleCommand(command: string, chatId: number, user: User, dayLocal: string) {
  const cmd = command.split(' ')[0].toLowerCase();

  switch (cmd) {
    case '/start':
      await bot.sendMessage(chatId, TelegramUtils.formatStartMessage());
      break;

    case '/today':
      await handleTodayCommand(chatId, user, dayLocal);
      break;

    case '/week':
      await handleWeekCommand(chatId, user);
      break;

    case '/month':
      await handleMonthCommand(chatId, user);
      break;

    case '/goals':
      await bot.sendMessage(chatId, TelegramUtils.formatGoalsDisplay(user));
      break;

    case '/setgoals':
      await handleSetGoalsCommand(command, chatId, user);
      break;

    case '/help':
      await bot.sendMessage(chatId, TelegramUtils.formatHelpMessage());
      break;

    case '/delete_me':
      await handleDeleteCommand(chatId, user);
      break;

    default:
      await bot.sendMessage(chatId, 'Неизвестная команда. Используйте /help для справки.');
  }
}

async function handleTodayCommand(chatId: number, user: User, dayLocal: string) {
  try {
    let dailyData = await sheetsService.getDailyEntry(user.user_id, dayLocal);
    
    if (!dailyData) {
      // Try to aggregate from log entries
      const logEntries = await sheetsService.getLogEntriesForDay(user.user_id, dayLocal);
      if (logEntries.length > 0) {
        dailyData = aggregateLogEntriesToDaily(logEntries, user, dayLocal);
        await sheetsService.upsertDailyEntry(dailyData);
      }
    }

    const response = TelegramUtils.formatTodayResponse(dailyData, user, dayLocal);
    await bot.sendMessage(chatId, response);
  } catch (error) {
    console.error('Error handling today command:', error);
    await bot.sendMessage(chatId, TelegramUtils.formatErrorMessage('Не удалось получить данные за сегодня.'));
  }
}

async function handleWeekCommand(chatId: number, user: User) {
  try {
    const { startDate, endDate } = TimeService.getLastNDaysRange(user.timezone, 7);
    const weeklyData = await sheetsService.getDailyEntriesForPeriod(user.user_id, startDate, endDate);
    
    const weeklyStats = ScoringService.calculateWeeklyStats(weeklyData, user);
    const advice = ScoringService.generateWeeklyAdvice(weeklyData, user);
    
    const response = TelegramUtils.formatWeeklyReport(weeklyStats, user, advice);
    await bot.sendMessage(chatId, response);
  } catch (error) {
    console.error('Error handling week command:', error);
    await bot.sendMessage(chatId, TelegramUtils.formatErrorMessage('Не удалось получить недельную статистику.'));
  }
}

async function handleMonthCommand(chatId: number, user: User) {
  try {
    const { startDate, endDate } = TimeService.getLastNDaysRange(user.timezone, 30);
    const monthlyData = await sheetsService.getDailyEntriesForPeriod(user.user_id, startDate, endDate);
    
    const monthlyStats = ScoringService.calculateWeeklyStats(monthlyData, user);
    
    // Calculate trend by splitting into weeks
    const weeksData: DailyEntry[][] = [];
    for (let i = 0; i < 4; i++) {
      const weekStart = TimeService.getLastNDaysRange(user.timezone, 7 + (i * 7)).startDate;
      const weekEnd = TimeService.getLastNDaysRange(user.timezone, (i * 7)).endDate;
      const weekData = monthlyData.filter(day => day.day_local >= weekStart && day.day_local <= weekEnd);
      weeksData.push(weekData);
    }
    
    const trend = ScoringService.calculateTrend(weeksData);
    const advice = ScoringService.generateWeeklyAdvice(monthlyData, user);
    
    const response = TelegramUtils.formatMonthlyReport({ ...monthlyStats, trend, weeks_data: [] }, user, advice);
    await bot.sendMessage(chatId, response);
  } catch (error) {
    console.error('Error handling month command:', error);
    await bot.sendMessage(chatId, TelegramUtils.formatErrorMessage('Не удалось получить месячную статистику.'));
  }
}

async function handleSetGoalsCommand(command: string, chatId: number, user: User) {
  try {
    const newGoals = TelegramUtils.parseSetGoalsCommand(command);
    
    if (!newGoals || Object.keys(newGoals).length === 0) {
      await bot.sendMessage(chatId, 
        'Используйте: /setgoals cal=1800 protein=120 fiber=25\n' +
        'Можно изменять отдельные параметры: /setgoals cal=2000'
      );
      return;
    }

    // Validate goals
    if (newGoals.cal_goal && (newGoals.cal_goal < 1000 || newGoals.cal_goal > 4000)) {
      await bot.sendMessage(chatId, 'Калории должны быть от 1000 до 4000.');
      return;
    }

    if (newGoals.protein_goal_g && (newGoals.protein_goal_g < 50 || newGoals.protein_goal_g > 300)) {
      await bot.sendMessage(chatId, 'Белок должен быть от 50 до 300 г.');
      return;
    }

    if (newGoals.fiber_goal_g && (newGoals.fiber_goal_g < 10 || newGoals.fiber_goal_g > 60)) {
      await bot.sendMessage(chatId, 'Клетчатка должна быть от 10 до 60 г.');
      return;
    }

    if (newGoals.timezone && !TimeService.isValidTimezone(newGoals.timezone)) {
      await bot.sendMessage(chatId, 'Неверный часовой пояс. Используйте формат: Europe/Madrid');
      return;
    }

    await sheetsService.createOrUpdateUser({ user_id: user.user_id, ...newGoals });
    
    const updatedUser = await sheetsService.getUser(user.user_id);
    if (updatedUser) {
      await bot.sendMessage(chatId, TelegramUtils.formatGoalsUpdateMessage(updatedUser));
    }
  } catch (error) {
    console.error('Error handling setgoals command:', error);
    await bot.sendMessage(chatId, TelegramUtils.formatErrorMessage('Не удалось обновить цели.'));
  }
}

async function handleDeleteCommand(chatId: number, user: User) {
  try {
    await sheetsService.deleteUserData(user.user_id);
    await bot.sendMessage(chatId, '✅ Все ваши данные удалены. Используйте /start для начала заново.');
  } catch (error) {
    console.error('Error deleting user data:', error);
    await bot.sendMessage(chatId, TelegramUtils.formatErrorMessage('Не удалось удалить данные.'));
  }
}

async function handleFoodAnalysis(message: TelegramMessage, user: User, dayLocal: string, timestamp: string) {
  const chatId = message.chat.id;

  try {
    let nutritionAnalysis;
    let photoBuffer: Buffer | undefined;
    let photoFileId: string | undefined;
    const text = message.text || message.caption;

    // Get recent days for context
    const { startDate } = TimeService.getLastNDaysRange(user.timezone, 3);
    const recentDays = await sheetsService.getDailyEntriesForPeriod(user.user_id, startDate, dayLocal);

    if (message.photo && message.photo.length > 0) {
      // Get the largest photo
      const photo = message.photo[message.photo.length - 1];
      photoFileId = photo.file_id;
      
      try {
        const fileInfo = await bot.getFile(photo.file_id);
        if (fileInfo.file_path) {
          const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;
          const response = await fetch(fileUrl);
          photoBuffer = Buffer.from(await response.arrayBuffer());
        }
      } catch (photoError) {
        console.error('Error downloading photo:', photoError);
      }
    }

    if (photoBuffer) {
      nutritionAnalysis = await llmService.analyzeFoodFromPhoto(photoBuffer, text, user, recentDays);
    } else if (text) {
      nutritionAnalysis = await llmService.analyzeFoodFromText(text, user, recentDays);
    } else {
      await bot.sendMessage(chatId, 'Пришлите фото еды или опишите что съели.');
      return;
    }

    // Get today's data for scoring context
    const todayData = await sheetsService.getDailyEntry(user.user_id, dayLocal);
    const mealScore = ScoringService.calculateMealScore(nutritionAnalysis, user, !todayData);

    // Create log entry
    const logEntry: LogEntry = {
      timestamp_utc: timestamp,
      day_local: dayLocal,
      user_id: user.user_id,
      chat_id: chatId,
      msg_id: message.message_id,
      text: text || undefined,
      photo_file_id: photoFileId,
      photo_note: text || undefined,
      calories: nutritionAnalysis.calories,
      protein_g: nutritionAnalysis.protein_g,
      fat_g: nutritionAnalysis.fat_g,
      carbs_g: nutritionAnalysis.carbs_g,
      fiber_g: nutritionAnalysis.fiber_g,
      score_item: mealScore,
      confidence: nutritionAnalysis.confidence,
      advice_short: nutritionAnalysis.advice_short,
      raw_model_json: JSON.stringify(nutritionAnalysis),
    };

    await sheetsService.addLogEntry(logEntry);

    // Update or create daily entry
    const updatedDailyData: DailyEntry = {
      day_local: dayLocal,
      user_id: user.user_id,
      calories_sum: (todayData?.calories_sum || 0) + nutritionAnalysis.calories,
      protein_sum: (todayData?.protein_sum || 0) + nutritionAnalysis.protein_g,
      fat_sum: (todayData?.fat_sum || 0) + nutritionAnalysis.fat_g,
      carbs_sum: (todayData?.carbs_sum || 0) + nutritionAnalysis.carbs_g,
      fiber_sum: (todayData?.fiber_sum || 0) + nutritionAnalysis.fiber_g,
      meals_count: (todayData?.meals_count || 0) + 1,
      daily_score: 0, // Will be calculated
      notes: '',
    };

    updatedDailyData.daily_score = ScoringService.calculateDailyScore(updatedDailyData, user);
    await sheetsService.upsertDailyEntry(updatedDailyData);

    // Send response to user
    const response = TelegramUtils.formatMealResponse(
      nutritionAnalysis.calories,
      Math.round(nutritionAnalysis.protein_g * 10) / 10,
      Math.round(nutritionAnalysis.fat_g * 10) / 10,
      Math.round(nutritionAnalysis.carbs_g * 10) / 10,
      Math.round(nutritionAnalysis.fiber_g * 10) / 10,
      nutritionAnalysis.advice_short,
      nutritionAnalysis.confidence
    );

    await bot.sendMessage(chatId, response);

  } catch (error) {
    console.error('Error analyzing food:', error);
    await bot.sendMessage(chatId, TelegramUtils.formatErrorMessage('Не удалось проанализировать еду.'));
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
    calories_sum: totals.calories,
    protein_sum: totals.protein,
    fat_sum: totals.fat,
    carbs_sum: totals.carbs,
    fiber_sum: totals.fiber,
    meals_count: logEntries.length,
    daily_score: 0,
    notes: '',
  };

  dailyEntry.daily_score = ScoringService.calculateDailyScore(dailyEntry, user);
  return dailyEntry;
}
