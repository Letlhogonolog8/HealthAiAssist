/**
 * The clinic's bookable times.
 *
 * In `shared/` because both sides need it and they must not disagree: the server
 * decides which slots are free and validates what comes back, and the client
 * draws the picker. When the two lists drift, the picker offers a time the
 * server will not accept — which is how a patient ends up choosing a slot that
 * silently fails on submit.
 *
 * This list was previously written out three separate times: twice as literal
 * arrays inside route handlers and once in server/services.ts.
 */
export const CLINIC_TIME_SLOTS = [
  '9:00 AM',
  '9:30 AM',
  '10:00 AM',
  '10:30 AM',
  '11:00 AM',
  '11:30 AM',
  '2:00 PM',
  '2:30 PM',
  '3:00 PM',
  '3:30 PM',
  '4:00 PM',
  '4:30 PM',
] as const;

export type ClinicTimeSlot = (typeof CLINIC_TIME_SLOTS)[number];
