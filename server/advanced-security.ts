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

    // Console only in development. This used to print the whole entry,
    // metadata included, on every event in every environment; the metadata can
    // carry identifiers, and production logs are frequently shipped elsewhere.
    if (process.env.NODE_ENV !== 'production') {
      console.log(`🔐 Security Event: ${logEntry.severity} ${event.action} ${event.outcome}`);
    }

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

  /**
   * Persists a security event to the audit_events table.
   *
   * It used to append JSON to logs/security-audit.log. That directory is
   * gitignored and, more importantly, lives on the container filesystem: on
   * Railway, Render or any other ephemeral host the whole security audit trail
   * is destroyed by the next deploy or restart. The application already has an
   * append-only audit table that the auditLog() middleware writes to; security
   * events belong in the same place, queryable and backed up with everything
   * else.
   *
   * The file fallback is kept for the case where the database itself is the
   * thing that failed — losing a security event because the write target was
   * down is the one outcome worth avoiding.
   */
  private static async writeToSecureLog(entry: any): Promise<void> {
    try {
      const { getDb } = await import('./db');
      const { auditEvents } = await import('@shared/schema');
      const db = getDb() as any;
      if (!db) throw new Error('no database handle');

      await db.insert(auditEvents).values({
        action: `SECURITY_${String(entry.action).toUpperCase()}`,
        actorUserId: entry.userId ?? null,
        actorUsername: null,
        actorRole: entry.userRole ?? null,
        method: null,
        path: entry.resource ?? null,
        statusCode: null,
        ipAddress: entry.ipAddress ?? null,
        // Severity and outcome only. The metadata object can contain the very
        // information the event is about, and an audit log holding the data it
        // audits has multiplied the exposure rather than recorded it.
        detail: `severity=${entry.severity} outcome=${entry.outcome} eventId=${entry.eventId}`,
      });
    } catch (dbError) {
      console.error('Security audit DB write failed, falling back to file:', dbError);

      const fs = await import('fs/promises');
      const path = await import('path');
      const logFile = path.join(process.cwd(), 'logs', 'security-audit.log');
      const logLine = JSON.stringify(entry) + '\n';

      try {
        await fs.appendFile(logFile, logLine);
      } catch {
        await fs.mkdir(path.dirname(logFile), { recursive: true });
        await fs.appendFile(logFile, logLine);
      }
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

  /**
   * Counts recent failed logins from the audit table and warns above a
   * threshold.
   *
   * The previous body logged "Checking failed login patterns for IP: ..." and
   * did nothing else, which read like brute-force detection in the logs while
   * detecting nothing. It queries the trail now. Blocking is deliberately not
   * done here: the login route is already behind loginLimiter, and a second
   * blocking mechanism that can be driven by a spoofable X-Forwarded-For is a
   * way to lock legitimate users out.
   */
  private static async checkFailedLoginAttempts(ipAddress: string, userId?: number): Promise<void> {
    if (!ipAddress) return;

    try {
      const { pool } = await import('./db');
      const { rows } = await pool.query(
        `SELECT count(*)::int AS failures
           FROM audit_events
          WHERE ip_address = $1
            AND action LIKE 'SECURITY_%FAILED%'
            AND occurred_at > now() - interval '15 minutes'`,
        [ipAddress]
      );

      const failures = rows[0]?.failures ?? 0;
      if (failures >= 10) {
        console.warn(
          `🚨 ${failures} failed authentication events from ${ipAddress} in 15 minutes` +
            (userId ? ` (most recent against user ${userId})` : '')
        );
      }
    } catch (error) {
      console.error('Failed-login pattern check failed:', error);
    }
  }

  /**
   * Flags one account reading an unusual number of patient records in a short
   * window — the shape of a bulk export.
   *
   * Also previously a console.log that claimed to be checking and was not.
   */
  private static async checkUnusualDataAccess(userId?: number, resource?: string): Promise<void> {
    if (!userId) return;

    try {
      const { pool } = await import('./db');
      const { rows } = await pool.query(
        `SELECT count(DISTINCT path)::int AS distinct_records
           FROM audit_events
          WHERE actor_user_id = $1
            AND action LIKE 'READ_PATIENT%'
            AND occurred_at > now() - interval '10 minutes'`,
        [userId]
      );

      const distinctRecords = rows[0]?.distinct_records ?? 0;
      if (distinctRecords >= 50) {
        console.warn(
          `🔍 User ${userId} read ${distinctRecords} distinct patient records in 10 minutes` +
            (resource ? ` (latest: ${resource})` : '')
        );
      }
    } catch (error) {
      console.error('Unusual-access pattern check failed:', error);
    }
  }
}

// Data Encryption Service
export class DataEncryption {
  private static algorithm = 'aes-256-gcm' as const;
  private static keyLength = 32;
  private static ivLength = 16;

  static encrypt(data: string, key?: string): { encrypted: string; iv: string; tag: string; key?: string } {
    const encryptionKey = key ? Buffer.from(key, 'hex') : crypto.randomBytes(this.keyLength);
    const iv = crypto.randomBytes(this.ivLength);
    
    const cipher = crypto.createCipheriv(this.algorithm, encryptionKey, iv);
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
    const decipher = crypto.createDecipheriv(this.algorithm, Buffer.from(key, 'hex'), Buffer.from(iv, 'hex'));
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

/**
 * Reads and revokes sessions from the session store, not from process memory.
 *
 * SessionManager below keeps its own Map, and nothing ever calls its
 * createSession() — so getActiveSessionsForUser() returned an empty array for
 * every user and terminateAllUserSessions() returned 0 while the endpoint
 * answered "All other sessions have been terminated". A user who believed their
 * account was compromised, clicked sign-out-everywhere and saw a success message
 * still had every other session live. The Map is also per-process, so it could
 * never have been right behind more than one instance.
 *
 * express-session's rows are the truth, so these query them directly.
 */
export class SessionStore {
  /** Sessions belonging to `userId` that have not expired. */
  static async listForUser(userId: number): Promise<Array<{
    sessionId: string;
    createdAt: string | null;
    expiresAt: Date;
    current: boolean;
  }>> {
    const { pool } = await import('./db');
    const { rows } = await pool.query(
      `SELECT sid, sess, expire
         FROM session
        WHERE (sess -> 'user' ->> 'id')::int = $1
          AND expire > now()
        ORDER BY expire DESC`,
      [userId]
    );

    return rows.map((row: any) => ({
      sessionId: row.sid,
      createdAt: row.sess?.cookie?.expires
        ? new Date(
            new Date(row.sess.cookie.expires).getTime() -
              (row.sess.cookie.originalMaxAge ?? 0)
          ).toISOString()
        : null,
      expiresAt: row.expire,
      current: false,
    }));
  }

  /**
   * Deletes every session for `userId` except `keepSessionId`.
   *
   * Returns the number actually deleted, so the caller reports what happened
   * rather than asserting it.
   */
  static async terminateAllExcept(userId: number, keepSessionId: string): Promise<number> {
    const { pool } = await import('./db');
    const { rowCount } = await pool.query(
      `DELETE FROM session
        WHERE (sess -> 'user' ->> 'id')::int = $1
          AND sid <> $2`,
      [userId, keepSessionId]
    );
    return rowCount ?? 0;
  }
}

// SessionManager was removed.
//
// It tracked sessions in a module-scoped Map that nothing ever wrote to:
// createSession() had no callers, so getActiveSessionsForUser() returned an
// empty array for every user and terminateAllUserSessions() reported 0 while
// the endpoint told the user every other session had been terminated. A
// per-process Map could not have worked behind more than one instance in any
// case. SessionStore above queries express-session's own rows instead.

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
  // `suspiciousActivities` (a Map<string, number> keyed by `${userId}-${action}`
  // with no eviction) was removed along with the counter that fed it: it was
  // reported as "failed logins" while counting every activity of any kind.
  // `recentActivity` below is the bounded replacement.
  private static alertThresholds = {
    failedLogins: 5,
    rapidDataAccess: 10,
    unusualHours: 3
  };

  /** Sliding five-minute window of recent actions, per user. */
  private static recentActivity = new Map<number, Array<{ action: string; resource: string; at: number }>>();
  private static readonly ACTIVITY_WINDOW_MS = 5 * 60 * 1000;
  /** Cap on tracked users, so an id-enumeration burst cannot grow this forever. */
  private static readonly MAX_TRACKED_USERS = 5000;

  static async monitorUserActivity(userId: number, activity: {
    action: string;
    resource: string;
    ipAddress: string;
    timestamp: Date;
  }): Promise<void> {
    const now = activity.timestamp.getTime();
    const cutoff = now - this.ACTIVITY_WINDOW_MS;

    const history = (this.recentActivity.get(userId) ?? []).filter((entry) => entry.at > cutoff);
    history.push({ action: activity.action, resource: activity.resource, at: now });
    this.recentActivity.set(userId, history);

    // Bound the map. `suspiciousActivities`, which this replaces, was a
    // Map keyed by `${userId}-${action}` with no eviction at all: one entry per
    // user per distinct action, retained for the life of the process.
    if (this.recentActivity.size > this.MAX_TRACKED_USERS) {
      for (const [id, entries] of this.recentActivity) {
        if (!entries.length || entries[entries.length - 1].at <= cutoff) {
          this.recentActivity.delete(id);
        }
      }
    }

    await this.checkSuspiciousPatterns(userId, activity);
  }

  private static async checkSuspiciousPatterns(userId: number, activity: any): Promise<void> {
    const hour = activity.timestamp.getHours();

    // Check for unusual hours (outside 6 AM - 10 PM)
    if (hour < 6 || hour > 22) {
      await this.triggerAlert('unusual_hours', { userId, action: activity.action });
    }

    // Rapid successive actions.
    //
    // getRecentActions() used to be a stub returning [], so `[].length > 10` was
    // false on every call and this alert could not fire under any circumstances.
    const recentActions = this.getRecentActions(userId);
    if (recentActions.length > this.alertThresholds.rapidDataAccess) {
      await this.triggerAlert('rapid_data_access', {
        userId,
        actionCount: recentActions.length,
        windowMinutes: this.ACTIVITY_WINDOW_MS / 60000,
      });
    }
  }

  private static getRecentActions(userId: number): Array<{ action: string; resource: string; at: number }> {
    const cutoff = Date.now() - this.ACTIVITY_WINDOW_MS;
    return (this.recentActivity.get(userId) ?? []).filter((entry) => entry.at > cutoff);
  }

  private static async triggerAlert(alertType: string, data: any): Promise<void> {
    // console.warn, not console.log: this is an alert, and on most log
    // aggregators severity is what decides whether anyone ever sees it.
    console.warn(`🚨 Security Alert: ${alertType}`, data);
    
    // Routing these to a pager or a SIEM is a deployment concern: the alert is
    // emitted at warn level with structured context so a log drain can act on
    // it. There is deliberately no automatic user or IP lockout here — an
    // automatic response driven by a spoofable header is itself an attack.
  }

  /**
   * Counters this process can actually answer for.
   *
   * The previous shape mislabelled its own data: `failedLogins` was the sum of a
   * counter incremented on *every* monitored activity, failed or not, and
   * `blockedIPs` and `activeSecurityAlerts` were the literals 0 with comments
   * saying the feature did not exist. A security dashboard reading zero blocked
   * IPs cannot be distinguished from one where blocking was never built.
   *
   * Failed logins are counted from the audit trail by
   * getFailedLoginCount() instead, which is where they are recorded.
   */
  static getSecurityMetrics(): {
    trackedUsers: number;
    recentActions: number;
    windowMinutes: number;
    ipBlocking: 'not_implemented';
  } {
    let recentActions = 0;
    const cutoff = Date.now() - this.ACTIVITY_WINDOW_MS;
    for (const entries of this.recentActivity.values()) {
      recentActions += entries.filter((entry) => entry.at > cutoff).length;
    }

    return {
      trackedUsers: this.recentActivity.size,
      recentActions,
      windowMinutes: this.ACTIVITY_WINDOW_MS / 60000,
      // Named rather than reported as 0, so a reader cannot mistake "no feature"
      // for "nothing blocked".
      ipBlocking: 'not_implemented',
    };
  }

  /** Failed authentication events in the last `minutes`, from audit_events. */
  static async getFailedLoginCount(minutes = 60): Promise<number | null> {
    try {
      const { pool } = await import('./db');
      const { rows } = await pool.query(
        `SELECT count(*)::int AS failures
           FROM audit_events
          WHERE action LIKE 'SECURITY_%FAILED%'
            AND occurred_at > now() - ($1 || ' minutes')::interval`,
        [String(minutes)]
      );
      return rows[0]?.failures ?? 0;
    } catch (error) {
      console.error('Failed-login count query failed:', error);
      return null;
    }
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

// The hourly SessionManager.cleanupExpiredSessions() timer went with it.
// connect-pg-simple prunes expired rows from the session table on its own
// schedule, so nothing here needs to.
