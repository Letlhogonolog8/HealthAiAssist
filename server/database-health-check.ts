import { pool } from './db';

export interface DatabaseHealth {
  isConnected: boolean;
  connectionCount: number;
  lastChecked: Date;
  error?: string;
}

export class DatabaseHealthChecker {
  private static instance: DatabaseHealthChecker;
  private healthStatus: DatabaseHealth = {
    isConnected: false,
    connectionCount: 0,
    lastChecked: new Date()
  };

  static getInstance(): DatabaseHealthChecker {
    if (!DatabaseHealthChecker.instance) {
      DatabaseHealthChecker.instance = new DatabaseHealthChecker();
    }
    return DatabaseHealthChecker.instance;
  }

  async checkHealth(): Promise<DatabaseHealth> {
    try {
      const client = await pool.connect();
      
      // Test basic connectivity
      const result = await client.query('SELECT NOW() as current_time, version() as version');
      
      // Get connection info
      const connectionInfo = await client.query(`
        SELECT 
          count(*) as total_connections,
          count(*) FILTER (WHERE state = 'active') as active_connections
        FROM pg_stat_activity 
        WHERE datname = current_database()
      `);

      client.release();

      this.healthStatus = {
        isConnected: true,
        connectionCount: parseInt(connectionInfo.rows[0]?.total_connections || '0'),
        lastChecked: new Date(),
        error: undefined
      };

      console.log('✅ Database health check passed:', {
        timestamp: result.rows[0]?.current_time,
        connections: this.healthStatus.connectionCount
      });

    } catch (error) {
      this.healthStatus = {
        isConnected: false,
        connectionCount: 0,
        lastChecked: new Date(),
        error: error instanceof Error ? error.message : 'Unknown database error'
      };

      console.error('❌ Database health check failed:', error);
    }

    return this.healthStatus;
  }

  getLastStatus(): DatabaseHealth {
    return this.healthStatus;
  }

  async ensureConnection(): Promise<boolean> {
    const health = await this.checkHealth();
    return health.isConnected;
  }

  // Graceful shutdown
  async shutdown(): Promise<void> {
    try {
      await pool.end();
      console.log('🔌 Database connections closed gracefully');
    } catch (error) {
      console.error('Error closing database connections:', error);
    }
  }
}

// Export singleton instance
export const dbHealthChecker = DatabaseHealthChecker.getInstance();

// Setup graceful shutdown handlers
process.on('SIGTERM', async () => {
  console.log('📡 SIGTERM received, shutting down database connections...');
  await dbHealthChecker.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('📡 SIGINT received, shutting down database connections...');
  await dbHealthChecker.shutdown();
  process.exit(0);
});