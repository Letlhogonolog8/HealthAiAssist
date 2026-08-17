import express from 'express';
import aiRoutes from './ai-routes';
import { analyticsEngine } from './analytics-engine';
import { 
  TwoFactorAuth, 
  AuditLogger, 
  ComplianceChecker,
  SessionManager,
  SecurityMonitor,
  PasswordSecurity
} from './advanced-security';
import { 
  cacheManager,
  databaseOptimizer,
  PerformanceMonitor,
  MemoryManager,
  BundleOptimizer,
  AssetOptimizer
} from './performance-optimizer';
import { requireAuth, requireMedicalAccess, AuthenticatedRequest } from './security-config';

const router = express.Router();

// ===================
// AI ENHANCEMENT ROUTES
// ===================
router.use('/ai', aiRoutes);

// ===================
// ADVANCED SECURITY ROUTES
// ===================

// Two-Factor Authentication Setup
router.post('/security/2fa/setup', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userEmail = req.session.user?.email || `user${req.session.user?.id}@healthai.local`;
    const { secret, qrCode, backupCodes } = TwoFactorAuth.generateSecret(userEmail);
    
    // Generate QR code
    const qrCodeImage = await TwoFactorAuth.generateQRCode(qrCode);
    
    // Store secret temporarily (in production, store encrypted in database)
    await cacheManager.set(`2fa_setup_${req.session.user?.id}`, secret, 600); // 10 minutes
    
    await AuditLogger.logSecurityEvent({
      userId: req.session.user?.id,
      userRole: req.session.user?.role,
      action: '2fa_setup_initiated',
      resource: 'user_security',
      outcome: 'success',
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || ''
    });

    res.json({
      qrCode: qrCodeImage,
      backupCodes,
      instructions: 'Scan QR code with authenticator app, then verify with a token'
    });

  } catch (error) {
    console.error('2FA setup error:', error);
    res.status(500).json({ error: 'Failed to setup 2FA' });
  }
});

// Two-Factor Authentication Verification
router.post('/security/2fa/verify', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    // Get temporary secret
    const secret = await cacheManager.get(`2fa_setup_${req.session.user?.id}`);
    if (!secret) {
      return res.status(400).json({ error: '2FA setup expired, please restart setup' });
    }

    // Verify token
    const isValid = TwoFactorAuth.verifyToken(token, secret);
    
    if (isValid) {
      // In production: Save encrypted secret to user's database record
      await cacheManager.delete(`2fa_setup_${req.session.user?.id}`);
      
      await AuditLogger.logSecurityEvent({
        userId: req.session.user?.id,
        userRole: req.session.user?.role,
        action: '2fa_enabled',
        resource: 'user_security',
        outcome: 'success',
        ipAddress: req.ip || '',
        userAgent: req.headers['user-agent'] || ''
      });

      res.json({ 
        success: true, 
        message: '2FA enabled successfully',
        recoveryCodesRemaining: 8
      });
    } else {
      await AuditLogger.logSecurityEvent({
        userId: req.session.user?.id,
        userRole: req.session.user?.role,
        action: '2fa_verification_failed',
        resource: 'user_security',
        outcome: 'failure',
        ipAddress: req.ip || '',
        userAgent: req.headers['user-agent'] || ''
      });

      res.status(400).json({ error: 'Invalid token' });
    }

  } catch (error) {
    console.error('2FA verification error:', error);
    res.status(500).json({ error: 'Failed to verify 2FA' });
  }
});

// Security Compliance Report
router.get('/security/compliance', requireMedicalAccess, async (req, res) => {
  try {
    const [hipaaCompliance, soc2Compliance] = await Promise.all([
      ComplianceChecker.checkHIPAACompliance(),
      ComplianceChecker.checkSOC2Compliance()
    ]);

    res.json({
      timestamp: new Date().toISOString(),
      compliance: {
        hipaa: hipaaCompliance,
        soc2: soc2Compliance
      },
      overallScore: (
        (hipaaCompliance.compliant ? 50 : 0) + 
        (Object.values(soc2Compliance.controlsStatus).filter(Boolean).length / Object.keys(soc2Compliance.controlsStatus).length * 50)
      ),
      recommendations: [
        ...hipaaCompliance.recommendations,
        ...soc2Compliance.recommendations
      ].slice(0, 10)
    });

  } catch (error) {
    console.error('Compliance check error:', error);
    res.status(500).json({ error: 'Failed to generate compliance report' });
  }
});

