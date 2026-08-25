// Must be the very first import: it loads .env, and ES module evaluation
// order means anything imported before it (transitively ./db) would read
// DATABASE_URL before the file had been applied.
import './load-env';

import { randomBytes } from "crypto";
import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import rateLimit from "express-rate-limit";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

import { applySecurityMiddleware, applyRateLimiting } from "./security-config";
import { setupMonitoring } from "./monitoring";
import { createCompressionMiddleware, ResponseOptimizer, PerformanceMonitor } from "./performance-optimizer";
import { trackApiUsage } from "./analytics-engine";
import { requestLogger, installProcessHandlers } from "./request-log";
import { initializeEnhancedWebSocket } from "./websocket";
import { enhancedWsManager } from "./websocket";

const app = express();

// Apply enhanced security middleware first
applySecurityMiddleware(app);

// Setup monitoring middleware and routes
setupMonitoring(app);

// Performance middleware, ahead of every router.
//
// These three used to be registered at the bottom of registerRoutes, after all
// the handlers. Express runs middleware in registration order and a handler that
// responds never calls next(), so none of them ever executed: nothing was
// compressed, X-Response-Time was never set, and the performance monitor
// recorded no samples. Wrapping a response requires being in front of it.
app.use(createCompressionMiddleware());
app.use(ResponseOptimizer.createResponseTimeMiddleware());
app.use(PerformanceMonitor.createPerformanceMiddleware());

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Session configuration - will be set up after database connection test
// Using enhanced session security configuration
const isProduction = process.env.NODE_ENV === 'production';
const httpsOnly = (process.env.HTTPS_ONLY || 'false').toLowerCase() === 'true';

// Warn if HTTPS is not enabled in production
if (isProduction && !httpsOnly) {
  console.warn('⚠️  WARNING: HTTPS_ONLY is not enabled in production. This is a security risk.');
  console.warn('   Set HTTPS_ONLY=true in production environment variables.');
}

