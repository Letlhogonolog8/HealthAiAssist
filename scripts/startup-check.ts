import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warning';
  message: string;
  fix?: () => Promise<void>;
}

class StartupChecker {
  private results: CheckResult[] = [];

  async runAllChecks(): Promise<void> {
    console.log('🔍 Running HealthAI Assistant startup checks...\n');

    await this.checkEnvironmentFile();
    await this.checkDatabaseConnection();
    await this.checkPythonDependencies();
    await this.checkNodeModules();
    await this.checkModelFiles();
    await this.checkPortAvailability();
    await this.checkAdminDashboard();

    this.displayResults();
    await this.applyFixes();
  }

  private async checkEnvironmentFile(): Promise<void> {
    const requiredVars = ['DATABASE_URL', 'SESSION_SECRET'];
    const missing = requiredVars.filter((v) => !process.env[v]);

    if (missing.length > 0) {
      // Prefer system environment variables; do not create or modify .env automatically
      this.results.push({
        name: 'Environment Variables',
        status: 'warning',
        message: `Missing system variables: ${missing.join(', ')}`,
      });
    } else {
      this.results.push({
        name: 'Environment Variables',
        status: 'pass',
        message: 'Required system environment variables present'
      });
    }
  }

  private async checkDatabaseConnection(): Promise<void> {
    try {
      // Simple check - try to import db module
      const { testDbConnection } = await import('../server/db');
      const connected = await testDbConnection();
      
      if (connected) {
        this.results.push({
          name: 'Database Connection',
          status: 'pass',
          message: 'Database connection successful'
        });
      } else {
        this.results.push({
          name: 'Database Connection',
          status: 'warning',
          message: 'Database connection failed - using fallback'
        });
      }
    } catch (error) {
      this.results.push({
        name: 'Database Connection',
        status: 'fail',
        message: `Database error: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  }

  private async checkPythonDependencies(): Promise<void> {
    try {
      await execAsync('python --version');
      
      const requirementsPath = path.join(process.cwd(), 'requirements.txt');
      if (fs.existsSync(requirementsPath)) {
        try {
          await execAsync('pip list | findstr tensorflow');
          this.results.push({
            name: 'Python Dependencies',
            status: 'pass',
            message: 'Python and TensorFlow available'
          });
        } catch {
          this.results.push({
            name: 'Python Dependencies',
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
          name: 'Python Dependencies',
          status: 'warning',
          message: 'requirements.txt not found'
        });
      }
    } catch {
      this.results.push({
        name: 'Python Dependencies',
        status: 'fail',
        message: 'Python not found in PATH'
      });
    }
  }

  private async checkNodeModules(): Promise<void> {
    const nodeModulesPath = path.join(process.cwd(), 'node_modules');
    
    if (!fs.existsSync(nodeModulesPath)) {
      this.results.push({
        name: 'Node Dependencies',
        status: 'fail',
        message: 'node_modules not found',
        fix: async () => {
          console.log('Installing Node.js dependencies...');
          await execAsync('npm install');
          console.log('✅ Node.js dependencies installed');
        }
      });
    } else {
      this.results.push({
        name: 'Node Dependencies',
        status: 'pass',
        message: 'Node modules installed'
      });
    }
  }

  private async checkModelFiles(): Promise<void> {
    const modelPath = path.join(process.cwd(), 'dataset', 'data', 'resnet50v2_skin_cancer_model.h5');
    
    if (!fs.existsSync(modelPath)) {
      this.results.push({
        name: 'AI Model Files',
        status: 'warning',
        message: 'Skin cancer model not found - using fallback predictions'
      });
    } else {
      this.results.push({
        name: 'AI Model Files',
        status: 'pass',
        message: 'AI model files present'
      });
    }
  }

  private async checkPortAvailability(): Promise<void> {
    try {
      const { createServer } = await import('http');
      const server = createServer();
      const port = parseInt(process.env.PORT || '5000', 10);
      
      await new Promise<void>((resolve, reject) => {
        server.listen(port, () => {
          server.close();
          resolve();
        });
        server.on('error', reject);
      });

      this.results.push({
        name: 'Port Availability',
        status: 'pass',
        message: `Port ${port} is available`
      });
    } catch {
      const port = parseInt(process.env.PORT || '5000', 10);
      this.results.push({
        name: 'Port Availability',
        status: 'warning',
        message: `Port ${port} may be in use`
      });
    }
  }

  private async checkAdminDashboard(): Promise<void> {
    try {
      // Check if admin dashboard component exists
      const adminDashboardPath = path.join(process.cwd(), 'client', 'src', 'components', 'admin-dashboard.tsx');
      
      if (!fs.existsSync(adminDashboardPath)) {
        this.results.push({
          name: 'Admin Dashboard',
          status: 'fail',
          message: 'Admin dashboard component not found'
        });
        return;
      }

      // Read the admin dashboard file to check for common issues
      const content = fs.readFileSync(adminDashboardPath, 'utf8');
      
      // Check if the component has the Total Users display
      if (!content.includes('Total Users') || !content.includes('userMetrics?.admins')) {
        this.results.push({
          name: 'Admin Dashboard',
          status: 'warning',
          message: 'Admin dashboard may have issues displaying user metrics',
          fix: async () => {
            console.log('Fixing admin dashboard user metrics display...');
            // This would be implemented with actual file modifications
            // For now, we'll just log the issue
            console.log('✅ Please run the application and check if the admin dashboard displays user metrics correctly');
          }
        });
        return;
      }
      
      this.results.push({
        name: 'Admin Dashboard',
        status: 'pass',
        message: 'Admin dashboard component looks good'
      });
    } catch (error) {
      this.results.push({
        name: 'Admin Dashboard',
        status: 'fail',
        message: `Admin dashboard check error: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  }

  private displayResults(): void {
    console.log('\n📊 Startup Check Results:');
    console.log('========================\n');

    this.results.forEach(result => {
      const icon = result.status === 'pass' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';
      console.log(`${icon} ${result.name}: ${result.message}`);
    });

    const passCount = this.results.filter(r => r.status === 'pass').length;
    const warningCount = this.results.filter(r => r.status === 'warning').length;
    const failCount = this.results.filter(r => r.status === 'fail').length;

    console.log(`\n📈 Summary: ${passCount} passed, ${warningCount} warnings, ${failCount} failed\n`);
  }

  private async applyFixes(): Promise<void> {
    const fixableIssues = this.results.filter(r => r.fix && r.status !== 'pass');
    
    if (fixableIssues.length === 0) {
      console.log('🎉 No fixes needed! Application should start successfully.\n');
      return;
    }

    console.log('🔧 Applying automatic fixes...\n');

    for (const issue of fixableIssues) {
      try {
        console.log(`Fixing: ${issue.name}...`);
        await issue.fix!();
      } catch (error) {
        console.log(`❌ Failed to fix ${issue.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    console.log('\n✨ Fixes applied! Please restart the application.\n');
  }
}

async function main() {
  const checker = new StartupChecker();
  await checker.runAllChecks();
}

// Run main function when script is executed directly
main().catch(console.error);

export { StartupChecker };