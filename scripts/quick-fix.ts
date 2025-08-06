import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

class QuickFix {
  async applyAllFixes(): Promise<void> {
    console.log('🔧 Applying quick fixes for common issues...\n');

    await this.fixEnvironmentFile();
    await this.fixPackageJsonSecurity();
    await this.fixPortConfiguration();
    await this.installMissingDependencies();
    await this.fixFilePermissions();

    console.log('\n✅ Quick fixes completed!\n');
  }

  private async fixEnvironmentFile(): Promise<void> {
    const envPath = path.join(process.cwd(), '.env');
    const envExamplePath = path.join(process.cwd(), '.env.example');

    if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
      fs.copyFileSync(envExamplePath, envPath);
      console.log('✅ Created .env file from .env.example');
    }

    if (fs.existsSync(envPath)) {
      let envContent = fs.readFileSync(envPath, 'utf8');
      let modified = false;

      // Ensure PORT is set
      if (!envContent.includes('PORT=')) {
        envContent += '\nPORT=5001\n';
        modified = true;
      }

      // Ensure NODE_ENV is set
      if (!envContent.includes('NODE_ENV=')) {
        envContent += 'NODE_ENV=development\n';
        modified = true;
      }

      if (modified) {
        fs.writeFileSync(envPath, envContent);
        console.log('✅ Updated .env file with missing variables');
      }
    }
  }

  private async fixPackageJsonSecurity(): Promise<void> {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    
    if (fs.existsSync(packageJsonPath)) {
      const packageContent = fs.readFileSync(packageJsonPath, 'utf8');
      
      // Check for exposed API keys in scripts
      if (packageContent.includes('sk-') || packageContent.includes('OPENAI_API_KEY=sk-')) {
        const packageJson = JSON.parse(packageContent);
        
        // Clean the dev script
        if (packageJson.scripts?.dev) {
          packageJson.scripts.dev = packageJson.scripts.dev
            .replace(/set OPENAI_API_KEY=[^&]+&&?\s*/, '')
            .replace(/&&\s*$/, '');
        }

        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
        console.log('✅ Removed exposed API keys from package.json');
      }
    }
  }

  private async fixPortConfiguration(): Promise<void> {
    const serverIndexPath = path.join(process.cwd(), 'server', 'index.ts');
    
    if (fs.existsSync(serverIndexPath)) {
      let content = fs.readFileSync(serverIndexPath, 'utf8');
      
      // Fix port configuration
      if (content.includes("process.env.PORT || '8080'")) {
        content = content.replace(
          "process.env.PORT || '8080'",
          "process.env.PORT || '5001'"
        );
        fs.writeFileSync(serverIndexPath, content);
        console.log('✅ Fixed port configuration in server/index.ts');
      }
    }
  }

  private async installMissingDependencies(): Promise<void> {
    const nodeModulesPath = path.join(process.cwd(), 'node_modules');
    
    if (!fs.existsSync(nodeModulesPath)) {
      console.log('📦 Installing Node.js dependencies...');
      try {
        await execAsync('npm install');
        console.log('✅ Node.js dependencies installed');
      } catch (error) {
        console.error('❌ Failed to install Node.js dependencies:', error);
      }
    }

    // Check for Python dependencies
    const requirementsPath = path.join(process.cwd(), 'requirements.txt');
    if (fs.existsSync(requirementsPath)) {
      try {
        await execAsync('python -c "import tensorflow"');
        console.log('✅ Python dependencies are installed');
      } catch {
        console.log('📦 Installing Python dependencies...');
        try {
          await execAsync('pip install -r requirements.txt');
          console.log('✅ Python dependencies installed');
        } catch (error) {
          console.error('❌ Failed to install Python dependencies:', error);
        }
      }
    }
  }

  private async fixFilePermissions(): Promise<void> {
    const criticalDirs = ['server', 'client', 'shared', 'scripts'];
    
    for (const dir of criticalDirs) {
      const dirPath = path.join(process.cwd(), dir);
      if (fs.existsSync(dirPath)) {
        try {
          // Test read/write access
          fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK);
        } catch (error) {
          console.log(`⚠️ Permission issue with ${dir} directory`);
          // On Windows, we can't easily fix permissions programmatically
          // Just log the issue
        }
      }
    }
  }
}

async function main() {
  const quickFix = new QuickFix();
  await quickFix.applyAllFixes();
}

// Run when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { QuickFix };