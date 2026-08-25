import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { User } from '@shared/schema';

// Simple type for authenticated requests  
export interface AuthenticatedRequest extends Request {
  session: any & {
    userId?: number;
    user?: Pick<User, 'id' | 'role' | 'username' | 'fullName' | 'email'>;
  };
}

// Authentication middleware
export const requireAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.session?.userId || !req.session?.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
};

// Role-based access control
export const requireRole = (allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.session?.user?.role || !allowedRoles.includes(req.session.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
};

// Admin only access
export const requireAdmin = requireRole(['admin']);

// Medical staff access (doctors and radiologists)
export const requireMedicalStaff = requireRole(['doctor', 'radiologist', 'admin']);

// Patient data access control
export const requirePatientAccess = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const patientId = parseInt(req.params.id || req.params.patientId || req.body.patientId);
  const userRole = req.session?.user?.role;
  const userId = req.session?.user?.id;

  // Admin can access all patient data
  if (userRole === 'admin') {
    return next();
  }

  // Patients can only access their own data
  if (userRole === 'patient' && userId === patientId) {
    return next();
  }

  // Medical staff can access patient data
  if (userRole && ['doctor', 'radiologist'].includes(userRole)) {
    return next();
  }

  return res.status(403).json({ error: "Access denied to patient data" });
};

/**
 * Ownership check for a resource addressed by its *own* id rather than a
 * patient id.
 *
 * `requirePatientAccess` and `requirePatientDataAccess` both compare the
 * session user's id against a route parameter, which only works when that
 * parameter *is* a patient id. On routes like
 * `DELETE /api/patient/appointments/:id` the parameter is an appointment id, so
 * those guards would have compared a user id against an appointment id — a
 * comparison that is meaningless and happens to pass whenever the two integers
 * coincide. They were therefore absent, and any authenticated patient could
 * delete, reschedule or read another patient's records by guessing a small
 * integer.
 *
 * This resolves ownership through the caller's own records instead: the id must
 * appear in the set the session user owns. Medical staff are allowed through,
 * as they are throughout this file — cross-patient access is their job.
 *
 * A non-existent id yields 403 rather than 404 on purpose. Distinguishing the
 * two would confirm which appointment ids exist to anyone willing to enumerate.
 */
const requireOwnership = (kind: 'appointment' | 'scan', paramNames: string[]) => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = req.session?.user?.id;
    const userRole = req.session?.user?.role;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Clinicians and admins act across patients by design.
    if (userRole && ['admin', 'doctor', 'radiologist'].includes(userRole)) {
      return next();
    }

    const rawId = paramNames
      .map((name) => req.params[name])
      .find((value) => value !== undefined);
    const resourceId = parseInt(rawId ?? '');
    if (isNaN(resourceId)) {
      return res.status(400).json({ error: `Invalid ${kind} ID` });
    }

    try {
      const { storage } = await import('./storage');
      const owned =
        kind === 'appointment'
          ? await storage.getAppointments(userId)
          : await storage.getScans(userId);

      if (!owned.some((record: any) => record.id === resourceId)) {
        return res.status(403).json({ error: `Access denied to this ${kind}` });
      }
      next();
    } catch (error) {
      // Fail closed. An ownership check that cannot run is not a pass.
      console.error(`[OWNERSHIP] lookup failed for ${kind} ${resourceId}:`, error);
      return res.status(503).json({ error: 'Authorization check unavailable' });
    }
  };
};

export const requireAppointmentOwnership = requireOwnership('appointment', ['id', 'appointmentId']);
export const requireScanOwnership = requireOwnership('scan', ['id', 'scanId']);

// Rate limiting for sensitive operations
export const sensitiveOperationLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: { error: "Too many attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting for authentication
export const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Increased to 1000 attempts per window
  message: { error: "Too many login attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting in development or if NODE_ENV is not set
    return process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
  }
});

