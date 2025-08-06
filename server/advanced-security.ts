import express from 'express';
import crypto from 'crypto';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import bcrypt from 'bcrypt';
import { storage } from './storage';
import { AuthenticatedRequest } from './security-config';

// Two-Factor Authentication System
export class TwoFactorAuth {
  static generateSecret(userEmail: string): { secret: string; qrCode: string; backupCodes: string[] } {
    const secret = speakeasy.generateSecret({
      name: `HealthAI (${userEmail})`,
      issuer: 'HealthAI Assistant',
      length: 32
    });

    // Generate backup codes
    const backupCodes = Array.from({ length: 8 }, () => 
      crypto.randomBytes(4).toString('hex').toUpperCase()
    );

    return {
      secret: secret.base32,
      qrCode: secret.otpauth_url || '',
      backupCodes
    };
  }

  static async generateQRCode(secret: string): Promise<string> {
    try {
      return await QRCode.toDataURL(secret);
    } catch (error) {
      throw new Error('Failed to generate QR code');
    }
  }

  static verifyToken(token: string, secret: string): boolean {
    return speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token,
      window: 2, // Allow 2 time steps (60 seconds) tolerance
    });
  }

  static verifyBackupCode(code: string, hashedBackupCodes: string[]): boolean {
    return hashedBackupCodes.some(hashedCode => bcrypt.compareSync(code, hashedCode));
  }
}

// Advanced Audit Logging System
export class AuditLogger {
  private static logDir = 'logs/audit';

  static async logSecurityEvent(event: {
    userId?: number;
    userRole?: string;
    action: string;
    resource: string;
    outcome: 'success' | 'failure' | 'blocked';
    ipAddress: string;
    userAgent: string;
    metadata?: any;
  }): Promise<void> {
    const logEntry = {
      timestamp: new Date().toISOString(),
      eventId: crypto.randomUUID(),
      severity: this.getSeverityLevel(event.action, event.outcome),
      ...event
    };

    // Log to console in development
    console.log('🔐 Security Event:', JSON.stringify(logEntry, null, 2));

    // In production, this would write to secure log files and/or external systems
    try {
      await this.writeToSecureLog(logEntry);
      await this.checkForSecurityPatterns(logEntry);
    } catch (error) {
      console.error('Audit logging failed:', error);
    }
  }

  private static getSeverityLevel(action: string, outcome: string): 'low' | 'medium' | 'high' | 'critical' {
    if (outcome === 'blocked' || action.includes('failed')) return 'high';
    if (action.includes('login') || action.includes('access')) return 'medium';
    return 'low';
  }

  private static async writeToSecureLog(entry: any): Promise<void> {
    // Mock implementation - in production use secure logging service
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const logFile = path.join(process.cwd(), 'logs', 'security-audit.log');
    const logLine = JSON.stringify(entry) + '\n';
    
    try {
      await fs.appendFile(logFile, logLine);
    } catch (error) {
      // Ensure log directory exists
      await fs.mkdir(path.dirname(logFile), { recursive: true });
      await fs.appendFile(logFile, logLine);
    }
  }

  private static async checkForSecurityPatterns(entry: any): Promise<void> {
    // Check for suspicious patterns
    if (entry.action.includes('failed_login')) {
      await this.checkFailedLoginAttempts(entry.ipAddress, entry.userId);
    }
    
    if (entry.action.includes('data_access') && entry.outcome === 'success') {
      await this.checkUnusualDataAccess(entry.userId, entry.resource);
    }
  }

  private static async checkFailedLoginAttempts(ipAddress: string, userId?: number): Promise<void> {
    // Mock implementation for failed login pattern detection
    console.log(`🚨 Checking failed login patterns for IP: ${ipAddress}, User: ${userId}`);
    
    // In production, this would:
    // 1. Query recent failed attempts from log database
    // 2. Trigger IP blocking if threshold exceeded
    // 3. Send alerts to security team
    // 4. Implement progressive delays
  }

  private static async checkUnusualDataAccess(userId?: number, resource?: string): Promise<void> {
    // Mock implementation for unusual access pattern detection
    console.log(`🔍 Checking access patterns for User: ${userId}, Resource: ${resource}`);
    
    // In production, this would:
    // 1. Compare with user's normal access patterns
    // 2. Check for bulk data access
    // 3. Verify access outside normal hours
    // 4. Alert on sensitive data access
  }
}

// Data Encryption Service
export class DataEncryption {
  private static algorithm = 'aes-256-gcm';
  private static keyLength = 32;
  private static ivLength = 16;

  static encrypt(data: string, key?: string): { encrypted: string; iv: string; tag: string; key?: string } {
    const encryptionKey = key ? Buffer.from(key, 'hex') : crypto.randomBytes(this.keyLength);
    const iv = crypto.randomBytes(this.ivLength);
    
    const cipher = crypto.createCipher(this.algorithm, encryptionKey);
    cipher.setAAD(Buffer.from('HealthAI-Medical-Data', 'utf8'));
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag();
    
    return {
      encrypted,
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      key: key ? undefined : encryptionKey.toString('hex')
    };
  }

