import { supabaseService } from './supabase';
import { ScoringService } from './scoring';
import { TimeService } from './time';
import { User, DailyEntry, WeeklyStats, MonthlyStats } from '../types';

export class SummaryService {
  /**
   * Generate comprehensive weekly summary
   */
  static async generateWeeklySummary(user: User): Promise<{
    stats: WeeklyStats;
    advice: string;
    data: DailyEntry[];
  }> {
    const { startDate, endDate } = TimeService.getLastNDaysRange(user.timezone, 7);
    const weeklyData = await supabaseService.getDailyEntriesForPeriod(user.user_id, startDate, endDate);
    
    const stats = ScoringService.calculateWeeklyStats(weeklyData, user);
    const advice = ScoringService.generateWeeklyAdvice(weeklyData, user);
    
    return {
      stats,
      advice,
      data: weeklyData
    };
  }

  /**
   * Generate comprehensive monthly summary
   */
  static async generateMonthlySummary(user: User): Promise<{
    stats: MonthlyStats;
    advice: string;
    weeklyBreakdown: WeeklyStats[];
  }> {
    const { startDate, endDate } = TimeService.getLastNDaysRange(user.timezone, 30);
    const monthlyData = await supabaseService.getDailyEntriesForPeriod(user.user_id, startDate, endDate);
    
    // Split into weeks for trend analysis
    const weeksData: DailyEntry[][] = [];
    const weeklyBreakdown: WeeklyStats[] = [];
    
    for (let weekIndex = 0; weekIndex < 4; weekIndex++) {
      const weekStartDays = 7 * (3 - weekIndex); // 21, 14, 7, 0 days ago
      const weekEndDays = 7 * (2 - weekIndex); // 14, 7, 0, -7 days ago (but min 0)
      
      const { startDate: weekStart, endDate: weekEnd } = TimeService.getLastNDaysRange(
        user.timezone, 
        weekStartDays === 0 ? 7 : weekStartDays
      );
      
      const weekData = monthlyData.filter(day => {
        return day.day_local >= weekStart && 
               day.day_local <= (weekEndDays <= 0 ? endDate : 
                                TimeService.getLastNDaysRange(user.timezone, weekEndDays).endDate);
      });
      
      weeksData.push(weekData);
      weeklyBreakdown.push(ScoringService.calculateWeeklyStats(weekData, user));
    }
    
    const overallStats = ScoringService.calculateWeeklyStats(monthlyData, user);
    const trend = ScoringService.calculateTrend(weeksData);
    const advice = this.generateMonthlyAdvice(monthlyData, weeklyBreakdown, user);
    
    return {
      stats: {
        ...overallStats,
        trend,
        weeks_data: weeklyBreakdown
      },
      advice,
      weeklyBreakdown
    };
  }

