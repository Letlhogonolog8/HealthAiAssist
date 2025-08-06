// Load environment variables first
import dotenv from 'dotenv';
dotenv.config();

import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import rateLimit from "express-rate-limit";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

import { applySecurityMiddleware } from "./security-config";
import { setupMonitoring } from "./monitoring";
import { initializeEnhancedWebSocket } from "./websocket";

const app = express();

// Apply enhanced security middleware first
applySecurityMiddleware(app);

// Setup monitoring middleware and routes
setupMonitoring(app);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Session configuration - will be set up after database connection test
// Using enhanced session security configuration

let sessionConfig: any = {
  secret: process.env.SESSION_SECRET || 'your-secure-session-secret-here',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax' as 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
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
    const { testDbConnection } = await import("./db");
    const dbConnected = await testDbConnection();
    
    // Setup PostgreSQL session store
    if (dbConnected) {
      const { pool } = await import("./db");
      const PgSession = connectPgSimple(session);
      sessionConfig.store = new PgSession({
        pool,
        tableName: 'session'
      });
      log("Using PostgreSQL session store");
    } else {
      log("Using memory session store (database connection failed)");
    }
    
    app.use(session(sessionConfig));
    
    // Apply enhanced session security after session middleware
    const { enhanceSessionSecurity } = await import("./security-enhanced");
    app.use(enhanceSessionSecurity);
    
    if (!dbConnected) {
      log("Warning: Database connection failed, but continuing with server startup");
    }

    // Serve manifest.json with proper content-type
    app.get('/manifest.json', (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.sendFile('manifest.json', { root: process.cwd() });
    });

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
      log(`Mobile: http://192.168.0.152:${port}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
})();
