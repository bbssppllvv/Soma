import { google, sheets_v4 } from 'googleapis';
import { User, LogEntry, DailyEntry } from '../types';

class SheetsService {
  private sheets: sheets_v4.Sheets;
  private spreadsheetId: string;

  constructor() {
    const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth });
    this.spreadsheetId = process.env.SHEET_ID || '';
  }

  // Users sheet operations
  async getUser(userId: number): Promise<User | null> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'users!A:J',
      });

      const rows = response.data.values || [];
      const userRow = rows.find(row => parseInt(row[0]) === userId);
      
      if (!userRow) return null;

      return {
        user_id: parseInt(userRow[0]),
        display_name: userRow[1] || '',
        timezone: userRow[2] || 'Europe/Madrid',
        cal_goal: parseInt(userRow[3]) || 1800,
        protein_goal_g: parseInt(userRow[4]) || 120,
        fiber_goal_g: parseInt(userRow[5]) || 25,
        first_seen_utc: userRow[6] || '',
        last_seen_utc: userRow[7] || '',
        silent_mode: userRow[8] === 'TRUE',
        daily_digest_time: userRow[9] || '21:30',
      };
    } catch (error) {
      console.error('Error getting user:', error);
      return null;
    }
  }

  async createOrUpdateUser(user: Partial<User> & { user_id: number }): Promise<void> {
    try {
      const existingUser = await this.getUser(user.user_id);
      const now = new Date().toISOString();

      const userData = {
        user_id: user.user_id,
        display_name: user.display_name || existingUser?.display_name || 'User',
        timezone: user.timezone || existingUser?.timezone || 'Europe/Madrid',
        cal_goal: user.cal_goal || existingUser?.cal_goal || 1800,
        protein_goal_g: user.protein_goal_g || existingUser?.protein_goal_g || 120,
        fiber_goal_g: user.fiber_goal_g || existingUser?.fiber_goal_g || 25,
        first_seen_utc: existingUser?.first_seen_utc || now,
        last_seen_utc: now,
        silent_mode: user.silent_mode !== undefined ? user.silent_mode : (existingUser?.silent_mode || false),
        daily_digest_time: user.daily_digest_time || existingUser?.daily_digest_time || '21:30',
      };

      if (existingUser) {
        // Update existing user
        await this.updateUserRow(userData);
      } else {
        // Create new user
        await this.sheets.spreadsheets.values.append({
          spreadsheetId: this.spreadsheetId,
          range: 'users!A:J',
          valueInputOption: 'RAW',
          requestBody: {
            values: [[
              userData.user_id,
              userData.display_name,
              userData.timezone,
              userData.cal_goal,
              userData.protein_goal_g,
              userData.fiber_goal_g,
              userData.first_seen_utc,
              userData.last_seen_utc,
              userData.silent_mode,
              userData.daily_digest_time,
            ]],
          },
        });
      }
    } catch (error) {
      console.error('Error creating/updating user:', error);
      throw error;
    }
  }

  private async updateUserRow(userData: User): Promise<void> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'users!A:J',
    });

    const rows = response.data.values || [];
    const rowIndex = rows.findIndex(row => parseInt(row[0]) === userData.user_id);

    if (rowIndex !== -1) {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `users!A${rowIndex + 1}:J${rowIndex + 1}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[
            userData.user_id,
            userData.display_name,
            userData.timezone,
            userData.cal_goal,
            userData.protein_goal_g,
            userData.fiber_goal_g,
            userData.first_seen_utc,
            userData.last_seen_utc,
            userData.silent_mode,
            userData.daily_digest_time,
          ]],
        },
      });
    }
  }

  // Log sheet operations
  async addLogEntry(entry: LogEntry): Promise<void> {
    try {
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: 'log!A:Q',
        valueInputOption: 'RAW',
        requestBody: {
          values: [[
            entry.timestamp_utc,
            entry.day_local,
            entry.user_id,
            entry.chat_id,
            entry.msg_id,
            entry.text || '',
            entry.photo_file_id || '',
            entry.photo_note || '',
            entry.calories,
            entry.protein_g,
            entry.fat_g,
            entry.carbs_g,
            entry.fiber_g,
            entry.score_item,
            entry.confidence,
            entry.advice_short,
            entry.raw_model_json,
          ]],
        },
      });
    } catch (error) {
      console.error('Error adding log entry:', error);
      throw error;
    }
  }

  async getLogEntriesForDay(userId: number, dayLocal: string): Promise<LogEntry[]> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'log!A:Q',
      });

      const rows = response.data.values || [];
      return rows
        .filter(row => parseInt(row[2]) === userId && row[1] === dayLocal)
        .map(row => ({
          timestamp_utc: row[0],
          day_local: row[1],
          user_id: parseInt(row[2]),
          chat_id: parseInt(row[3]),
          msg_id: parseInt(row[4]),
          text: row[5] || undefined,
          photo_file_id: row[6] || undefined,
          photo_note: row[7] || undefined,
          calories: parseFloat(row[8]) || 0,
          protein_g: parseFloat(row[9]) || 0,
          fat_g: parseFloat(row[10]) || 0,
          carbs_g: parseFloat(row[11]) || 0,
          fiber_g: parseFloat(row[12]) || 0,
          score_item: parseFloat(row[13]) || 0,
          confidence: parseFloat(row[14]) || 0,
          advice_short: row[15] || '',
          raw_model_json: row[16] || '',
        }));
    } catch (error) {
      console.error('Error getting log entries:', error);
      return [];
    }
  }

  // Daily sheet operations
  async getDailyEntry(userId: number, dayLocal: string): Promise<DailyEntry | null> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'daily!A:J',
      });

      const rows = response.data.values || [];
      const dailyRow = rows.find(row => parseInt(row[1]) === userId && row[0] === dayLocal);
      
      if (!dailyRow) return null;

      return {
        day_local: dailyRow[0],
        user_id: parseInt(dailyRow[1]),
        calories_sum: parseFloat(dailyRow[2]) || 0,
        protein_sum: parseFloat(dailyRow[3]) || 0,
        fat_sum: parseFloat(dailyRow[4]) || 0,
        carbs_sum: parseFloat(dailyRow[5]) || 0,
        fiber_sum: parseFloat(dailyRow[6]) || 0,
        meals_count: parseInt(dailyRow[7]) || 0,
        daily_score: parseFloat(dailyRow[8]) || 0,
        notes: dailyRow[9] || '',
      };
    } catch (error) {
      console.error('Error getting daily entry:', error);
      return null;
    }
  }

  async upsertDailyEntry(entry: DailyEntry): Promise<void> {
    try {
      const existingEntry = await this.getDailyEntry(entry.user_id, entry.day_local);
      
      if (existingEntry) {
        // Update existing entry
        await this.updateDailyRow(entry);
      } else {
        // Create new entry
        await this.sheets.spreadsheets.values.append({
          spreadsheetId: this.spreadsheetId,
          range: 'daily!A:J',
          valueInputOption: 'RAW',
          requestBody: {
            values: [[
              entry.day_local,
              entry.user_id,
              entry.calories_sum,
              entry.protein_sum,
              entry.fat_sum,
              entry.carbs_sum,
              entry.fiber_sum,
              entry.meals_count,
              entry.daily_score,
              entry.notes,
            ]],
          },
        });
      }
    } catch (error) {
      console.error('Error upserting daily entry:', error);
      throw error;
    }
  }

  private async updateDailyRow(entry: DailyEntry): Promise<void> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'daily!A:J',
    });

    const rows = response.data.values || [];
    const rowIndex = rows.findIndex(row => parseInt(row[1]) === entry.user_id && row[0] === entry.day_local);

    if (rowIndex !== -1) {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `daily!A${rowIndex + 1}:J${rowIndex + 1}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[
            entry.day_local,
            entry.user_id,
            entry.calories_sum,
            entry.protein_sum,
            entry.fat_sum,
            entry.carbs_sum,
            entry.fiber_sum,
            entry.meals_count,
            entry.daily_score,
            entry.notes,
          ]],
        },
      });
    }
  }

  async getDailyEntriesForPeriod(userId: number, startDate: string, endDate: string): Promise<DailyEntry[]> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'daily!A:J',
      });

      const rows = response.data.values || [];
      return rows
        .filter(row => {
          const rowUserId = parseInt(row[1]);
          const rowDate = row[0];
          return rowUserId === userId && rowDate >= startDate && rowDate <= endDate;
        })
        .map(row => ({
          day_local: row[0],
          user_id: parseInt(row[1]),
          calories_sum: parseFloat(row[2]) || 0,
          protein_sum: parseFloat(row[3]) || 0,
          fat_sum: parseFloat(row[4]) || 0,
          carbs_sum: parseFloat(row[5]) || 0,
          fiber_sum: parseFloat(row[6]) || 0,
          meals_count: parseInt(row[7]) || 0,
          daily_score: parseFloat(row[8]) || 0,
          notes: row[9] || '',
        }));
    } catch (error) {
      console.error('Error getting daily entries for period:', error);
      return [];
    }
  }

  async getAllUsersForDigest(): Promise<User[]> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'users!A:J',
      });

      const rows = response.data.values || [];
      return rows.slice(1).map(row => ({
        user_id: parseInt(row[0]),
        display_name: row[1] || '',
        timezone: row[2] || 'Europe/Madrid',
        cal_goal: parseInt(row[3]) || 1800,
        protein_goal_g: parseInt(row[4]) || 120,
        fiber_goal_g: parseInt(row[5]) || 25,
        first_seen_utc: row[6] || '',
        last_seen_utc: row[7] || '',
        silent_mode: row[8] === 'TRUE',
        daily_digest_time: row[9] || '21:30',
      }));
    } catch (error) {
      console.error('Error getting all users:', error);
      return [];
    }
  }

  async deleteUserData(userId: number): Promise<void> {
    try {
      // Delete from users sheet
      await this.deleteRowsFromSheet('users', userId, 0);
      // Delete from log sheet
      await this.deleteRowsFromSheet('log', userId, 2);
      // Delete from daily sheet
      await this.deleteRowsFromSheet('daily', userId, 1);
    } catch (error) {
      console.error('Error deleting user data:', error);
      throw error;
    }
  }

  private async deleteRowsFromSheet(sheetName: string, userId: number, userIdColumn: number): Promise<void> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!A:Z`,
    });

    const rows = response.data.values || [];
    const rowsToDelete: number[] = [];

    rows.forEach((row, index) => {
      if (parseInt(row[userIdColumn]) === userId) {
        rowsToDelete.push(index);
      }
    });

    // Delete rows in reverse order to maintain indices
    for (const rowIndex of rowsToDelete.reverse()) {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: await this.getSheetId(sheetName),
                dimension: 'ROWS',
                startIndex: rowIndex,
                endIndex: rowIndex + 1,
              },
            },
          }],
        },
      });
    }
  }

  private async getSheetId(sheetName: string): Promise<number> {
    const response = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
    });

    const sheet = response.data.sheets?.find(s => s.properties?.title === sheetName);
    return sheet?.properties?.sheetId || 0;
  }
}

export const sheetsService = new SheetsService();
