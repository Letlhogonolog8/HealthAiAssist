import { storage } from './storage';
import { aiEngine } from './ai-engine';

interface AnalyticsMetric {
  name: string;
  value: number;
  timestamp: Date;
  metadata?: any;
}

interface UserActivity {
  userId: number;
  action: string;
  resource: string;
  timestamp: Date;
  duration?: number;
  metadata?: any;
}

interface MedicalInsight {
  type: 'population_health' | 'treatment_outcome' | 'risk_assessment' | 'screening_effectiveness';
  insight: string;
  confidence: number;
  data: any;
  recommendations: string[];
}

export class AnalyticsEngine {
  private metrics: Map<string, AnalyticsMetric[]> = new Map();
  private userActivities: UserActivity[] = [];

  // Real-time metrics collection
  async trackUserActivity(activity: UserActivity): Promise<void> {
    this.userActivities.push(activity);
    
    // Keep only last 10,000 activities in memory
    if (this.userActivities.length > 10000) {
      this.userActivities = this.userActivities.slice(-10000);
    }

    // Process real-time insights
    await this.processRealTimeInsights(activity);
  }

  private async processRealTimeInsights(activity: UserActivity): Promise<void> {
    try {
      // Track common metrics
      await this.trackMetric(`user_activity_${activity.action}`, 1);
      await this.trackMetric('total_user_activities', 1);
      
      // Track user engagement patterns
      if (activity.duration) {
        await this.trackMetric('average_session_duration', activity.duration);
      }
    } catch (error) {
      console.error('Error processing real-time insights:', error);
    }
  }

  async trackMetric(metricName: string, value: number, metadata?: any): Promise<void> {
    const metric: AnalyticsMetric = {
      name: metricName,
      value,
      timestamp: new Date(),
      metadata
    };

    if (!this.metrics.has(metricName)) {
      this.metrics.set(metricName, []);
    }

    const metricHistory = this.metrics.get(metricName)!;
    metricHistory.push(metric);

    // Keep only last 1000 data points per metric
    if (metricHistory.length > 1000) {
      this.metrics.set(metricName, metricHistory.slice(-1000));
    }
  }

  // Medical Analytics
  async generateMedicalInsights(): Promise<MedicalInsight[]> {
    const insights: MedicalInsight[] = [];

    try {
      // Population health insights
      const populationInsight = await this.analyzePopulationHealth();
      if (populationInsight) insights.push(populationInsight);

      // Treatment outcome analysis
      const treatmentInsight = await this.analyzeTreatmentOutcomes();
      if (treatmentInsight) insights.push(treatmentInsight);

      // Risk assessment patterns
      const riskInsight = await this.analyzeRiskPatterns();
      if (riskInsight) insights.push(riskInsight);

      // Screening effectiveness
      const screeningInsight = await this.analyzeScreeningEffectiveness();
      if (screeningInsight) insights.push(screeningInsight);

    } catch (error) {
      console.error('Error generating medical insights:', error);
    }

    return insights;
  }

  private async analyzePopulationHealth(): Promise<MedicalInsight | null> {
    try {
      const scans = await storage.getScans();
      const users = await storage.getAllUsers();

      if (scans.length === 0 || users.length === 0) return null;

      // Analyze scan distribution by age groups
      const ageGroups = this.categorizeByAge(scans, users);
      const riskDistribution = this.analyzeRiskDistribution(scans);

      const insight = this.generatePopulationHealthInsight(ageGroups, riskDistribution);

      return {
        type: 'population_health',
        insight: insight.message,
        confidence: insight.confidence,
        data: {
          ageGroups,
          riskDistribution,
          totalPatients: users.filter(u => u.role === 'patient').length,
          totalScans: scans.length
        },
        recommendations: insight.recommendations
      };
    } catch (error) {
      console.error('Population health analysis error:', error);
      return null;
    }
  }

  private async analyzeTreatmentOutcomes(): Promise<MedicalInsight | null> {
    try {
      const scans = await storage.getScans();
      const completedScans = scans.filter(s => s.status === 'completed');

      if (completedScans.length < 10) return null; // Need sufficient data

      const outcomesByType = this.groupScansByType(completedScans);
      const successRates = this.calculateSuccessRates(outcomesByType);

      return {
        type: 'treatment_outcome',
        insight: `Treatment success rates vary by scan type: ${Object.entries(successRates)
          .map(([type, rate]) => `${type}: ${((rate as number) * 100).toFixed(1)}%`)
          .join(', ')}`,
        confidence: 0.8,
        data: {
          outcomesByType,
          successRates,
          totalCompleted: completedScans.length
        },
        recommendations: this.generateTreatmentRecommendations(successRates)
      };
    } catch (error) {
      console.error('Treatment outcome analysis error:', error);
      return null;
    }
  }

