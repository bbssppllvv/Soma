import TelegramBot from 'node-telegram-bot-api';
import { DailyEntry, WeeklyStats, MonthlyStats, User } from '../types';

export class TelegramUtils {
  /**
   * Format meal response message
   */
  static formatMealResponse(
    calories: number,
    protein: number,
    fat: number,
    carbs: number,
    fiber: number,
    advice: string,
    confidence?: number
  ): string {
    let message = '🍽️ Принял.\n';
    message += `~${calories} ккал • Б ${protein} г • Ж ${fat} г • У ${carbs} г • Клетч ${fiber} г\n`;
    
    if (confidence && confidence < 0.6) {
      message += '⚠️ Низкая уверенность в оценке\n';
    }
    
    message += `💡 ${advice}`;
    
    return message;
  }

  /**
   * Format daily summary message
   */
  static formatDailyReport(
    date: string,
    dailyData: DailyEntry,
    user: User,
    advice?: string
  ): string {
    const dateFormatted = new Date(date + 'T00:00:00').toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: 'short'
    });

    let message = `📊 Итоги дня (${dateFormatted}):\n`;
    message += `Ккал ~${dailyData.calories_sum} / цель ${user.cal_goal}\n`;
    message += `Белок ${dailyData.protein_sum} г / цель ${user.protein_goal_g}\n`;
    message += `Клетчатка ${dailyData.fiber_sum} г / цель ${user.fiber_goal_g}\n`;
    
    // Add progress indicators
    const calProgress = dailyData.calories_sum / user.cal_goal;
    const proteinProgress = dailyData.protein_sum / user.protein_goal_g;
    const fiberProgress = dailyData.fiber_sum / user.fiber_goal_g;
    
    const calIcon = calProgress >= 0.85 && calProgress <= 1.15 ? '✅' : calProgress < 0.85 ? '📉' : '📈';
    const proteinIcon = proteinProgress >= 1.0 ? '✅' : '📉';
    const fiberIcon = fiberProgress >= 1.0 ? '✅' : '📉';
    
    message += `${calIcon} ${dailyData.meals_count} приёма • Оценка дня ${dailyData.daily_score.toFixed(1)}/10\n`;
    
    if (advice) {
      message += `💡 Завтра: ${advice}`;
    }
    
    return message;
  }

  /**
   * Format today's summary
   */
  static formatTodayResponse(
    dailyData: DailyEntry | null,
    user: User,
    dayLocal: string
  ): string {
    if (!dailyData || dailyData.meals_count === 0) {
      return '📝 Сегодня ещё нет записей о питании.\nПришлите фото или описание еды для анализа.';
    }

    return this.formatDailyReport(dayLocal, dailyData, user);
  }

  /**
   * Format weekly summary
   */
  static formatWeeklyReport(
    weeklyStats: WeeklyStats,
    user: User,
    advice: string
  ): string {
    let message = '📈 Неделя (последние 7 дней):\n\n';
    
    message += `📊 Средние значения в день:\n`;
    message += `Ккал: ${weeklyStats.avg_calories} (цель ${user.cal_goal})\n`;
    message += `Белок: ${weeklyStats.avg_protein} г (цель ${user.protein_goal_g})\n`;
    message += `Клетчатка: ${weeklyStats.avg_fiber} г (цель ${user.fiber_goal_g})\n\n`;
    
    message += `🎯 Попадания в цели:\n`;
    message += `Калории: ${weeklyStats.days_in_cal_range}/${weeklyStats.days_count} дней\n`;
    message += `Белок: ${weeklyStats.days_protein_met}/${weeklyStats.days_count} дней\n`;
    message += `Клетчатка: ${weeklyStats.days_fiber_met}/${weeklyStats.days_count} дней\n\n`;
    
    message += `⭐ Средняя оценка: ${weeklyStats.avg_daily_score}/10\n\n`;
    message += `💡 ${advice}`;
    
    return message;
  }

  /**
   * Format monthly summary
   */
  static formatMonthlyReport(
    monthlyStats: MonthlyStats,
    user: User,
    advice: string
  ): string {
    let message = '📅 Месяц (последние 30 дней):\n\n';
    
    message += `📊 Средние значения в день:\n`;
    message += `Ккал: ${monthlyStats.avg_calories} (цель ${user.cal_goal})\n`;
    message += `Белок: ${monthlyStats.avg_protein} г (цель ${user.protein_goal_g})\n`;
    message += `Клетчатка: ${monthlyStats.avg_fiber} г (цель ${user.fiber_goal_g})\n\n`;
    
    message += `🎯 Попадания в цели:\n`;
    message += `Калории: ${monthlyStats.days_in_cal_range}/${monthlyStats.days_count} дней (${Math.round(monthlyStats.days_in_cal_range/monthlyStats.days_count*100)}%)\n`;
    message += `Белок: ${monthlyStats.days_protein_met}/${monthlyStats.days_count} дней (${Math.round(monthlyStats.days_protein_met/monthlyStats.days_count*100)}%)\n`;
    message += `Клетчатка: ${monthlyStats.days_fiber_met}/${monthlyStats.days_count} дней (${Math.round(monthlyStats.days_fiber_met/monthlyStats.days_count*100)}%)\n\n`;
    
    // Trend indicator
    const trendEmoji = monthlyStats.trend === 'improving' ? '📈' : 
                      monthlyStats.trend === 'declining' ? '📉' : '➡️';
    message += `${trendEmoji} Тренд: `;
    switch (monthlyStats.trend) {
      case 'improving':
        message += 'улучшается\n';
        break;
      case 'declining':
        message += 'снижается\n';
        break;
      default:
        message += 'стабильно\n';
    }
    
    message += `⭐ Средняя оценка: ${monthlyStats.avg_daily_score}/10\n\n`;
    message += `💡 ${advice}`;
    
    return message;
  }

  /**
   * Format goals display
   */
  static formatGoalsDisplay(user: User): string {
    let message = '🎯 Ваши цели:\n\n';
    message += `🔥 Калории: ${user.cal_goal} ккал\n`;
    message += `💪 Белок: ${user.protein_goal_g} г\n`;
    message += `🌾 Клетчатка: ${user.fiber_goal_g} г\n`;
    message += `🕘 Отчёт в: ${user.daily_digest_time}\n`;
    message += `🌍 Часовой пояс: ${user.timezone}\n\n`;
    message += `Изменить: /setgoals cal=1800 protein=120 fiber=25`;
    
    return message;
  }

  /**
   * Format help message
   */
  static formatHelpMessage(): string {
    return `🤖 Soma - ваш помощник по питанию

📸 Отправьте фото еды или опишите текстом
🔍 Получите оценку калорий, БЖУ и совет

📋 Команды:
/today - сегодняшний отчёт
/report - подробный дневной отчёт с советами
/week - неделя (7 дней)
/month - месяц (30 дней)
/goals - показать цели
/setgoals cal=1800 protein=120 fiber=25 - изменить цели
/help - эта справка
/delete_me - удалить все данные

💡 Можно писать "как мои последние 7 дней" вместо команд`;
  }

  /**
   * Format start/onboarding message
   */
  static formatStartMessage(): string {
    return `👋 Привет! Я Soma, ваш персональный трекер питания.

📸 Просто пришлите фото еды или опишите что съели
🔍 Я проанализирую калории, белки, жиры, углеводы и клетчатку
💡 Дам персональный совет на основе ваших целей

🎯 Стандартные цели: 1800 ккал, 120г белка, 25г клетчатки
📊 Ежедневный отчёт в 21:30

Изменить настройки: /setgoals или /goals
Справка: /help

Начните с фото или описания вашего приёма пищи! 🍽️`;
  }

  /**
   * Format goals update confirmation
   */
  static formatGoalsUpdateMessage(user: User): string {
    return `✅ Цели обновлены:

🔥 Калории: ${user.cal_goal} ккал
💪 Белок: ${user.protein_goal_g} г  
🌾 Клетчатка: ${user.fiber_goal_g} г

Новые цели будут учтены в следующих анализах.`;
  }

  /**
   * Format error message
   */
  static formatErrorMessage(error: string): string {
    return `❌ ${error}\n\nПопробуйте ещё раз или обратитесь к /help`;
  }

  /**
   * Parse natural language commands
   */
  static parseNaturalCommand(text: string): string | null {
    const lowerText = text.toLowerCase();
    
    if (lowerText.includes('последние 7 дней') || lowerText.includes('неделя') || lowerText.includes('за неделю')) {
      return '/week';
    }
    
    if (lowerText.includes('последние 30 дней') || lowerText.includes('месяц') || lowerText.includes('за месяц')) {
      return '/month';
    }
    
    if (lowerText.includes('сегодня') || lowerText.includes('итоги дня')) {
      return '/today';
    }
    
    if (lowerText.includes('цели') || lowerText.includes('настройки')) {
      return '/goals';
    }
    
    return null;
  }

  /**
   * Parse setgoals command
   */
  static parseSetGoalsCommand(text: string): Partial<User> | null {
    const goals: Partial<User> = {};
    
    // Parse cal=1800
    const calMatch = text.match(/cal=(\d+)/i);
    if (calMatch) {
      goals.cal_goal = parseInt(calMatch[1]);
    }
    
    // Parse protein=120
    const proteinMatch = text.match(/protein=(\d+)/i);
    if (proteinMatch) {
      goals.protein_goal_g = parseInt(proteinMatch[1]);
    }
    
    // Parse fiber=25
    const fiberMatch = text.match(/fiber=(\d+)/i);
    if (fiberMatch) {
      goals.fiber_goal_g = parseInt(fiberMatch[1]);
    }
    
    // Parse timezone
    const timezoneMatch = text.match(/tz=([A-Za-z\/]+)/i);
    if (timezoneMatch) {
      goals.timezone = timezoneMatch[1];
    }
    
    // Parse digest time
    const timeMatch = text.match(/time=(\d{1,2}):(\d{2})/i);
    if (timeMatch) {
      goals.daily_digest_time = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
    }
    
    return Object.keys(goals).length > 0 ? goals : null;
  }

  /**
   * Validate and sanitize user input
   */
  static sanitizeInput(text: string): string {
    return text.trim().substring(0, 1000); // Limit length and trim
  }

  /**
   * Check if message is a command
   */
  static isCommand(text: string): boolean {
    return text.startsWith('/');
  }

  /**
   * Rate limit check (simple in-memory implementation)
   */
  private static userMessageCounts: Map<number, { count: number; resetTime: number }> = new Map();

  static checkRateLimit(userId: number, maxMessages: number = 30): boolean {
    const now = Date.now();
    const dayStart = new Date().setHours(0, 0, 0, 0);
    
    const userStats = this.userMessageCounts.get(userId);
    
    if (!userStats || userStats.resetTime < dayStart) {
      this.userMessageCounts.set(userId, { count: 1, resetTime: now });
      return true;
    }
    
    if (userStats.count >= maxMessages) {
      return false;
    }
    
    userStats.count++;
    return true;
  }
}
