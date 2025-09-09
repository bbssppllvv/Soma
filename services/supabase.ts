import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { User, LogEntry, DailyEntry } from '../types';

// Database types matching our schema
interface DatabaseUser {
  id: string;
  telegram_user_id: number;
  display_name: string;
  timezone: string;
  cal_goal: number;
  protein_goal_g: number;
  fiber_goal_g: number;
  first_seen_utc: string;
  last_seen_utc: string;
  daily_digest_time: string;
}

interface DatabaseEntry {
  id: string;
  user_id: string;
  timestamp_utc: string;
  day_local: string;
  chat_id: number;
  message_id: number;  // Your schema uses message_id instead of msg_id
  text?: string;
  photo_file_id?: string;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  fiber_g: number;
  score_item: number;
  confidence: number;
  advice_short?: string;
  raw_model_json?: any;
}

interface DatabaseDaily {
  user_id: string;
  day_local: string;
  calories_sum: number;
  protein_sum: number;
  fat_sum: number;
  carbs_sum: number;
  fiber_sum: number;
  meals_count: number;
  daily_score: number;
  notes?: string;
}

class SupabaseService {
  private supabase: SupabaseClient;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase environment variables');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }

  // Users operations
  async getUser(telegramUserId: number): Promise<User | null> {
    try {
      const { data, error } = await this.supabase
        .from('users')
        .select('*')
        .eq('telegram_user_id', telegramUserId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned
          return null;
        }
        throw error;
      }

      return this.mapDatabaseUserToUser(data as DatabaseUser);
    } catch (error) {
      console.error('Error getting user:', error);
      return null;
    }
  }

  async createOrUpdateUser(user: Partial<User> & { user_id: number }): Promise<void> {
    try {
      const existingUser = await this.getUser(user.user_id);
      const now = new Date().toISOString();

      if (existingUser) {
        // Update existing user
        const updateData: Partial<DatabaseUser> = {
          display_name: user.display_name || existingUser.display_name,
          timezone: user.timezone || existingUser.timezone,
          cal_goal: user.cal_goal || existingUser.cal_goal,
          protein_goal_g: user.protein_goal_g || existingUser.protein_goal_g,
          fiber_goal_g: user.fiber_goal_g || existingUser.fiber_goal_g,
          last_seen_utc: now,
          daily_digest_time: user.daily_digest_time || existingUser.daily_digest_time,
        };

        const { error } = await this.supabase
          .from('users')
          .update(updateData)
          .eq('telegram_user_id', user.user_id);

        if (error) throw error;
      } else {
        // Create new user
        const insertData: Omit<DatabaseUser, 'id'> = {
          telegram_user_id: user.user_id,
          display_name: user.display_name || 'User',
          timezone: user.timezone || 'Europe/Madrid',
          cal_goal: user.cal_goal || 1800,
          protein_goal_g: user.protein_goal_g || 120,
          fiber_goal_g: user.fiber_goal_g || 25,
          first_seen_utc: now,
          last_seen_utc: now,
          daily_digest_time: user.daily_digest_time || '21:30',
        };

        const { error } = await this.supabase
          .from('users')
          .insert(insertData);

        if (error) throw error;
      }
    } catch (error) {
      console.error('Error creating/updating user:', error);
      throw error;
    }
  }

  // Entries operations
  async addLogEntry(entry: LogEntry): Promise<void> {
    try {
      // First get the user's UUID
      const user = await this.getUser(entry.user_id);
      if (!user) {
        throw new Error(`User ${entry.user_id} not found`);
      }

      const { data: userData } = await this.supabase
        .from('users')
        .select('id')
        .eq('telegram_user_id', entry.user_id)
        .single();

      if (!userData) {
        throw new Error(`User UUID not found for telegram_user_id ${entry.user_id}`);
      }

      const insertData: Omit<DatabaseEntry, 'id'> = {
        user_id: userData.id,
        timestamp_utc: entry.timestamp_utc,
        day_local: entry.day_local,
        chat_id: entry.chat_id,
        message_id: entry.msg_id,  // Map msg_id to message_id
        text: entry.text || null,
        photo_file_id: entry.photo_file_id || null,
        calories: entry.calories,
        protein_g: entry.protein_g,
        fat_g: entry.fat_g,
        carbs_g: entry.carbs_g,
        fiber_g: entry.fiber_g,
        score_item: entry.score_item,
        confidence: entry.confidence,
        advice_short: entry.advice_short || null,
        raw_model_json: entry.raw_model_json ? JSON.parse(entry.raw_model_json) : null,
      };

      const { error } = await this.supabase
        .from('entries')
        .insert(insertData);

      if (error) throw error;
    } catch (error) {
      console.error('Error adding log entry:', error);
      throw error;
    }
  }

  async getLogEntriesForDay(telegramUserId: number, dayLocal: string): Promise<LogEntry[]> {
    try {
      const { data: userData } = await this.supabase
        .from('users')
        .select('id')
        .eq('telegram_user_id', telegramUserId)
        .single();

      if (!userData) return [];

      const { data, error } = await this.supabase
        .from('entries')
        .select('*')
        .eq('user_id', userData.id)
        .eq('day_local', dayLocal)
        .order('timestamp_utc', { ascending: true });

      if (error) throw error;

      return (data as DatabaseEntry[]).map(this.mapDatabaseEntryToLogEntry);
    } catch (error) {
      console.error('Error getting log entries:', error);
      return [];
    }
  }

  // Daily operations
  async getDailyEntry(telegramUserId: number, dayLocal: string): Promise<DailyEntry | null> {
    try {
      const { data: userData } = await this.supabase
        .from('users')
        .select('id')
        .eq('telegram_user_id', telegramUserId)
        .single();

      if (!userData) return null;

      const { data, error } = await this.supabase
        .from('daily')
        .select('*')
        .eq('user_id', userData.id)
        .eq('day_local', dayLocal)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }

      return this.mapDatabaseDailyToDailyEntry(data as DatabaseDaily, telegramUserId);
    } catch (error) {
      console.error('Error getting daily entry:', error);
      return null;
    }
  }

  async upsertDailyEntry(entry: DailyEntry): Promise<void> {
    try {
      const { data: userData } = await this.supabase
        .from('users')
        .select('id')
        .eq('telegram_user_id', entry.user_id)
        .single();

      if (!userData) {
        throw new Error(`User ${entry.user_id} not found`);
      }

      const upsertData: Omit<DatabaseDaily, never> = {
        user_id: userData.id,
        day_local: entry.day_local,
        calories_sum: entry.calories_sum,
        protein_sum: entry.protein_sum,
        fat_sum: entry.fat_sum,
        carbs_sum: entry.carbs_sum,
        fiber_sum: entry.fiber_sum,
        meals_count: entry.meals_count,
        daily_score: entry.daily_score,
        notes: entry.notes || null,
      };

      const { error } = await this.supabase
        .from('daily')
        .upsert(upsertData, {
          onConflict: 'user_id,day_local'
        });

      if (error) throw error;
    } catch (error) {
      console.error('Error upserting daily entry:', error);
      throw error;
    }
  }

  async getDailyEntriesForPeriod(telegramUserId: number, startDate: string, endDate: string): Promise<DailyEntry[]> {
    try {
      const { data: userData } = await this.supabase
        .from('users')
        .select('id')
        .eq('telegram_user_id', telegramUserId)
        .single();

      if (!userData) return [];

      const { data, error } = await this.supabase
        .from('daily')
        .select('*')
        .eq('user_id', userData.id)
        .gte('day_local', startDate)
        .lte('day_local', endDate)
        .order('day_local', { ascending: true });

      if (error) throw error;

      return (data as DatabaseDaily[]).map(daily => 
        this.mapDatabaseDailyToDailyEntry(daily, telegramUserId)
      );
    } catch (error) {
      console.error('Error getting daily entries for period:', error);
      return [];
    }
  }

  async getAllUsersForDigest(): Promise<User[]> {
    try {
      const { data, error } = await this.supabase
        .from('users')
        .select('*')
        .eq('silent_mode', false);

      if (error) throw error;

      return (data as DatabaseUser[]).map(this.mapDatabaseUserToUser);
    } catch (error) {
      console.error('Error getting all users:', error);
      return [];
    }
  }

  async deleteUserData(telegramUserId: number): Promise<void> {
    try {
      const { data: userData } = await this.supabase
        .from('users')
        .select('id')
        .eq('telegram_user_id', telegramUserId)
        .single();

      if (!userData) return;

      // Delete user (cascades to entries and daily due to foreign key constraints)
      const { error } = await this.supabase
        .from('users')
        .delete()
        .eq('id', userData.id);

      if (error) throw error;
    } catch (error) {
      console.error('Error deleting user data:', error);
      throw error;
    }
  }

  // Helper mapping functions
  private mapDatabaseUserToUser(dbUser: DatabaseUser): User {
    return {
      user_id: dbUser.telegram_user_id,
      display_name: dbUser.display_name,
      timezone: dbUser.timezone,
      cal_goal: dbUser.cal_goal,
      protein_goal_g: dbUser.protein_goal_g,
      fiber_goal_g: dbUser.fiber_goal_g,
      first_seen_utc: dbUser.first_seen_utc,
      last_seen_utc: dbUser.last_seen_utc,
      silent_mode: false, // Default since not in your schema
      daily_digest_time: dbUser.daily_digest_time,
    };
  }

  private mapDatabaseEntryToLogEntry(dbEntry: DatabaseEntry): LogEntry {
    return {
      timestamp_utc: dbEntry.timestamp_utc,
      day_local: dbEntry.day_local,
      user_id: 0, // Will be filled by caller
      chat_id: dbEntry.chat_id,
      msg_id: dbEntry.message_id,  // Map message_id back to msg_id
      text: dbEntry.text || undefined,
      photo_file_id: dbEntry.photo_file_id || undefined,
      photo_note: undefined, // Not in your schema
      calories: Number(dbEntry.calories),
      protein_g: Number(dbEntry.protein_g),
      fat_g: Number(dbEntry.fat_g),
      carbs_g: Number(dbEntry.carbs_g),
      fiber_g: Number(dbEntry.fiber_g),
      score_item: Number(dbEntry.score_item),
      confidence: Number(dbEntry.confidence),
      advice_short: dbEntry.advice_short || '',
      raw_model_json: dbEntry.raw_model_json ? JSON.stringify(dbEntry.raw_model_json) : '',
    };
  }

  private mapDatabaseDailyToDailyEntry(dbDaily: DatabaseDaily, telegramUserId: number): DailyEntry {
    return {
      day_local: dbDaily.day_local,
      user_id: telegramUserId,
      calories_sum: Number(dbDaily.calories_sum),
      protein_sum: Number(dbDaily.protein_sum),
      fat_sum: Number(dbDaily.fat_sum),
      carbs_sum: Number(dbDaily.carbs_sum),
      fiber_sum: Number(dbDaily.fiber_sum),
      meals_count: dbDaily.meals_count,
      daily_score: Number(dbDaily.daily_score),
      notes: dbDaily.notes || '',
    };
  }

  // Health check method
  async healthCheck(): Promise<{ status: string; users: number }> {
    try {
      const { count, error } = await this.supabase
        .from('users')
        .select('*', { count: 'exact', head: true });

      if (error) throw error;

      return {
        status: 'healthy',
        users: count || 0
      };
    } catch (error) {
      console.error('Supabase health check failed:', error);
      return {
        status: 'unhealthy',
        users: 0
      };
    }
  }
}

export const supabaseService = new SupabaseService();
