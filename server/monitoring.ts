import express from 'express';
// import statusMonitor from 'express-status-monitor';

export function setupMonitoring(app: express.Express) {
  // Disabled express-status-monitor due to Windows wmic compatibility issues
  // app.use(statusMonitor());

  // Simple status endpoint instead
  app.get('/status', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      env: process.env.NODE_ENV
    });
  });
}
