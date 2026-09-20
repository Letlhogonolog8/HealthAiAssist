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

/**
 * How long a calendar lookup may take before it is abandoned.
 *
 * There was no bound at all, and that is a request-hanging bug rather than a
 * slow-response one. `googleCalendarService` is called from inside the
 * appointment handlers, so an unresponsive Google endpoint held the HTTP request
 * open for as long as the socket stayed up — the booking never returned, and the
 * patient saw a spinner rather than an error.
 *
 * ── This is not what caused the 20-second timeouts ───────────────────────
 *
 * Worth recording, because the wrong cause was published twice. The
 * intermittent 20-second failures on POST /api/patient/appointments and the
 * dermatologist-slot routes were attributed first to database latency and then
 * to this API call. Both were wrong. Timing the route from the inside gave
 * `imported calendar: 11834ms` against `calendar checked: 12714ms` — the call
 * took 880ms and the *module import* took the rest. googleapis is loaded lazily
 * on the request path, and that is the hang; it is warmed at boot in
 * server/index.ts.
 *
 * Unsetting GOOGLE_CALENDAR_CREDENTIALS appeared to fix it, which is what made
 * the wrong diagnosis convincing. It did not: the import happens either way, and
 * a passing run only meant the module was already warm or the run was lucky.
 * A single passing run does not establish a cause.
 *
 * The deadline below is still worth having — an unbounded outbound call inside a
 * booking handler is a real exposure — but it was not the bug.
 *
 * Five seconds is chosen against what the call is worth, not what the API
 * usually takes: the answer only decides whether to warn about a clash, and both
 * callers already treat a failure as "available". Waiting longer buys a slightly
 * better warning at the cost of a booking that never completes.
 */
const CALENDAR_TIMEOUT_MS = Number(process.env.GOOGLE_CALENDAR_TIMEOUT_MS ?? 5000);

/**
 * Rejects if `work` has not settled within `ms`.
 *
 * Wraps the whole operation rather than passing a timeout to googleapis alone,
 * because the first call after startup also fetches an OAuth token — a separate
 * outbound request that a per-request timeout on events.list does not cover.
 * Both are bounded here.
 */
function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what} did not respond within ${ms}ms`)),
      ms
    );
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer)) as Promise<T>;
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

    // Every calendar lookup in this service funnels through here — the batch
    // path collapses its slots into one range query — so bounding this one call
    // bounds all of them.
    try {
      const response = await withDeadline<{ data: { items?: CalendarEvent[] } }>(
        this.calendar.events.list({
          calendarId: process.env.GOOGLE_CALENDAR_ID,
          timeMin: startTime.toISOString(),
          timeMax: endTime.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          // Defence in depth: bounds the HTTP request itself, while the
          // withDeadline wrapper bounds auth and everything else.
          timeout: CALENDAR_TIMEOUT_MS,
        }),
        CALENDAR_TIMEOUT_MS,
        'Google Calendar events.list'
      );

      return response.data.items || [];
    } catch (error) {
      // Deliberately not rethrown. Both callers treat an empty result as "no
      // known conflict" and proceed, which is the right posture: a calendar
      // outage must not stop someone booking an appointment.
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