  /**
   * Get today's summary with real-time aggregation
   */
  static async getTodaySummary(user: User): Promise<DailyEntry | null> {
    const todayDate = TimeService.getCurrentLocalDate(user.timezone);
    
    let dailyData = await supabaseService.getDailyEntry(user.user_id, todayDate);
    
    if (!dailyData) {
      // Try to aggregate from log entries
      const logEntries = await supabaseService.getLogEntriesForDay(user.user_id, todayDate);
      if (logEntries.length > 0) {
        const totals = logEntries.reduce((acc, entry) => ({
          calories: acc.calories + entry.calories,
          protein: acc.protein + entry.protein_g,
          fat: acc.fat + entry.fat_g,
          carbs: acc.carbs + entry.carbs_g,
          fiber: acc.fiber + entry.fiber_g,
        }), { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 });

        dailyData = {
          day_local: todayDate,
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

        dailyData.daily_score = ScoringService.calculateDailyScore(dailyData, user);
        
        // Save the aggregated data
        await supabaseService.upsertDailyEntry(dailyData);
      }
    }
    
    return dailyData;
  }

  /**
   * Generate monthly advice based on patterns and trends
   */
  private static generateMonthlyAdvice(
    monthlyData: DailyEntry[], 
    weeklyBreakdown: WeeklyStats[], 
    user: User
  ): string {
    const advice: string[] = [];
    
    if (monthlyData.length === 0) {
      return 'Начните регулярно отслеживать питание для получения персональных советов.';
    }
    
    // Analyze consistency
    const daysWithData = monthlyData.length;
    if (daysWithData < 20) {
      advice.push('Записывайте питание чаще для лучшей аналитики');
    }
    
    // Analyze trends
    if (weeklyBreakdown.length >= 2) {
      const recentWeek = weeklyBreakdown[weeklyBreakdown.length - 1];
      const previousWeek = weeklyBreakdown[weeklyBreakdown.length - 2];
      
      // Calorie trend
      if (recentWeek.avg_calories > previousWeek.avg_calories * 1.1) {
        advice.push('снизьте калорийность');
      } else if (recentWeek.avg_calories < previousWeek.avg_calories * 0.9) {
        advice.push('стабилизируйте калории');
      }
      
      // Protein trend
      if (recentWeek.avg_protein < previousWeek.avg_protein * 0.9) {
        advice.push('поддерживайте уровень белка');
      }
      
      // Fiber trend
      if (recentWeek.avg_fiber < user.fiber_goal_g * 0.6) {
        advice.push('добавьте клетчатки');
      }
    }
    
    // Overall performance
    const overallStats = ScoringService.calculateWeeklyStats(monthlyData, user);
    if (overallStats.avg_daily_score > 7) {
      advice.push('отличная работа, продолжайте');
    } else if (overallStats.avg_daily_score < 5) {
      advice.push('сосредоточьтесь на балансе БЖУ');
    }
    
    if (advice.length === 0) {
      advice.push('поддерживайте текущий ритм питания');
    }
    
    return advice.slice(0, 2).join(', ') + '.';
  }

  /**
   * Get streak information (consecutive days with data)
   */
  static async getStreakInfo(user: User): Promise<{
    currentStreak: number;
    longestStreak: number;
    lastActiveDate: string | null;
  }> {
    const { startDate } = TimeService.getLastNDaysRange(user.timezone, 60); // Look back 60 days
    const endDate = TimeService.getCurrentLocalDate(user.timezone);
    
    const data = await supabaseService.getDailyEntriesForPeriod(user.user_id, startDate, endDate);
    
    if (data.length === 0) {
      return { currentStreak: 0, longestStreak: 0, lastActiveDate: null };
    }
    
    // Sort by date
    data.sort((a, b) => a.day_local.localeCompare(b.day_local));
    
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;
    let lastActiveDate = data[data.length - 1].day_local;
    
    // Calculate current streak (from today backwards)
    const today = TimeService.getCurrentLocalDate(user.timezone);
    let checkDate = new Date(today + 'T00:00:00');
    
    while (true) {
      const dateStr = checkDate.toISOString().split('T')[0];
      const hasData = data.some(d => d.day_local === dateStr && d.meals_count > 0);
      
      if (hasData) {
        currentStreak++;
      } else {
        break;
      }
      
      checkDate.setDate(checkDate.getDate() - 1);
      
      // Don't go back more than 60 days
      if (currentStreak > 60) break;
    }
    
    // Calculate longest streak
    let previousDate: Date | null = null;
    
    for (const entry of data) {
      if (entry.meals_count > 0) {
        const entryDate = new Date(entry.day_local + 'T00:00:00');
        
        if (previousDate && 
            entryDate.getTime() - previousDate.getTime() === 24 * 60 * 60 * 1000) {
          tempStreak++;
        } else {
          tempStreak = 1;
        }
        
        longestStreak = Math.max(longestStreak, tempStreak);
        previousDate = entryDate;
      } else {
        tempStreak = 0;
      }
    }
    
    return {
      currentStreak,
      longestStreak,
      lastActiveDate
    };
  }

  /**
   * Generate motivational message based on progress
   */
  static generateMotivationalMessage(
    user: User, 
    todayData: DailyEntry | null,
    streakInfo: { currentStreak: number; longestStreak: number }
  ): string {
    const messages = [];
    
    if (streakInfo.currentStreak >= 7) {
      messages.push(`🔥 Отличная серия: ${streakInfo.currentStreak} дней подряд!`);
    } else if (streakInfo.currentStreak >= 3) {
      messages.push(`💪 Хорошая серия: ${streakInfo.currentStreak} дня подряд!`);
    }
    
    if (todayData) {
      const calorieProgress = todayData.calories_sum / user.cal_goal;
      if (calorieProgress >= 0.85 && calorieProgress <= 1.15) {
        messages.push('🎯 Отлично попадаете в цель по калориям!');
      }
      
      if (todayData.protein_sum >= user.protein_goal_g) {
        messages.push('💪 Белок на высоте!');
      }
      
      if (todayData.daily_score >= 8) {
        messages.push('⭐ Превосходный день по питанию!');
      }
    }
    
    if (messages.length === 0) {
      messages.push('📈 Продолжайте отслеживать питание для достижения целей!');
    }
    
    return messages.join(' ');
  }
}