  static decrypt(encryptedData: string, key: string, iv: string, tag: string): string {
    const decipher = crypto.createDecipher(this.algorithm, Buffer.from(key, 'hex'));
    decipher.setAAD(Buffer.from('HealthAI-Medical-Data', 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  static hashSensitiveData(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  static generateSecureToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }
}

// Security Compliance Checker
export class ComplianceChecker {
  static async checkHIPAACompliance(): Promise<{
    compliant: boolean;
    issues: string[];
    recommendations: string[];
  }> {
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check encryption
    if (!process.env.ENCRYPTION_KEY) {
      issues.push('Data encryption not configured');
      recommendations.push('Configure ENCRYPTION_KEY environment variable');
    }

    // Check audit logging
    if (!process.env.ENABLE_AUDIT_LOGGING) {
      issues.push('Audit logging not enabled');
      recommendations.push('Enable comprehensive audit logging');
    }

    // Check access controls
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 64) {
      issues.push('Weak session security');
      recommendations.push('Use strong session secrets (64+ characters)');
    }

    // Check data retention policies
    issues.push('Data retention policies not automated');
    recommendations.push('Implement automated data retention and deletion');

    return {
      compliant: issues.length === 0,
      issues,
      recommendations
    };
  }

  static async checkSOC2Compliance(): Promise<{
    compliant: boolean;
    controlsStatus: { [key: string]: boolean };
    recommendations: string[];
  }> {
    const controlsStatus = {
      'Access Controls': !!process.env.SESSION_SECRET,
      'Data Encryption': !!process.env.ENCRYPTION_KEY,
      'Audit Logging': true, // Implemented above
      'Backup Systems': false, // Would need to implement
      'Incident Response': false, // Would need to implement
      'Risk Assessment': false, // Would need to implement
      'Vulnerability Management': false // Would need to implement
    };

    const recommendations = Object.entries(controlsStatus)
      .filter(([, status]) => !status)
      .map(([control]) => `Implement ${control} procedures`);

    return {
      compliant: Object.values(controlsStatus).every(status => status),
      controlsStatus,
      recommendations
    };
  }
}

// Advanced Session Management
export class SessionManager {
  private static activeSessions = new Map<string, {
    userId: number;
    createdAt: Date;
    lastActivity: Date;
    ipAddress: string;
    userAgent: string;
    deviceFingerprint?: string;
  }>();

  static createSession(userId: number, sessionId: string, metadata: {
    ipAddress: string;
    userAgent: string;
    deviceFingerprint?: string;
  }): void {
    this.activeSessions.set(sessionId, {
      userId,
      createdAt: new Date(),
      lastActivity: new Date(),
      ...metadata
    });

    // Log session creation
    AuditLogger.logSecurityEvent({
      userId,
      action: 'session_created',
      resource: 'user_session',
      outcome: 'success',
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent
    });
  }

  static updateActivity(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
    }
  }

  static terminateSession(sessionId: string, reason: string = 'user_logout'): void {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      this.activeSessions.delete(sessionId);
      
      AuditLogger.logSecurityEvent({
        userId: session.userId,
        action: 'session_terminated',
        resource: 'user_session',
        outcome: 'success',
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        metadata: { reason }
      });
    }
  }

  static getActiveSessionsForUser(userId: number): any[] {
    return Array.from(this.activeSessions.entries())
      .filter(([, session]) => session.userId === userId)
      .map(([sessionId, session]) => ({
        sessionId,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent
      }));
  }

  static terminateAllUserSessions(userId: number, excludeSessionId?: string): number {
    let terminatedCount = 0;
    
    for (const [sessionId, session] of this.activeSessions.entries()) {
      if (session.userId === userId && sessionId !== excludeSessionId) {
        this.terminateSession(sessionId, 'admin_termination');
        terminatedCount++;
      }
    }
    
    return terminatedCount;
  }

  static cleanupExpiredSessions(): number {
    const now = new Date();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    let cleanedCount = 0;

    for (const [sessionId, session] of this.activeSessions.entries()) {
      if (now.getTime() - session.lastActivity.getTime() > maxAge) {
        this.terminateSession(sessionId, 'expired');
        cleanedCount++;
      }
    }

    return cleanedCount;
  }
}

// Device and Browser Fingerprinting
export class DeviceFingerprinting {
  static generateFingerprint(req: express.Request): string {
    const components = [
      req.headers['user-agent'] || '',
      req.headers['accept-language'] || '',
      req.headers['accept-encoding'] || '',
      req.ip || '',
      req.headers['x-forwarded-for'] || ''
    ];

    return crypto
      .createHash('sha256')
      .update(components.join('|'))
      .digest('hex')
      .substring(0, 16);
  }

  static detectSuspiciousDevice(currentFingerprint: string, userFingerprints: string[]): boolean {
    // Check if this is a completely new device
    if (!userFingerprints.includes(currentFingerprint)) {
      return userFingerprints.length > 0; // Suspicious if user has used other devices
    }
    return false;
  }
}