  private async analyzeRiskPatterns(): Promise<MedicalInsight | null> {
    try {
      const scans = await storage.getScans();
      const highRiskScans = scans.filter(s => s.riskLevel === 'high' || s.riskLevel === 'critical');

      if (highRiskScans.length === 0) return null;

      const patterns = this.identifyRiskPatterns(highRiskScans);
      
      return {
        type: 'risk_assessment',
        insight: `Identified ${patterns.commonFactors.length} common risk factors in high-risk cases`,
        confidence: 0.75,
        data: {
          highRiskCount: highRiskScans.length,
          totalScans: scans.length,
          riskPercentage: (highRiskScans.length / scans.length) * 100,
          patterns
        },
        recommendations: [
          'Implement early screening for identified risk factors',
          'Develop targeted prevention programs',
          'Enhance monitoring for high-risk patients'
        ]
      };
    } catch (error) {
      console.error('Risk pattern analysis error:', error);
      return null;
    }
  }

  private async analyzeScreeningEffectiveness(): Promise<MedicalInsight | null> {
    try {
      const scans = await storage.getScans();
      const recentScans = scans.filter(s => {
        const scanDate = new Date(s.createdAt || '');
        const monthsAgo = new Date();
        monthsAgo.setMonth(monthsAgo.getMonth() - 6);
        return scanDate > monthsAgo;
      });

      if (recentScans.length < 20) return null;

      const effectiveness = this.calculateScreeningEffectiveness(recentScans);

      return {
        type: 'screening_effectiveness',
        insight: `Current screening programs show ${(effectiveness.detectionRate * 100).toFixed(1)}% early detection rate`,
        confidence: 0.85,
        data: effectiveness,
        recommendations: [
          'Maintain current screening protocols for effective programs',
          'Review and improve underperforming screening methods',
          'Consider expanding successful screening to broader populations'
        ]
      };
    } catch (error) {
      console.error('Screening effectiveness analysis error:', error);
      return null;
    }
  }

  // User Behavior Analytics
  async getUserBehaviorAnalytics(timeRange: 'day' | 'week' | 'month' = 'week'): Promise<any> {
    const now = new Date();
    const startDate = new Date();

    switch (timeRange) {
      case 'day':
        startDate.setDate(now.getDate() - 1);
        break;
      case 'week':
        startDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(now.getMonth() - 1);
        break;
    }

    const activities = this.userActivities.filter(a => a.timestamp > startDate);
    
    return {
      totalActivities: activities.length,
      uniqueUsers: new Set(activities.map(a => a.userId)).size,
      topActions: this.getTopActions(activities),
      userEngagement: this.calculateUserEngagement(activities),
      peakHours: this.analyzePeakUsageHours(activities),
      featureUsage: this.analyzeFeatureUsage(activities)
    };
  }

  // System Performance Analytics
  async getSystemPerformanceMetrics(): Promise<any> {
    const aiModelMetrics = await this.getAIModelMetrics();
    const databaseMetrics = this.getDatabaseMetrics();
    const apiMetrics = this.getAPIMetrics();

    return {
      ai: aiModelMetrics,
      database: databaseMetrics,
      api: apiMetrics,
      overall: {
        healthScore: this.calculateOverallHealthScore(aiModelMetrics, databaseMetrics, apiMetrics),
        uptime: this.calculateUptime(),
        lastUpdated: new Date()
      }
    };
  }

  private async getAIModelMetrics(): Promise<any> {
    try {
      const modelStatus = await aiEngine.getModelStatus();
      const metrics: any = {};

      for (const [modelType] of Object.entries(modelStatus)) {
        metrics[modelType] = await aiEngine.getModelPerformanceMetrics(modelType);
      }

      return {
        models: metrics,
        totalModels: Object.keys(modelStatus).length,
        loadedModels: Object.values(modelStatus).filter((status: any) => status.loaded).length
      };
    } catch (error) {
      return { error: 'Failed to fetch AI metrics', models: {} };
    }
  }

  private getDatabaseMetrics(): any {
    // Mock database metrics - in production would query actual DB stats
    return {
      connectionCount: Math.floor(Math.random() * 20) + 5,
      averageQueryTime: Math.random() * 100 + 50,
      totalQueries: Math.floor(Math.random() * 10000) + 1000,
      cachehitRate: Math.random() * 0.2 + 0.8,
      storageUsed: Math.random() * 1000 + 500 // MB
    };
  }

  private getAPIMetrics(): any {
    // Mock API metrics
    return {
      requestsPerMinute: Math.floor(Math.random() * 50) + 10,
      averageResponseTime: Math.random() * 200 + 100,
      errorRate: Math.random() * 0.05,
      throughput: Math.random() * 1000 + 500
    };
  }

  // Business Intelligence
  async generateBusinessInsights(): Promise<any> {
    try {
      const users = await storage.getAllUsers();
      const scans = await storage.getScans();
      const appointments = await storage.getAppointments();

      return {
        userGrowth: this.analyzeUserGrowth(users),
        serviceUtilization: this.analyzeServiceUtilization(scans, appointments),
        revenueInsights: this.analyzeRevenuePatterns(scans, appointments),
        customerSatisfaction: this.estimateCustomerSatisfaction(users, scans),
        operationalEfficiency: this.analyzeOperationalEfficiency(scans, appointments),
        marketTrends: this.identifyMarketTrends(scans, users)
      };
    } catch (error) {
      console.error('Business insights generation error:', error);
      return { error: 'Failed to generate business insights' };
    }
  }

  // Helper methods for analytics calculations
  private categorizeByAge(scans: any[], users: any[]): any {
    const ageGroups = {
      '18-30': 0,
      '31-45': 0,
      '46-60': 0,
      '60+': 0,
      'unknown': 0
    };

    scans.forEach(scan => {
      const user = users.find(u => u.id === scan.patientId);
      if (user && user.age) {
        if (user.age <= 30) ageGroups['18-30']++;
        else if (user.age <= 45) ageGroups['31-45']++;
        else if (user.age <= 60) ageGroups['46-60']++;
        else ageGroups['60+']++;
      } else {
        ageGroups['unknown']++;
      }
    });

    return ageGroups;
  }

  private analyzeRiskDistribution(scans: any[]): any {
    const distribution = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
      unknown: 0
    };

    scans.forEach(scan => {
      const risk = scan.riskLevel || 'unknown';
      if (distribution.hasOwnProperty(risk)) {
        distribution[risk as keyof typeof distribution]++;
      } else {
        distribution.unknown++;
      }
    });

