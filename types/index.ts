export interface User {
  user_id: number;
  display_name: string;
  timezone: string;
  cal_goal: number;
  protein_goal_g: number;
  fiber_goal_g: number;
  first_seen_utc: string;
  last_seen_utc: string;
  silent_mode: boolean;
  daily_digest_time: string; // HH:mm format
}

export interface LogEntry {
  timestamp_utc: string;
  day_local: string; // YYYY-MM-DD format
  user_id: number;
  chat_id: number;
  msg_id: number;
  text?: string;
  photo_file_id?: string;
  photo_note?: string;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  fiber_g: number;
  score_item: number; // 0-10
  confidence: number; // 0-1
  advice_short: string;
  raw_model_json: string;
}

export interface DailyEntry {
  day_local: string; // YYYY-MM-DD format
  user_id: number;
  calories_sum: number;
  protein_sum: number;
  fat_sum: number;
  carbs_sum: number;
  fiber_sum: number;
  meals_count: number;
  daily_score: number; // 0-10
  notes: string;
}

export interface NutritionAnalysis {
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  fiber_g: number;
  confidence: number; // 0-1
  advice_short: string;
}

export interface WeeklyStats {
  days_count: number;
  avg_calories: number;
  avg_protein: number;
  avg_fiber: number;
  days_in_cal_range: number;
  days_protein_met: number;
  days_fiber_met: number;
  avg_daily_score: number;
}

export interface MonthlyStats extends WeeklyStats {
  weeks_data: WeeklyStats[];
  trend: 'improving' | 'declining' | 'stable';
}

export interface TelegramMessage {
  message_id: number;
  from: {
    id: number;
    first_name: string;
    username?: string;
  };
  chat: {
    id: number;
  };
  date: number;
  text?: string;
  caption?: string;
  photo?: Array<{
    file_id: string;
    width: number;
    height: number;
    file_size?: number;
  }>;
}
