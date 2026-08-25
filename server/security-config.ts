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

  // 4. Configure CORS, on the API only.
  //
  // Static assets are same-origin by construction and gain nothing from CORS
  // headers. Running this middleware over them is what turned a rejected origin
  // into a 500 on the application's own JavaScript.
  app.use('/api', corsConfig);

  // 5. Rate limiting is NOT applied here. See applyRateLimiting() below.

  // 6. Input validation and sanitization
  app.use(validateInput);

  // 7. Enhanced session security (will be applied after session middleware is configured)

  // 8. Medical data access auditing
  app.use(auditMedicalAccess);

  console.log('🔒 Enhanced security middleware applied successfully');
};

/**
 * Installs the rate limiters. Must be called AFTER the session middleware.
 *
 * These used to be part of applySecurityMiddleware(), which runs at module scope
 * before the session store has been configured — the session is set up inside
 * an async block once the database connection has been tested. Every limiter
 * therefore saw `req.session === undefined`, so the per-account keys and
 * ceilings they are configured with could never take effect and every request in
 * the system, from every user behind a shared address, competed for one
 * anonymous IP budget.
 */
export const applyRateLimiting = (app: express.Application) => {
  const { generalLimiter, authLimiter, medicalLimiter, chatLimiter, scanLimiter } = createRateLimiters();

  // Most specific prefix first: Express runs them in registration order and each
  // one that passes calls next(), so a /api/patient request is metered by the
  // medical limiter and then by the general one.
  app.use('/api/auth', authLimiter);
  app.use('/api/patient', medicalLimiter);
  app.use('/api/doctor', medicalLimiter);
  app.use('/api/radiologist', medicalLimiter);
  // Scans get their own ceiling BEFORE the medical one. Registration order is
  // evaluation order, and this is the expensive endpoint in the system — see
  // scanLimiter in security-enhanced.ts.
  app.use('/api/scans', scanLimiter);
  app.use('/api/scan', scanLimiter);
  app.use('/api/scans', medicalLimiter);
  app.use('/api/appointments', medicalLimiter);
  // Both chat surfaces. `/api/chat` does not cover `/api/chatbot/...`: Express
  // matches a mount path only at a segment boundary, so the prefix that looks
  // like it covers both matched only the first, and the route that forwards
  // messages to a metered third-party API was left on the general limiter.
  app.use('/api/chat', chatLimiter);
  app.use('/api/chatbot', chatLimiter);
  app.use('/api', generalLimiter);

  console.log('🚦 Rate limiting applied (per-account where authenticated)');
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

/**
 * Blocks a privileged account that has not enrolled a second factor.
 *
 * Only active when MFA_ENFORCE=true. See server/mfa.ts for why that is not the
 * default: enabling enrolment and enforcement in the same deploy locks out every
 * existing clinician simultaneously, including whoever would have to fix it.
 *
 * Deliberately mounted on clinical data access rather than on login. An
 * un-enrolled clinician can still sign in and reach the enrolment screen —
 * being unable to log in at all leaves no route to compliance except an
 * administrator manually clearing the flag, which is a support process that
 * bypasses the control.
 */
export const requireMfaEnrolled = async (
  req: AuthenticatedRequest,
  res: express.Response,
  next: express.NextFunction
) => {
  const { mfaEnforced, roleRequiresMfa } = await import('./mfa');
  if (!mfaEnforced()) return next();

  const role = req.session?.user?.role;
  if (!roleRequiresMfa(role)) return next();

  if (req.session?.user?.mfaEnabled) return next();

  try {
    // Re-read rather than trusting the session copy: the session was populated
    // at login and enrolment may have happened since, in this same session.
    const { storage } = await import('./storage');
    const user = await storage.getUser(req.session!.user!.id);
    if (user?.mfaEnabled) {
      req.session.user!.mfaEnabled = true;
      return next();
    }
  } catch (error) {
    // The lookup failed, which means the database is unreachable. Passing the
    // request on is safe here and denying it is not useful: this is a
    // defence-in-depth layer above requireAuth and requireMedicalAccess, and
    // every handler behind it needs the same database to return anything at
    // all. A 500 from the handler is a clearer signal than a 403 claiming an
    // enrolment problem that may not exist.
    console.error('MFA enrolment check failed; passing through:', error);
    return next();
  }

  return res.status(403).json({
    error: 'Two-factor authentication is required for this role before patient data can be accessed.',
    code: 'MFA_ENROLLMENT_REQUIRED',
  });
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

/**
 * Gates a patient-scoped route on an actual care relationship.
 *
 * `resolvePatientId` is passed in because the patient is identified differently
 * on different routes: a path parameter on /api/patient/profile/:id, the owner
 * of a scan on /api/scans/:id/image. Resolving it inside each route handler and
 * checking there would put the decision in twenty places; passing a resolver
 * keeps it in one.
 *
 * Returns 403 with code NO_CARE_RELATIONSHIP and the break-glass path, so a
 * clinician who genuinely needs the record is told how to get it rather than
 * being left to find a way around the control.
 *
 * In shadow mode (the default) the denial is recorded and the request proceeds.
 * See server/care-relationship.ts for why that is the right default for a
 * rollout and the wrong one to leave in place indefinitely.
 */
export const requireCareRelationship = (
  resolvePatientId: (req: AuthenticatedRequest) => Promise<number | null> | number | null
) => {
  return async (
    req: AuthenticatedRequest,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const actorId = req.session?.user?.id;
    const actorRole = req.session?.user?.role;
    if (!actorId || !actorRole) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    let patientId: number | null = null;
    try {
      patientId = await resolvePatientId(req);
    } catch {
      patientId = null;
    }

    // Nothing to gate on. Let the handler answer — it will 404 on an id that
    // does not resolve, which is a clearer response than a 403 implying the
    // record exists and is merely out of reach.
    if (patientId === null || Number.isNaN(patientId)) return next();

    try {
      const { evaluateAccess, careRelationshipEnforced } = await import('./care-relationship');
      const decision = await evaluateAccess(actorId, actorRole, patientId);

      if (decision.allowed) {
        // Recorded on the request so the audit middleware can name the basis.
        // "allowed" tells an access review nothing; "allowed, break_glass" tells
        // it where to look.
        (req as any).accessBasis = decision.basis;
        return next();
      }

      const { recordAuditEvent } = await import('./security-middleware');
      if (!careRelationshipEnforced()) {
        await recordAuditEvent({
          action: 'CARE_RELATIONSHIP_WOULD_BLOCK',
          actorUserId: actorId,
          actorRole,
          method: req.method,
          path: req.path,
          statusCode: 200,
          detail: `shadow mode: no care relationship with patient ${patientId}`,
        });
        (req as any).accessBasis = 'none';
        return next();
      }

      await recordAuditEvent({
        action: 'CARE_RELATIONSHIP_BLOCKED',
        actorUserId: actorId,
        actorRole,
        method: req.method,
        path: req.path,
        statusCode: 403,
        detail: `no care relationship with patient ${patientId}`,
      });

      return res.status(403).json({
        error:
          'You do not have a recorded care relationship with this patient. If this ' +
          'is clinically urgent, request emergency access.',
        code: 'NO_CARE_RELATIONSHIP',
        breakGlass: '/api/clinical/break-glass',
      });
    } catch (error) {
      // The lookup needs the database, and so does every handler behind this.
      // A 500 from the handler is a clearer signal than a 403 asserting an
      // access problem that may not exist.
      console.error('Care relationship check failed; passing through:', error);
      return next();
    }
  };
};

// Patient data access - ensure users can only access their own data
export const requirePatientDataAccess = (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
  const userId = req.session?.user?.id || req.session?.userId;
  const userRole = req.session?.user?.role;
  const requestedPatientId = parseInt(req.params.patientId || req.params.id || req.query.patientId as string);

  // No debug log here.
  //
  // This unconditionally wrote { userId, userRole, requestedPatientId } to
  // stdout on every patient-scoped request, in production as well as
  // development, where it was collected by whatever aggregates logs on the
  // host. That is a record of which account looked at which patient, sitting
  // outside the audit table that is supposed to be the sole home for exactly
  // that fact — retained on a different schedule, readable by anyone with log
  // access, and invisible to the access review the audit table supports.
  //
  // Denials are recorded by auditMedicalAccess, which writes to audit_events.

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
  
  // The body carries no identifiers.
  //
  // It used to echo userId, userRole and requestedPatientId. The caller already
  // knows its own id and role, so those add nothing — but requestedPatientId is
  // the server confirming that a given patient id was recognised and reached the
  // authorisation check, which turns a 403 into an oracle: walk the id space and
  // the differences between responses enumerate the patient table.
  return res.status(403).json({
    error: 'Access denied: Cannot access other patient data'
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
