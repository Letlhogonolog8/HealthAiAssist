import compression from 'compression';
import express from 'express';
import redis from 'redis';
import { LRUCache } from 'lru-cache';

// In-Memory Cache System
export class CacheManager {
  private cache: LRUCache<string, any>;
  private redisClient: any = null;

  constructor() {
    // Initialize in-memory cache
    this.cache = new LRUCache({
      max: 1000, // Maximum items
      ttl: 1000 * 60 * 15, // 15 minutes TTL
      allowStale: false,
      updateAgeOnGet: false,
      updateAgeOnHas: false,
    });

    // Initialize Redis if available
    this.initializeRedis();
  }

  private async initializeRedis(): Promise<void> {
    try {
      if (process.env.REDIS_URL) {
        this.redisClient = redis.createClient({
          url: process.env.REDIS_URL
        });
        
        this.redisClient.on('error', (err: any) => {
          console.warn('Redis Client Error:', err);
          this.redisClient = null;
        });

        await this.redisClient.connect();
        console.log('✅ Redis connected for caching');
      }
    } catch (error) {
      console.warn('Redis not available, using in-memory cache only');
      this.redisClient = null;
    }
  }

  async get(key: string): Promise<any> {
    // Try in-memory cache first
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    // Try Redis if available
    if (this.redisClient) {
      try {
        const redisValue = await this.redisClient.get(key);
        if (redisValue) {
          const parsed = JSON.parse(redisValue);
          // Store in memory cache for faster access
          this.cache.set(key, parsed);
          return parsed;
        }
      } catch (error) {
        console.warn('Redis get error:', error);
      }
    }

    return null;
  }

  async set(key: string, value: any, ttlSeconds: number = 900): Promise<void> {
    // Store in memory cache
    this.cache.set(key, value);

    // Store in Redis if available
    if (this.redisClient) {
      try {
        await this.redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
      } catch (error) {
        console.warn('Redis set error:', error);
      }
    }
  }

  async delete(key: string): Promise<void> {
    // Delete from memory cache
    this.cache.delete(key);

    // Delete from Redis if available
    if (this.redisClient) {
      try {
        await this.redisClient.del(key);
      } catch (error) {
        console.warn('Redis delete error:', error);
      }
    }
  }

  async invalidatePattern(pattern: string): Promise<void> {
    // Invalidate memory cache entries matching pattern
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }

    // Invalidate Redis entries if available
    if (this.redisClient) {
      try {
        const keys = await this.redisClient.keys(`*${pattern}*`);
        if (keys.length > 0) {
          await this.redisClient.del(keys);
        }
      } catch (error) {
        console.warn('Redis pattern invalidation error:', error);
      }
    }
  }

  getStats(): any {
    return {
      memoryCache: {
        size: this.cache.size,
        calculatedSize: this.cache.calculatedSize,
        remainingTTL: this.cache.ttl,
        hitRatio: this.cache.size > 0 ? 'Available' : 'N/A'
      },
      redisCache: {
        connected: !!this.redisClient,
        status: this.redisClient ? 'Available' : 'Not configured'
      }
    };
  }
}

// Database Performance Optimizer
/**
 * Reports on the database, from the database.
 *
 * Everything this class returned used to be written by hand. `getConnectionPoolStats`
 * described a pool object it had invented rather than the pg pool the server
 * actually uses; `analyzeQueryPerformance` returned a fixed list of index
 * suggestions and one fabricated slow query ("SELECT * FROM medical_scans
 * WHERE...", 245ms, 150 calls) that corresponded to nothing. An operations
 * dashboard that makes up its own numbers is worse than no dashboard: it is
 * consulted during incidents.
 *
 * There was also an optimizedQuery()/executeQuery() pair whose executor logged
 * the SQL and returned `{ mockResult: true, queryTime: Math.random() * 100 }`.
 * Nothing called it, and a cache in front of a fake executor is not something to
 * repair, so it is gone.
 */
export class DatabaseOptimizer {
  /**
   * Live pool counters from pg.
   *
   * `waiting` is the number that matters under load: persistently above zero
   * means requests are queuing for a connection and `max` is too low.
   */
  async getConnectionPoolStats(): Promise<any> {
    try {
      const { pool } = await import('./db');
      return {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
        active: pool.totalCount - pool.idleCount,
        source: 'pg.Pool',
      };
    } catch (error) {
      return { error: 'Connection pool unavailable', detail: (error as Error).message };
    }
  }

