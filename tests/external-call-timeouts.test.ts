/**
 * Outbound calls made while a patient waits must be bounded.
 *
 * ── What this pins ─────────────────────────────────────────────────────────
 *
 * `googleCalendarService` is called from inside the appointment handlers, and
 * had no timeout on its Google API calls. An unresponsive endpoint would have
 * held the HTTP request open for as long as the socket stayed up: the booking
 * never returns and the patient sees a spinner rather than an error. That is a
 * real exposure and this test closes it.
 *
 * ── What this did not cause ────────────────────────────────────────────────
 *
 * It was not the source of the intermittent 20-second timeouts on
 * POST /api/patient/appointments and the dermatologist-slot routes, although it
 * was published as such. Those came from the `await import(...)` of this module
 * on the request path — googleapis takes roughly twelve seconds to load cold
 * under tsx — and are fixed by the warm-up in server/index.ts. The calendar
 * call itself measured under a second. See the header of
 * server/google-calendar-service.ts for the timings.
 *
 * ── Why the assertion is "returns", not "returns quickly" ─────────────────
 *
 * The failure mode is not slowness, it is never returning. A test that asserts a
 * duration is a benchmark and will flake on a loaded machine; this asserts the
 * call settles at all, under a hard cap well below the request timeout, against
 * a stub that is guaranteed never to resolve.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

// Read at module load by the service, so it must be set before the import below.
process.env.GOOGLE_CALENDAR_TIMEOUT_MS = '300';

const { GoogleCalendarService } = await import('../server/google-calendar-service.ts');

/** A calendar client whose request never settles, ever. */
function hangingCalendar() {
  return {
    events: {
      list: () => new Promise(() => {}),
    },
  };
}

/** A service wired to that client, with the configured flag forced on. */
function serviceWithHangingCalendar() {
  const service: any = new GoogleCalendarService();
  service.isConfigured = true;
  service.calendar = hangingCalendar();
  return service;
}

const CAP_MS = 5_000;

describe('Google Calendar calls are bounded', { timeout: 30_000 }, () => {
  test('a single slot check returns even when the API never responds', async () => {
    const service = serviceWithHangingCalendar();

    const result = await Promise.race([
      service.checkTimeSlotAvailability('2026-10-01', '09:00 AM'),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('checkTimeSlotAvailability never returned')), CAP_MS)
      ),
    ]);

    assert.ok(result, 'no result returned');
    // Fails open, deliberately: a calendar outage must not stop someone booking.
    // The clash warning is worth less than the appointment.
    assert.equal(result.isAvailable, true);
  });

  test('a batch check returns one entry per slot, all available', async () => {
    const service = serviceWithHangingCalendar();
    const slots = [
      { date: '2026-10-01', time: '09:00 AM' },
      { date: '2026-10-01', time: '09:30 AM' },
      { date: '2026-10-01', time: '10:00 AM' },
    ];

    const results = await Promise.race([
      service.checkMultipleTimeSlots(slots),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('checkMultipleTimeSlots never returned')), CAP_MS)
      ),
    ]);

    assert.equal(results.length, slots.length, 'a slot was dropped');
    for (const r of results) {
      assert.equal(r.isAvailable, true);
    }
  });

  test('an unconfigured service does not reach the network at all', async () => {
    // The common deployment. It must answer without a timeout being involved,
    // or every booking pays the deadline as latency.
    const service: any = new GoogleCalendarService();
    service.isConfigured = false;

    const started = Date.now();
    const result = await service.checkTimeSlotAvailability('2026-10-01', '09:00 AM');

    assert.equal(result.isAvailable, true);
    assert.ok(
      Date.now() - started < 250,
      'unconfigured path should short-circuit, not wait on a deadline'
    );
  });
});
