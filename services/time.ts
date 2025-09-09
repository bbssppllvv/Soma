import { format, parseISO, startOfDay, subDays, endOfDay } from 'date-fns';
import { zonedTimeToUtc, utcToZonedTime, formatInTimeZone } from 'date-fns-tz';

export class TimeService {
  /**
   * Convert UTC timestamp to local date string (YYYY-MM-DD) for a given timezone
   */
  static toLocalDate(timestampUtc: string, timezone: string): string {
    const utcDate = parseISO(timestampUtc);
    const zonedDate = utcToZonedTime(utcDate, timezone);
    return format(zonedDate, 'yyyy-MM-dd');
  }

  /**
   * Get current local date string for a timezone
   */
  static getCurrentLocalDate(timezone: string): string {
    const now = new Date();
    return formatInTimeZone(now, timezone, 'yyyy-MM-dd');
  }

  /**
   * Get current local time in HH:mm format for a timezone
   */
  static getCurrentLocalTime(timezone: string): string {
    const now = new Date();
    return formatInTimeZone(now, timezone, 'HH:mm');
  }

  /**
   * Check if current time is within range of target time (±5 minutes)
   */
  static isTimeInRange(currentTime: string, targetTime: string, rangeMinutes: number = 5): boolean {
    const [currentHour, currentMinute] = currentTime.split(':').map(Number);
    const [targetHour, targetMinute] = targetTime.split(':').map(Number);

    const currentTotalMinutes = currentHour * 60 + currentMinute;
    const targetTotalMinutes = targetHour * 60 + targetMinute;

    const difference = Math.abs(currentTotalMinutes - targetTotalMinutes);
    return difference <= rangeMinutes;
  }

  /**
   * Get date range for last N days in local timezone
   */
  static getLastNDaysRange(timezone: string, days: number): { startDate: string; endDate: string } {
    const now = new Date();
    const zonedNow = utcToZonedTime(now, timezone);
    const endDate = format(zonedNow, 'yyyy-MM-dd');
    
    const startDateObj = subDays(zonedNow, days - 1);
    const startDate = format(startDateObj, 'yyyy-MM-dd');

    return { startDate, endDate };
  }

  /**
   * Get start and end of day in UTC for a local date and timezone
   */
  static getDayBoundsInUtc(localDate: string, timezone: string): { startUtc: Date; endUtc: Date } {
    const localDateObj = parseISO(localDate + 'T00:00:00');
    const startOfDayLocal = startOfDay(localDateObj);
    const endOfDayLocal = endOfDay(localDateObj);

    const startUtc = zonedTimeToUtc(startOfDayLocal, timezone);
    const endUtc = zonedTimeToUtc(endOfDayLocal, timezone);

    return { startUtc, endUtc };
  }

  /**
   * Format timestamp for display in user's timezone
   */
  static formatForDisplay(timestampUtc: string, timezone: string, formatString: string = 'HH:mm'): string {
    const utcDate = parseISO(timestampUtc);
    return formatInTimeZone(utcDate, timezone, formatString);
  }

  /**
   * Get week boundaries for analytics (Monday to Sunday)
   */
  static getWeekBoundaries(timezone: string, weeksAgo: number = 0): { startDate: string; endDate: string } {
    const now = new Date();
    const zonedNow = utcToZonedTime(now, timezone);
    
    // Get current day of week (0 = Sunday, 1 = Monday, etc.)
    const currentDay = zonedNow.getDay();
    const daysFromMonday = currentDay === 0 ? 6 : currentDay - 1; // Convert to Monday-based week
    
    // Calculate start of current week (Monday)
    const startOfWeek = subDays(zonedNow, daysFromMonday + (weeksAgo * 7));
    const endOfWeek = subDays(startOfWeek, -6); // Add 6 days to get Sunday
    
    return {
      startDate: format(startOfWeek, 'yyyy-MM-dd'),
      endDate: format(endOfWeek, 'yyyy-MM-dd')
    };
  }

  /**
   * Check if a date string is today in the given timezone
   */
  static isToday(dateString: string, timezone: string): boolean {
    const today = this.getCurrentLocalDate(timezone);
    return dateString === today;
  }

  /**
   * Get relative date description (today, yesterday, N days ago)
   */
  static getRelativeDateDescription(dateString: string, timezone: string): string {
    const today = this.getCurrentLocalDate(timezone);
    const yesterday = format(subDays(parseISO(today + 'T00:00:00'), 1), 'yyyy-MM-dd');

    if (dateString === today) {
      return 'сегодня';
    } else if (dateString === yesterday) {
      return 'вчера';
    } else {
      const daysDiff = Math.floor((parseISO(today + 'T00:00:00').getTime() - parseISO(dateString + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff > 0) {
        return `${daysDiff} дн. назад`;
      } else {
        return dateString;
      }
    }
  }

  /**
   * Validate timezone string
   */
  static isValidTimezone(timezone: string): boolean {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get default timezone
   */
  static getDefaultTimezone(): string {
    return process.env.TIMEZONE_DEFAULT || 'Europe/Madrid';
  }
}