  /**
   * Real table statistics, and real slow queries when the server can provide
   * them.
   *
   * pg_stat_user_tables is always available. pg_stat_statements is an extension
   * and is frequently not installed, so its absence is reported as such instead
   * of being papered over with example data.
   */
  async analyzeQueryPerformance(): Promise<any> {
    try {
      const { pool } = await import('./db');

      const tableStats = await pool.query(`
        SELECT relname AS table_name,
               seq_scan,
               idx_scan,
               n_live_tup AS live_rows
        FROM pg_stat_user_tables
        ORDER BY seq_scan DESC
        LIMIT 20
      `);

      let slowQueries: any[] = [];
      let slowQueryNote =
        'pg_stat_statements is not installed; per-query timings are unavailable. ' +
        'Enable it with CREATE EXTENSION pg_stat_statements.';

      try {
        const slow = await pool.query(`
          SELECT calls,
                 round(mean_exec_time::numeric, 2) AS mean_ms,
                 round(total_exec_time::numeric, 2) AS total_ms,
                 left(query, 200) AS query
          FROM pg_stat_statements
          ORDER BY mean_exec_time DESC
          LIMIT 10
        `);
        slowQueries = slow.rows;
        slowQueryNote = 'From pg_stat_statements.';
      } catch {
        /* extension absent: leave the note as-is */
      }

      // A table read mostly by sequential scan, with enough rows for that to
      // cost something, is the one signal worth surfacing without guessing.
      const sequentialScanHeavy = tableStats.rows
        .filter((row: any) => Number(row.seq_scan) > Number(row.idx_scan ?? 0) && Number(row.live_rows) > 1000)
        .map((row: any) => ({
          table: row.table_name,
          seqScans: Number(row.seq_scan),
          indexScans: Number(row.idx_scan ?? 0),
          liveRows: Number(row.live_rows),
        }));

      return {
        tableStats: tableStats.rows,
        sequentialScanHeavy,
        slowQueries,
        slowQueryNote,
        measuredAt: new Date().toISOString(),
      };
    } catch (error) {
      return { error: 'Query analysis unavailable', detail: (error as Error).message };
    }
  }
}

// Bundle Optimization
export class BundleOptimizer {
  static generateOptimizedViteConfig(): any {
    return {
      build: {
        rollupOptions: {
          output: {
            manualChunks: {
              // Vendor chunks
              'vendor-react': ['react', 'react-dom'],
              'vendor-ui': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu'],
              'vendor-charts': ['recharts'],
              'vendor-utils': ['date-fns', 'clsx', 'tailwind-merge'],
              
              // Feature chunks
              'feature-auth': ['src/hooks/useUser.ts', 'src/pages/auth'],
              'feature-chat': ['src/components/enhanced-chat', 'src/hooks/useWebSocketEnhanced'],
              'feature-dashboard': ['src/components/enhanced-dashboard'],
              'feature-medical': ['src/components/ai-scanner', 'src/components/medical-reports'],
            }
          }
        },
        chunkSizeWarningLimit: 1000,
        target: 'esnext',
        minify: 'terser',
        terserOptions: {
          compress: {
            drop_console: true,
            drop_debugger: true
          }
        }
      },
      optimizeDeps: {
        include: [
          'react',
          'react-dom',
          '@tanstack/react-query',
          'recharts'
        ]
      }
    };
  }

  static getPerformanceRecommendations(): string[] {
    return [
      'Implement code splitting with React.lazy()',
      'Use dynamic imports for heavy components',
      'Optimize images with next-gen formats (WebP, AVIF)',
      'Implement service worker for caching',
      'Use React.memo() for expensive components',
      'Lazy load off-screen images',
      'Implement virtual scrolling for large lists',
      'Use useMemo() and useCallback() for expensive calculations'
    ];
  }

  static generateServiceWorkerConfig(): string {
    return `
// Service Worker for HealthAI Assistant
const CACHE_NAME = 'healthai-v1';
const urlsToCache = [
  '/',
  '/static/css/main.css',
  '/static/js/main.js',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cached version or fetch from network
        return response || fetch(event.request);
      }
    )
  );
});
`;
  }
}

// Response Optimization Middleware
export function createCompressionMiddleware(): express.RequestHandler {
  return compression({
    filter: (req, res) => {
      if (req.headers['x-no-compression']) {
        return false;
      }
      return compression.filter(req, res);
    },
    level: 6, // Good balance between compression and speed
    threshold: 1024, // Only compress files larger than 1KB
  });
}

// API Response Optimization
export class ResponseOptimizer {
  static optimizeJsonResponse(data: any): any {
    return {
      ...data,
      timestamp: new Date().toISOString(),
      cached: false,
      version: '1.0'
    };
  }

  // createETagMiddleware() was removed rather than repaired.
  //
  // Two independent reasons. It only acted when res.send() received an object,
  // and res.json() — which every route here uses — serialises first and calls
  // res.send() with a string, so the branch never ran. And Express already emits
  // a weak ETag for exactly these responses via its own `etag` setting, which
  // does work, hashes the whole body instead of the first 16 base64 characters,
  // and does not risk two different payloads sharing a tag.

