// Load environment variables from .env only in non-production environments
import dotenv from 'dotenv';
if (process.env.NODE_ENV !== 'production') {
  const parsed = dotenv.config().parsed ?? {};

  // dotenv never overwrites a variable that is already set. On Windows a User-
  // or Machine-level environment variable therefore silently beats .env, so
  // editing the file appears to work and changes nothing. That is how a
  // SESSION_SECRET of "dev_secret_123" survived being "fixed" in .env.
  //
  // Values are never printed — only the key names, and only when they diverge.
  const shadowed = Object.keys(parsed).filter((key) => process.env[key] !== parsed[key]);
  if (shadowed.length) {
    console.warn(
      `⚠️  ${shadowed.length} variable(s) in .env are being IGNORED because they are ` +
      `already set in the environment:\n     ${shadowed.join(', ')}\n` +
      '     The pre-existing value wins. Editing .env will not change these.\n' +
      '     Inspect with: [Environment]::GetEnvironmentVariable(\'NAME\',\'User\'|\'Machine\')\n' +
      '     Note that a terminal opened before a system variable changed still ' +
      'carries the old value — reopen it.'
    );
  }
}

import { randomBytes } from "crypto";
import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import rateLimit from "express-rate-limit";
import { registerRoutes } from "./routes";
import { registerHealthRoute } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

import { applySecurityMiddleware } from "./security-config";
import { setupMonitoring } from "./monitoring";
import { initializeEnhancedWebSocket } from "./websocket";
import { enhancedWsManager } from "./websocket";

const app = express();

// Apply enhanced security middleware first
applySecurityMiddleware(app);

// Setup monitoring middleware and routes
setupMonitoring(app);

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

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Application specific logging, throwing an error, or other logic here
});

(async () => {
  try {
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
    
    app.use(session(sessionConfig));
    
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

    // Serve manifest.json with proper content-type
    app.get('/manifest.json', (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.sendFile('manifest.json', { root: process.cwd() });
    });

    // Lightweight health endpoint for uptime checks
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

    // Register basic health endpoint before other middleware that may catch-all
    try { registerHealthRoute(app); } catch {}

    const server = await registerRoutes(app);

    // Initialize enhanced WebSocket
    const wsManager = initializeEnhancedWebSocket(server);
    console.log('🔌 Enhanced WebSocket server initialized');

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      
      log(`Error: ${message}`);
      res.status(status).json({ message });
    });

    // Setup vite in development mode
    if (app.get("env") === "development") {
      await setupVite(app, server);
    } else {
      serveStatic(app);
    }

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
