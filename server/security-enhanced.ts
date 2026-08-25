import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
// The keyring is the source of truth for whether encryption is usable; it
// accepts a rotatable ENCRYPTION_KEYS as well as a single ENCRYPTION_KEY.
import { isKeyringConfigured } from './crypto/keyring';

// Enhanced authentication interface
export interface AuthenticatedRequest extends Request {
  session: any & {
    userId?: number;
    user?: {
      id: number;
      role: string;
      username: string;
      fullName: string;
      email: string;
    };
  };
}

/**
 * Rate-limit key: the logged-in user when there is one, the IP otherwise.
 *
 * Keying purely on IP is wrong for this application. A clinic, a hospital or any
 * corporate network leaves through one address, so every clinician on site
 * shared a single budget: one person refreshing a dashboard could 429 the whole
 * building. Authenticated traffic is attributable to an account, which is both
 * fairer and a better signal — a single account making thousands of requests is
 * the thing actually worth limiting. Anonymous traffic still falls back to IP,
 * where the tighter ceilings belong.
 */
const limitKey = (req: Request): string => {
  const userId = (req as AuthenticatedRequest).session?.user?.id;
  return userId ? `user:${userId}` : `ip:${req.ip}`;
};

// Rate limiting configurations for different endpoint types
export const createRateLimiters = () => {
  const isDev = process.env.NODE_ENV === 'development';
  const disableRateLimit = (process.env.DISABLE_RATE_LIMIT || '').toLowerCase() === 'true';
  const shouldSkip = () => isDev || disableRateLimit;

  /**
   * General API traffic.
   *
   * Was 100 requests per IP per 15 minutes, which works out to under seven a
   * minute for an entire site. The dashboards in this app issue six or more
   * requests per render and poll on a ten-second interval, so a single logged-in
   * clinician exceeded it within about two minutes; behind shared egress the
   * whole practice did so sooner. The budget is now per account and sized for
   * what the client actually does.
   */
  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: (req: Request) => ((req as AuthenticatedRequest).session?.user ? 1500 : 200),
    keyGenerator: limitKey,
    message: {
      error: 'Too many requests, please try again later.',
      retryAfter: 15 * 60 * 1000
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: shouldSkip,
  });

  // Strict rate limiting for authentication endpoints
  // Deliberately IP-keyed and left alone: there is no session to attribute a
  // login attempt to, and this is the limiter that matters against credential
  // stuffing.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // login attempts per window
    message: {
      error: 'Too many login attempts, please try again later.',
      retryAfter: 15 * 60 * 1000
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: shouldSkip,
  });

  // Medical data endpoints - more permissive for healthcare workflows
  // 50 requests per 5 minutes was under one every six seconds for a clinician
  // whose dashboard polls three endpoints on a ten-second timer. Per account,
  // and sized for that.
  const medicalLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: (req: Request) => ((req as AuthenticatedRequest).session?.user ? 600 : 60),
    keyGenerator: limitKey,
    message: {
      error: 'Medical API rate limit exceeded. Please wait before making more requests.',
      retryAfter: 5 * 60 * 1000
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: shouldSkip,
  });

  // Chat/messaging endpoints - higher limit for real-time communication
  // Chat covers polling for messages and notifications as well as sending, so
  // the ceiling has to cover reads; 30/minute was a send-rate limit applied to
  // both.
  const chatLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: (req: Request) => ((req as AuthenticatedRequest).session?.user ? 120 : 20),
    keyGenerator: limitKey,
    message: {
      error: 'Message rate limit exceeded. Please slow down.',
      retryAfter: 60 * 1000
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: shouldSkip,
  });

  return { generalLimiter, authLimiter, medicalLimiter, chatLimiter };
};

// CORS configuration for healthcare application
/**
 * CORS.
 *
 * Two things were wrong here, and together they made every production build a
 * blank page.
 *
 * First, a disallowed origin called back with an Error. cors() forwards that to
 * Express's error handler, so the response was 500 instead of simply omitting
 * the Access-Control-Allow-Origin header. Denial in CORS is the *absence* of a
 * header — the browser enforces it. Turning it into a server error takes the
 * request down with it.
 *
 * Second, the allowlist was five hardcoded literals, all on port 5000, and this
 * middleware was mounted on every route rather than on /api. A
 * `<script type="module">` is fetched in CORS mode and carries an Origin header,
 * so on any deployment not served from exactly http://localhost:5000, the
 * browser's request for the application's own JavaScript was "cross-origin",
 * failed the allowlist, and returned 500. index.html loaded, every script 500'd,
 * and the page rendered nothing, with "Error: Not allowed by CORS" the only clue
 * in the log.
 *
 * A request whose Origin matches the host it was sent to is same-origin and is
 * always allowed; that is the case the app itself is in, on any hostname and any
 * port, without configuration.
 */