  static createResponseTimeMiddleware(): express.RequestHandler {
    return (req, res, next) => {
      const start = Date.now();
      
      // Set the header before the response starts
      const originalSend = res.send;
      res.send = function(body) {
        const duration = Date.now() - start;
        if (!res.headersSent) {
          res.set('X-Response-Time', `${duration}ms`);
        }
        
        // Log slow responses
        if (duration > 1000) {
          console.warn(`🐌 Slow response: ${req.method} ${req.path} took ${duration}ms`);
        }
        
        return originalSend.call(this, body);
      };
      
      next();
    };
  }
}

// Memory Management
export class MemoryManager {
  private static memoryUsage = new Map<string, number>();

  static trackMemoryUsage(component: string): void {
    const usage = process.memoryUsage();
    this.memoryUsage.set(component, usage.heapUsed);
    
    // Log memory warnings
    if (usage.heapUsed > 512 * 1024 * 1024) { // 512MB
      console.warn(`⚠️ High memory usage in ${component}: ${(usage.heapUsed / 1024 / 1024).toFixed(2)}MB`);
    }
  }

  static getMemoryStats(): any {
    const usage = process.memoryUsage();
    
    return {
      heapUsed: `${(usage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
      heapTotal: `${(usage.heapTotal / 1024 / 1024).toFixed(2)}MB`,
      external: `${(usage.external / 1024 / 1024).toFixed(2)}MB`,
      rss: `${(usage.rss / 1024 / 1024).toFixed(2)}MB`,
      componentUsage: Object.fromEntries(
        Array.from(this.memoryUsage.entries()).map(([component, bytes]) => [
          component,
          `${(bytes / 1024 / 1024).toFixed(2)}MB`
        ])
      )
    };
  }

  static performGarbageCollection(): void {
    if (global.gc) {
      global.gc();
      console.log('🗑️ Garbage collection performed');
    } else {
      console.warn('Garbage collection not available');
    }
  }
}

// Performance Monitoring
export class PerformanceMonitor {
  private static metrics = new Map<string, Array<{ timestamp: number; value: number }>>();

  static recordMetric(name: string, value: number): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    
    const metricArray = this.metrics.get(name)!;
    metricArray.push({ timestamp: Date.now(), value });
    
    // Keep only last 100 measurements
    if (metricArray.length > 100) {
      metricArray.shift();
    }
  }

  static getMetricsSummary(): any {
    const summary: any = {};
    
    for (const [name, measurements] of this.metrics.entries()) {
      if (measurements.length === 0) continue;
      
      const values = measurements.map(m => m.value);
      const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
      const min = Math.min(...values);
      const max = Math.max(...values);
      
      summary[name] = {
        average: avg,
        min,
        max,
        samples: measurements.length,
        latest: values[values.length - 1]
      };
    }
    
    return summary;
  }

  static createPerformanceMiddleware(): express.RequestHandler {
    return (req, res, next) => {
      const start = process.hrtime.bigint();
      
      res.on('finish', () => {
        const end = process.hrtime.bigint();
        const duration = Number(end - start) / 1000000; // Convert to milliseconds
        
        this.recordMetric('response_time', duration);
        this.recordMetric(`response_time_${req.method}`, duration);
        
        if (req.path.startsWith('/api/')) {
          this.recordMetric('api_response_time', duration);
        }
      });
      
      next();
    };
  }
}

// CDN and Asset Optimization
export class AssetOptimizer {
  static generateCDNConfig(): any {
    return {
      domains: [
        'cdn.healthai.com',
        'assets.healthai.com'
      ],
      routes: {
        '/static/*': 'https://cdn.healthai.com/static/',
        '/images/*': 'https://assets.healthai.com/images/',
        '/uploads/*': 'https://assets.healthai.com/uploads/'
      },
      cacheHeaders: {
        'Cache-Control': 'public, max-age=31536000', // 1 year for static assets
        'Expires': new Date(Date.now() + 31536000000).toUTCString()
      }
    };
  }

  static optimizeImages(): string[] {
    return [
      'Convert PNG/JPEG to WebP format',
      'Implement responsive images with srcset',
      'Use lazy loading for off-screen images',
      'Compress images with 80% quality',
      'Generate multiple sizes for different devices',
      'Use modern formats (AVIF) for supported browsers'
    ];
  }

  static createImageOptimizationMiddleware(): express.RequestHandler {
    return (req, res, next) => {
      if (req.path.match(/\.(jpg|jpeg|png|gif|webp|avif)$/i)) {
        // Set optimal caching headers for images
        res.set('Cache-Control', 'public, max-age=31536000');
        res.set('Vary', 'Accept');
        
        // Serve WebP if supported
        if (req.headers.accept?.includes('image/webp')) {
          res.set('Content-Type', 'image/webp');
        }
      }
      next();
    };
  }
}

// Export singleton instances
export const cacheManager = new CacheManager();
export const databaseOptimizer = new DatabaseOptimizer();

// Performance monitoring intervals
setInterval(() => {
  MemoryManager.trackMemoryUsage('general');
}, 60000); // Every minute

setInterval(() => {
  MemoryManager.performGarbageCollection();
}, 300000); // Every 5 minutes
