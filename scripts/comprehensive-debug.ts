import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface DebugResult {
  component: string;
  status: 'pass' | 'fail' | 'warning';
  message: string;
  details?: any;
  fix?: () => Promise<void>;
}

class ComprehensiveDebugger {
  private results: DebugResult[] = [];

  async runFullDiagnostic(): Promise<void> {
    console.log('🔍 Running comprehensive HealthAI Assistant debug...\n');

    // Core system checks
    await this.checkEnvironmentConfiguration();
    await this.checkDatabaseConnectivity();
    await this.checkNodeDependencies();
    await this.checkPythonEnvironment();
    await this.checkPortConfiguration();
    await this.checkFilePermissions();
    await this.checkAPIEndpoints();
    await this.checkClientBuild();
    await this.checkSecurityConfiguration();
    await this.checkAIModelFiles();

    this.displayResults();
    await this.applyAutomaticFixes();
  }

  private async checkEnvironmentConfiguration(): Promise<void> {
    const envPath = path.join(process.cwd(), '.env');
    
    if (!fs.existsSync(envPath)) {
      this.results.push({
        component: 'Environment Configuration',
        status: 'fail',
        message: '.env file missing',
        fix: async () => {
          const examplePath = path.join(process.cwd(), '.env.example');
          if (fs.existsSync(examplePath)) {
            fs.copyFileSync(examplePath, envPath);
            console.log('✅ Created .env from .env.example');
          }
        }
      });
      return;
    }

    const envContent = fs.readFileSync(envPath, 'utf8');
    const requiredVars = [
      'DATABASE_URL',
      'SESSION_SECRET',
      'NODE_ENV',
      'PORT',
      'OPENAI_API_KEY'
    ];

    const missingVars = requiredVars.filter(varName => 
      !envContent.includes(varName) || envContent.includes(`${varName}=`)
    );

    if (missingVars.length > 0) {
      this.results.push({
        component: 'Environment Variables',
        status: 'warning',
        message: `Missing or empty variables: ${missingVars.join(', ')}`,
        details: { missingVars }
      });
    } else {
      this.results.push({
        component: 'Environment Configuration',
        status: 'pass',
        message: 'All required environment variables present'
      });
    }
  }