export const corsConfig = cors({
  origin: function (this: any, origin, callback) {
    // No Origin: a navigation, a curl, a server-to-server call. Nothing to allow.
    if (!origin) return callback(null, true);

    const configured = (process.env.CORS_ORIGINS || process.env.PROD_ORIGIN || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const allowedOrigins = new Set([
      ...configured,
      // Local development conveniences only; production relies on the
      // same-origin check below or on CORS_ORIGINS.
      ...(process.env.NODE_ENV !== 'production'
        ? [
            'http://localhost:5000',
            'http://localhost:5173',
            'http://localhost:3000',
            'http://127.0.0.1:5000',
            'http://127.0.0.1:5173',
          ]
        : []),
    ]);

    if (allowedOrigins.has(origin)) return callback(null, true);

    // Same-origin, whatever the host and port happen to be. `this` is the
    // request when cors() invokes the origin callback.
    const host = this?.headers?.host;
    if (host) {
      const sameOrigin = `${this.secure || this.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${host}`;
      if (origin === sameOrigin) return callback(null, true);
      // Behind a proxy the scheme can differ from what this process sees, so
      // compare the authority alone as well.
      try {
        if (new URL(origin).host === host) return callback(null, true);
      } catch {
        /* malformed Origin: fall through to denial */
      }
    }

    // Denied: no CORS headers, no error. The browser blocks the read.
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-requested-with'],
  maxAge: 86400
});

// Security headers configuration
const isDevEnv = process.env.NODE_ENV !== 'production';

// NOTE: In development, we use 'unsafe-inline' for styles due to Vite HMR and React development tools.
// This should NOT be used in production. For production, implement proper nonce-based CSP or styled-components.
const cspDirectives: Record<string, string[] | null> = {
  defaultSrc: ["'self'"],
  /**
   * 'unsafe-inline' for styles, in production too.
   *
   * Not an oversight and not laziness. Radix UI positions every popover, dialog,
   * dropdown, tooltip and select by writing a `style` attribute at runtime, and
   * framer-motion animates the same way. Without this, style-src-attr falls back
   * to style-src and the browser drops those declarations: in production the
   * dialogs render at the wrong place or not at all, while development — which
   * did include 'unsafe-inline' — looks fine. That divergence is worse than the
   * directive it was avoiding.
   *
   * The risk 'unsafe-inline' in style-src carries is CSS injection, which is
   * bounded here: script-src stays strict, so injected CSS cannot execute.
   * Removing it properly means per-render nonces or hashes, which Radix does not
   * currently support.
   */
  styleSrc: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
  fontSrc: ["'self'", "https://fonts.gstatic.com"],
  imgSrc: ["'self'", "data:", "https:", "blob:", "https://api.qrserver.com"],
  // Scripts stay strict in production. Vite injects an inline bootstrap in dev
  // only.
  scriptSrc: isDevEnv ? ["'self'", "'unsafe-inline'"] : ["'self'"],
  /**
   * Where the page may send data.
   *
   * `https:` was in this list, which permits a fetch to any host on the
   * internet and makes the rest of the directive decorative — the point of
   * connect-src on a page holding clinical data is that injected script cannot
   * post it somewhere. The enumerated entries are what the application actually
   * talks to: its own origin, its WebSocket, and the assistant's upstream.
   *
   * Note that the browser never contacts api.openai.com directly — the server
   * proxies it, so that consent and redaction run first. The entry stays only
   * because removing it is a separate change from removing the wildcard, and
   * one of those is a security fix.
   */
  connectSrc: ["'self'", "https://api.openai.com", "wss:", "ws:"],
  mediaSrc: ["'self'", "blob:"],
  // Additional security directives
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"],
  // A valueless directive. It was set to ["'self'"] in production, which emits
  // `upgrade-insecure-requests 'self'`; that is malformed, so browsers ignored
  // the whole directive and no upgrade happened. `null` tells helmet to emit the
  // bare keyword. Off in development, where the app is served over http.
  upgradeInsecureRequests: isDevEnv ? null : [],
};

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: cspDirectives,
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  noSniff: true,
  frameguard: { action: 'deny' },
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});