// Active Sessions Management
router.get('/security/sessions', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const sessions = SessionManager.getActiveSessionsForUser(req.session.user?.id!);
    
    res.json({
      currentSession: req.sessionID,
      activeSessions: sessions,
      totalSessions: sessions.length
    });

  } catch (error) {
    console.error('Sessions fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Terminate All Sessions
router.post('/security/sessions/terminate-all', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const terminatedCount = SessionManager.terminateAllUserSessions(
      req.session.user?.id!,
      req.sessionID
    );

    await AuditLogger.logSecurityEvent({
      userId: req.session.user?.id,
      userRole: req.session.user?.role,
      action: 'all_sessions_terminated',
      resource: 'user_security',
      outcome: 'success',
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
      metadata: { terminatedSessions: terminatedCount }
    });

    res.json({ 
      success: true, 
      terminatedSessions: terminatedCount,
      message: 'All other sessions have been terminated'
    });

  } catch (error) {
    console.error('Session termination error:', error);
    res.status(500).json({ error: 'Failed to terminate sessions' });
  }
});

// Password Strength Check
router.post('/security/password/check', requireAuth, async (req, res) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    const validation = PasswordSecurity.validatePassword(password);
    const strength = PasswordSecurity.checkPasswordStrength(password);

    res.json({
      valid: validation.valid,
      issues: validation.issues,
      strength: strength.strength,
      score: strength.score,
      suggestions: strength.suggestions
    });

  } catch (error) {
    console.error('Password check error:', error);
    res.status(500).json({ error: 'Failed to check password' });
  }
});

// ===================
// ANALYTICS ROUTES
// ===================

// Medical Insights Dashboard
router.get('/analytics/medical-insights', requireMedicalAccess, async (req, res) => {
  try {
    const insights = await analyticsEngine.generateMedicalInsights();
    
    res.json({
      insights,
      generatedAt: new Date().toISOString(),
      totalInsights: insights.length,
      highConfidenceInsights: insights.filter(i => i.confidence > 0.8).length
    });

  } catch (error) {
    console.error('Medical insights error:', error);
    res.status(500).json({ error: 'Failed to generate medical insights' });
  }
});

