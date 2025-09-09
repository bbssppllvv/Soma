import { User, LogEntry, DailyEntry, NutritionAnalysis } from '../types';

export class ScoringService {
  /**
   * Calculate score for a single meal (0-10)
   * Based on protein contribution, fiber content, and calorie appropriateness
   */
  static calculateMealScore(
    nutrition: NutritionAnalysis,
    user: User,
    isFirstMealOfDay: boolean = false
  ): number {
    let score = 0;

    // Protein score (up to 4 points)
    // Higher score for meals that contribute well to daily protein goal
    const proteinTargetPerMeal = user.protein_goal_g * 0.5; // Assuming 2 main meals
    const proteinScore = Math.min(4, (nutrition.protein_g / proteinTargetPerMeal) * 4);
    score += proteinScore;

    // Fiber score (up to 3 points)
    // Good fiber content gets rewarded
    const fiberTargetPerMeal = user.fiber_goal_g * 0.4; // 40% of daily fiber in one meal is excellent
    const fiberScore = Math.min(3, (nutrition.fiber_g / fiberTargetPerMeal) * 3);
    score += fiberScore;

    // Calorie appropriateness (up to 3 points)
    // Ideal meal is 15-30% of daily calories
    const caloriePercentage = nutrition.calories / user.cal_goal;
    let calorieScore = 0;

    if (caloriePercentage >= 0.15 && caloriePercentage <= 0.35) {
      // Perfect range
      calorieScore = 3;
    } else if (caloriePercentage >= 0.10 && caloriePercentage <= 0.45) {
      // Good range
      calorieScore = 2;
    } else if (caloriePercentage >= 0.05 && caloriePercentage <= 0.55) {
      // Acceptable range
      calorieScore = 1;
    } else if (caloriePercentage > 0.55) {
      // Penalty for very large meals
      calorieScore = Math.max(0, 1 - (caloriePercentage - 0.55) * 2);
    }

    score += calorieScore;

    // Confidence penalty - reduce score if AI is not confident
    const confidenceMultiplier = 0.5 + (nutrition.confidence * 0.5); // Range: 0.5 to 1.0
    score *= confidenceMultiplier;

    return Math.max(0, Math.min(10, score));
  }

  /**
   * Calculate daily score (0-10)
   * Based on calorie target achievement, protein goal, and fiber goal
   */
  static calculateDailyScore(dailyData: DailyEntry, user: User): number {
    let score = 0;

    // Calorie score (up to 5 points)
    // Best score for staying within 85-105% of goal
    const calorieRatio = dailyData.calories_sum / user.cal_goal;
    let calorieScore = 0;

    if (calorieRatio >= 0.85 && calorieRatio <= 1.05) {
      // Perfect range
      calorieScore = 5;
    } else if (calorieRatio >= 0.75 && calorieRatio <= 1.15) {
      // Good range
      calorieScore = 4;
    } else if (calorieRatio >= 0.65 && calorieRatio <= 1.25) {
      // Acceptable range
      calorieScore = 3;
    } else if (calorieRatio >= 0.50 && calorieRatio <= 1.40) {
      // Poor range
      calorieScore = 2;
    } else {
      // Very poor range
      calorieScore = 1;
    }

    score += calorieScore;

    // Protein score (up to 3 points)
    const proteinRatio = Math.min(1.5, dailyData.protein_sum / user.protein_goal_g); // Cap at 150%
    const proteinScore = Math.min(3, proteinRatio * 3);
    score += proteinScore;

    // Fiber score (up to 2 points)
    const fiberRatio = Math.min(1.5, dailyData.fiber_sum / user.fiber_goal_g); // Cap at 150%
    const fiberScore = Math.min(2, fiberRatio * 2);
    score += fiberScore;

    return Math.max(0, Math.min(10, score));
  }

