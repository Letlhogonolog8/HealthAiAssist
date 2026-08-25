/**
 * Password hashing and the login limiter.
 *
 * This file used to export a second, weaker copy of the authorisation
 * middleware: its own `requireAuth`, `requireRole`, `apiLimiter`,
 * `securityHeaders` and `auditLog`, none of which anything imported. The real
 * ones live in security-config.ts and security-middleware.ts, and the copies
 * differed in ways that mattered — this `requireAuth` accepted a session
 * carrying `user` but no `userId`, where the live one requires both, and this
 * `requireRole` returned 401 where the live one distinguishes 401 from 403.
 *
 * Two same-named guards with different strictness, importable from two paths, is
 * a latent authorisation bug waiting for whoever next reaches for the obvious
 * import. Only what is actually used is exported now.
 */
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcrypt';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    user?: {
      id: number;
      username: string;
      role: string;
      [key: string]: any;
    };
    /**
     * A password has been accepted, a second factor has not yet been.
     *
     * Deliberately NOT `userId` or `user`: every guard in the system keys off
     * those two, so a half-authenticated session must not carry either. Holding
     * the pending identity in the session rather than in a separately issued
     * token means the challenge is bound to the same cookie that passed the
     * password, and there is no second credential to store, expire or leak.
     */
    pendingMfaUserId?: number;
    pendingMfaAt?: number;
  }
}

// Rate limiting configurations
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: {
    error: 'Too many login attempts, please try again in 15 minutes',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.ip + ':' + (req.body?.username || 'unknown');
  }
});

// Secure password hashing
export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 12;
  return bcrypt.hash(password, saltRounds);
}

// Password verification
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch (error) {
    console.error('Password verification error:', error);
    return false;
  }
}
