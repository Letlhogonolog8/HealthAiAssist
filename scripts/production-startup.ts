import { ComprehensiveDebugger } from './comprehensive-debug';
import { dbHealthChecker } from '../server/database-health-check';

class ProductionStartup {
  async initialize(): Promise<boolean> {
    console.log('🚀 Initializing HealthAI Assistant for production...\n');

    // Run comprehensive debug first
    const appDebugger = new ComprehensiveDebugger();
    await appDebugger.runFullDiagnostic();

    // Check database health
    console.log('🔍 Checking database health...');
    const dbHealth = await dbHealthChecker.checkHealth();
    
    if (!dbHealth.isConnected) {
      console.error('❌ Database connection failed. Cannot start application.');
      return false;
    }

    console.log('✅ Database health check passed');

    // Verify critical environment variables
    const requiredEnvVars = [
      'DATABASE_URL',
      'SESSION_SECRET',
      'OPENAI_API_KEY'
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      console.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
      return false;
    }

    console.log('✅ Environment variables validated');

    // Set production optimizations
    process.env.NODE_ENV = 'production';
    
    console.log('🎉 Application ready for production startup!\n');
    return true;
  }
}

async function main() {
  const startup = new ProductionStartup();
  const success = await startup.initialize();
  
  if (success) {
    console.log('Starting server...');
    // Import and start the server
    await import('../server/index');
  } else {
    console.error('❌ Startup failed. Please fix the issues above.');
    process.exit(1);
  }
}

// Run when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal startup error:', error);
    process.exit(1);
  });
}

export { ProductionStartup };