import { users, medicalScans, medicalTerms, appointments, chatMessages, notifications, scanOutcomes, type User, type InsertUser, type MedicalScan, type InsertScan, type MedicalTerm, type InsertTerm, type Appointment, type InsertAppointment, type Notification, type InsertNotification, type ScanOutcome, type InsertScanOutcome } from "@shared/schema";
import { getDb } from "./db";
// Row-level at-rest encryption, driven by the manifest in server/crypto. No-ops
// when no key is configured, and reads tolerate plaintext — which is what lets
// this be switched on over a live table without rewriting it first.
import { encryptRow, decryptRow, decryptRows } from "./crypto";
import { eq, ilike, or, and, sql, inArray, isNull, desc, gte } from "drizzle-orm";

const db = getDb();

/**
 * One modality's confusion matrix, counted from scans that have both a model
 * prediction and a human adjudication.
 *
 * `indeterminate` is carried separately rather than folded into either class:
 * an inconclusive biopsy is a real result, and forcing it into "benign" would
 * inflate specificity by exactly the cases the model found hardest.
 */
export interface OutcomeMatrixRow {
  scanType: string;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  indeterminate: number;
  /** Scans with a prediction but no adjudication. The measurement backlog. */
  unadjudicated: number;
}

/** A scan with the patient's name already attached by the database. */
export type ScanWithPatient = MedicalScan & {
  patientName: string | null;
  patientEmail: string | null;
};

/** Narrows a scan listing. Everything here maps to an existing index. */
export interface ScanQuery {
  status?: string;
  /** Rows created at or after this instant. */
  since?: Date;
  patientId?: number;
  radiologistId?: number;
  limit?: number;
  /** Newest first by default; activity feeds and queues want opposite ends. */
  order?: 'newest' | 'oldest';
}

/** Aggregate scan counters, computed in the database. */
export interface ScanStats {
  total: number;
  pending: number;
  completed: number;
  today: number;
  completedToday: number;
  /** Rows whose result is still the literal 'Processing'. */
  processing: number;
  cancerDetections: number;
  /** Null when no row has recorded one. Never a placeholder constant. */
  averageProcessingTimeMs: number | null;
  averageConfidencePct: number | null;
  byType: Array<{ scanType: string; count: number }>;
}