// Input validation middleware
export const validateInput = (req: Request, res: Response, next: NextFunction) => {
  // Sanitize common dangerous patterns
  const sanitizeString = (str: string): string => {
    if (typeof str !== 'string') return str;
    
    // Remove potential XSS patterns
    return str
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .replace(/eval\s*\(/gi, '')
      .trim();
  };

  // Recursively sanitize request body
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
        if (obj.hasOwnProperty(key)) {
          sanitized[key] = sanitizeObject(obj[key]);
        }
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

// Session security middleware
/**
 * Rotates the session ID periodically, carrying the session contents across.
 *
 * `req.session.regenerate()` does not rotate an ID — it destroys the session and
 * creates an empty one. The previous version restored only `lastRegeneration`,
 * so every rotation silently discarded `user` and `userId` and logged the person
 * out. Because `lastRegeneration` starts undefined, the first authenticated
 * request after login already satisfied the 30-minute test, so the logout could
 * land immediately.
 *
 * It survived unnoticed because the end-to-end test registers and logs in while
 * carrying cookies, and that sequence happens to absorb the one rotation before
 * the assertions run. A real user would be signed out mid-session.
 *
 * Everything except Express's own `cookie` is copied onto the new session; the
 * cookie belongs to the new session and must not be overwritten.
 */
export const enhanceSessionSecurity = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session || !(req.session as any).user) return next();

  const now = Date.now();
  const ROTATE_AFTER_MS = 30 * 60 * 1000;
  const lastRegeneration = (req.session as any).lastRegeneration;

  // A session that has never been stamped was just created — stamp it and
  // leave it alone.
  //
  // This read `|| 0`, so `now - 0` was always far greater than thirty minutes
  // and every freshly issued session was regenerated on its very first
  // authenticated request. Three consequences, all live: the sid changed
  // immediately after every login, so any client that does not follow Set-Cookie
  // perfectly was silently logged out one request in; the session store took two
  // writes per login instead of one; and the thirty-minute rotation this exists
  // to implement never governed the first rotation at all.
  if (typeof lastRegeneration !== 'number') {
    (req.session as any).lastRegeneration = now;
    return next();
  }

  if (now - lastRegeneration <= ROTATE_AFTER_MS) return next();

  const { cookie, ...carried } = req.session as any;

  req.session.regenerate((regenErr) => {
    if (regenErr) {
      // Rotation is a hardening measure; failing it must not end the session.
      console.error('Session regeneration error:', regenErr);
      return next();
    }

    Object.assign(req.session, carried);
    (req.session as any).lastRegeneration = now;

    req.session.save((saveErr) => {
      if (saveErr) console.error('Session save error after regeneration:', saveErr);
      next();
    });
  });
};

// Medical data access logging middleware
export const auditMedicalAccess = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  // Log access to sensitive medical endpoints
  const medicalEndpoints = [
    '/api/scans',
    '/api/patient',
    '/api/medical',
    '/api/appointments',
    '/api/radiologist',
    '/api/doctor'
  ];

  const isMedicalEndpoint = medicalEndpoints.some(endpoint => 
    req.path.startsWith(endpoint)
  );

  if (isMedicalEndpoint && req.session?.user) {
    console.log(`🏥 Medical Data Access: ${req.session.user.role} (${req.session.user.id}) accessed ${req.method} ${req.path} at ${new Date().toISOString()}`);
    
    // In production, you would save this to a secure audit log
    // await auditLogger.logMedicalAccess({
    //   userId: req.session.user.id,
    //   userRole: req.session.user.role,
    //   endpoint: req.path,
    //   method: req.method,
    //   timestamp: new Date(),
    //   ip: req.ip
    // });
  }

  next();
};

// ── Data encryption ────────────────────────────────────────────────────────
//
// Rewritten. The previous pair used crypto.createCipher / createDecipher, and
// that was wrong in two independent ways.
//
// It did not work at all. createCipher was removed in Node 22, which is the
// version this application runs and the version its CI pins, so the first call
// to either function would have thrown "crypto.createCipher is not a function".
// Nothing called them, which is the only reason that went unnoticed.
//
// And it would not have been secure if it had worked. createCipher ignores the
// IV entirely — it derives key and IV from the password with a single-round
// MD5 KDF — so the sixteen random bytes generated below were stored in the
// output and never used. Encryption was deterministic: the same plaintext always
// produced the same ciphertext, which in a medical database leaks that two
// patients share a diagnosis without decrypting anything.
//
// The replacement uses createCipheriv with a fresh 12-byte nonce per message,
// which is what AES-GCM requires.

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
/** GCM's standard nonce length. 12 bytes, not 16. */
const GCM_NONCE_BYTES = 12;
/** Bound into the tag, so a value encrypted here cannot be replayed elsewhere. */
const ENCRYPTION_AAD = Buffer.from('HealthAI-Medical-Data', 'utf8');

/**
 * The 32-byte key, validated.
 *
 * A short or non-hex ENCRYPTION_KEY used to reach createCipher as a password and
 * be silently stretched, so a four-character key looked like it worked. AES-256
 * needs exactly 32 bytes and this refuses anything else.
 */
