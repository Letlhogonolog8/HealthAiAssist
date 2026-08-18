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