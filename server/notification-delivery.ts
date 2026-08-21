/**
 * Getting a notification to someone who is not looking at the tab.
 *
 * In-app notifications persist and push over the WebSocket, which is fine for a
 * clinician working in the application and useless for a patient who closed it
 * three days ago. Anything time-sensitive — a result confirmed, a scan flagged,
 * an appointment tomorrow — needs a channel that reaches them where they are.
 *
 * ── What is deliberately NOT in these messages ─────────────────────────────
 *
 * Clinical content. Not the finding, not the risk level, not the modality, not
 * "malignancy detected".
 *
 * Email and SMS are not confidential channels. They sit unencrypted on carrier
 * infrastructure and third-party mail servers, they land on a lock screen a
 * partner or colleague can read, and they are delivered to an address that may
 * have been recycled or shared. A push saying a result is ready is a scheduling
 * fact; a push saying what the result is discloses a diagnosis to whoever is
 * holding the phone. The body says that something is waiting and where to sign
 * in to read it, and the detail stays behind authentication.
 *
 * That is also why there is no "urgent — call us immediately" wording: urgency
 * on a lock screen is itself clinical information.
 *
 * ── Failure posture ────────────────────────────────────────────────────────
 *
 * Delivery is best-effort and never blocks or fails the operation that
 * triggered it. The durable record is the row in `notifications`; this is a
 * courtesy on top. An unconfigured channel is not an error, it is a channel that
 * is off, and the result says which channels actually carried the message so a
 * caller can tell "sent" from "nowhere to send it".
 */

export type DeliveryChannel = 'email' | 'sms';

export interface DeliveryTarget {
  email?: string | null;
  phone?: string | null;
  fullName?: string | null;
}

export interface DeliveryResult {
  attempted: DeliveryChannel[];
  delivered: DeliveryChannel[];
  skipped: Array<{ channel: DeliveryChannel; reason: string }>;
}

/** Where the recipient should go to read the thing itself. */
function appUrl(path = '/'): string {
  const base = (process.env.PUBLIC_APP_URL || process.env.PROD_ORIGIN || '').replace(/\/$/, '');
  return base ? `${base}${path}` : path;
}

let sendgridReady: boolean | null = null;

/**
 * Lazily configures SendGrid, once.
 *
 * Lazy because the module is imported by request handlers and an unconfigured
 * key should not throw at import time; once because setApiKey is global state.
 */
async function getSendgrid(): Promise<any | null> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.NOTIFICATION_FROM_EMAIL;
  if (!apiKey || !from) return null;

  const sgMail = (await import('@sendgrid/mail')).default;
  if (sendgridReady === null) {
    try {
      sgMail.setApiKey(apiKey);
      sendgridReady = true;
    } catch (error) {
      console.error('SendGrid could not be configured:', error);
      sendgridReady = false;
    }
  }
  return sendgridReady ? sgMail : null;
}

/** E.164, matching the check the voice path already applies. */
function isSendablePhone(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value.trim());
}

/**
 * Notifies `target` that something is waiting for them.
 *
 * `subject` and `summary` must be free of clinical detail — see the file header.
 * Callers pass what kind of thing arrived, not what it says.
 */
export async function deliverNotification(
  target: DeliveryTarget,
  subject: string,
  summary: string,
  link = '/'
): Promise<DeliveryResult> {
  const result: DeliveryResult = { attempted: [], delivered: [], skipped: [] };
  const url = appUrl(link);
  const greeting = target.fullName ? `Hello ${target.fullName},` : 'Hello,';

  // ── Email ────────────────────────────────────────────────────────────────
  const sgMail = await getSendgrid();
  if (!sgMail) {
    result.skipped.push({
      channel: 'email',
      reason: 'SENDGRID_API_KEY or NOTIFICATION_FROM_EMAIL is not set',
    });
  } else if (!target.email) {
    result.skipped.push({ channel: 'email', reason: 'no email address on file' });
  } else {
    result.attempted.push('email');
    try {
      await sgMail.send({
        to: target.email,
        from: process.env.NOTIFICATION_FROM_EMAIL!,
        subject,
        text:
          `${greeting}\n\n${summary}\n\n` +
          `Sign in to view it: ${url}\n\n` +
          `This message deliberately contains no clinical detail. ` +
          `Email is not a secure channel, so the content stays behind your login.\n`,
      });
      result.delivered.push('email');
    } catch (error: any) {
      // SendGrid errors carry the recipient address; log the status, not the body.
      console.error('Email notification failed:', error?.code ?? error?.message ?? 'unknown');
      result.skipped.push({ channel: 'email', reason: 'send failed' });
    }
  }

  // ── SMS ──────────────────────────────────────────────────────────────────
  const smsFrom = process.env.TWILIO_SMS_NUMBER || process.env.TWILIO_PHONE_NUMBER;
  const hasTwilio = Boolean(
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && smsFrom
  );

  if (!hasTwilio) {
    result.skipped.push({ channel: 'sms', reason: 'Twilio is not configured' });
  } else if (!target.phone || !isSendablePhone(target.phone)) {
    result.skipped.push({
      channel: 'sms',
      reason: target.phone ? 'phone number is not in E.164 format' : 'no phone number on file',
    });
  } else {
    result.attempted.push('sms');
    try {
      const twilio = (await import('twilio')).default;
      const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
      await client.messages.create({
        to: target.phone.trim(),
        from: smsFrom!,
        // Short, and still says nothing clinical.
        body: `${summary} Sign in to view: ${url}`,
      });
      result.delivered.push('sms');
    } catch (error: any) {
      console.error('SMS notification failed:', error?.code ?? error?.message ?? 'unknown');
      result.skipped.push({ channel: 'sms', reason: 'send failed' });
    }
  }

  return result;
}

/**
 * Fire-and-forget wrapper for request handlers.
 *
 * Nothing a notification does should be able to fail the clinical operation that
 * caused it, or make the caller wait on a third-party API.
 */
export function deliverInBackground(
  target: DeliveryTarget,
  subject: string,
  summary: string,
  link = '/'
): void {
  void deliverNotification(target, subject, summary, link)
    .then((result) => {
      if (result.delivered.length === 0 && result.attempted.length > 0) {
        console.warn('Notification reached no channel:', result.skipped);
      }
    })
    .catch((error) => console.error('Notification delivery threw:', error));
}

/** What the deployment can currently reach people through. Reported by /api/ready. */
export function deliveryChannelStatus(): Record<DeliveryChannel, boolean> {
  return {
    email: Boolean(process.env.SENDGRID_API_KEY && process.env.NOTIFICATION_FROM_EMAIL),
    sms: Boolean(
      process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        (process.env.TWILIO_SMS_NUMBER || process.env.TWILIO_PHONE_NUMBER)
    ),
  };
}