export interface IStorage {
  // User management
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, updates: Partial<User>): Promise<User | undefined>;
  updateUserProfile(id: number, updates: Partial<User>): Promise<User | undefined>;
  permanentlyDeleteUser(id: number): Promise<boolean>;
  deleteUser(id: number): Promise<boolean>;
  
  // Password reset functionality
  setPasswordResetToken(userId: number, token: string): Promise<void>;
  getUserByResetToken(token: string): Promise<User | undefined>;
  updateUserPassword(userId: number, hashedPassword: string): Promise<void>;
  clearPasswordResetToken(userId: number): Promise<void>;
  
  // Medical scans
  getScans(patientId?: number): Promise<MedicalScan[]>;
  createScan(scan: InsertScan): Promise<MedicalScan>;
  updateScan(id: number, updates: Partial<MedicalScan>): Promise<MedicalScan | undefined>;
  deleteScan(id: number): Promise<boolean>;
  getScansForReview(): Promise<any[]>;
  
  // Medical terms
  getTerms(): Promise<MedicalTerm[]>;
  searchTerms(query: string): Promise<MedicalTerm[]>;
  createTerm(term: InsertTerm): Promise<MedicalTerm>;
  
  // Appointments
  getAppointments(patientId?: number): Promise<Appointment[]>;
  createAppointment(appointment: InsertAppointment): Promise<Appointment>;
  updateAppointment(id: number, updates: Partial<Appointment>): Promise<Appointment | undefined>;
  updateAppointmentStatus(id: number, action: string, notes?: string): Promise<any>;
  rescheduleAppointment(id: number, newDate: Date, newTime: string): Promise<Appointment | undefined>;
  deleteAppointment(id: number): Promise<boolean>;
  
  // Patient Portal
  getPatientActivities(patientId: number): Promise<any[]>;
  getPatientAppointments(patientId: number): Promise<any[]>;
  
  // Doctor Portal
  getDoctorStats(): Promise<any>;
  getDoctorAppointments(doctorId: number): Promise<any[]>;
  getDoctorPatients(doctorId: number): Promise<any[]>;
  getPendingReports(doctorId: number): Promise<any[]>;
  getDoctorNotifications(doctorId: number): Promise<any[]>;
  
  // Radiologist Interface
  getRadiologistStats(): Promise<any>;
  getRadiologistActivities(radiologistId: number): Promise<any[]>;
  completeReview(scanId: number, notes: string, approved: boolean): Promise<any>;
  
  // Administrator Dashboard
  getAdminStats(): Promise<any>;
  getAllUsers(): Promise<User[]>;
  getSystemActivities(): Promise<any[]>;

  /**
   * Aggregate counters.
   *
   * Separate from getAllUsers()/getScans() on purpose. Callers that only needed
   * a number were fetching every row — every user record, password hash and
   * reset token included — and calling .length on it. That is a full table
   * transferred per dashboard render, and it grows with the table.
   */
  countScans(): Promise<number>;
  countUsersByRoles(roles: string[]): Promise<number>;
  countAllUsers(): Promise<number>;
  countCriticalScans(): Promise<number>;
  getUserRoleCounts(): Promise<{ role: string; count: number; newToday: number }[]>;
  /** Scans per calendar day for the last `days` days, oldest first. */
  getScansPerDay(days: number): Promise<Array<{ day: string; scans: number }>>;
  /** Cumulative registered users at the end of each of the last `months` months. */
  getCumulativeUsersByMonth(months: number): Promise<Array<{ month: string; users: number }>>;
  /** Distinct users holding an unexpired session right now. */
  countSignedInUsers(): Promise<number>;
  /**
   * Deletes every session belonging to a user, ending their logins immediately.
   *
   * Deleting or deactivating an account did not touch its sessions, so a removed
   * clinician stayed authenticated until their cookie expired — up to 24 hours
   * of continued access to patient records after the account was revoked.
   */
  revokeSessionsForUser(userId: number): Promise<number>;

  // Adjudicated outcomes
  recordScanOutcome(outcome: InsertScanOutcome): Promise<ScanOutcome>;
  /** The newest adjudication for a scan, or undefined if none has been made. */
  getCurrentOutcome(scanId: number): Promise<ScanOutcome | undefined>;
  /** Every adjudication for a scan, newest first. Append-only, so this is history. */
  getOutcomeHistory(scanId: number): Promise<ScanOutcome[]>;
  /** Scans that have a model prediction and no adjudication yet. */
  getScansAwaitingOutcome(limit?: number): Promise<MedicalScan[]>;
  /** Confusion-matrix counts per modality, from adjudicated scans only. */
  getOutcomeMatrix(minimumMethod?: string): Promise<OutcomeMatrixRow[]>;

  /**
   * Indexed lookups, so a handler that wants one row or one group fetches one
   * row or one group.
   *
   * Sixteen route handlers called getScans() — every scan in the system — and
   * then ran Array.prototype.find or .filter over the result to reach a single
   * record or a single status. Eighteen more did the same with getAllUsers(),
   * which also carries every password hash and reset token into the process on
   * each dashboard render. Every index needed for these already exists on the
   * tables; nothing was using them.
   */
  getScanById(id: number): Promise<MedicalScan | undefined>;
  /**
   * Scans with the patient's name, filtered and limited in the database.
   *
   * The shape almost every clinical listing needs, and the one they were all
   * building by hand: fetch every scan, fetch every user, then
   * `allUsers.find(u => u.id === scan.patientId)` inside a map over the scans.
   * That is two full table reads and a linear scan per row — quadratic in the
   * size of the database, on endpoints a dashboard polls. One indexed join
   * replaces it, and only the columns a listing displays are selected, so the
   * password hash stays in the database.
   */
  listScansWithPatient(query?: ScanQuery): Promise<ScanWithPatient[]>;
  /** One scan with its patient's name. */
  getScanWithPatient(id: number): Promise<ScanWithPatient | undefined>;
  getScansByStatus(status: string, limit?: number): Promise<MedicalScan[]>;
  getUsersByRole(role: string): Promise<User[]>;
  /**
   * One page of users, projected to the columns the admin list displays.
   *
   * Paged because the user table is the one listing that legitimately wants
   * every role, and therefore the one that grows without bound. Projected
   * because getAllUsers() selects `*`: rendering a list of names should not read
   * every password hash and live reset token into the process.
   */
  listUsersPage(opts: { page: number; pageSize: number }): Promise<{
    users: Array<{
      id: number;
      username: string;
      fullName: string | null;
      email: string;
      role: string;
      specialization: string | null;
      isActive: boolean | null;
      createdAt: Date | null;
    }>;
    total: number;
  }>;
  /**
   * Active users in the given roles, projected to the columns a directory needs.
   *
   * Distinct from getAllUsers() in two ways that both matter. It filters in the
   * database instead of loading every row and calling .filter(), and it selects
   * named columns instead of `*` — so the password hash and the password-reset
   * token stay in the database rather than being read into the process on every
   * chat poll and every render of the booking form.
   */
  listDirectory(roles: string[]): Promise<Array<{
    id: number;
    fullName: string | null;
    username: string;
    role: string;
    specialization: string | null;
  }>>;
  /**
   * Staff records for the admin console: the directory columns plus the
   * administrative ones, and still no password hash or reset token.
   */
  getStaffDirectory(roles: string[]): Promise<Array<{
    id: number;
    username: string;
    fullName: string | null;
    email: string;
    phone: string | null;
    role: string;
    specialization: string | null;
    licenseNumber: string | null;
    isActive: boolean | null;
    createdAt: Date | null;
  }>>;
  getScanStats(): Promise<ScanStats>;
  
  // Real-time Chat
  getChatParticipants(userId: number, role: string): Promise<any[]>;
  getChatMessages(userId: number, participantId: number): Promise<any[]>;
  createChatMessage(message: any): Promise<any>;
  markMessagesAsRead(senderId: number, receiverId: number): Promise<number>;

  // Notifications
  createNotification(notification: InsertNotification): Promise<Notification>;
  getNotifications(recipientId: number, limit?: number): Promise<Notification[]>;
  countUnreadNotifications(recipientId: number): Promise<number>;
  markNotificationRead(id: number, recipientId: number): Promise<boolean>;
  markAllNotificationsRead(recipientId: number): Promise<number>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    try {
      const [user] = await (db as any).select().from(users).where(eq(users.id, id));
      return user ? decryptRow('users', user) : undefined;
    } catch (error) {
      console.error('Error fetching user:', error);
      return undefined;
    }
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    // The lookup column itself is deliberately not encrypted — see
    // EXCLUDED_FIELDS. The row's other sensitive columns still are.
    const [user] = await (db as any).select().from(users).where(eq(users.username, username));
    return user ? decryptRow('users', user) : undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await (db as any).select().from(users).where(eq(users.email, email));
    return user ? decryptRow('users', user) : undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await (db as any).insert(users)
      .values(encryptRow('users', {
        ...insertUser,
        role: insertUser.role || "patient",
        isActive: true,
        createdAt: new Date()
      }))
      .returning();
    // The row comes back as it was written, so it needs opening again.
    return decryptRow('users', user);
  }

  async updateUser(id: number, updates: Partial<User>): Promise<User | undefined> {
    // encryptRow only touches properties actually present, so a partial update
    // that does not mention `address` leaves the stored ciphertext alone.
    const [user] = await (db as any).update(users)
      .set(encryptRow('users', updates))
      .where(eq(users.id, id))
      .returning();

    return user ? decryptRow('users', user) : undefined;
  }

  async permanentlyDeleteUser(id: number): Promise<boolean> {
    try {
      const user = await this.getUser(id);
      if (!user) return false;

      if (user.role === 'patient') {
        await (db as any).delete(medicalScans).where(eq(medicalScans.patientId, id));
        await (db as any).delete(appointments).where(eq(appointments.patientId, id));
      } else if (['doctor', 'radiologist'].includes(user.role)) {
        await (db as any).delete(appointments).where(eq(appointments.doctorId, id));
        
        await (db as any).update(medicalScans)
          .set({ doctorId: null })
          .where(eq(medicalScans.doctorId, id));
          
        if (user.role === 'radiologist') {
          await (db as any).update(medicalScans)
            .set({ radiologistId: null })
            .where(eq(medicalScans.radiologistId, id));
        }
      }
      
      const result = await (db as any).delete(users).where(eq(users.id, id));
      return (result.rowCount || 0) > 0;
    } catch (error) {
      console.error('Error permanently deleting user:', error);
      return false;
    }
  }

  async deleteUser(id: number): Promise<boolean> {
    return this.permanentlyDeleteUser(id);
  }

  async updateUserProfile(id: number, updates: Partial<User>): Promise<User | undefined> {
    return this.updateUser(id, updates);
  }

  async setPasswordResetToken(userId: number, token: string): Promise<void> {
    await (db as any).update(users)
      .set({ 
        resetToken: token, 
        resetTokenExpiry: new Date(Date.now() + 3600000)
      })
      .where(eq(users.id, userId));
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    const [user] = await (db as any).select()
      .from(users)
      .where(eq(users.resetToken, token));
    
    if (user && user.resetTokenExpiry && user.resetTokenExpiry > new Date()) {
      return decryptRow('users', user);
    }
    return undefined;
  }

  async updateUserPassword(userId: number, hashedPassword: string): Promise<void> {
    await (db as any).update(users)
      .set({ 
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null
      })
      .where(eq(users.id, userId));
  }

  async clearPasswordResetToken(userId: number): Promise<void> {
    await (db as any).update(users)
      .set({ 
        resetToken: null, 
        resetTokenExpiry: null 
      })
      .where(eq(users.id, userId));
  }

  async getScans(patientId?: number): Promise<any[]> {
    if (patientId) {
      return decryptRows(
        'medical_scans',
        await (db as any).select().from(medicalScans).where(eq(medicalScans.patientId, patientId))
      );
    }
    return decryptRows('medical_scans', await (db as any).select().from(medicalScans));
  }

  async createScan(insertScan: InsertScan): Promise<MedicalScan> {
    const [scan] = await (db as any).insert(medicalScans)
      .values(encryptRow('medical_scans', {
        ...insertScan,
        // Honour an explicit status (e.g. "pending_manual_review" when automated
        // analysis could not run); default to "pending". This previously always
        // forced "pending", silently discarding the caller's value.
        status: insertScan.status ?? "pending",
        createdAt: new Date()
      }))
      .returning();
    return decryptRow('medical_scans', scan);
  }

  async updateScan(id: number, updates: Partial<MedicalScan>): Promise<MedicalScan | undefined> {
    try {
      const [scan] = await (db as any).update(medicalScans)
        .set(encryptRow('medical_scans', {
          ...updates,
          updatedAt: new Date()
        }))
        .where(eq(medicalScans.id, id))
        .returning();
      return scan ? decryptRow('medical_scans', scan) : undefined;
    } catch (error) {
      console.error('Error updating scan:', error);
      return undefined;
    }
  }

  async deleteScan(id: number): Promise<boolean> {
    try {
      const result = await (db as any).delete(medicalScans).where(eq(medicalScans.id, id));
      return (result.rowCount || 0) > 0;
    } catch (error) {
      console.error('Error deleting scan:', error);
      return false;
    }
  }

  async getScansForReview(): Promise<any[]> {
    return decryptRows(
      'medical_scans',
      await (db as any).select().from(medicalScans).where(eq(medicalScans.status, 'pending'))
    );
  }

  async getTerms(): Promise<MedicalTerm[]> {
    return await (db as any).select().from(medicalTerms);
  }

  async searchTerms(query: string): Promise<MedicalTerm[]> {
    return await (db as any).select().from(medicalTerms).where(
      or(
        ilike(medicalTerms.term, `%${query}%`),
        ilike(medicalTerms.definition, `%${query}%`)
      )
    );
  }

  async createTerm(insertTerm: InsertTerm): Promise<MedicalTerm> {
    const [term] = await (db as any).insert(medicalTerms)
      .values(insertTerm)
      .returning();
    return term;
  }

  async getAppointments(patientId?: number): Promise<any[]> {
    if (patientId) {
      return await (db as any).select().from(appointments).where(eq(appointments.patientId, patientId));
    }
    return await (db as any).select().from(appointments);
  }

  async createAppointment(insertAppointment: InsertAppointment): Promise<Appointment> {
    const [appointment] = await (db as any).insert(appointments)
      .values({
        ...insertAppointment,
        status: "scheduled",
        createdAt: new Date()
      })
      .returning();
    return appointment;
  }

  async updateAppointment(id: number, updates: Partial<Appointment>): Promise<Appointment | undefined> {
    const [appointment] = await (db as any).update(appointments)
      .set(updates)
      .where(eq(appointments.id, id))
      .returning();
    return appointment || undefined;
  }

  async updateAppointmentStatus(id: number, action: string, notes?: string): Promise<any> {
    const statusMap: Record<string, string> = {
      'accept': 'confirmed',
      'approve': 'confirmed', 
      'decline': 'cancelled',
      'reject': 'cancelled',
      'complete': 'completed',
      'cancel': 'cancelled'
    };
    const status = statusMap[action] || action;
    return this.updateAppointment(id, { status, notes });
  }

  async rescheduleAppointment(id: number, newDate: Date, newTime: string): Promise<Appointment | undefined> {
    return this.updateAppointment(id, { appointmentDate: newDate, appointmentTime: newTime });
  }

  async deleteAppointment(id: number): Promise<boolean> {
    try {
      const result = await (db as any).delete(appointments).where(eq(appointments.id, id));
      return (result.rowCount || 0) > 0;
    } catch {
      return false;
    }
  }

  async getPatientActivities(patientId: number): Promise<any[]> {
    try {
      const scans = await this.getScans(patientId);
      const appts = await this.getAppointments(patientId);

      const scanActivities = (scans || []).map((s: any) => ({
        id: s.id,
        message: `${(s.scanType || 'Medical')} scan ${s.status === 'pending' ? 'submitted' : 'completed'}`,
        description: s.result || 'Scan updated',
        timestamp: s.createdAt || s.updatedAt || new Date(),
        status: (() => {
          const res = (s.result || '').toString().toLowerCase();
          if (res.includes('abnormal') || res.includes('suspicious')) return 'abnormal';
          if (res.includes('urgent') || res.includes('critical')) return 'critical';
          return 'normal';
        })(),
        type: 'scan'
      }));

      const apptActivities = (appts || []).map((a: any) => ({
        id: a.id,
        message: `Appointment ${a.status || 'scheduled'}`,
        description: a.notes || 'Appointment update',
        timestamp: a.updatedAt || a.createdAt || new Date(),
        status: a.status || 'scheduled',
        type: 'appointment'
      }));

      const all = [...scanActivities, ...apptActivities]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 10);
      return all;
    } catch (error) {
      console.error('Error building patient activities:', error);
      return [];
    }
  }

  async getPatientAppointments(patientId: number): Promise<any[]> {
    return this.getAppointments(patientId);
  }

  async getDoctorStats(): Promise<any> {
    return {};
  }

  async getDoctorAppointments(doctorId: number): Promise<any[]> {
    try {
      const doctorAppointments = await (db as any).select().from(appointments).where(eq(appointments.doctorId, doctorId));
      return doctorAppointments;
    } catch (error) {
      console.error('Error fetching doctor appointments:', error);
      return [];
    }
  }

  async getDoctorPatients(doctorId: number): Promise<any[]> {
    return [];
  }

  async getPendingReports(doctorId: number): Promise<any[]> {
    return [];
  }

  async getDoctorNotifications(doctorId: number): Promise<any[]> {
    return [];
  }

  async getRadiologistStats(): Promise<any> {
    return {};
  }

  async getRadiologistActivities(radiologistId: number): Promise<any[]> {
    return [];
  }

  async completeReview(scanId: number, notes: string, approved: boolean): Promise<any> {
    return this.updateScan(scanId, { notes, status: approved ? 'completed' : 'rejected' });
  }

  async getAdminStats(): Promise<any> {
    return {};
  }

  async getAllUsers(): Promise<User[]> {
    return decryptRows('users', await (db as any).select().from(users));
  }

  async getScanById(id: number): Promise<MedicalScan | undefined> {
    const [scan] = await (db as any).select().from(medicalScans).where(eq(medicalScans.id, id)).limit(1);
    return scan ? decryptRow('medical_scans', scan) : undefined;
  }

  /** Shared column list, so every caller gets the same flat shape. */
  private scanWithPatientColumns() {
    return {
      id: medicalScans.id,
      patientId: medicalScans.patientId,
      scanType: medicalScans.scanType,
      imagePath: medicalScans.imagePath,
      aiConfidence: medicalScans.aiConfidence,
      result: medicalScans.result,
      radiologistId: medicalScans.radiologistId,
      doctorId: medicalScans.doctorId,
      notes: medicalScans.notes,
      status: medicalScans.status,
      priority: medicalScans.priority,
      findings: medicalScans.findings,
      recommendations: medicalScans.recommendations,
      riskLevel: medicalScans.riskLevel,
      processingTime: medicalScans.processingTime,
      imageSize: medicalScans.imageSize,
      modelVersion: medicalScans.modelVersion,
      predictedPositive: medicalScans.predictedPositive,
      createdAt: medicalScans.createdAt,
      updatedAt: medicalScans.updatedAt,
      reviewedAt: medicalScans.reviewedAt,
      patientName: users.fullName,
      patientEmail: users.email,
    };
  }

  async listScansWithPatient(query: ScanQuery = {}): Promise<ScanWithPatient[]> {
    // Typed, because an empty literal infers as never[] and every push fails.
    const conditions: any[] = [];
    if (query.status) conditions.push(eq(medicalScans.status, query.status));
    if (query.patientId) conditions.push(eq(medicalScans.patientId, query.patientId));
    if (query.radiologistId) conditions.push(eq(medicalScans.radiologistId, query.radiologistId));
    if (query.since) conditions.push(gte(medicalScans.createdAt, query.since));

    let builder = (db as any)
      .select(this.scanWithPatientColumns())
      .from(medicalScans)
      .leftJoin(users, eq(users.id, medicalScans.patientId));

    if (conditions.length) builder = builder.where(and(...conditions));

    builder = builder.orderBy(
      query.order === 'oldest' ? medicalScans.createdAt : desc(medicalScans.createdAt)
    );

    // A default ceiling, not an optional one. An unbounded listing is fine on a
    // developer's database and is the thing that falls over first in production.
    builder = builder.limit(query.limit ?? 200);

    return decryptRows('medical_scans', await builder);
  }

  async getScanWithPatient(id: number): Promise<ScanWithPatient | undefined> {
    const [row] = await (db as any)
      .select(this.scanWithPatientColumns())
      .from(medicalScans)
      .leftJoin(users, eq(users.id, medicalScans.patientId))
      .where(eq(medicalScans.id, id))
      .limit(1);
    return row ? decryptRow('medical_scans', row) : undefined;
  }

  async getScansByStatus(status: string, limit = 200): Promise<MedicalScan[]> {
    return decryptRows(
      'medical_scans',
      await (db as any)
        .select()
        .from(medicalScans)
        .where(eq(medicalScans.status, status))
        .orderBy(desc(medicalScans.createdAt))
        .limit(limit)
    );
  }

  async getUsersByRole(role: string): Promise<User[]> {
    return decryptRows('users', await (db as any).select().from(users).where(eq(users.role, role)));
  }

  async listUsersPage({ page, pageSize }: { page: number; pageSize: number }) {
    const [rows, [count]] = await Promise.all([
      (db as any)
        .select({
          id: users.id,
          username: users.username,
          fullName: users.fullName,
          email: users.email,
          role: users.role,
          specialization: users.specialization,
          isActive: users.isActive,
          createdAt: users.createdAt,
        })
        .from(users)
        .orderBy(desc(users.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      (db as any).select({ total: sql<number>`count(*)::int` }).from(users),
    ]);
    // Nothing in this projection is encrypted, so no decryption is needed.
    return { users: rows, total: count?.total ?? 0 };
  }

  async getStaffDirectory(roles: string[]) {
    if (!roles.length) return [];
    const rows = await (db as any)
      .select({
        id: users.id,
        username: users.username,
        fullName: users.fullName,
        email: users.email,
        phone: users.phone,
        role: users.role,
        specialization: users.specialization,
        licenseNumber: users.licenseNumber,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(inArray(users.role, roles))
      .orderBy(users.fullName);
    // `phone` is encrypted at rest; the admin console displays it. The cast is
    // because decryptRows is generic over the row shape and the projection is
    // narrower than User.
    return decryptRows('users', rows) as Array<{
      id: number;
      username: string;
      fullName: string | null;
      email: string;
      phone: string | null;
      role: string;
      specialization: string | null;
      licenseNumber: string | null;
      isActive: boolean | null;
      createdAt: Date | null;
    }>;
  }

  async listDirectory(roles: string[]) {
    if (!roles.length) return [];
    return await (db as any)
      .select({
        id: users.id,
        fullName: users.fullName,
        username: users.username,
        role: users.role,
        specialization: users.specialization,
      })
      .from(users)
      .where(and(inArray(users.role, roles), eq(users.isActive, true)))
      .orderBy(users.fullName);
  }

  /**
   * Dashboard counters in two aggregate queries.
   *
   * Every figure below was previously computed by loading medical_scans into
   * memory and running .filter().length over it, once per dashboard poll.
   * averageProcessingTimeMs in particular was not computed at all: the endpoint
   * returned the constant 2.4, despite processing_time_ms being recorded on
   * every row.
   */
  async getScanStats(): Promise<ScanStats> {
    const [totals] = await (db as any)
      .select({
        total: sql<number>`count(*)::int`,
        pending: sql<number>`count(*) filter (where status = 'pending')::int`,
        completed: sql<number>`count(*) filter (where status = 'completed')::int`,
        today: sql<number>`count(*) filter (where created_at >= current_date)::int`,
        completedToday: sql<number>`count(*) filter (where created_at >= current_date and status = 'completed')::int`,
        processing: sql<number>`count(*) filter (where result = 'Processing')::int`,
        cancerDetections: sql<number>`count(*) filter (where result ilike '%cancer%' or result ilike '%malignant%')::int`,
        averageProcessingTimeMs: sql<number | null>`avg(processing_time_ms)`,
        averageConfidencePct: sql<number | null>`avg(nullif(replace(ai_confidence, '%', ''), '')::numeric)`,
      })
      .from(medicalScans);

    const byType = await (db as any)
      .select({ scanType: medicalScans.scanType, count: sql<number>`count(*)::int` })
      .from(medicalScans)
      .groupBy(medicalScans.scanType);

    return {
      total: totals?.total ?? 0,
      pending: totals?.pending ?? 0,
      completed: totals?.completed ?? 0,
      today: totals?.today ?? 0,
      completedToday: totals?.completedToday ?? 0,
      processing: totals?.processing ?? 0,
      cancerDetections: totals?.cancerDetections ?? 0,
      averageProcessingTimeMs:
        totals?.averageProcessingTimeMs === null || totals?.averageProcessingTimeMs === undefined
          ? null
          : Math.round(Number(totals.averageProcessingTimeMs)),
      averageConfidencePct:
        totals?.averageConfidencePct === null || totals?.averageConfidencePct === undefined
          ? null
          : Math.round(Number(totals.averageConfidencePct)),
      byType,
    };
  }

  /**
   * Real daily scan counts.
   *
   * The admin dashboard drew this series client-side as
   * `dailyScans - (6 - i) * 2`, which is today's count with a straight line
   * subtracted from it: a chart shaped like a trend, containing no history.
   * generate_series fills days with no scans as zero rather than omitting them,
   * so the axis is continuous.
   */
  async getScansPerDay(days: number): Promise<Array<{ day: string; scans: number }>> {
    const { pool } = await import('./db');
    const { rows } = await pool.query(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
              count(s.id)::int AS scans
         FROM generate_series(current_date - ($1::int - 1), current_date, interval '1 day') AS d(day)
         LEFT JOIN medical_scans s ON s.created_at >= d.day AND s.created_at < d.day + interval '1 day'
        GROUP BY d.day
        ORDER BY d.day`,
      [days]
    );
    return rows;
  }

  /**
   * Real cumulative registration curve.
   *
   * Replaces seven hardcoded multipliers (0.5, 0.6, 0.7, 0.78, 0.86, 0.93, 1.0)
   * applied to the current user count, which produced the same smooth upward
   * curve no matter what the registration history actually looked like.
   */
  async getCumulativeUsersByMonth(months: number): Promise<Array<{ month: string; users: number }>> {
    const { pool } = await import('./db');
    const { rows } = await pool.query(
      `SELECT to_char(m.month, 'Mon YYYY') AS month,
              (SELECT count(*)::int FROM users u
                WHERE u.created_at < m.month + interval '1 month') AS users
         FROM generate_series(
                date_trunc('month', current_date) - (($1::int - 1) || ' months')::interval,
                date_trunc('month', current_date),
                interval '1 month'
              ) AS m(month)
        ORDER BY m.month`,
      [months]
    );
    return rows;
  }

  /** One GROUP BY instead of five passes over an in-memory copy of the table. */
  async getUserRoleCounts(): Promise<{ role: string; count: number; newToday: number }[]> {
    return await (db as any)
      .select({
        role: users.role,
        count: sql<number>`count(*)::int`,
        newToday: sql<number>`count(*) filter (where created_at >= current_date)::int`,
      })
      .from(users)
      .groupBy(users.role);
  }

  /**
   * Users with a live session, counted from express-session's own table.
   *
   * Replaces `Math.floor(totalUsers * 0.3)`, which reported that 30% of accounts
   * were active regardless of whether anyone was signed in.
   */
  async countSignedInUsers(): Promise<number> {
    const { pool } = await import('./db');
    // Joined to `users` so sessions left behind by deleted accounts are not
    // counted. Before sessions were revoked on deletion, 100 of the 105 live
    // rows in this table belonged to users that no longer existed, and this
    // reported all of them as signed in.
    const { rows } = await pool.query(
      `SELECT count(DISTINCT u.id)::int AS signed_in
         FROM session s
         JOIN users u ON u.id = (s.sess -> 'user' ->> 'id')::int
        WHERE s.expire > now()`
    );
    return rows[0]?.signed_in ?? 0;
  }

  async revokeSessionsForUser(userId: number): Promise<number> {
    const { pool } = await import('./db');
    const { rowCount } = await pool.query(
      `DELETE FROM session WHERE (sess -> 'user' ->> 'id')::int = $1`,
      [userId]
    );
    return rowCount ?? 0;
  }

  async recordScanOutcome(outcome: InsertScanOutcome): Promise<ScanOutcome> {
    const [row] = await (db as any)
      .insert(scanOutcomes)
      .values(encryptRow('scan_outcomes', outcome))
      .returning();
    return decryptRow('scan_outcomes', row);
  }

  async getCurrentOutcome(scanId: number): Promise<ScanOutcome | undefined> {
    const [row] = await (db as any)
      .select()
      .from(scanOutcomes)
      .where(eq(scanOutcomes.scanId, scanId))
      .orderBy(desc(scanOutcomes.recordedAt), desc(scanOutcomes.id))
      .limit(1);
    return row ? decryptRow('scan_outcomes', row) : undefined;
  }

  async getOutcomeHistory(scanId: number): Promise<ScanOutcome[]> {
    return decryptRows(
      'scan_outcomes',
      await (db as any)
        .select()
        .from(scanOutcomes)
        .where(eq(scanOutcomes.scanId, scanId))
        .orderBy(desc(scanOutcomes.recordedAt), desc(scanOutcomes.id))
    );
  }

  async getScansAwaitingOutcome(limit = 100): Promise<MedicalScan[]> {
    const { pool } = await import('./db');
    // A scan is measurable only if a model actually made a call on it, so rows
    // with a null prediction are not in this queue — they are in the manual
    // review queue, which is a different job.
    const { rows } = await pool.query(
      `SELECT s.*
         FROM medical_scans s
        WHERE s.predicted_positive IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM scan_outcomes o WHERE o.scan_id = s.id)
        ORDER BY
          -- Flagged scans first: a false negative costs more than a false
          -- positive, and confirming the flagged ones is what surfaces them.
          s.predicted_positive DESC,
          s.created_at ASC
        LIMIT $1`,
      [limit]
    );
    return decryptRows('medical_scans', rows);
  }

  /**
   * Confusion counts per modality, from the newest adjudication per scan.
   *
   * `minimumMethod` restricts the evidence: passing 'biopsy' counts only scans
   * confirmed by biopsy or histopathology. A sensitivity computed purely from
   * "the radiologist looked again" is a measure of agreement with a radiologist,
   * not of correctness, and the caller should be able to say which it wants.
   */
  async getOutcomeMatrix(minimumMethod?: string): Promise<OutcomeMatrixRow[]> {
    const { pool } = await import('./db');

    const strength = ['histopathology', 'biopsy', 'specialist_review', 'imaging_followup', 'clinical_followup'];
    const cutoff = minimumMethod ? strength.indexOf(minimumMethod) : -1;
    const accepted = cutoff >= 0 ? strength.slice(0, cutoff + 1) : strength;

    const { rows } = await pool.query(
      `WITH latest AS (
         SELECT DISTINCT ON (o.scan_id) o.scan_id, o.outcome, o.method
           FROM scan_outcomes o
          WHERE o.method = ANY($1)
          ORDER BY o.scan_id, o.recorded_at DESC, o.id DESC
       )
       SELECT s.scan_type AS "scanType",
              count(*) FILTER (WHERE s.predicted_positive AND l.outcome = 'malignant')::int      AS "truePositives",
              count(*) FILTER (WHERE s.predicted_positive AND l.outcome = 'benign')::int         AS "falsePositives",
              count(*) FILTER (WHERE NOT s.predicted_positive AND l.outcome = 'benign')::int     AS "trueNegatives",
              count(*) FILTER (WHERE NOT s.predicted_positive AND l.outcome = 'malignant')::int  AS "falseNegatives",
              count(*) FILTER (WHERE l.outcome = 'indeterminate')::int                           AS "indeterminate",
              count(*) FILTER (WHERE l.scan_id IS NULL)::int                                     AS "unadjudicated"
         FROM medical_scans s
         LEFT JOIN latest l ON l.scan_id = s.id
        WHERE s.predicted_positive IS NOT NULL
        GROUP BY s.scan_type
        ORDER BY s.scan_type`,
      [accepted]
    );
    return rows;
  }

  async countAllUsers(): Promise<number> {
    const [row] = await (db as any)
      .select({ count: sql<number>`count(*)::int` })
      .from(users);
    return row?.count ?? 0;
  }

  /** Results whose text marks them urgent or critical. */
  async countCriticalScans(): Promise<number> {
    const [row] = await (db as any)
      .select({ count: sql<number>`count(*)::int` })
      .from(medicalScans)
      .where(sql`result ilike '%urgent%' or result ilike '%critical%'`);
    return row?.count ?? 0;
  }

  async countScans(): Promise<number> {
    const [row] = await (db as any)
      .select({ count: sql<number>`count(*)::int` })
      .from(medicalScans);
    return row?.count ?? 0;
  }

  async countUsersByRoles(roles: string[]): Promise<number> {
    if (!roles.length) return 0;
    const [row] = await (db as any)
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(and(inArray(users.role, roles), eq(users.isActive, true)));
    return row?.count ?? 0;
  }

  async getSystemActivities(): Promise<any[]> {
    return [];
  }

  async getChatParticipants(userId: number, role: string): Promise<any[]> {
    return [];
  }

  async getChatMessages(userId: number, participantId: number): Promise<any[]> {
    try {
      const messages = await (db as any)
        .select({
          id: chatMessages.id,
          senderId: chatMessages.senderId,
          receiverId: chatMessages.receiverId,
          message: chatMessages.message,
          messageType: chatMessages.messageType,
          status: chatMessages.status,
          timestamp: chatMessages.createdAt,
          readAt: chatMessages.readAt,
          senderName: users.fullName
        })
        .from(chatMessages)
        .leftJoin(users, eq(chatMessages.senderId, users.id))
        .where(
          or(
            and(eq(chatMessages.senderId, userId), eq(chatMessages.receiverId, participantId)),
            and(eq(chatMessages.senderId, participantId), eq(chatMessages.receiverId, userId))
          )
        )
        .orderBy(chatMessages.createdAt);

      return decryptRows('chat_messages', messages);
    } catch (error) {
      console.error('Error fetching chat messages:', error);
      return [];
    }
  }

  async createChatMessage(messageData: any): Promise<any> {
    try {
      const [message] = await (db as any)
        .insert(chatMessages)
        .values(encryptRow('chat_messages', {
          senderId: messageData.senderId,
          receiverId: messageData.receiverId,
          message: messageData.message,
          messageType: messageData.messageType || 'text',
          status: messageData.status || 'sent'
        }))
        .returning();

      return decryptRow('chat_messages', message);
    } catch (error) {
      console.error('Error creating chat message:', error);
      throw error;
    }
  }

  /**
   * Marks every message `senderId` sent to `receiverId` as read.
   *
   * The body of this method used to be the comment "Implementation would mark
   * messages as read" and nothing else, while POST /api/chat/mark-read answered
   * {success: true}. chat_messages.read_at was declared in the schema and never
   * written, so no message was ever read and unread badges never cleared.
   *
   * Returns how many rows changed, so the caller can tell a no-op from a real
   * update instead of assuming success.
   */
  async markMessagesAsRead(senderId: number, receiverId: number): Promise<number> {
    const updated = await (db as any)
      .update(chatMessages)
      .set({ readAt: new Date(), status: 'read' })
      .where(
        and(
          eq(chatMessages.senderId, senderId),
          eq(chatMessages.receiverId, receiverId),
          isNull(chatMessages.readAt)
        )
      )
      .returning({ id: chatMessages.id });
    return updated.length;
  }

  async createNotification(notification: InsertNotification): Promise<Notification> {
    const [row] = await (db as any).insert(notifications).values(notification).returning();
    return row;
  }

  async getNotifications(recipientId: number, limit = 20): Promise<Notification[]> {
    return await (db as any)
      .select()
      .from(notifications)
      .where(eq(notifications.recipientId, recipientId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  async countUnreadNotifications(recipientId: number): Promise<number> {
    const [row] = await (db as any)
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.recipientId, recipientId), isNull(notifications.readAt)));
    return row?.count ?? 0;
  }

  /**
   * Ownership is part of the WHERE clause, not a check before it: a notification
   * belonging to someone else is simply not matched, so there is no window in
   * which a check passes and the update touches another row.
   */
  async markNotificationRead(id: number, recipientId: number): Promise<boolean> {
    const updated = await (db as any)
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.recipientId, recipientId),
          isNull(notifications.readAt)
        )
      )
      .returning({ id: notifications.id });
    return updated.length > 0;
  }

  async markAllNotificationsRead(recipientId: number): Promise<number> {
    const updated = await (db as any)
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.recipientId, recipientId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return updated.length;
  }
}

// Create storage instance with fallback mechanism
/**
 * In-memory storage used when the database is unreachable.
 *
 * It ships with NO accounts. It previously carried four — admin, doctor,
 * radiologist, patient — all sharing one hardcoded bcrypt hash copied from a
 * tutorial. Since this class is both the default export and the failure path
 * when the database drops, a database outage silently swapped a real user table
 * for a fixed set of credentials, including an administrator. Whoever knows that
 * hash's plaintext could log in as admin during any outage. (The inline comments
 * claimed the password was "admin123"; it is not, which made the risk harder to
 * assess rather than smaller.)
 *
 * With no users, authentication simply fails while the database is down. That is
 * the correct behaviour: a health system that cannot reach its user table should
 * refuse logins, not accept a built-in one.
 */
class FallbackStorage implements IStorage {
  private mockUsers: User[] = [];

  async getUser(id: number): Promise<User | undefined> {
    return this.mockUsers.find(u => u.id === id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return this.mockUsers.find(u => u.username === username);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return this.mockUsers.find(u => u.email === email);
  }

  async createUser(user: InsertUser): Promise<User> {
    const newUser: User = {
      id: this.mockUsers.length ? Math.max(...this.mockUsers.map(u => u.id)) + 1 : 1,
      ...user,
      role: user.role || 'patient',
      isActive: true,
      createdAt: new Date()
    } as User;
    this.mockUsers.push(newUser);
    return newUser;
  }

  async updateUser(id: number, updates: Partial<User>): Promise<User | undefined> {
    const userIndex = this.mockUsers.findIndex(u => u.id === id);
    if (userIndex === -1) return undefined;
    this.mockUsers[userIndex] = { ...this.mockUsers[userIndex], ...updates };
    return this.mockUsers[userIndex];
  }

  async updateUserProfile(id: number, updates: Partial<User>): Promise<User | undefined> {
    return this.updateUser(id, updates);
  }

  async permanentlyDeleteUser(id: number): Promise<boolean> {
    const index = this.mockUsers.findIndex(u => u.id === id);
    if (index === -1) return false;
    this.mockUsers.splice(index, 1);
    return true;
  }

  async deleteUser(id: number): Promise<boolean> {
    return this.permanentlyDeleteUser(id);
  }

  async getAllUsers(): Promise<User[]> {
    return this.mockUsers;
  }

  async countScans(): Promise<number> { return 0; }
  async countAllUsers(): Promise<number> { return this.mockUsers.length; }
  async getUserRoleCounts() {
    const byRole = new Map<string, number>();
    for (const u of this.mockUsers) byRole.set(u.role, (byRole.get(u.role) ?? 0) + 1);
    return Array.from(byRole, ([role, count]) => ({ role, count, newToday: 0 }));
  }
  async countSignedInUsers(): Promise<number> { return 0; }
  async revokeSessionsForUser(userId: number): Promise<number> { return 0; }
  async recordScanOutcome(outcome: InsertScanOutcome): Promise<ScanOutcome> {
    throw new Error('Recording an outcome requires a database connection');
  }
  async getCurrentOutcome(scanId: number): Promise<ScanOutcome | undefined> { return undefined; }
  async getOutcomeHistory(scanId: number): Promise<ScanOutcome[]> { return []; }
  async getScansAwaitingOutcome(limit?: number): Promise<MedicalScan[]> { return []; }
  async getOutcomeMatrix(minimumMethod?: string): Promise<OutcomeMatrixRow[]> { return []; }
  async getScansPerDay(days: number) { return []; }
  async getCumulativeUsersByMonth(months: number) { return []; }
  async countCriticalScans(): Promise<number> { return 0; }
  async getScanById(id: number): Promise<MedicalScan | undefined> { return undefined; }
  async listScansWithPatient(query?: ScanQuery): Promise<ScanWithPatient[]> { return []; }
  async getScanWithPatient(id: number): Promise<ScanWithPatient | undefined> { return undefined; }
  async getScansByStatus(status: string, limit?: number): Promise<MedicalScan[]> { return []; }
  async getUsersByRole(role: string): Promise<User[]> {
    return this.mockUsers.filter((u) => u.role === role);
  }
  async listUsersPage({ page, pageSize }: { page: number; pageSize: number }) {
    const slice = this.mockUsers.slice((page - 1) * pageSize, page * pageSize);
    return {
      users: slice.map((u) => ({
        id: u.id, username: u.username, fullName: u.fullName, email: u.email,
        role: u.role, specialization: u.specialization ?? null,
        isActive: u.isActive ?? true, createdAt: u.createdAt ?? null,
      })),
      total: this.mockUsers.length,
    };
  }
  async getStaffDirectory(roles: string[]) {
    return this.mockUsers.filter((u) => roles.includes(u.role)).map((u) => ({
      id: u.id, username: u.username, fullName: u.fullName, email: u.email,
      phone: u.phone ?? null, role: u.role, specialization: u.specialization ?? null,
      licenseNumber: u.licenseNumber ?? null, isActive: u.isActive ?? true,
      createdAt: u.createdAt ?? null,
    }));
  }
  async listDirectory(roles: string[]) {
    return this.mockUsers
      .filter((u) => roles.includes(u.role))
      .map((u) => ({
        id: u.id,
        fullName: u.fullName,
        username: u.username,
        role: u.role,
        specialization: u.specialization ?? null,
      }));
  }
  async getScanStats(): Promise<ScanStats> {
    return {
      total: 0, pending: 0, completed: 0, today: 0, completedToday: 0,
      processing: 0, cancerDetections: 0,
      averageProcessingTimeMs: null, averageConfidencePct: null, byType: [],
    };
  }

  async countUsersByRoles(roles: string[]): Promise<number> {
    return this.mockUsers.filter((u) => roles.includes(u.role)).length;
  }

  // Implement other required methods with mock data
  async setPasswordResetToken(userId: number, token: string): Promise<void> {}
  async getUserByResetToken(token: string): Promise<User | undefined> { return undefined; }
  async updateUserPassword(userId: number, hashedPassword: string): Promise<void> {}
  async clearPasswordResetToken(userId: number): Promise<void> {}
  async getScans(patientId?: number): Promise<MedicalScan[]> { return []; }
  async createScan(scan: InsertScan): Promise<MedicalScan> { return {} as MedicalScan; }
  async updateScan(id: number, updates: Partial<MedicalScan>): Promise<MedicalScan | undefined> { return undefined; }
  async deleteScan(id: number): Promise<boolean> { return false; }
  async getScansForReview(): Promise<any[]> { return []; }
  async getTerms(): Promise<MedicalTerm[]> { return []; }
  async searchTerms(query: string): Promise<MedicalTerm[]> { return []; }
  async createTerm(term: InsertTerm): Promise<MedicalTerm> { return {} as MedicalTerm; }
  async getAppointments(patientId?: number): Promise<Appointment[]> { return []; }
  async createAppointment(appointment: InsertAppointment): Promise<Appointment> { return {} as Appointment; }
  async updateAppointment(id: number, updates: Partial<Appointment>): Promise<Appointment | undefined> { return undefined; }
  async updateAppointmentStatus(id: number, action: string, notes?: string): Promise<any> { return null; }
  async rescheduleAppointment(id: number, newDate: Date, newTime: string): Promise<Appointment | undefined> { return undefined; }
  async deleteAppointment(id: number): Promise<boolean> { return false; }
  async getPatientActivities(patientId: number): Promise<any[]> { return []; }
  async getPatientAppointments(patientId: number): Promise<any[]> { return []; }
  async getDoctorStats(): Promise<any> { return {}; }
  async getDoctorAppointments(doctorId: number): Promise<any[]> { return []; }
  async getDoctorPatients(doctorId: number): Promise<any[]> { return []; }
  async getPendingReports(doctorId: number): Promise<any[]> { return []; }
  async getDoctorNotifications(doctorId: number): Promise<any[]> { return []; }
  async getRadiologistStats(): Promise<any> { return {}; }
  async getRadiologistActivities(radiologistId: number): Promise<any[]> { return []; }
  async completeReview(scanId: number, notes: string, approved: boolean): Promise<any> { return null; }
  async getAdminStats(): Promise<any> { return {}; }
  async getSystemActivities(): Promise<any[]> { return []; }
  async getChatParticipants(userId: number, role: string): Promise<any[]> { return []; }
  async getChatMessages(userId: number, participantId: number): Promise<any[]> { return []; }
  async createChatMessage(message: any): Promise<any> { return {}; }
  async markMessagesAsRead(senderId: number, receiverId: number): Promise<number> { return 0; }
  async createNotification(notification: InsertNotification): Promise<Notification> {
    throw new Error('Notifications require a database connection');
  }
  async getNotifications(recipientId: number, limit?: number): Promise<Notification[]> { return []; }
  async countUnreadNotifications(recipientId: number): Promise<number> { return 0; }
  async markNotificationRead(id: number, recipientId: number): Promise<boolean> { return false; }
  async markAllNotificationsRead(recipientId: number): Promise<number> { return 0; }
}

// Dynamic storage selection based on database availability
let storage: IStorage;

export async function initializeStorage(): Promise<IStorage> {
  try {
    // Test if database is available
    const dbStorage = new DatabaseStorage();
    await dbStorage.getAllUsers(); // Test database connection
    storage = dbStorage;
    console.log('✅ Using database storage');
    return storage;
  } catch (error) {
    console.error('❌ Database unavailable. Falling back to in-memory storage:', error);
    console.error('   No accounts exist in fallback storage, so all logins will fail');
    console.error('   until the database is restored. This is intentional.');
    storage = new FallbackStorage();
    return storage;
  }
}

// Initialize with fallback storage by default
storage = new FallbackStorage();

export { storage };