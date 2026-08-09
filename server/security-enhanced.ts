import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

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

// Rate limiting configurations for different endpoint types
export const createRateLimiters = () => {
  const isDev = process.env.NODE_ENV === 'development';
  const disableRateLimit = (process.env.DISABLE_RATE_LIMIT || '').toLowerCase() === 'true';
  const shouldSkip = () => isDev || disableRateLimit;
  // General API rate limiting
  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: {
      error: 'Too many requests from this IP, please try again later.',
      retryAfter: 15 * 60 * 1000
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: shouldSkip,
  });

  // Strict rate limiting for authentication endpoints
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // increased from 5 to 50 login attempts per windowMs
    message: {
      error: 'Too many login attempts, please try again later.',
      retryAfter: 15 * 60 * 1000
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: shouldSkip,
  });

  // Medical data endpoints - more permissive for healthcare workflows
  const medicalLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 50, // 50 requests per 5 minutes
    message: {
      error: 'Medical API rate limit exceeded. Please wait before making more requests.',
      retryAfter: 5 * 60 * 1000
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: shouldSkip,
  });

  // Chat/messaging endpoints - higher limit for real-time communication
  const chatLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30, // 30 messages per minute
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
export const corsConfig = cors({
  origin: function (origin, callback) {
    const prodOrigin = process.env.PROD_ORIGIN; // e.g., https://app.yourdomain.com
    const allowedOrigins = new Set([
      'http://localhost:5000',
      'http://localhost:3000',
      'https://localhost:5000',
      'http://192.168.0.160:5000', // Mobile access
      ...(prodOrigin ? [prodOrigin] : [])
    ]);

    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-requested-with'],
  maxAge: 86400
});

// Security headers configuration
const isDevEnv = process.env.NODE_ENV !== 'production';

const cspDirectives: Record<string, string[]> = {
  defaultSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  fontSrc: ["'self'", "https://fonts.gstatic.com"],
  imgSrc: ["'self'", "data:", "https:", "blob:", "https://api.qrserver.com"],
  scriptSrc: isDevEnv ? ["'self'", "'unsafe-eval'", "'unsafe-inline'"] : ["'self'"],
  connectSrc: ["'self'", "https://api.openai.com", "wss:", "https:"],
  mediaSrc: ["'self'", "blob:"],
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
export const enhanceSessionSecurity = (req: Request, res: Response, next: NextFunction) => {
  // Regenerate session ID periodically to prevent session fixation
  if (req.session && (req.session as any).user) {
    const lastRegeneration = (req.session as any).lastRegeneration || 0;
    const now = Date.now();
    
    // Regenerate session every 30 minutes
    if (now - lastRegeneration > 30 * 60 * 1000) {
      req.session.regenerate((err) => {
        if (err) {
          console.error('Session regeneration error:', err);
        } else {
          (req.session as any).lastRegeneration = now;
        }
        next();
      });
      return;
    }
  }
  
  next();
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

// Data encryption utilities
export const encryptSensitiveData = (data: string): string => {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY not set in environment variables');
  }
  
  const algorithm = 'aes-256-gcm';
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(16);
  
  const cipher = crypto.createCipher(algorithm, key);
  cipher.setAAD(Buffer.from('HealthAI-Medical-Data', 'utf8'));
  
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
};

export const decryptSensitiveData = (encryptedData: string): string => {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY not set in environment variables');
  }
  
  const algorithm = 'aes-256-gcm';
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  
  const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  
  const decipher = crypto.createDecipher(algorithm, key);
  decipher.setAAD(Buffer.from('HealthAI-Medical-Data', 'utf8'));
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
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

  // Warn about insecure configurations
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.JWT_SECRET) {
      console.warn('⚠️  JWT_SECRET not set - JWT tokens will be less secure');
    }
    if (!process.env.ENCRYPTION_KEY) {
      console.warn('⚠️  ENCRYPTION_KEY not set - sensitive data encryption disabled');
    }
    if (!process.env.HTTPS_ONLY) {
      console.warn('⚠️  HTTPS_ONLY not set - consider enabling HTTPS enforcement');
    }
  }

  console.log('✅ Security environment validation passed');
};