// HTTPS enforcement middleware - redirect HTTP to HTTPS in production
if (httpsOnly) {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(301, `https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}

/**
 * Resolves the session signing secret.
 *
 * There is deliberately no hardcoded fallback. The previous default —
 * 'your-secure-session-secret-here-dev-only' — is a literal published in this
 * repository, so any deployment missing the environment variable signed its
 * session cookies with a value an attacker could read here and forge.
 *
 * Production refuses to start without one. Development mints an ephemeral random
 * secret: sessions do not survive a restart, which is mildly annoying and far
 * better than a known key.
 */
function resolveSessionSecret(): string {
  const configured = process.env.SESSION_SECRET;

  if (configured && configured.length >= 64 && !configured.startsWith('CHANGE_ME')) {
    return configured;
  }

  if (process.env.NODE_ENV === 'production') {
    console.error(
      'FATAL: SESSION_SECRET is missing, too short (min 64 chars), or still the ' +
      'placeholder. Generate one with:\n' +
      "  node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\""
    );
    process.exit(1);
  }

  console.warn(
    '⚠️  SESSION_SECRET not set or too short. Using an ephemeral secret for this ' +
    'process; sessions will be invalidated on restart.'
  );
  return randomBytes(64).toString('hex');
}

/**
 * Refuses to start in production without durable storage for scan images.
 *
 * `persistScanImage` falls back to writing into the container's local
 * `uploads/` directory when no object store is configured. That directory is
 * ephemeral on Render, Railway and Cloud Run — the three deploy targets in this
 * repository — so the fallback silently discards patient imaging on the next
 * deploy, restart or autoscale event.
 *
 * The failure is invisible while it happens: the upload succeeds, the model
 * runs, the finding is written, and the row keeps an `image_path` pointing at a
 * file that no longer exists. It surfaces later, as a radiologist opening a scan
 * flagged high-risk and finding no image behind it — which makes the human
 * review step that every model card in this project insists on impossible to
 * perform, for the scans where it matters most.
 *
 * Development keeps the fallback: losing images from local experiments costs
 * nothing, and requiring a bucket to run the app would be a poor trade.
 *
 * Set GOOGLE_CLOUD_PROJECT_ID, GOOGLE_CLOUD_CLIENT_EMAIL,
 * GOOGLE_CLOUD_PRIVATE_KEY and GOOGLE_CLOUD_SCAN_BUCKET, or set
 * ALLOW_EPHEMERAL_SCAN_STORAGE=true to accept the loss deliberately.
 */
async function assertScanStorageConfigured(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') return;

  if ((process.env.ALLOW_EPHEMERAL_SCAN_STORAGE || '').toLowerCase() === 'true') {
    console.warn(
      '⚠️  ALLOW_EPHEMERAL_SCAN_STORAGE is set. Scan images will be written to ' +
      'container-local disk and lost on the next deploy. Every stored finding ' +
      'will outlive the image it was made from.'
    );
    return;
  }

  const { isScanObjectStoreAvailable } = await import('./google-cloud-service');
  if (!isScanObjectStoreAvailable()) {
    console.error(
      [
        'FATAL: no durable object store is configured for scan images, and this is a production start.',
        '  Scan images would be written to ephemeral container disk and lost on the next deploy,',
        '  leaving findings with no image behind them.',
        '  Set GOOGLE_CLOUD_PROJECT_ID, GOOGLE_CLOUD_CLIENT_EMAIL, GOOGLE_CLOUD_PRIVATE_KEY',
        '  and GOOGLE_CLOUD_SCAN_BUCKET, or set ALLOW_EPHEMERAL_SCAN_STORAGE=true to accept',
        '  that loss deliberately.',
      ].join('\n')
    );
    process.exit(1);
  }
}

let sessionConfig: any = {
  secret: resolveSessionSecret(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    // Use Secure+SameSite=None only when HTTPS_ONLY is enabled (i.e., behind HTTPS)
    secure: httpsOnly,
    httpOnly: true,
    sameSite: httpsOnly ? 'none' as 'none' : 'lax' as 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  },
  name: 'healthai.sid' // Custom session name
};

// Request logging.
//
// The previous logger wrapped res.json to capture every response body and
// appended it to the line, truncated to eighty characters — which for
// /api/patient/profile/:id is a patient's name and the start of their email
// address, written to stdout and collected by whatever aggregates logs on the
// host. See server/request-log.ts. Nothing is logged from a response body now.
app.use(requestLogger);

installProcessHandlers();

(async () => {
  try {
    // Before anything else that could accept a request.
    await assertScanStorageConfigured();

    // Test database connection before starting server
    let dbConnected = false;
    try {
      const { testDbConnection } = await import("./db");
      dbConnected = await testDbConnection();
      
      // Setup PostgreSQL session store
      if (dbConnected) {
        const { pool } = await import("./db");
        const PgSession = connectPgSimple(session);
        sessionConfig.store = new PgSession({
          pool,
          tableName: 'session'
        });
        log("Using PostgreSQL session store");
      }
    } catch (dbError) {
      console.error('Database connection error:', dbError);
      dbConnected = false;
    }
    
    if (!dbConnected) {
      log("Using memory session store (database connection failed)");
    }
    
    // Kept as a reference so the WebSocket upgrade handler can run the exact same
    // middleware and recover the same session. Sockets authenticate from the
    // session cookie; without this they would have to trust whatever identity the
    // client claimed, which is what they used to do.
    const sessionMiddleware = session(sessionConfig);

    /**
     * Paths that cannot act on a session, and so should not load one.
     *
     * connect-pg-simple issues a SELECT against the session table for every
     * request carrying the cookie. Mounted globally, that meant a database round
     * trip for each of the hundred-odd module requests Vite serves on a dev page
     * load, and for every hashed asset in production — none of which can read or
     * write a session.
     *
     * Against a pooler that allows 15 clients, that volume is what pushed the
     * pool past its limit and produced EMAXCONNSESSION partway through a page.
     *
     * Deliberately a prefix allowlist of asset namespaces rather than an
     * extension check: /api must always get a session, and so must the SPA
     * document, so anything not matched here keeps the middleware.
     */
    const SESSIONLESS_PREFIXES = [
      '/@',             // Vite internals: /@vite, /@fs, /@react-refresh
      '/src/',          // dev source modules
      '/node_modules/', // dev dependency modules
      '/assets/',       // production build output
    ];

    app.use((req, res, next) => {
      if (SESSIONLESS_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
        return next();
      }
      return sessionMiddleware(req, res, next);
    });

    // Rate limiting reads req.session to meter per account rather than per IP,
    // so it has to come after the session middleware and before the routes.
    applyRateLimiting(app);

    // Needs the session, so it goes after it — and ahead of the routes, so it
    // actually sees requests.
    app.use('/api', trackApiUsage);

    /**
     * MFA enrolment gate on the clinical surfaces.
     *
     * No-op unless MFA_ENFORCE=true. Mounted here rather than on each route so
     * that a route added later is covered by default — the opposite of how
     * requireAuth was once dropped from several /api/doctor/* handlers during a
     * refactor, which is why tests/auth-matrix.test.ts exists.
     *
     * /api/auth is deliberately absent: an un-enrolled clinician has to be able
     * to reach the enrolment endpoints.
     */
    const { requireMfaEnrolled } = await import('./security-config');
    app.use('/api/patient', requireMfaEnrolled);
    app.use('/api/doctor', requireMfaEnrolled);
    app.use('/api/radiologist', requireMfaEnrolled);
    app.use('/api/scans', requireMfaEnrolled);
    app.use('/api/admin', requireMfaEnrolled);
    
    // Apply enhanced session security after session middleware
    try {
      const { enhanceSessionSecurity } = await import("./security-enhanced");
      app.use(enhanceSessionSecurity);
    } catch (securityError) {
      console.error('Security middleware error:', securityError);
    }
    
    if (!dbConnected) {
      log("Warning: Database connection failed, but continuing with server startup");
    }

    // Initialize storage with fallback mechanism
    try {
      const { initializeStorage } = await import("./storage");
      await initializeStorage();
      log("Storage initialized successfully");
    } catch (storageError) {
      console.error('Storage initialization error:', storageError);
      log("Using fallback storage");
    }

    // The hand-written /manifest.json route that stood here is gone.
    //
    // It served a file whose "icons" array was empty, which makes a PWA
    // non-installable — no install prompt, no error, nothing to notice. The
    // manifest is now generated by vite-plugin-pwa with real icons and is
    // served from the build output like any other static asset.

    /**
     * Liveness. Cheap, always 200 while the process is running.
     *
     * Deliberately does not touch the database: a liveness probe that fails on a
     * transient database blip gets the container killed and restarted, which
     * does not fix a database.
     */
    app.get('/api/health', (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.status(200).send(JSON.stringify({
        status: 'ok',
        env: app.get('env'),
        uptimeSec: Math.round(process.uptime()),
        websocket: enhancedWsManager ? {
          connections: enhancedWsManager.getConnectionCount(),
        } : { connections: 0 }
      }));
    });

    /**
     * Readiness: can this instance actually serve requests?
     *
     * Separate from /api/health because they answer different questions and a
     * load balancer needs the second one. The server starts even when the
     * database is unreachable — it falls back to an in-memory store holding no
     * accounts, so every login fails — and /api/health still answered
     * {"status":"ok"}, so a broken instance stayed in rotation indefinitely,
     * silently refusing every login it received.
     *
     * The result is cached briefly so a health check every second does not become
     * a query every second.
     */
    let readinessCache: { at: number; ok: boolean; detail: any } | null = null;
    const READINESS_TTL_MS = 5000;

    app.get('/api/ready', async (_req, res) => {
      const now = Date.now();
      if (!readinessCache || now - readinessCache.at > READINESS_TTL_MS) {
        let ok = false;
        let detail: any = { database: 'unreachable' };
        try {
          const { pool } = await import('./db');
          const started = Date.now();
          await pool.query('SELECT 1');
          ok = true;
          detail = {
            database: 'ok',
            latencyMs: Date.now() - started,
            pool: {
              total: pool.totalCount,
              idle: pool.idleCount,
              waiting: pool.waitingCount,
            },
          };
        } catch (error) {
          detail = { database: 'unreachable', error: (error as Error).message };
        }
        readinessCache = { at: now, ok, detail };
      }

      // Which channels can actually reach a patient. Not part of readiness — the
      // instance serves fine without them — but an operator checking this endpoint
      // should be able to see that nothing can be delivered.
      const { deliveryChannelStatus } = await import('./notification-delivery');
      // Key ids and a count, never key material. An operator needs to know which
      // key is active before retiring the previous one.
      const { keyringStatus } = await import('./crypto/keyring');

      // Which models are resident, and whether the service holding them is
      // reachable. Not part of readiness either — the instance serves the rest
      // of the application fine without it, and a scan submitted while it is
      // down is refused with 503 and queued for a human, which is the designed
      // behaviour rather than an outage. But an operator needs to see that
      // automated analysis is currently unavailable, and to be able to confirm
      // that the artifact hashes here match the model_version values being
      // written to medical_scans.
      const { inferenceHealth } = await import('./inference-client');

      res.status(readinessCache.ok ? 200 : 503).json({
        status: readinessCache.ok ? 'ready' : 'not_ready',
        uptimeSec: Math.round(process.uptime()),
        ...readinessCache.detail,
        notificationChannels: deliveryChannelStatus(),
        encryption: keyringStatus(),
        inference: await inferenceHealth(),
      });
    });

    // Optional dev seeding
    try {
      if ((process.env.DEV_SEED || '').toLowerCase() === 'true' && app.get('env') === 'development') {
        const { seedDev } = await import('../scripts/seed-dev');
        const result = await seedDev();
        console.log(`🌱 Dev seed: users=${result.createdUsers}, scans=${result.createdScans}, appointments=${result.createdAppointments}`);
      }
    } catch (seedError) {
      console.warn('Dev seed failed:', seedError);
    }

    const server = await registerRoutes(app);

    // Initialize enhanced WebSocket. This is the only place it is started:
    // a second manager on the same server crashes the process on the first
    // upgrade (see initializeEnhancedWebSocket).
    initializeEnhancedWebSocket(server, sessionMiddleware);
    console.log('🔌 Enhanced WebSocket server initialized');

    // An unmatched /api path is a 404, not the single-page app.
    //
    // Both setupVite and serveStatic end in app.use("*", ...) serving
    // client/index.html with status 200. That catch-all also swallowed every
    // mistyped or removed API route: GET /api/does-not-exist answered 200 with a
    // page of HTML, so client code calling response.json() on it failed with a
    // parse error somewhere unrelated instead of seeing a 404. Registered here,
    // ahead of the SPA fallback, so only /api is affected.
    app.use('/api', (req, res) => {
      res.status(404).json({ error: 'Not found', path: req.originalUrl });
    });

    // Setup vite in development mode
    if (app.get("env") === "development") {
      await setupVite(app, server);
    } else {
      serveStatic(app);
    }

    // Error handler last.
    //
    // Express resumes from the failing layer forward when next(err) is called,
    // so a handler registered before the middleware that throws is never
    // reached. This sat above setupVite/serveStatic, which meant errors from the
    // SPA fallback — a missing build directory, an unreadable index.html —
    // bypassed it and hit Express's default handler, which in development
    // returns a stack trace to the browser.
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

      log(`Error: ${message}`);

      // Never leak an internal message to the client in production; it has
      // carried SQL text and file paths before.
      const body =
        status >= 500 && process.env.NODE_ENV === 'production'
          ? { message: 'Internal Server Error' }
          : { message };

      if (res.headersSent) return;
      res.status(status).json(body);
    });

    const port = parseInt(process.env.PORT || '5000', 10);
    server.listen(port, '0.0.0.0', () => {
      log(`serving on port ${port}`);
      log(`Local: http://localhost:${port}`);
      log(`Mobile: http://192.168.0.160:${port}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
})();