// Security Monitoring and Alerting
export class SecurityMonitor {
  private static suspiciousActivities = new Map<string, number>();
  private static alertThresholds = {
    failedLogins: 5,
    rapidDataAccess: 10,
    unusualHours: 3
  };

  static async monitorUserActivity(userId: number, activity: {
    action: string;
    resource: string;
    ipAddress: string;
    timestamp: Date;
  }): Promise<void> {
    const key = `${userId}-${activity.action}`;
    const count = this.suspiciousActivities.get(key) || 0;
    this.suspiciousActivities.set(key, count + 1);

    // Check for suspicious patterns
    await this.checkSuspiciousPatterns(userId, activity);
  }

  private static async checkSuspiciousPatterns(userId: number, activity: any): Promise<void> {
    const hour = activity.timestamp.getHours();
    
    // Check for unusual hours (outside 6 AM - 10 PM)
    if (hour < 6 || hour > 22) {
      await this.triggerAlert('unusual_hours', { userId, activity });
    }

    // Check for rapid successive actions
    const recentActions = this.getRecentActions(userId);
    if (recentActions.length > this.alertThresholds.rapidDataAccess) {
      await this.triggerAlert('rapid_data_access', { userId, actions: recentActions });
    }
  }

  private static getRecentActions(userId: number): any[] {
    // Mock implementation - in production would query recent activity log
    return [];
  }

  private static async triggerAlert(alertType: string, data: any): Promise<void> {
    console.log(`🚨 Security Alert: ${alertType}`, data);
    
    // In production, this would:
    // 1. Send alerts to security team
    // 2. Log to security incident management system
    // 3. Potentially trigger automatic responses
    // 4. Update risk scores for users/IPs
  }

  static getSecurityMetrics(): {
    failedLogins: number;
    blockedIPs: number;
    suspiciousActivities: number;
    activeSecurityAlerts: number;
  } {
    return {
      failedLogins: Array.from(this.suspiciousActivities.values()).reduce((sum, count) => sum + count, 0),
      blockedIPs: 0, // Would implement IP blocking
      suspiciousActivities: this.suspiciousActivities.size,
      activeSecurityAlerts: 0 // Would track active alerts
    };
  }
}

// Password Security Enhancement
export class PasswordSecurity {
  static readonly minLength = 12;
  static readonly requireUppercase = true;
  static readonly requireLowercase = true;
  static readonly requireNumbers = true;
  static readonly requireSymbols = true;

  static validatePassword(password: string): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    if (password.length < this.minLength) {
      issues.push(`Password must be at least ${this.minLength} characters long`);
    }

    if (this.requireUppercase && !/[A-Z]/.test(password)) {
      issues.push('Password must contain at least one uppercase letter');
    }

    if (this.requireLowercase && !/[a-z]/.test(password)) {
      issues.push('Password must contain at least one lowercase letter');
    }

    if (this.requireNumbers && !/\d/.test(password)) {
      issues.push('Password must contain at least one number');
    }

    if (this.requireSymbols && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      issues.push('Password must contain at least one special character');
    }

    // Check for common patterns
    if (this.hasCommonPatterns(password)) {
      issues.push('Password contains common patterns (avoid sequences, repeated characters)');
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }

  private static hasCommonPatterns(password: string): boolean {
    const commonPatterns = [
      /123456/,
      /abcdef/,
      /qwerty/,
      /(.)\1{2,}/, // Three or more repeated characters
      /password/i,
      /admin/i
    ];

    return commonPatterns.some(pattern => pattern.test(password));
  }

  static generateSecurePassword(length: number = 16): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()';
    let password = '';
    
    for (let i = 0; i < length; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    
    return password;
  }

  static checkPasswordStrength(password: string): {
    score: number;
    strength: 'Very Weak' | 'Weak' | 'Fair' | 'Good' | 'Strong' | 'Very Strong';
    suggestions: string[];
  } {
    let score = 0;
    const suggestions: string[] = [];

    // Length scoring
    if (password.length >= 12) score += 2;
    else if (password.length >= 8) score += 1;
    else suggestions.push('Use at least 12 characters');

    // Character variety
    if (/[a-z]/.test(password)) score += 1;
    else suggestions.push('Add lowercase letters');

    if (/[A-Z]/.test(password)) score += 1;
    else suggestions.push('Add uppercase letters');

    if (/\d/.test(password)) score += 1;
    else suggestions.push('Add numbers');

    if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) score += 2;
    else suggestions.push('Add special characters');

    // Penalty for patterns
    if (this.hasCommonPatterns(password)) {
      score -= 2;
      suggestions.push('Avoid common patterns and sequences');
    }

    const strengthLevels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'] as const;
    const strengthIndex = Math.max(0, Math.min(5, Math.floor(score / 1.5)));

    return {
      score: Math.max(0, score),
      strength: strengthLevels[strengthIndex],
      suggestions
    };
  }
}

// Initialize security monitoring cleanup
setInterval(() => {
  SessionManager.cleanupExpiredSessions();
}, 60 * 60 * 1000); // Run every hour
