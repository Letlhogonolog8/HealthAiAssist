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
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Authentication required' });
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
  const userId = req.session?.user?.id;
  const userRole = req.session?.user?.role;
  const requestedPatientId = parseInt(req.params.patientId || req.params.id || req.query.patientId as string);
  
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
    requestedPatientId
  });
};

export { AuthenticatedRequest };
