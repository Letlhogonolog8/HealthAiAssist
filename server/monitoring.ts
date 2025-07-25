import express from 'express';
import statusMonitor from 'express-status-monitor';

export function setupMonitoring(app: express.Express) {
  // Setup express-status-monitor middleware for basic monitoring
  app.use(statusMonitor());

  // Endpoint to serve monitoring dashboard
  app.get('/status', (req, res) => {
    res.redirect('/status-monitor');
  });
}
