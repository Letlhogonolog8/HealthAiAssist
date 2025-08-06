import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';

interface PerformanceMetrics {
  timestamp: string;
  memoryUsage: NodeJS.MemoryUsage;
  uptime: number;
  cpuUsage: NodeJS.CpuUsage;
  responseTime?: number;
  activeConnections?: number;
}

class PerformanceMonitor {
  private metrics: PerformanceMetrics[] = [];
  private startTime: number;
  private cpuUsageStart: NodeJS.CpuUsage;

  constructor() {
    this.startTime = performance.now();
    this.cpuUsageStart = process.cpuUsage();
    this.startMonitoring();
  }

  private startMonitoring(): void {
    // Collect metrics every 30 seconds
    setInterval(() => {
      this.collectMetrics();
    }, 30000);

    // Log summary every 5 minutes
    setInterval(() => {
      this.logSummary();
    }, 300000);
  }

  private collectMetrics(): void {
    const metric: PerformanceMetrics = {
      timestamp: new Date().toISOString(),
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
      cpuUsage: process.cpuUsage(this.cpuUsageStart)
    };

    this.metrics.push(metric);

    // Keep only last 100 metrics (50 minutes of data)
    if (this.metrics.length > 100) {
      this.metrics.shift();
    }
  }

  private logSummary(): void {
    if (this.metrics.length === 0) return;

    const latest = this.metrics[this.metrics.length - 1];
    const memoryMB = Math.round(latest.memoryUsage.heapUsed / 1024 / 1024);
    const uptimeMinutes = Math.round(latest.uptime / 60);

    console.log(`📊 Performance Summary:`);
    console.log(`   Memory Usage: ${memoryMB}MB`);
    console.log(`   Uptime: ${uptimeMinutes} minutes`);
    console.log(`   CPU Usage: ${(latest.cpuUsage.user / 1000000).toFixed(2)}s user, ${(latest.cpuUsage.system / 1000000).toFixed(2)}s system`);
  }

  public getMetrics(): PerformanceMetrics[] {
    return [...this.metrics];
  }

  public getCurrentMetrics(): PerformanceMetrics {
    const current: PerformanceMetrics = {
      timestamp: new Date().toISOString(),
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
      cpuUsage: process.cpuUsage(this.cpuUsageStart)
    };
    return current;
  }

  public saveMetricsToFile(): void {
    const metricsPath = path.join(process.cwd(), 'performance-metrics.json');
    fs.writeFileSync(metricsPath, JSON.stringify(this.metrics, null, 2));
    console.log(`📁 Metrics saved to ${metricsPath}`);
  }

  public getHealthStatus(): {
    status: 'healthy' | 'warning' | 'critical';
    issues: string[];
    recommendations: string[];
  } {
    const current = this.getCurrentMetrics();
    const memoryMB = current.memoryUsage.heapUsed / 1024 / 1024;
    const issues: string[] = [];
    const recommendations: string[] = [];

    let status: 'healthy' | 'warning' | 'critical' = 'healthy';

    // Memory checks
    if (memoryMB > 500) {
      status = 'critical';
      issues.push(`High memory usage: ${Math.round(memoryMB)}MB`);
      recommendations.push('Restart application or investigate memory leaks');
    } else if (memoryMB > 200) {
      status = 'warning';
      issues.push(`Elevated memory usage: ${Math.round(memoryMB)}MB`);
      recommendations.push('Monitor memory usage and consider optimization');
    }

    // CPU checks
    const cpuUser = current.cpuUsage.user / 1000000;
    const cpuSystem = current.cpuUsage.system / 1000000;
    const totalCpu = cpuUser + cpuSystem;

    if (totalCpu > 10) {
      status = status === 'critical' ? 'critical' : 'warning';
      issues.push(`High CPU usage: ${totalCpu.toFixed(2)}s total`);
      recommendations.push('Investigate CPU-intensive operations');
    }

    return { status, issues, recommendations };
  }
}

// Export for use in main application
export { PerformanceMonitor };

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const monitor = new PerformanceMonitor();
  
  console.log('🚀 HealthAI Performance Monitor Started');
  console.log('Press Ctrl+C to stop and save metrics\n');

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n📊 Saving performance metrics...');
    monitor.saveMetricsToFile();
    
    const health = monitor.getHealthStatus();
    console.log(`\n🏥 Final Health Status: ${health.status.toUpperCase()}`);
    
    if (health.issues.length > 0) {
      console.log('Issues:');
      health.issues.forEach(issue => console.log(`  - ${issue}`));
    }
    
    if (health.recommendations.length > 0) {
      console.log('Recommendations:');
      health.recommendations.forEach(rec => console.log(`  - ${rec}`));
    }
    
    process.exit(0);
  });

  // Show initial status
  setTimeout(() => {
    const health = monitor.getHealthStatus();
    console.log(`Initial Health Status: ${health.status}`);
  }, 1000);
}