  private async checkDatabaseConnectivity(): Promise<void> {
    try {
      const { testDbConnection } = await import('../server/db');
      const connected = await testDbConnection();
      
      if (connected) {
        this.results.push({
          component: 'Database Connectivity',
          status: 'pass',
          message: 'PostgreSQL connection successful'
        });
      } else {
        this.results.push({
          component: 'Database Connectivity',
          status: 'fail',
          message: 'Database connection failed'
        });
      }
    } catch (error) {
      this.results.push({
        component: 'Database Connectivity',
        status: 'fail',
        message: `Database error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        details: error
      });
    }
  }

  private async checkNodeDependencies(): Promise<void> {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const nodeModulesPath = path.join(process.cwd(), 'node_modules');

    if (!fs.existsSync(packageJsonPath)) {
      this.results.push({
        component: 'Node Dependencies',
        status: 'fail',
        message: 'package.json not found'
      });
      return;
    }

    if (!fs.existsSync(nodeModulesPath)) {
      this.results.push({
        component: 'Node Dependencies',
        status: 'fail',
        message: 'node_modules not found',
        fix: async () => {
          console.log('Installing Node.js dependencies...');
          await execAsync('npm install');
          console.log('✅ Node.js dependencies installed');
        }
      });
      return;
    }

    // Check for critical dependencies
    const criticalDeps = [
      'express',
      'react',
      'drizzle-orm',
      '@tanstack/react-query',
      'zod'
    ];

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    
    const missingDeps = criticalDeps.filter(dep => !allDeps[dep]);

    if (missingDeps.length > 0) {
      this.results.push({
        component: 'Node Dependencies',
        status: 'warning',
        message: `Missing critical dependencies: ${missingDeps.join(', ')}`,
        details: { missingDeps }
      });
    } else {
      this.results.push({
        component: 'Node Dependencies',
        status: 'pass',
        message: 'All critical Node.js dependencies present'
      });
    }
  }

  private async checkPythonEnvironment(): Promise<void> {
    try {
      const { stdout } = await execAsync('python --version');
      console.log(`Python version: ${stdout.trim()}`);

      const requirementsPath = path.join(process.cwd(), 'requirements.txt');
      if (fs.existsSync(requirementsPath)) {
        try {
          await execAsync('pip list | findstr tensorflow');
          this.results.push({
            component: 'Python Environment',
            status: 'pass',
            message: 'Python and TensorFlow available'
          });
        } catch {
          this.results.push({
            component: 'Python Environment',
            status: 'warning',
            message: 'TensorFlow not installed',
            fix: async () => {
              console.log('Installing Python dependencies...');
              await execAsync('pip install -r requirements.txt');
              console.log('✅ Python dependencies installed');
            }
          });
        }
      } else {
        this.results.push({
          component: 'Python Environment',
          status: 'warning',
          message: 'requirements.txt not found'
        });
      }
    } catch (error) {
      this.results.push({
        component: 'Python Environment',
        status: 'fail',
        message: 'Python not found in PATH',
        details: error
      });
    }
  }

  private async checkPortConfiguration(): Promise<void> {
    const envPath = path.join(process.cwd(), '.env');
    const packageJsonPath = path.join(process.cwd(), 'package.json');

    let envPort = '5000'; // default
    let scriptPort = '5000'; // default

    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const portMatch = envContent.match(/PORT=(\d+)/);
      if (portMatch) envPort = portMatch[1];
    }

    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      const devScript = packageJson.scripts?.dev || '';
      const portMatch = devScript.match(/PORT=(\d+)/);
      if (portMatch) scriptPort = portMatch[1];
    }

    if (envPort === scriptPort) {
      this.results.push({
        component: 'Port Configuration',
        status: 'pass',
        message: `Port configuration consistent: ${envPort}`
      });
    } else {
      this.results.push({
        component: 'Port Configuration',
        status: 'warning',
        message: `Port mismatch - .env: ${envPort}, package.json: ${scriptPort}`,
        details: { envPort, scriptPort }
      });
    }
  }

  private async checkFilePermissions(): Promise<void> {
    const criticalPaths = [
      'server',
      'client/src',
      'shared',
      'scripts',
      '.env'
    ];

    const permissionIssues: string[] = [];

    for (const pathToCheck of criticalPaths) {
      const fullPath = path.join(process.cwd(), pathToCheck);
      try {
        if (fs.existsSync(fullPath)) {
          fs.accessSync(fullPath, fs.constants.R_OK | fs.constants.W_OK);
        }
      } catch (error) {
        permissionIssues.push(pathToCheck);
      }
    }

    if (permissionIssues.length > 0) {
      this.results.push({
        component: 'File Permissions',
        status: 'warning',
        message: `Permission issues with: ${permissionIssues.join(', ')}`,
        details: { permissionIssues }
      });
    } else {
      this.results.push({
        component: 'File Permissions',
        status: 'pass',
        message: 'File permissions are correct'
      });
    }
  }

  private async checkAPIEndpoints(): Promise<void> {
    const routesPath = path.join(process.cwd(), 'server', 'routes.ts');
    
    if (!fs.existsSync(routesPath)) {
      this.results.push({
        component: 'API Endpoints',
        status: 'fail',
        message: 'routes.ts file not found'
      });
      return;
    }

    const routesContent = fs.readFileSync(routesPath, 'utf8');
    const criticalEndpoints = [
      '/api/auth/login',
      '/api/auth/me',
      '/api/scans',
      '/api/admin/stats'
    ];

    const missingEndpoints = criticalEndpoints.filter(endpoint => 
      !routesContent.includes(`"${endpoint}"`)
    );

    if (missingEndpoints.length > 0) {
      this.results.push({
        component: 'API Endpoints',
        status: 'warning',
        message: `Missing endpoints: ${missingEndpoints.join(', ')}`,
        details: { missingEndpoints }
      });
    } else {
      this.results.push({
        component: 'API Endpoints',
        status: 'pass',
        message: 'All critical API endpoints present'
      });
    }
  }

  private async checkClientBuild(): Promise<void> {
    const clientPath = path.join(process.cwd(), 'client');
    const srcPath = path.join(clientPath, 'src');
    const appPath = path.join(srcPath, 'App.tsx');

    if (!fs.existsSync(clientPath)) {
      this.results.push({
        component: 'Client Build',
        status: 'fail',
        message: 'Client directory not found'
      });
      return;
    }

    if (!fs.existsSync(appPath)) {
      this.results.push({
        component: 'Client Build',
        status: 'fail',
        message: 'App.tsx not found'
      });
      return;
    }

    // Check for TypeScript compilation issues
    try {
      await execAsync('npx tsc --noEmit', { cwd: process.cwd() });
      this.results.push({
        component: 'Client Build',
        status: 'pass',
        message: 'TypeScript compilation successful'
      });
    } catch (error) {
      this.results.push({
        component: 'Client Build',
        status: 'warning',
        message: 'TypeScript compilation issues detected',
        details: error
      });
    }
  }

  private async checkSecurityConfiguration(): Promise<void> {
    const envPath = path.join(process.cwd(), '.env');
    
    if (!fs.existsSync(envPath)) {
      this.results.push({
        component: 'Security Configuration',
        status: 'fail',
        message: 'Environment file not found'
      });
      return;
    }

    const envContent = fs.readFileSync(envPath, 'utf8');
    const securityIssues: string[] = [];

    // Check for default/weak session secret
    if (envContent.includes('SESSION_SECRET=your-super-secret-session-key-change-this-in-production')) {
      securityIssues.push('Default session secret detected');
    }

    // Check for exposed API keys in package.json
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageContent = fs.readFileSync(packageJsonPath, 'utf8');
      if (packageContent.includes('sk-') || packageContent.includes('API_KEY')) {
        securityIssues.push('Potential API key exposure in package.json');
      }
    }

    if (securityIssues.length > 0) {
      this.results.push({
        component: 'Security Configuration',
        status: 'warning',
        message: `Security issues: ${securityIssues.join(', ')}`,
        details: { securityIssues }
      });
    } else {
      this.results.push({
        component: 'Security Configuration',
        status: 'pass',
        message: 'Security configuration looks good'
      });
    }
  }

  private async checkAIModelFiles(): Promise<void> {
    const modelPaths = [
      'dataset/data/resnet50v2_skin_cancer_model.h5',
      'dataset/data/skin_cancer_efficientnet_model.h5'
    ];

    const existingModels = modelPaths.filter(modelPath => 
      fs.existsSync(path.join(process.cwd(), modelPath))
    );

    if (existingModels.length === 0) {
      this.results.push({
        component: 'AI Model Files',
        status: 'warning',
        message: 'No AI model files found - using fallback predictions'
      });
    } else {
      this.results.push({
        component: 'AI Model Files',
        status: 'pass',
        message: `Found ${existingModels.length} AI model file(s)`
      });
    }
  }

  private displayResults(): void {
    console.log('\n📊 Comprehensive Debug Results:');
    console.log('================================\n');

    this.results.forEach(result => {
      const icon = result.status === 'pass' ? '✅' : 
                   result.status === 'warning' ? '⚠️' : '❌';
      console.log(`${icon} ${result.component}: ${result.message}`);
      
      if (result.details) {
        console.log(`   Details: ${JSON.stringify(result.details, null, 2)}`);
      }
    });

    const passCount = this.results.filter(r => r.status === 'pass').length;
    const warningCount = this.results.filter(r => r.status === 'warning').length;
    const failCount = this.results.filter(r => r.status === 'fail').length;

    console.log(`\n📈 Summary: ${passCount} passed, ${warningCount} warnings, ${failCount} failed\n`);

    // Overall health assessment
    if (failCount === 0 && warningCount <= 2) {
      console.log('🎉 Application is in good health and ready to run!');
    } else if (failCount === 0) {
      console.log('⚠️ Application should run but has some warnings to address.');
    } else {
      console.log('❌ Application has critical issues that need to be fixed.');
    }
  }

  private async applyAutomaticFixes(): Promise<void> {
    const fixableIssues = this.results.filter(r => r.fix && r.status !== 'pass');
    
    if (fixableIssues.length === 0) {
      console.log('\n✨ No automatic fixes needed!\n');
      return;
    }

    console.log('\n🔧 Applying automatic fixes...\n');

    for (const issue of fixableIssues) {
      try {
        console.log(`Fixing: ${issue.component}...`);
        await issue.fix!();
      } catch (error) {
        console.log(`❌ Failed to fix ${issue.component}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    console.log('\n✨ Automatic fixes completed!\n');
  }
}

async function main() {
  const appDebugger = new ComprehensiveDebugger();
  await appDebugger.runFullDiagnostic();
}

// Run when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { ComprehensiveDebugger };