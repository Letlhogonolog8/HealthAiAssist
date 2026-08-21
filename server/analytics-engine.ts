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
  /**
   * Null where no confidence was computed.
   *
   * Three of the four generators returned hardcoded literals here (0.8, 0.75,
   * 0.85), which the API then filtered on to report a "high confidence" count.
   */
  confidence: number | null;
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
      const negativeRates = this.calculateNegativeRates(outcomesByType);

      // The recommendations that used to accompany this said "Improve treatment
      // protocols for {type} cases" whenever the rate fell below 0.7 — clinical
      // advice derived from how often a classifier said "no cancer".
      return {
        type: 'treatment_outcome',
        insight:
          `Share of completed scans with no malignancy in the result, by modality: ` +
          Object.entries(negativeRates)
            .map(([type, rate]) => `${type}: ${((rate as number) * 100).toFixed(1)}%`)
            .join(', ') +
          `. This reflects model output, not patient outcomes.`,
        confidence: null,
        data: {
          outcomesByType,
          negativeRates,
          totalCompleted: completedScans.length
        },
        recommendations: [
          'Outcomes are not recorded, so no treatment inference can be drawn from this',
        ]
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
        insight:
          `${highRiskScans.length} of ${scans.length} scans are recorded at high or ` +
          `critical risk; the most frequent modalities are ` +
          `${patterns.commonFactors.join(', ') || 'none'}.`,
        // Was 0.75, a constant. /api/advanced/analytics/medical-insights counts
        // insights with confidence > 0.8 as "high confidence", so these literals
        // decided that count rather than any measurement.
        confidence: null,
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

      // `effectiveness.detectionRate` was read here after
      // calculateScreeningEffectiveness stopped returning it: the field is gone,
      // so the expression was `(undefined * 100).toFixed(1)` and this insight
      // rendered the string "NaN% early detection rate" on the dashboard.
      //
      // It was also the wrong claim. A flag rate is the proportion of scans the
      // model marked for review; calling it an early detection rate asserts that
      // those flags were correct and early, neither of which anything here
      // confirms.
      return {
        type: 'screening_effectiveness',
        insight:
          `${effectiveness.flaggedScans} of ${effectiveness.totalScreenings} scans in the last ` +
          `six months were flagged for review (${(effectiveness.flagRate * 100).toFixed(1)}%). ` +
          `Whether those flags were correct is not recorded.`,
        // Not a measured confidence. Reported as null rather than a constant that
        // the endpoint then counts as "high confidence".
        confidence: null,
        data: effectiveness,
        recommendations: [
          'Record a confirmed outcome per scan so screening performance can be measured',
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

  // Infrastructure telemetry is not instrumented. These previously returned
  // randomised values that rendered as live gauges on the admin dashboard.
  // Wire them to pg_stat_statements / a metrics middleware before reporting them.
  private getDatabaseMetrics(): any {
    return {
      instrumented: false,
      connectionCount: null,
      averageQueryTime: null,
      totalQueries: null,
      cachehitRate: null,
      storageUsed: null
    };
  }

  private getAPIMetrics(): any {
    return {
      instrumented: false,
      requestsPerMinute: null,
      averageResponseTime: null,
      errorRate: null,
      throughput: null
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

    // The last of the four hardcoded confidences. Null, like the others: nothing
    // here estimates how reliable this summary is.
    return {
      message,
      confidence: null,
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

  /**
   * The proportion of completed scans per modality whose result did NOT mention
   * cancer or malignancy.
   *
   * Named for what it counts. It used to be called a "treatment success rate",
   * which is a claim about patient outcomes: this system records no treatment,
   * no follow-up and no confirmed diagnosis, so it cannot know whether any
   * treatment succeeded. A scan the model did not flag is not a cured patient.
   */
  private calculateNegativeRates(outcomesByType: any): any {
    const negativeRates: any = {};

    for (const [type, scans] of Object.entries(outcomesByType)) {
      const scanArray = scans as any[];
      const negativeScans = scanArray.filter(s =>
        s.result && !s.result.toLowerCase().includes('malignant') &&
        !s.result.toLowerCase().includes('cancer')
      );
      negativeRates[type] = scanArray.length > 0 ? negativeScans.length / scanArray.length : 0;
    }

    return negativeRates;
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
    const flaggedScans = scans.filter(s => s.riskLevel === 'medium' || s.riskLevel === 'high').length;
    const flagRate = scans.length > 0 ? flaggedScans / scans.length : 0;

    return {
      totalScreenings: scans.length,
      // Count of scans the model flagged. NOT "early detections" — nothing here
      // confirms a detection was correct or early.
      flaggedScans,
      flagRate,
      // Sensitivity, specificity and false-positive rate require confirmed
      // outcomes (biopsy or clinical follow-up) to compare predictions against.
      // The schema does not record outcomes, so these are not computable and are
      // reported as null. They were previously randomised, which meant the
      // dashboard published invented clinical performance figures.
      sensitivity: null,
      specificity: null,
      falsePositiveRate: null,
      clinicalMetricsUnavailable:
        'Requires confirmed diagnostic outcomes per scan; not currently recorded.'
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

    // Database and API health are only scored where telemetry actually exists.
    // Treating an uninstrumented metric as "passing" reports a healthy system we
    // have not measured.
    if (db.instrumented) {
      if (db.averageQueryTime > 200) score -= 15;
      if (db.cachehitRate < 0.8) score -= 10;
    }

    if (api.instrumented) {
      if (api.errorRate > 0.05) score -= 20;
      if (api.averageResponseTime > 500) score -= 15;
    }

    return Math.max(0, score);
  }

  /** Fraction of process lifetime spent up. Real, but only covers the current process. */
  private calculateUptime(): number {
    return 1;
  }

  private analyzeUserGrowth(users: any[]): any {
    return {
      totalUsers: users.length,
      // Growth and churn need historical snapshots or signup timestamps we do not
      // aggregate yet. Previously randomised.
      newUsersThisMonth: null,
      growthRate: null,
      churnRate: null,
      instrumented: false
    };
  }

  private analyzeServiceUtilization(scans: any[], appointments: any[]): any {
    return {
      scanVolume: scans.length,
      appointmentVolume: appointments.length,
      // Requires capacity data (staff, slots) that is not modelled.
      utilizationRate: null,
      peakDemandHours: null,
      instrumented: false
    };
  }

  private analyzeRevenuePatterns(scans: any[], appointments: any[]): any {
    // No billing system is connected. Any revenue figure here would be invented.
    return {
      totalRevenue: null,
      revenuePerScan: null,
      revenuePerAppointment: null,
      monthlyGrowth: null,
      instrumented: false,
      note: 'No billing integration; revenue cannot be derived from scan counts.'
    };
  }

  private estimateCustomerSatisfaction(users: any[], scans: any[]): any {
    // No survey or NPS instrument exists. Previously randomised.
    return {
      overallSatisfaction: null,
      npsScore: null,
      retentionRate: null,
      instrumented: false,
      note: 'Requires a survey/NPS instrument; none is collected.'
    };
  }

  private analyzeOperationalEfficiency(scans: any[], appointments: any[]): any {
    return {
      averageScanProcessingTime: null,
      appointmentUtilization: null,
      resourceEfficiency: null,
      costPerScan: null,
      instrumented: false
    };
  }

  /**
   * Demand by modality, counted from the scans table.
   *
   * The rest of this object used to be marketing copy served from an analytics
   * endpoint: a fixed "growingDemandAreas", an "emergingTechnologies" list, and
   * a "competitivePosition" of "Strong in AI-powered diagnostics" — a claim
   * about the market that no data here could support, presented next to figures
   * that were real. Its neighbours (revenue, satisfaction, efficiency) were
   * already reduced to nulls with `instrumented: false`; this one was missed.
   */
  private identifyMarketTrends(scans: any[], users: any[]): any {
    const byType = scans.reduce((counts: Record<string, number>, scan: any) => {
      const type = scan.scanType || 'unknown';
      counts[type] = (counts[type] || 0) + 1;
      return counts;
    }, {});

    const demandByScanType = Object.entries(byType)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .map(([scanType, count]) => ({ scanType, count }));

    return {
      demandByScanType,
      totalScans: scans.length,
      registeredPatients: users.filter((u: any) => u.role === 'patient').length,
      // Market position and technology trends are claims about the world outside
      // this database. Nothing here can measure them.
      competitivePosition: null,
      marketOpportunities: null,
      instrumented: false,
      note: 'Demand counts are from the scans table. Market position is not measured.'
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

// Start cleanup interval. Unref'd so an idle timer cannot hold the process open
// — without it a short-lived run (a test harness, a one-shot script) sits for up
// to 24 hours after its work is done.
setInterval(() => {
  analyticsEngine.cleanupOldData();
}, 24 * 60 * 60 * 1000).unref(); // Daily cleanup

/**
 * Collapses the variable parts of a path so one route is one metric.
 *
 * Metric names are Map keys with no eviction by key, so recording
 * `GET_/api/patient/profile/1173` verbatim adds a permanent entry per patient
 * viewed: the map grows with traffic and never shrinks. Numeric and UUID-shaped
 * segments become `:id`, which bounds the key space by the number of routes.
 */
export function normalizeResourcePath(path: string): string {
  return path
    .split('/')
    .map((seg) =>
      /^\d+$/.test(seg) ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)
        ? ':id'
        : seg
    )
    .join('/');
}

/**
 * Records authenticated API usage.
 *
 * Registered ahead of the routers. The previous copy sat at the very bottom of
 * registerRoutes, behind every handler, so it recorded nothing at all. It also
 * `await`ed the recording before calling next(), putting the tracker on the
 * request's critical path; it is fire-and-forget now.
 */
export function trackApiUsage(req: any, _res: any, next: () => void): void {
  const user = req.session?.user;
  if (user?.id) {
    const resource = normalizeResourcePath(req.path);
    void analyticsEngine
      .trackUserActivity({
        userId: user.id,
        action: `${req.method}_${resource}`,
        resource,
        timestamp: new Date(),
        metadata: { userAgent: req.headers['user-agent'], ip: req.ip },
      })
      .catch((error) => console.error('Analytics tracking failed:', error));
  }
  next();
}
