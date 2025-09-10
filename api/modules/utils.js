// Utility Functions - Scoring, calculations, and helpers

// Calculate meal score with professional dietitian approach
export function calculateMealScore(nutrition, userContext = null) {
  // Detect beverage/low-calorie items
  const isLowCalorieBeverage = nutrition.calories <= 50 && nutrition.protein_g <= 2 && nutrition.fat_g <= 1;
  const isProteinDrink = nutrition.calories <= 200 && nutrition.protein_g >= 15; // protein shake, etc.
  
  // Special scoring for beverages
  if (isLowCalorieBeverage) {
    return calculateBeverageScore(nutrition, userContext);
  }
  
  let score = 0;
  
  // Base scoring if no user context
  if (!userContext) {
    return calculateBasicMealScore(nutrition);
  }
  
  const dailyGoals = userContext.goals;
  const expectedMealsPerDay = 3;
  const targetCaloriesPerMeal = dailyGoals.cal_goal / expectedMealsPerDay;
  const targetProteinPerMeal = dailyGoals.protein_goal_g / expectedMealsPerDay;
  const targetFiberPerMeal = dailyGoals.fiber_goal_g / expectedMealsPerDay;
  
  // For protein drinks, adjust expectations
  if (isProteinDrink) {
    targetCaloriesPerMeal = targetCaloriesPerMeal * 0.6; // Expect smaller calorie load
  }
  
  // Protein scoring (0-3 points) - professional standards
  const proteinRatio = nutrition.protein_g / targetProteinPerMeal;
  if (proteinRatio >= 1.2) score += 3;       // 120%+ = excellent
  else if (proteinRatio >= 0.8) score += 2.5; // 80-120% = very good
  else if (proteinRatio >= 0.5) score += 2;   // 50-80% = good
  else if (proteinRatio >= 0.25) score += 1;  // 25-50% = acceptable
  else score += 0.5; // <25% = minimal credit
  
  // Calorie scoring (0-2.5 points) - realistic portion assessment
  const calorieRatio = nutrition.calories / targetCaloriesPerMeal;
  if (calorieRatio >= 0.7 && calorieRatio <= 1.3) score += 2.5; // 70-130% = optimal
  else if (calorieRatio >= 0.5 && calorieRatio <= 1.6) score += 2; // 50-160% = good
  else if (calorieRatio >= 0.3 && calorieRatio <= 2.0) score += 1; // 30-200% = acceptable
  else score += 0.5; // Extreme portions = minimal credit
  
  // Fiber scoring (0-2 points) - realistic expectations
  const fiberRatio = nutrition.fiber_g / targetFiberPerMeal;
  if (fiberRatio >= 1.0) score += 2;         // 100%+ = excellent
  else if (fiberRatio >= 0.5) score += 1.5;  // 50-100% = very good
  else if (fiberRatio >= 0.25) score += 1;   // 25-50% = good
  else if (fiberRatio >= 0.1) score += 0.5;  // 10-25% = some credit
  // No points for very low fiber, but no penalty
  
  // Macro balance assessment (0-1.5 points)
  const proteinCal = nutrition.protein_g * 4;
  const fatCal = nutrition.fat_g * 9;
  const carbsCal = nutrition.carbs_g * 4;
  const totalMacroCal = proteinCal + fatCal + carbsCal;
  
  if (totalMacroCal > 0) {
    const proteinPercent = proteinCal / totalMacroCal;
    const fatPercent = fatCal / totalMacroCal;
    
    // Professional macro distribution standards
    if (proteinPercent >= 0.25 && fatPercent >= 0.15 && fatPercent <= 0.45) {
      score += 1.5; // Excellent balance
    } else if (proteinPercent >= 0.15 && fatPercent >= 0.10 && fatPercent <= 0.50) {
      score += 1; // Good balance
    } else if (proteinPercent >= 0.10) {
      score += 0.5; // Acceptable protein
    }
  }
  
  // Nutritional density bonus (0-1 points)
  const nutrientDensity = (nutrition.protein_g + nutrition.fiber_g * 2) / (nutrition.calories / 100);
  if (nutrientDensity >= 8) score += 1;      // High nutrient density
  else if (nutrientDensity >= 5) score += 0.5; // Good nutrient density
  
  // Apply confidence factor (0.85-1.0 multiplier)
  score *= (0.85 + nutrition.confidence * 0.15);
  
  return Math.max(1, Math.min(10, Math.round(score * 10) / 10));
}

// Special scoring for beverages (coffee, tea, water, etc.)
export function calculateBeverageScore(nutrition, userContext) {
  const foodName = nutrition.food_name?.toLowerCase() || '';
  
  // Healthy zero-calorie beverages
  if (nutrition.calories <= 10 && (
    foodName.includes('coffee') || 
    foodName.includes('tea') || 
    foodName.includes('water') ||
    foodName.includes('americano') ||
    foodName.includes('espresso')
  )) {
    return 7.5; // Good choice - hydration without calories
  }
  
  // Low-calorie beverages (10-50 calories)
  if (nutrition.calories <= 50) {
    if (nutrition.protein_g >= 5) return 8.0; // Protein drink
    if (nutrition.calories <= 25) return 7.0; // Very low calorie
    return 6.0; // Low calorie beverage
  }
  
  // Medium calorie beverages (50-150 calories)
  if (nutrition.calories <= 150) {
    if (nutrition.protein_g >= 10) return 7.5; // Good protein drink
    if (nutrition.protein_g >= 5) return 6.5;  // Some protein
    if (nutrition.calories <= 100) return 5.5; // Moderate calories
    return 4.5; // Higher calorie, low nutrition
  }
  
  // High calorie beverages (150+ calories) - treat as snack
  return calculateBasicMealScore(nutrition);
}

