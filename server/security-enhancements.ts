import express, { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';

// Middleware to enforce HTTPS in production
export function enforceHTTPS(req: Request, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(`https://${req.headers.host}${req.url}`);
  }
  next();
}

// Rate limiting middleware to prevent abuse
export const apiRateLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutes - increased window
  max: 300, // increased limit each IP to 300 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later.',
  skipSuccessfulRequests: true, // do not count successful requests
  handler: (req, res) => {
    const rateLimitInfo = (req as any).rateLimit;
    res.status(429).json({
      error: 'Too many requests from this IP, please try again later.',
      retryAfter: rateLimitInfo && rateLimitInfo.resetTime ? Math.ceil((rateLimitInfo.resetTime.getTime() - Date.now()) / 1000) : 60
    });
  }
});

// Session security enhancements
export function sessionSecurityConfig() {
  return {
    secret: process.env.SESSION_SECRET || 'fallback-secret-key-for-development',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production', // secure cookies in production
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  };
}