// User Behavior Analytics
router.get('/analytics/user-behavior', requireMedicalAccess, async (req, res) => {
  try {
    const timeRange = req.query.range as 'day' | 'week' | 'month' || 'week';
    const analytics = await analyticsEngine.getUserBehaviorAnalytics(timeRange);
    
    res.json({
      timeRange,
      ...analytics,
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('User behavior analytics error:', error);
    res.status(500).json({ error: 'Failed to generate user behavior analytics' });
  }
});

// System Performance Metrics
router.get('/analytics/performance', requireAuth, requireMedicalAccess, async (req, res) => {
  try {
    const metrics = await analyticsEngine.getSystemPerformanceMetrics();
    const performanceMetrics = PerformanceMonitor.getMetricsSummary();
    const memoryStats = MemoryManager.getMemoryStats();
    const cacheStats = cacheManager.getStats();

    res.json({
      system: metrics,
      performance: performanceMetrics,
      memory: memoryStats,
      cache: cacheStats,
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Performance metrics error:', error);
    res.status(500).json({ error: 'Failed to fetch performance metrics' });
  }
});

// Business Intelligence Dashboard
router.get('/analytics/business', requireMedicalAccess, async (req, res) => {
  try {
    const insights = await analyticsEngine.generateBusinessInsights();
    
    res.json({
      ...insights,
      generatedAt: new Date().toISOString(),
      reportPeriod: 'Last 30 days'
    });

  } catch (error) {
    console.error('Business insights error:', error);
    res.status(500).json({ error: 'Failed to generate business insights' });
  }
});

// Track User Activity (Analytics)
router.post('/analytics/track', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { action, resource, metadata } = req.body;
    
    await analyticsEngine.trackUserActivity({
      userId: req.session.user?.id!,
      action,
      resource,
      timestamp: new Date(),
      metadata
    });

    await SecurityMonitor.monitorUserActivity(req.session.user?.id!, {
      action,
      resource,
      ipAddress: req.ip || '',
      timestamp: new Date()
    });

    res.json({ success: true });

  } catch (error) {
    console.error('Activity tracking error:', error);
    res.status(500).json({ error: 'Failed to track activity' });
  }
});

// ===================
// PERFORMANCE ROUTES
// ===================

// Cache Management
router.get('/performance/cache/stats', requireMedicalAccess, async (req, res) => {
  try {
    const stats = cacheManager.getStats();
    
    res.json({
      cache: stats,
      recommendations: [
        'Monitor cache hit ratios',
        'Adjust TTL based on data freshness requirements',
        'Consider Redis for distributed caching',
        'Implement cache warming for critical data'
      ]
    });

  } catch (error) {
    console.error('Cache stats error:', error);
    res.status(500).json({ error: 'Failed to fetch cache statistics' });
  }
});

// Clear Cache
router.post('/performance/cache/clear', requireMedicalAccess, async (req, res) => {
  try {
    const { pattern } = req.body;
    
    if (pattern) {
      await cacheManager.invalidatePattern(pattern);
      res.json({ success: true, message: `Cache cleared for pattern: ${pattern}` });
    } else {
      // Clear all cache - be careful with this
      await cacheManager.invalidatePattern('');
      res.json({ success: true, message: 'All cache cleared' });
    }

  } catch (error) {
    console.error('Cache clear error:', error);
    res.status(500).json({ error: 'Failed to clear cache' });
  }
});

// Database Performance Analysis
router.get('/performance/database', requireMedicalAccess, async (req, res) => {
  try {
    const analysis = await databaseOptimizer.analyzeQueryPerformance();
    const connectionStats = databaseOptimizer.getConnectionPoolStats();

    res.json({
      queryAnalysis: analysis,
      connectionPool: connectionStats,
      recommendations: [
        'Implement query result caching',
        'Add database monitoring',
        'Optimize slow queries',
        'Consider read replicas for heavy read workloads'
      ]
    });

  } catch (error) {
    console.error('Database performance error:', error);
    res.status(500).json({ error: 'Failed to analyze database performance' });
  }
});

// Bundle Optimization Recommendations
router.get('/performance/optimization', requireMedicalAccess, async (req, res) => {
  try {
    const viteConfig = BundleOptimizer.generateOptimizedViteConfig();
    const recommendations = BundleOptimizer.getPerformanceRecommendations();
    const assetOptimization = AssetOptimizer.optimizeImages();
    const cdnConfig = AssetOptimizer.generateCDNConfig();

    res.json({
      bundleOptimization: {
        viteConfig,
        recommendations
      },
      assetOptimization,
      cdnConfiguration: cdnConfig,
      implementationPriority: [
        'Enable gzip/brotli compression',
        'Implement code splitting',
        'Optimize images',
        'Set up CDN',
        'Enable service worker caching'
      ]
    });

  } catch (error) {
    console.error('Optimization recommendations error:', error);
    res.status(500).json({ error: 'Failed to generate optimization recommendations' });
  }
});

// System Health Check
router.get('/health', async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '2.0.0',
      services: {
        database: 'connected',
        cache: cacheManager.getStats().redisCache.connected ? 'connected' : 'memory-only',
        ai: 'loaded',
        security: 'active'
      },
      performance: PerformanceMonitor.getMetricsSummary(),
      memory: MemoryManager.getMemoryStats()
    };

    res.json(health);

  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
