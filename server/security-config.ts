import express from 'express';
import {
  createRateLimiters,
  corsConfig,
  securityHeaders,
  validateInput,
  enhanceSessionSecurity,
  auditMedicalAccess,
  validateSecurityEnvironment,
  type AuthenticatedRequest
} from './security-enhanced';

// Apply all security middleware to Express app
export const applySecurityMiddleware = (app: express.Application) => {
  // 1. Validate security environment first
  validateSecurityEnvironment();

  // 2. Trust proxy for rate limiting and security headers
  app.set('trust proxy', 1);

  // 3. Apply security headers
  app.use(securityHeaders);

  // 4. Configure CORS
  app.use(corsConfig);

  // 5. Rate limiting
  const { generalLimiter, authLimiter, medicalLimiter, chatLimiter } = createRateLimiters();
  
  // Apply different rate limits to different routes
  app.use('/api/auth', authLimiter);
  app.use('/api/patient', medicalLimiter);
  app.use('/api/doctor', medicalLimiter);
  app.use('/api/radiologist', medicalLimiter);
  app.use('/api/scans', medicalLimiter);
  app.use('/api/appointments', medicalLimiter);
  app.use('/api/chat', chatLimiter);
  app.use('/api', generalLimiter); // General limiter for other API routes

  // 6. Input validation and sanitization
  app.use(validateInput);

  // 7. Enhanced session security (will be applied after session middleware is configured)

  // 8. Medical data access auditing
  app.use(auditMedicalAccess);

  console.log('🔒 Enhanced security middleware applied successfully');
};

// Additional middleware for specific security requirements
export const requireAuth = (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('RequireAuth - Session exists:', !!req.session);
    console.log('RequireAuth - User in session:', !!req.session?.user);
    console.log('RequireAuth - UserId in session:', req.session?.userId);
  }

  if (!req.session?.user && !req.session?.userId) {
    // In production, don't leak debug info. In development, include for troubleshooting.
    const response: any = { error: 'Authentication required' };
    if (process.env.NODE_ENV !== 'production') {
      response.debug = {
        hasSession: !!req.session,
        hasUser: !!req.session?.user,
        hasUserId: !!req.session?.userId,
        sessionId: req.sessionID
      };
    }
    return res.status(401).json(response);
  }
  next();
};

export const requireRole = (allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
    if (!req.session?.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!allowedRoles.includes(req.session.user.role)) {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        required: allowedRoles,
        current: req.session.user.role
      });
    }
    
    next();
  };
};

export const requireAdmin = (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  if (req.session.user.role !== 'admin') {
    return res.status(403).json({ 
      error: 'Admin access required',
      current: req.session.user.role
    });
  }
  
  next();
};

// Medical data access authorization
export const requireMedicalAccess = (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
  const medicalRoles = ['doctor', 'radiologist', 'admin'];
  const userRole = req.session?.user?.role;
  
  if (!userRole || !medicalRoles.includes(userRole)) {
    return res.status(403).json({ 
      error: 'Medical data access requires healthcare provider credentials',
      userRole: userRole || 'unknown'
    });
  }
  
  next();
};

// Patient data access - ensure users can only access their own data
export const requirePatientDataAccess = (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
  const userId = req.session?.user?.id || req.session?.userId;
  const userRole = req.session?.user?.role;
  const requestedPatientId = parseInt(req.params.patientId || req.params.id || req.query.patientId as string);
  
  console.log('PatientDataAccess - Debug info:', {
    userId,
    userRole,
    requestedPatientId
  });
  
  // Check authentication first
  if (!userId) {
    return res.status(401).json({ 
      error: 'Authentication required'
    });
  }
  
  // Admins and healthcare providers can access any patient data
  if (['admin', 'doctor', 'radiologist'].includes(userRole || '')) {
    return next();
  }
  
  // Patients can only access their own data
  if (userRole === 'patient' && userId === requestedPatientId) {
    return next();
  }
  
  return res.status(403).json({ 
    error: 'Access denied: Cannot access other patient data',
    userId,
    userRole,
    requestedPatientId
  });
};

// `bypassAuthForDebug` used to live here. It fabricated an admin or patient
// session for any unauthenticated request when DEBUG_BYPASS_AUTH=true, and it was
// attached to 14 endpoints including admin staff creation and deletion, patient
// profile reads, and system stats. One environment variable stood between a
// deployment and unauthenticated administrative access.
//
// It is deleted rather than kept-but-disabled. A switch like that in a health
// application is a finding whether or not it happens to be off, and a disabled
// bypass tends not to stay disabled. Use a seeded test account for local work.

export { AuthenticatedRequest };