    return distribution;
  }

  private generatePopulationHealthInsight(ageGroups: any, riskDistribution: any): any {
    const totalScans = Object.values(ageGroups).reduce((sum: number, count) => sum + (count as number), 0) as number;
    const highRiskPercentage = ((riskDistribution.high + riskDistribution.critical) / totalScans) * 100;

    let message = `Population analysis shows ${totalScans} total scans with ${highRiskPercentage.toFixed(1)}% high-risk cases.`;
    
    const recommendations = [
      'Continue regular screening programs',
      'Focus on high-risk demographics',
      'Implement preventive care initiatives'
    ];

    if (highRiskPercentage > 20) {
      message += ' Elevated high-risk percentage requires attention.';
      recommendations.unshift('Investigate causes of high-risk prevalence');
    }

    return {
      message,
      confidence: 0.8,
      recommendations
    };
  }

  private groupScansByType(scans: any[]): any {
    return scans.reduce((groups, scan) => {
      const type = scan.scanType || 'unknown';
      if (!groups[type]) groups[type] = [];
      groups[type].push(scan);
      return groups;
    }, {});
  }

  private calculateSuccessRates(outcomesByType: any): any {
    const successRates: any = {};
    
    for (const [type, scans] of Object.entries(outcomesByType)) {
      const scanArray = scans as any[];
      const successfulScans = scanArray.filter(s => 
        s.result && !s.result.toLowerCase().includes('malignant') && 
        !s.result.toLowerCase().includes('cancer')
      );
      successRates[type] = scanArray.length > 0 ? successfulScans.length / scanArray.length : 0;
    }
    
    return successRates;
  }

  private generateTreatmentRecommendations(successRates: any): string[] {
    const recommendations: string[] = [];
    
    for (const [type, rate] of Object.entries(successRates)) {
      if ((rate as number) < 0.7) {
        recommendations.push(`Improve treatment protocols for ${type} cases`);
      }
    }
    
    if (recommendations.length === 0) {
      recommendations.push('Maintain current high-quality treatment standards');
    }
    
    return recommendations;
  }

  private identifyRiskPatterns(highRiskScans: any[]): any {
    // Simplified pattern identification
    const scanTypes = highRiskScans.map(s => s.scanType);
    const commonTypes = this.findMostCommon(scanTypes);
    
    return {
      commonFactors: commonTypes,
      temporalPatterns: this.analyzeTemporalPatterns(highRiskScans),
      demographicPatterns: 'Analysis requires additional demographic data'
    };
  }

  private calculateScreeningEffectiveness(scans: any[]): any {
    const earlyDetections = scans.filter(s => s.riskLevel === 'medium' || s.riskLevel === 'high').length;
    const detectionRate = scans.length > 0 ? earlyDetections / scans.length : 0;
    
    return {
      totalScreenings: scans.length,
      earlyDetections,
      detectionRate,
      falsePositiveRate: Math.random() * 0.1, // Mock data
      sensitivity: Math.random() * 0.2 + 0.8, // Mock data
      specificity: Math.random() * 0.1 + 0.9  // Mock data
    };
  }

  private getTopActions(activities: UserActivity[]): any[] {
    const actionCounts = activities.reduce((counts, activity) => {
      counts[activity.action] = (counts[activity.action] || 0) + 1;
      return counts;
    }, {} as { [key: string]: number });

    return Object.entries(actionCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([action, count]) => ({ action, count }));
  }

  private calculateUserEngagement(activities: UserActivity[]): any {
    const userSessions = this.groupActivitiesByUser(activities);
    const engagementScores = Object.entries(userSessions).map(([userId, userActivities]) => {
      const sessionDuration = this.calculateSessionDuration(userActivities as UserActivity[]);
      const actionVariety = new Set((userActivities as UserActivity[]).map(a => a.action)).size;
      return {
        userId: parseInt(userId),
        sessionDuration,
        actionVariety,
        engagementScore: sessionDuration * actionVariety
      };
    });

    return {
      averageSessionDuration: engagementScores.reduce((sum, score) => sum + score.sessionDuration, 0) / engagementScores.length,
      averageActionVariety: engagementScores.reduce((sum, score) => sum + score.actionVariety, 0) / engagementScores.length,
      highlyEngagedUsers: engagementScores.filter(score => score.engagementScore > 1000).length
    };
  }

  private analyzePeakUsageHours(activities: UserActivity[]): any {
    const hourCounts = Array(24).fill(0);
    
    activities.forEach(activity => {
      const hour = activity.timestamp.getHours();
      hourCounts[hour]++;
    });

    const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
    
    return {
      hourlyDistribution: hourCounts,
      peakHour,
      peakHourActivity: Math.max(...hourCounts)
    };
  }

  private analyzeFeatureUsage(activities: UserActivity[]): any {
    const features = activities.reduce((features, activity) => {
      const feature = this.mapActionToFeature(activity.action);
      features[feature] = (features[feature] || 0) + 1;
      return features;
    }, {} as { [key: string]: number });

    return {
      totalFeatures: Object.keys(features).length,
      mostUsedFeature: Object.entries(features).reduce((max, [feature, count]) => 
        count > max.count ? { feature, count } : max, { feature: '', count: 0 }),
      featureUsageDistribution: features
    };
  }

  private calculateOverallHealthScore(ai: any, db: any, api: any): number {
    let score = 100;
    
    // AI health
    if (ai.loadedModels < ai.totalModels) score -= 20;
    
    // Database health
    if (db.averageQueryTime > 200) score -= 15;
    if (db.cachehitRate < 0.8) score -= 10;
    
    // API health
    if (api.errorRate > 0.05) score -= 20;
    if (api.averageResponseTime > 500) score -= 15;
    
    return Math.max(0, score);
  }

  private calculateUptime(): number {
    // Mock uptime calculation
    return Math.random() * 0.05 + 0.95; // 95-100% uptime
  }

  private analyzeUserGrowth(users: any[]): any {
    // Mock user growth analysis
    return {
      totalUsers: users.length,
      newUsersThisMonth: Math.floor(users.length * 0.1),
      growthRate: Math.random() * 0.2 + 0.05, // 5-25% growth
      churnRate: Math.random() * 0.05 + 0.01  // 1-6% churn
    };
  }

  private analyzeServiceUtilization(scans: any[], appointments: any[]): any {
    return {
      scanVolume: scans.length,
      appointmentVolume: appointments.length,
      utilizationRate: Math.random() * 0.3 + 0.6, // 60-90% utilization
      peakDemandHours: [9, 10, 11, 14, 15, 16] // Mock peak hours
    };
  }

  private analyzeRevenuePatterns(scans: any[], appointments: any[]): any {
    // Mock revenue analysis
    const avgScanRevenue = 150;
    const avgAppointmentRevenue = 200;
    
    return {
      totalRevenue: (scans.length * avgScanRevenue) + (appointments.length * avgAppointmentRevenue),
      revenuePerScan: avgScanRevenue,
      revenuePerAppointment: avgAppointmentRevenue,
      monthlyGrowth: Math.random() * 0.15 + 0.05 // 5-20% monthly growth
    };
  }

  private estimateCustomerSatisfaction(users: any[], scans: any[]): any {
    // Mock satisfaction scoring
    return {
      overallSatisfaction: Math.random() * 0.3 + 0.7, // 70-100%
      npsScore: Math.random() * 30 + 50, // 50-80 NPS
      retentionRate: Math.random() * 0.1 + 0.85 // 85-95% retention
    };
  }

  private analyzeOperationalEfficiency(scans: any[], appointments: any[]): any {
    return {
      averageScanProcessingTime: '24 hours',
      appointmentUtilization: Math.random() * 0.2 + 0.75, // 75-95%
      resourceEfficiency: Math.random() * 0.15 + 0.8, // 80-95%
      costPerScan: Math.random() * 50 + 75 // $75-125 per scan
    };
  }

  private identifyMarketTrends(scans: any[], users: any[]): any {
    return {
      growingDemandAreas: ['skin cancer screening', 'preventive care'],
      emergingTechnologies: ['AI-assisted diagnosis', 'telemedicine'],
      competitivePosition: 'Strong in AI-powered diagnostics',
      marketOpportunities: ['expand to rural areas', 'mobile health solutions']
    };
  }

  // Utility methods
  private findMostCommon(array: any[]): any[] {
    const counts = array.reduce((acc, item) => {
      acc[item] = (acc[item] || 0) + 1;
      return acc;
    }, {});
    
    return Object.entries(counts)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 3)
      .map(([item]) => item);
  }

  private analyzeTemporalPatterns(scans: any[]): string {
    // Simplified temporal analysis
    const months = scans.map(s => new Date(s.createdAt || '').getMonth());
    const mostCommonMonth = this.findMostCommon(months)[0];
    return `Peak activity in month ${mostCommonMonth + 1}`;
  }

  private groupActivitiesByUser(activities: UserActivity[]): { [userId: number]: UserActivity[] } {
    return activities.reduce((groups, activity) => {
      if (!groups[activity.userId]) groups[activity.userId] = [];
      groups[activity.userId].push(activity);
      return groups;
    }, {} as { [userId: number]: UserActivity[] });
  }

  private calculateSessionDuration(activities: UserActivity[]): number {
    if (activities.length < 2) return 0;
    
    const sorted = activities.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const start = sorted[0].timestamp.getTime();
    const end = sorted[sorted.length - 1].timestamp.getTime();
    
    return (end - start) / (1000 * 60); // Duration in minutes
  }

  private mapActionToFeature(action: string): string {
    const featureMap: { [key: string]: string } = {
      'scan_upload': 'Medical Scanning',
      'appointment_book': 'Appointment Booking',
      'chat_message': 'Communication',
      'report_view': 'Medical Reports',
      'profile_update': 'Profile Management'
    };
    
    return featureMap[action] || 'Other';
  }

  // Cleanup old data
  cleanupOldData(): void {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    this.userActivities = this.userActivities.filter(activity => 
      activity.timestamp > oneWeekAgo
    );
    
    // Clean up old metrics
    for (const [metricName, metricHistory] of this.metrics.entries()) {
      const recentMetrics = metricHistory.filter(metric => 
        metric.timestamp > oneWeekAgo
      );
      this.metrics.set(metricName, recentMetrics);
    }
    
    console.log('🧹 Analytics data cleanup completed');
  }
}

// Singleton instance
export const analyticsEngine = new AnalyticsEngine();

// Start cleanup interval
setInterval(() => {
  analyticsEngine.cleanupOldData();
}, 24 * 60 * 60 * 1000); // Daily cleanup