  /**
   * Get contextual advice based on recent eating patterns
   */
  static generateContextualAdvice(
    currentMeal: NutritionAnalysis,
    todaysSoFar: DailyEntry | null,
    recentDays: DailyEntry[],
    user: User
  ): string {
    const advice: string[] = [];

    // Check today's progress
    if (todaysSoFar) {
      const caloriesWithCurrent = todaysSoFar.calories_sum + currentMeal.calories;
      const proteinWithCurrent = todaysSoFar.protein_sum + currentMeal.protein_g;
      const fiberWithCurrent = todaysSoFar.fiber_sum + currentMeal.fiber_g;

      // Calorie guidance
      const calorieProgress = caloriesWithCurrent / user.cal_goal;
      if (calorieProgress > 1.1) {
        advice.push('Калорий много на сегодня');
      } else if (calorieProgress < 0.6 && todaysSoFar.meals_count >= 2) {
        advice.push('Добавьте калорий до ужина');
      }

      // Protein guidance
      if (proteinWithCurrent >= user.protein_goal_g) {
        advice.push('Белок отлично');
      } else if (proteinWithCurrent < user.protein_goal_g * 0.7) {
        advice.push('Добавьте белок');
      }

      // Fiber guidance
      if (fiberWithCurrent < user.fiber_goal_g * 0.5) {
        advice.push('Нужно больше клетчатки');
      }
    }

    // Check recent patterns
    if (recentDays.length > 0) {
      const avgFiber = recentDays.reduce((sum, day) => sum + day.fiber_sum, 0) / recentDays.length;
      const avgProtein = recentDays.reduce((sum, day) => sum + day.protein_sum, 0) / recentDays.length;

      if (avgFiber < user.fiber_goal_g * 0.6) {
        advice.push('Добавьте овощей/фруктов');
      }

      if (avgProtein < user.protein_goal_g * 0.8) {
        advice.push('Больше белка в рацион');
      }
    }

    // Current meal assessment
    if (currentMeal.protein_g > 25) {
      advice.push('Хороший белковый приём');
    }

    if (currentMeal.fiber_g > 8) {
      advice.push('Отлично по клетчатке');
    }

    // Default positive message if no specific advice
    if (advice.length === 0) {
      advice.push('Хороший выбор');
    }

    return advice.slice(0, 2).join(', ') + '.';
  }

  /**
   * Calculate weekly statistics
   */
  static calculateWeeklyStats(weeklyData: DailyEntry[], user: User) {
    if (weeklyData.length === 0) {
      return {
        days_count: 0,
        avg_calories: 0,
        avg_protein: 0,
        avg_fiber: 0,
        days_in_cal_range: 0,
        days_protein_met: 0,
        days_fiber_met: 0,
        avg_daily_score: 0,
      };
    }

    const totalCalories = weeklyData.reduce((sum, day) => sum + day.calories_sum, 0);
    const totalProtein = weeklyData.reduce((sum, day) => sum + day.protein_sum, 0);
    const totalFiber = weeklyData.reduce((sum, day) => sum + day.fiber_sum, 0);
    const totalScore = weeklyData.reduce((sum, day) => sum + day.daily_score, 0);

    const daysInCalRange = weeklyData.filter(day => {
      const ratio = day.calories_sum / user.cal_goal;
      return ratio >= 0.85 && ratio <= 1.15;
    }).length;

    const daysProteinMet = weeklyData.filter(day => 
      day.protein_sum >= user.protein_goal_g
    ).length;

    const daysFiberMet = weeklyData.filter(day => 
      day.fiber_sum >= user.fiber_goal_g
    ).length;

    return {
      days_count: weeklyData.length,
      avg_calories: Math.round(totalCalories / weeklyData.length),
      avg_protein: Math.round(totalProtein / weeklyData.length),
      avg_fiber: Math.round(totalFiber / weeklyData.length),
      days_in_cal_range: daysInCalRange,
      days_protein_met: daysProteinMet,
      days_fiber_met: daysFiberMet,
      avg_daily_score: Math.round((totalScore / weeklyData.length) * 10) / 10,
    };
  }

  /**
   * Generate weekly advice based on patterns
   */
  static generateWeeklyAdvice(weeklyData: DailyEntry[], user: User): string {
    const stats = this.calculateWeeklyStats(weeklyData, user);
    
    if (stats.days_count === 0) {
      return 'Начните записывать приёмы пищи для анализа.';
    }

    const advice: string[] = [];

    // Calorie consistency
    if (stats.days_in_cal_range / stats.days_count >= 0.7) {
      advice.push('Отличная калорийность');
    } else {
      advice.push('Стабилизируйте калории');
    }

    // Protein achievement
    if (stats.days_protein_met / stats.days_count >= 0.6) {
      advice.push('белок хорошо');
    } else {
      advice.push('добавьте белка');
    }

    // Fiber achievement
    if (stats.days_fiber_met / stats.days_count < 0.5) {
      advice.push('больше клетчатки');
    }

    return advice.join(', ') + '.';
  }

  /**
   * Determine trend from weekly data
   */
  static calculateTrend(weeksData: DailyEntry[][]): 'improving' | 'declining' | 'stable' {
    if (weeksData.length < 2) return 'stable';

    const weekScores = weeksData.map(week => {
      const totalScore = week.reduce((sum, day) => sum + day.daily_score, 0);
      return week.length > 0 ? totalScore / week.length : 0;
    });

    const firstHalf = weekScores.slice(0, Math.floor(weekScores.length / 2));
    const secondHalf = weekScores.slice(Math.floor(weekScores.length / 2));

    const firstHalfAvg = firstHalf.reduce((sum, score) => sum + score, 0) / firstHalf.length;
    const secondHalfAvg = secondHalf.reduce((sum, score) => sum + score, 0) / secondHalf.length;

    const difference = secondHalfAvg - firstHalfAvg;

    if (difference > 0.3) return 'improving';
    if (difference < -0.3) return 'declining';
    return 'stable';
  }
}
