/**
 * Request logging, and the process-level handlers that catch what escapes it.
 *
 * The logger this replaces wrapped res.json to capture every response body and
 * appended it to the log line:
 *
 *     GET /api/patient/profile/47 200 in 31ms :: {"id":47,"personalInfo":{"name":"…
 *
 * Truncating the line to eighty characters did not fix that — eighty characters
 * of a patient profile is a name and the start of an email address, written to
 * stdout, which on every host this deploys to is collected and retained by a log
 * aggregator with a different access model from the database. Scan results and
 * chat messages went the same way. Nothing here logs a response body.
 *
 * What it logs instead is what an operator actually needs to answer "which
 * request was that, who made it, and why was it slow": a correlation id, the
 * route rather than the populated path, the status, the duration, and the acting
 * user's id. Identifiers, not contents.
 */
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

import { normalizeResourcePath } from './analytics-engine';

/** JSON lines in production so a log drain can index them; readable in dev. */
const structured = process.env.NODE_ENV === 'production';

/** Requests slower than this are flagged for attention. */
const SLOW_REQUEST_MS = Number(process.env.SLOW_REQUEST_MS ?? 1500);

export interface RequestLogFields {
  requestId: string;
  method: string;
  route: string;
  status: number;
  durationMs: number;
  userId: number | null;
  role: string | null;
  ip: string | null;
  slow: boolean;
}

function emit(level: 'info' | 'warn' | 'error', fields: RequestLogFields): void {
  if (structured) {
    const line = JSON.stringify({ level, msg: 'http_request', time: new Date().toISOString(), ...fields });
    (level === 'info' ? console.log : level === 'warn' ? console.warn : console.error)(line);
    return;
  }

  const time = new Date().toLocaleTimeString('en-US', { hour12: true });
  const who = fields.userId ? ` user=${fields.userId}` : '';
  const flag = fields.slow ? ' SLOW' : '';
  const message =
    `${time} [express] ${fields.method} ${fields.route} ${fields.status} ` +
    `in ${fields.durationMs}ms${who}${flag}`;
  (level === 'info' ? console.log : level === 'warn' ? console.warn : console.error)(message);
}

/**
 * Attaches a correlation id and logs the outcome of every API request.
 *
 * The id is echoed as `X-Request-Id`, so a user reporting a problem can quote
 * something that finds the exact request in the log. An inbound `X-Request-Id`
 * is honoured when it looks safe, which lets a proxy or a front end trace a call
 * across services.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.headers['x-request-id'];
  const requestId =
    typeof inbound === 'string' && /^[\w-]{8,64}$/.test(inbound) ? inbound : randomUUID();

  (req as any).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const start = Date.now();

  // Captured now, not inside the finish handler.
  //
  // Express strips the mount path from req.url while a mounted handler runs and
  // restores it on the way out of next() — but a handler that responds without
  // calling next() never returns through that path, so req.url stays trimmed.
  // Reading req.path at finish time therefore saw "/zzz" for a request to
  // "/api/zzz", failed the startsWith('/api') test, and silently dropped every
  // 404 from the log: the one class of request an operator most wants to see.
  const requestPath = req.path;

  res.on('finish', () => {
    if (!requestPath.startsWith('/api')) return;

    const durationMs = Date.now() - start;
    const session = (req as any).session;

    const fields: RequestLogFields = {
      requestId,
      method: req.method,
      // The route shape, not the populated path: logging
      // /api/patient/profile/47 puts a patient id in every line and makes the
      // log itself a record of who was looked at.
      route: normalizeResourcePath(requestPath),
      status: res.statusCode,
      durationMs,
      userId: session?.user?.id ?? null,
      role: session?.user?.role ?? null,
      ip: req.ip ?? null,
      slow: durationMs > SLOW_REQUEST_MS,
    };

    emit(res.statusCode >= 500 ? 'error' : fields.slow || res.statusCode >= 400 ? 'warn' : 'info', fields);
  });

  next();
}

/**
 * Process-level handlers.
 *
 * `unhandledRejection` previously logged the promise object itself, which prints
 * `Promise { <pending> }` and nothing useful, and did not include a stack.
 *
 * An uncaught exception leaves the process in an undefined state, so it is
 * logged and then rethrown to Node's default handler, which exits. That is the
 * correct outcome for a health system: a supervisor restarting a fresh process
 * is safer than one continuing to serve from unknown state. It is also how the
 * duplicate-WebSocket crash was eventually diagnosed — the exit was the signal.
 */
export function installProcessHandlers(): void {
  process.on('unhandledRejection', (reason: unknown) => {
    const detail =
      reason instanceof Error
        ? { message: reason.message, stack: reason.stack }
        : { message: String(reason) };

    console.error(
      structured
        ? JSON.stringify({ level: 'error', msg: 'unhandled_rejection', time: new Date().toISOString(), ...detail })
        : `Unhandled rejection: ${detail.message}\n${(detail as any).stack ?? ''}`
    );
  });

  process.on('uncaughtException', (error: Error) => {
    console.error(
      structured
        ? JSON.stringify({
            level: 'fatal',
            msg: 'uncaught_exception',
            time: new Date().toISOString(),
            message: error.message,
            stack: error.stack,
          })
        : `Uncaught exception: ${error.message}\n${error.stack ?? ''}`
    );

    // Give the log a chance to flush, then let the process die.
    setTimeout(() => process.exit(1), 100).unref();
  });
}
