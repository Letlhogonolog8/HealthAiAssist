import { google } from 'googleapis';

interface CalendarEvent {
  id: string;
  summary: string;
  start: {
    dateTime: string;
    timeZone?: string;
  };
  end: {
    dateTime: string;
    timeZone?: string;
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
  }>;
}

interface TimeSlotCheck {
  date: string;
  time: string;
  isAvailable: boolean;
  conflictingEvent?: CalendarEvent;
}

export class GoogleCalendarService {
  private calendar: any;
  private isConfigured: boolean = false;

  constructor() {
    this.initializeCalendar();
  }

  private initializeCalendar() {
    try {
      // Check if Google Calendar credentials are available
      const credentials = process.env.GOOGLE_CALENDAR_CREDENTIALS;
      const calendarId = process.env.GOOGLE_CALENDAR_ID;

      if (!credentials || !calendarId) {
        console.log('Google Calendar not configured - using fallback availability checking');
        return;
      }

      // Initialize Google Calendar API
      const auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(credentials),
        scopes: ['https://www.googleapis.com/auth/calendar.readonly']
      });

      this.calendar = google.calendar({ version: 'v3', auth });
      this.isConfigured = true;
      console.log('Google Calendar service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Google Calendar:', error);
      this.isConfigured = false;
    }
  }

  /**
   * Check if a specific time slot is available
   */
  async checkTimeSlotAvailability(date: string, time: string): Promise<TimeSlotCheck> {
    if (!this.isConfigured) {
      // Fallback: assume slot is available if Google Calendar is not configured
      return {
        date,
        time,
        isAvailable: true
      };
    }

    try {
      const startDateTime = this.parseDateTime(date, time);
      const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000); // 1 hour appointment

      const events = await this.getEventsInTimeRange(startDateTime, endDateTime);
      
      if (events.length > 0) {
        return {
          date,
          time,
          isAvailable: false,
          conflictingEvent: events[0]
        };
      }

      return {
        date,
        time,
        isAvailable: true
      };
    } catch (error) {
      console.error('Error checking time slot availability:', error);
      // Return available on error to prevent blocking appointments
      return {
        date,
        time,
        isAvailable: true
      };
    }
  }

  /**
   * Get all events in a specific time range
   */
  private async getEventsInTimeRange(startTime: Date, endTime: Date): Promise<CalendarEvent[]> {
    if (!this.isConfigured) {
      return [];
    }

    try {
      const response = await this.calendar.events.list({
        calendarId: process.env.GOOGLE_CALENDAR_ID,
        timeMin: startTime.toISOString(),
        timeMax: endTime.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });

      return response.data.items || [];
    } catch (error) {
      console.error('Error fetching calendar events:', error);
      return [];
    }
  }

  /**
   * Get available time slots for a specific date
   */
  async getAvailableTimeSlotsForDate(date: string): Promise<string[]> {
    const allTimeSlots = [
      '09:00 AM', '09:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
      '02:00 PM', '02:30 PM', '03:00 PM', '03:30 PM', '04:00 PM', '04:30 PM'
    ];

    if (!this.isConfigured) {
      // Return all slots if Google Calendar is not configured
      return allTimeSlots;
    }

    const availableSlots: string[] = [];

    for (const timeSlot of allTimeSlots) {
      const availability = await this.checkTimeSlotAvailability(date, timeSlot);
      if (availability.isAvailable) {
        availableSlots.push(timeSlot);
      }
    }

    return availableSlots;
  }

  /**
   * Check many slots with a single call to Google.
   *
   * The previous implementation looped over checkTimeSlotAvailability, which
   * issues one events.list request per slot. /api/appointments/available-slots
   * asks about a whole month — roughly twenty working days times twelve slots
   * times every clinician — so one page load became hundreds of sequential API
   * calls: seconds of latency, and a quota an unauthenticated caller could
   * exhaust by reloading. Now the busy intervals for the whole window are
   * fetched once and every slot is decided in memory.
   */
  async checkMultipleTimeSlots(slots: Array<{ date: string; time: string }>): Promise<TimeSlotCheck[]> {
    if (!this.isConfigured || slots.length === 0) {
      return slots.map(({ date, time }) => ({ date, time, isAvailable: true }));
    }

    const starts = slots.map((slot) => this.parseDateTime(slot.date, slot.time).getTime());
    const windowStart = new Date(Math.min(...starts));
    // Slots are treated as one hour, matching checkTimeSlotAvailability.
    const windowEnd = new Date(Math.max(...starts) + 60 * 60 * 1000);

    let busy: Array<{ start: number; end: number; summary: string }>;
    try {
      const events = await this.getEventsInTimeRange(windowStart, windowEnd);
      busy = events
        .filter((event) => event.start?.dateTime && event.end?.dateTime)
        .map((event) => ({
          start: new Date(event.start.dateTime).getTime(),
          end: new Date(event.end.dateTime).getTime(),
          summary: event.summary || 'Busy',
        }));
    } catch (error) {
      console.error('Error fetching calendar events for slot batch:', error);
      // Same posture as the single-slot path: a calendar outage must not block
      // every appointment in the system.
      return slots.map(({ date, time }) => ({ date, time, isAvailable: true }));
    }

    return slots.map(({ date, time }, index) => {
      const slotStart = starts[index];
      const slotEnd = slotStart + 60 * 60 * 1000;
      const clash = busy.find((event) => event.start < slotEnd && event.end > slotStart);

      return clash
        ? {
            date,
            time,
            isAvailable: false,
            conflictingEvent: { summary: clash.summary } as CalendarEvent,
          }
        : { date, time, isAvailable: true };
    });
  }

  /**
   * Get busy times for a specific date range
   */
  async getBusyTimes(startDate: Date, endDate: Date): Promise<Array<{ start: Date; end: Date; summary: string }>> {
    if (!this.isConfigured) {
      return [];
    }

    try {
      const events = await this.getEventsInTimeRange(startDate, endDate);
      
      return events.map(event => ({
        start: new Date(event.start.dateTime),
        end: new Date(event.end.dateTime),
        summary: event.summary || 'Busy'
      }));
    } catch (error) {
      console.error('Error fetching busy times:', error);
      return [];
    }
  }

  /**
   * Parse date and time strings into a Date object
   */
  private parseDateTime(date: string, time: string): Date {
    const [timePart, period] = time.split(' ');
    const [hours, minutes] = timePart.split(':').map(Number);
    
    let hour24 = hours;
    if (period === 'PM' && hours !== 12) {
      hour24 += 12;
    } else if (period === 'AM' && hours === 12) {
      hour24 = 0;
    }

    const dateTime = new Date(date);
    dateTime.setHours(hour24, minutes, 0, 0);
    
    return dateTime;
  }

  /**
   * Check if the service is properly configured
   */
  isServiceConfigured(): boolean {
    return this.isConfigured;
  }

  /**
   * Get configuration status
   */
  getServiceStatus(): { configured: boolean; message: string } {
    if (this.isConfigured) {
      return {
        configured: true,
        message: 'Google Calendar integration is active'
      };
    } else {
      return {
        configured: false,
        message: 'Google Calendar not configured - using fallback availability checking'
      };
    }
  }
}

// Export singleton instance
export const googleCalendarService = new GoogleCalendarService();