// Basic meal score for fallback (professional standards)
export function calculateBasicMealScore(nutrition) {
  let score = 0;
  
  // Protein scoring (0-3 points) - professional standards
  if (nutrition.protein_g >= 25) score += 3;      // Excellent protein
  else if (nutrition.protein_g >= 18) score += 2.5; // Very good protein
  else if (nutrition.protein_g >= 12) score += 2;   // Good protein
  else if (nutrition.protein_g >= 6) score += 1;    // Acceptable protein
  else score += 0.5; // Minimal protein
  
  // Calorie scoring (0-2.5 points)
  if (nutrition.calories >= 250 && nutrition.calories <= 600) score += 2.5; // Optimal meal size
  else if (nutrition.calories >= 150 && nutrition.calories <= 800) score += 2; // Good meal size
  else if (nutrition.calories >= 100 && nutrition.calories <= 1000) score += 1; // Acceptable
  else score += 0.5; // Extreme sizes
  
  // Fiber scoring (0-2 points)
  if (nutrition.fiber_g >= 8) score += 2;       // Excellent fiber
  else if (nutrition.fiber_g >= 5) score += 1.5; // Very good fiber
  else if (nutrition.fiber_g >= 3) score += 1;   // Good fiber
  else if (nutrition.fiber_g >= 1) score += 0.5; // Some fiber
  
  // Macro balance (0-1.5 points)
  const proteinCal = nutrition.protein_g * 4;
  const fatCal = nutrition.fat_g * 9;
  const totalCal = nutrition.calories;
  
  if (totalCal > 0) {
    const proteinPercent = proteinCal / totalCal;
    const fatPercent = fatCal / totalCal;
    
    if (proteinPercent >= 0.20 && fatPercent >= 0.15 && fatPercent <= 0.45) {
      score += 1.5; // Excellent balance
    } else if (proteinPercent >= 0.12 && fatPercent >= 0.10 && fatPercent <= 0.50) {
      score += 1; // Good balance
    } else if (proteinPercent >= 0.08) {
      score += 0.5; // Some protein
    }
  }
  
  // Nutritional density (0-1 points)
  const nutrientDensity = (nutrition.protein_g + nutrition.fiber_g * 2) / (nutrition.calories / 100);
  if (nutrientDensity >= 6) score += 1;
  else if (nutrientDensity >= 4) score += 0.5;
  
  return Math.max(2, Math.min(10, Math.round(score * 10) / 10)); // Minimum 2.0, max 10
}

// Get professional score explanation 
export function getScoreExplanation(nutrition, userContext) {
  const score = nutrition.score;
  const isLowCalorieBeverage = nutrition.calories <= 50 && nutrition.protein_g <= 2 && nutrition.fat_g <= 1;
  
  // Special explanations for beverages
  if (isLowCalorieBeverage) {
    if (score >= 7.0) return '(great beverage choice)';
    if (score >= 6.0) return '(good hydration option)';
    return '(adequate beverage)';
  }
  
  if (!userContext || !userContext.hasProfile) {
    // Basic professional explanation
    if (score >= 8.5) return '(excellent nutritional profile)';
    if (score >= 7.5) return '(very good nutrition)';
    if (score >= 6.5) return '(good meal choice)';
    if (score >= 5.5) return '(adequate nutrition)';
    if (score >= 4.0) return '(below optimal)';
    return '(needs improvement)';
  }
  
  // Personalized professional assessment
  const dailyGoals = userContext.goals;
  const targetProteinPerMeal = dailyGoals.protein_goal_g / 3;
  const targetCaloriesPerMeal = dailyGoals.cal_goal / 3;
  const targetFiberPerMeal = dailyGoals.fiber_goal_g / 3;
  
  const proteinRatio = nutrition.protein_g / targetProteinPerMeal;
  const calorieRatio = nutrition.calories / targetCaloriesPerMeal;
  const fiberRatio = nutrition.fiber_g / targetFiberPerMeal;
  
  // Professional dietitian assessment
  if (score >= 8.5) {
    return '(excellent for your goals)';
  } else if (score >= 7.5) {
    return '(very good choice)';
  } else if (score >= 6.5) {
    return '(good nutrition)';
  } else if (score >= 5.5) {
    return '(adequate meal)';
  } else if (score >= 4.5) {
    // Identify the main issue professionally
    if (proteinRatio < 0.4) return '(low protein content)';
    if (calorieRatio > 1.8) return '(high calorie density)';
    if (calorieRatio < 0.4) return '(light meal)';
    return '(unbalanced macros)';
  } else {
    return '(needs nutritional improvement)';
  }
}