function encryptionKey(): Buffer {
  const configured = process.env.ENCRYPTION_KEY;
  if (!configured) {
    throw new Error(
      'ENCRYPTION_KEY is not set. Generate one with:' +
        "  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  if (!/^[0-9a-fA-F]{64}$/.test(configured)) {
    throw new Error(
      'ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes) for AES-256.'
    );
  }

  return Buffer.from(configured, 'hex');
}

/** Whether encryption is usable, without throwing. For health reporting. */
export const isEncryptionConfigured = (): boolean => {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
};

/** Returns "nonce:tag:ciphertext", all hex. */
export const encryptSensitiveData = (data: string): string => {
  const key = encryptionKey();
  const nonce = crypto.randomBytes(GCM_NONCE_BYTES);

  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, nonce);
  cipher.setAAD(ENCRYPTION_AAD);

  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${nonce.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
};

export const decryptSensitiveData = (encryptedData: string): string => {
  const key = encryptionKey();

  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed ciphertext: expected nonce:tag:ciphertext');
  }

  const [nonceHex, authTagHex, encrypted] = parts;
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    key,
    Buffer.from(nonceHex, 'hex')
  );
  decipher.setAAD(ENCRYPTION_AAD);
  // A wrong key, a tampered ciphertext or a tampered tag all fail here, in
  // final(), rather than returning plausible-looking rubbish.
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'hex')),
    decipher.final(),
  ]).toString('utf8');
};

// Environment validation
export const validateSecurityEnvironment = () => {
  const requiredEnvVars = [
    'SESSION_SECRET'
  ];
  
  // DATABASE_URL is optional in development
  const optionalInDevVars = ['DATABASE_URL'];
  if (process.env.NODE_ENV === 'production') {
    requiredEnvVars.push('DATABASE_URL');
  }

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }

  /*
   * Production refuses to start on a misconfiguration rather than warning about
   * it.
   *
   * These were three console.warn lines. A warning at boot scrolls past in a
   * deploy log and is gone; the deployment comes up, serves patients, and the
   * fact that transport encryption was never enforced surfaces later or never.
   * SESSION_SECRET already worked this way — it exits — and there is no
   * principled reason the transport and at-rest settings should be softer.
   *
   * Both have deliberate escape hatches, because both have legitimate
   * configurations where the platform is not the right layer to enforce them.
   */
  if (process.env.NODE_ENV === 'production') {
    const fatal: string[] = [];

    // TLS may legitimately terminate at a load balancer or ingress that does not
    // forward x-forwarded-proto in a form this process can check. Saying so
    // explicitly is fine; saying nothing is not.
    const httpsOnly = (process.env.HTTPS_ONLY || '').toLowerCase() === 'true';
    const tlsElsewhere = (process.env.TLS_TERMINATED_UPSTREAM || '').toLowerCase() === 'true';
    if (!httpsOnly && !tlsElsewhere) {
      fatal.push(
        'HTTPS_ONLY is not enabled. Patient data must not travel over plaintext HTTP. ' +
          'Set HTTPS_ONLY=true, or TLS_TERMINATED_UPSTREAM=true if TLS ends at a proxy ' +
          'in front of this process.'
      );
    }

    // At-rest encryption is opt-out rather than silently absent, so a deployment
    // that has genuinely decided against it has recorded that decision.
    const encryptionOptOut =
      (process.env.ALLOW_UNENCRYPTED_AT_REST || '').toLowerCase() === 'true';
    if (!isKeyringConfigured() && !encryptionOptOut) {
      fatal.push(
        'ENCRYPTION_KEY is missing or not 64 hex characters, so at-rest encryption of ' +
          'sensitive fields is unavailable. Generate one with:\n' +
          "     node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n" +
          '     Set ALLOW_UNENCRYPTED_AT_REST=true to proceed without it deliberately.'
      );
    }

    if (fatal.length > 0) {
      console.error('FATAL: refusing to start in production.\n  - ' + fatal.join('\n  - '));
      process.exit(1);
    }

    if (tlsElsewhere) {
      console.warn(
        '⚠️  HTTPS enforcement delegated upstream (TLS_TERMINATED_UPSTREAM=true). ' +
          'This process will not redirect plaintext requests.'
      );
    }
    if (encryptionOptOut) {
      console.warn(
        '⚠️  Running without at-rest encryption (ALLOW_UNENCRYPTED_AT_REST=true).'
      );
    }
    if (!process.env.JWT_SECRET) {
      console.warn('⚠️  JWT_SECRET not set - JWT tokens will be less secure');
    }
  }

  console.log('✅ Security environment validation passed');
};