// Input validation middleware
export const validateInput = (req: Request, res: Response, next: NextFunction) => {
  // Basic XSS protection
  const sanitizeString = (str: string) => {
    return str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
              .replace(/javascript:/gi, '')
              .replace(/on\w+\s*=/gi, '');
  };

  // Recursively sanitize object
  const sanitizeObject = (obj: any): any => {
    if (typeof obj === 'string') {
      return sanitizeString(obj);
    }
    if (Array.isArray(obj)) {
      return obj.map(sanitizeObject);
    }
    if (obj && typeof obj === 'object') {
      const sanitized: any = {};
      for (const key in obj) {
        sanitized[key] = sanitizeObject(obj[key]);
      }
      return sanitized;
    }
    return obj;
  };

  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  
  next();
};

/**
 * Audit logging for sensitive operations.
 *
 * Writes to the `audit_events` table. This previously only called console.log,
 * which is terminal output, not an audit trail — it vanished with the process
 * and could not be queried, so the twelve endpoints using it were effectively
 * unaudited.
 *
 * The row is written on response finish so the outcome is captured: an attempted
 * staff deletion that was rejected with 403 is exactly the event an audit trail
 * exists to record, and logging on the way in would show it as if it succeeded.
 *
 * A failed audit write is logged loudly but never blocks the request. Losing an
 * audit row is bad; refusing clinical work because the audit table is briefly
 * unreachable is worse.
 */
/**
 * Writes one audit row directly, outside the request/response cycle.
 *
 * `auditLog` covers the common case — an action defined by the route, recorded
 * when the response finishes. Some decisions need recording at the moment they
 * are made rather than when the response lands, and need to carry a `detail`
 * the route name cannot express: which patient an access check refused, and on
 * what basis. This is for those.
 *
 * Same failure posture as auditLog: a lost audit row is bad, and refusing
 * clinical work because the audit table is briefly unreachable is worse.
 *
 * `detail` must stay non-identifying. An audit log that contains the personal
 * information it is auditing has multiplied the exposure rather than controlled
 * it — a patient id is a reference, a patient name is a disclosure.
 */
export async function recordAuditEvent(event: {
  action: string;
  actorUserId?: number | null;
  actorUsername?: string | null;
  actorRole?: string | null;
  method?: string | null;
  path?: string | null;
  statusCode?: number | null;
  ipAddress?: string | null;
  detail?: string | null;
}): Promise<void> {
  try {
    const { getDb } = await import('./db');
    const { auditEvents } = await import('@shared/schema');
    const db = getDb() as any;
    if (!db) return;

    await db.insert(auditEvents).values({
      action: event.action,
      actorUserId: event.actorUserId ?? null,
      actorUsername: event.actorUsername ?? null,
      actorRole: event.actorRole ?? null,
      method: event.method ?? null,
      path: event.path ?? null,
      statusCode: event.statusCode ?? null,
      ipAddress: event.ipAddress ?? null,
      detail: event.detail ?? null,
    });
  } catch (error) {
    console.error(`[AUDIT] FAILED TO PERSIST "${event.action}":`, error);
  }
}

export const auditLog = (action: string) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const actorUserId = req.session?.user?.id ?? null;
    const actorUsername = req.session?.user?.username ?? null;
    const actorRole = req.session?.user?.role ?? null;

    res.on('finish', () => {
      void (async () => {
        try {
          const { getDb } = await import('./db');
          const { auditEvents } = await import('@shared/schema');
          const db = getDb() as any;
          if (!db) return;

          await db.insert(auditEvents).values({
            action,
            actorUserId,
            actorUsername,
            actorRole,
            method: req.method,
            path: req.originalUrl?.split('?')[0] ?? req.path,
            statusCode: res.statusCode,
            ipAddress: req.ip ?? null,
          });
        } catch (error) {
          console.error(
            `[AUDIT] FAILED TO PERSIST "${action}" by ${actorUsername ?? 'anonymous'}:`,
            error
          );
        }
      })();
    });

    next();
  };
};