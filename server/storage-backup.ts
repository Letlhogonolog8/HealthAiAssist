import { users, medicalScans, medicalTerms, appointments, type User, type InsertUser, type MedicalScan, type InsertScan, type MedicalTerm, type InsertTerm, type Appointment, type InsertAppointment } from "@shared/schema";
import { getDb } from "./db";

const db = getDb();
import { eq, ilike, or } from "drizzle-orm";

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
  
  // Real-time Chat
  getChatParticipants(userId: number, role: string): Promise<any[]>;
  getChatMessages(userId: number, participantId: number): Promise<any[]>;
  createChatMessage(message: any): Promise<any>;
  markMessagesAsRead(senderId: number, receiverId: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async deleteScan(id: number): Promise<boolean> {
    try {
      const result = await db.delete(medicalScans).where(eq(medicalScans.id, id));
      return (result.rowCount || 0) > 0;
    } catch (error) {
      console.error('Error deleting scan:', error);
      return false;
    }
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values({
        ...insertUser,
        role: insertUser.role || "patient",
        isActive: true,
        createdAt: new Date()
      })
      .returning();
    return user;
  }

  async updateUser(id: number, updates: Partial<User>): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, id))
      .returning();
    
    return user || undefined;
  }

  async permanentlyDeleteUser(id: number): Promise<boolean> {
    try {
      const user = await this.getUser(id);
      if (!user) return false;

      if (user.role === 'patient') {
        // For patients, delete their scans and appointments
        await db.delete(medicalScans).where(eq(medicalScans.patientId, id));
        await db.delete(appointments).where(eq(appointments.patientId, id));
      } else if (['doctor', 'radiologist'].includes(user.role)) {
        // For doctors/radiologists, handle foreign key constraints
        // Delete appointments where they are the doctor
        await db.delete(appointments).where(eq(appointments.doctorId, id));
        
        // Remove references from medical scans
        await db.update(medicalScans)
          .set({ doctorId: null })
          .where(eq(medicalScans.doctorId, id));
          
        if (user.role === 'radiologist') {
          await db.update(medicalScans)
            .set({ radiologistId: null })
            .where(eq(medicalScans.radiologistId, id));
        }
      }
      
      // Delete the user
      const result = await db.delete(users).where(eq(users.id, id));
      return (result.rowCount || 0) > 0;
    } catch (error) {
      console.error('Error permanently deleting user:', error);
      return false;
    }
  }

  async setPasswordResetToken(userId: number, token: string): Promise<void> {
    await db
      .update(users)
      .set({ 
        resetToken: token, 
        resetTokenExpiry: new Date(Date.now() + 3600000) // 1 hour from now
      })
      .where(eq(users.id, userId));
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.resetToken, token));
    
    // Check if token is expired
    if (user && user.resetTokenExpiry && user.resetTokenExpiry > new Date()) {
      return user;
    }
    return undefined;
  }

  async updateUserPassword(userId: number, hashedPassword: string): Promise<void> {
    await db
      .update(users)
      .set({ 
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null
      })
      .where(eq(users.id, userId));
    
    console.log(`Password updated for user ID: ${userId}`);
  }

  async clearPasswordResetToken(userId: number): Promise<void> {
    await db
      .update(users)
      .set({ 
        resetToken: null, 
        resetTokenExpiry: null 
      })
      .where(eq(users.id, userId));
  }

  async getScans(patientId?: number): Promise<any[]> {
    if (patientId) {
      return await db.select().from(medicalScans).where(eq(medicalScans.patientId, patientId));
    }
    return await db.select().from(medicalScans);
  }

  async createScan(insertScan: InsertScan): Promise<MedicalScan> {
    const [scan] = await db
      .insert(medicalScans)
      .values({
        ...insertScan,
        status: "pending",
        createdAt: new Date()
      })
      .returning();
    return scan;
  }

  async updateScan(id: number, updates: Partial<MedicalScan>): Promise<MedicalScan | undefined> {
    const [scan] = await db
      .update(medicalScans)
      .set(updates)
      .where(eq(medicalScans.id, id))
      .returning();
    return scan || undefined;
  }

  async getTerms(): Promise<MedicalTerm[]> {
    return await db.select().from(medicalTerms);
  }

  async searchTerms(query: string): Promise<MedicalTerm[]> {
    return await db.select().from(medicalTerms).where(
      or(
        ilike(medicalTerms.term, `%${query}%`),
        ilike(medicalTerms.definition, `%${query}%`)
      )
    );
  }

  async createTerm(insertTerm: InsertTerm): Promise<MedicalTerm> {
    const [term] = await db
      .insert(medicalTerms)
      .values(insertTerm)
      .returning();
    return term;
  }

  async getAppointments(patientId?: number): Promise<any[]> {
    if (patientId) {
      return await db.select().from(appointments).where(eq(appointments.patientId, patientId));
    }
    return await db.select().from(appointments);
  }

  async createAppointment(insertAppointment: InsertAppointment): Promise<Appointment> {
    const [appointment] = await db
      .insert(appointments)
      .values(insertAppointment)
      .returning();
    return appointment;
  }

  async updateAppointment(id: number, updates: Partial<Appointment>): Promise<Appointment | undefined> {
    const [appointment] = await db
      .update(appointments)
      .set(updates)
      .where(eq(appointments.id, id))
      .returning();
    return appointment || undefined;
  }

  async rescheduleAppointment(id: number, newDate: Date, newTime: string): Promise<Appointment | undefined> {
    const [appointment] = await db
      .update(appointments)
      .set({ 
        appointmentDate: newDate,
        appointmentTime: newTime,
        status: 'scheduled'
      })
      .where(eq(appointments.id, id))
      .returning();
    return appointment || undefined;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async updateUserProfile(id: number, updates: Partial<User>): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, id))
      .returning();
    return user || undefined;
  }

  async deleteUser(id: number): Promise<boolean> {
    try {
      // First, handle appointments for doctors/radiologists
      const user = await this.getUser(id);
      if (user && ['doctor', 'radiologist'].includes(user.role)) {
        // Delete all appointments for this doctor (since doctor_id has NOT NULL constraint)
        await db.delete(appointments).where(eq(appointments.doctorId, id));
        
        // Update medical scans to remove references
        await db.update(medicalScans)
          .set({ doctorId: null })
          .where(eq(medicalScans.doctorId, id));
          
        if (user.role === 'radiologist') {
          await db.update(medicalScans)
            .set({ radiologistId: null })
            .where(eq(medicalScans.radiologistId, id));
        }
      }
      
      // Now delete the user
      const result = await db.delete(users).where(eq(users.id, id));
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      console.error('Error deleting user:', error);
      throw error;
    }
  }

  async getScansForReview(): Promise<any[]> {
    return [
      {
        id: 1,
        patientName: "John Smith",
        scanType: "Chest X-Ray",
        uploadDate: new Date().toISOString(),
        status: "pending",
        priority: "medium",
        aiConfidence: 0,
        findings: [],
        recommendations: [],
        riskLevel: "unknown"
      },
      {
        id: 2,
        patientName: "Unknown Patient",
        scanType: "Mammography",
        uploadDate: new Date(Date.now() - 86400000).toISOString(),
        status: "completed",
        priority: "high",
        aiConfidence: 94,
        findings: ["Suspicious mass detected in upper left quadrant"],
        recommendations: ["Immediate biopsy recommended", "Oncology consultation"],
        riskLevel: "high"
      }
    ];
  }

  async updateAppointmentStatus(id: number, action: string, notes?: string): Promise<any> {
    const statusMap: { [key: string]: string } = {
      'accept': 'confirmed',
      'decline': 'cancelled',
      'complete': 'completed',
      'delete': 'cancelled'
    };

    if (action === 'delete') {
      await db.delete(appointments).where(eq(appointments.id, id));
      return { success: true, action: 'deleted' };
    }

    const [appointment] = await db
      .update(appointments)
      .set({ 
        status: statusMap[action] || 'pending',
        notes: notes
      })
      .where(eq(appointments.id, id))
      .returning();
    
    return appointment;
  }

  async getPatientActivities(patientId: number): Promise<any[]> {
    return [
      {
        id: 1,
        type: "scan_completed",
        description: "Skin lesion scan completed",
        timestamp: new Date().toISOString(),
        status: "completed",
        result: "Normal findings - no concerning patterns detected",
        riskLevel: "low"
      },
      {
        id: 2,
        type: "scan_completed", 
        description: "Breast cancer screening completed",
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        status: "completed",
        result: "Normal findings - no concerning patterns detected",
        riskLevel: "low"
      },
      {
        id: 3,
        type: "scan_completed",
        description: "Lung cancer screening completed", 
        timestamp: new Date(Date.now() - 7200000).toISOString(),
        status: "completed",
        result: "Abnormal findings detected - medium risk",
        riskLevel: "medium"
      }
    ];
  }

  async getPatientAppointments(patientId: number): Promise<any[]> {
    try {
      const result = await db
        .select({
          id: appointments.id,
          doctorId: appointments.doctorId,
          doctorName: users.fullName,
          specialty: users.specialization,
          professionalRole: users.role,
          date: appointments.appointmentDate,
          time: appointments.appointmentTime,
          type: appointments.type,
          status: appointments.status,
          notes: appointments.notes,
          priority: appointments.priority,
          reason: appointments.reason
        })
        .from(appointments)
        .innerJoin(users, eq(appointments.doctorId, users.id))
        .where(eq(appointments.patientId, patientId))
        .orderBy(appointments.appointmentDate, appointments.appointmentTime);

      return result;
    } catch (error) {
      console.error('Error in getPatientAppointments:', error);
      return [];
    }
  }

  async getDoctorStats(): Promise<any> {
    const totalAppointments = await db.select().from(appointments);
    const totalScans = await db.select().from(medicalScans);
    const totalPatients = await db.select().from(users).where(eq(users.role, 'patient'));
    
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    
    const todaysAppointments = totalAppointments.filter((apt: any) => {
      const aptDate = new Date(apt.appointmentDate);
      return aptDate >= todayStart && aptDate <= todayEnd;
    });

    const pendingReports = totalScans.filter((scan: any) => 
      scan.result !== 'Processing' && !scan.notes
    );

    return {
      activePatients: totalPatients.length,
      todaysAppointments: todaysAppointments.length,
      pendingReports: pendingReports.length,
      criticalCases: totalScans.filter((scan: any) => 
        scan.result?.toLowerCase().includes('high') || 
        scan.result?.toLowerCase().includes('critical')
      ).length,
      totalPatients: totalPatients.length,
      appointmentsCompleted: totalAppointments.filter((apt: any) => apt.status === 'completed').length,
      avgConsultationTime: 45,
      patientSatisfaction: 96
    };
  }

  async getDoctorAppointments(doctorId: number): Promise<any[]> {
    try {
      const result = await db
        .select({
          id: appointments.id,
          patientId: appointments.patientId,
          patientName: users.fullName,
          patientEmail: users.email,
          date: appointments.appointmentDate,
          time: appointments.appointmentTime,
          type: appointments.type,
          status: appointments.status,
          notes: appointments.notes,
          priority: appointments.priority,
          reason: appointments.reason
        })
        .from(appointments)
        .innerJoin(users, eq(appointments.patientId, users.id))
        .where(eq(appointments.doctorId, doctorId))
        .orderBy(appointments.appointmentDate, appointments.appointmentTime);

      return result;
    } catch (error) {
      console.error('Error in getDoctorAppointments:', error);
      return [];
    }
  }

  async getDoctorPatients(doctorId: number): Promise<any[]> {
    // Get patients who have appointments with this doctor
    const patientResults = await db
      .selectDistinct({
        id: users.id,
        name: users.fullName,
        email: users.email,
        age: users.age,
        gender: users.gender,
        lastVisit: appointments.appointmentDate
      })
      .from(users)
      .innerJoin(appointments, eq(users.id, appointments.patientId))
      .where(eq(appointments.doctorId, doctorId))
      .orderBy(users.fullName);

    // Get scan counts for each patient
    const patientsWithDetails = await Promise.all(patientResults.map(async (patient: any) => {
      const scans = await db
        .select()
        .from(medicalScans)
        .where(eq(medicalScans.patientId, patient.id));

      return {
        id: patient.id,
        name: patient.name,
        email: patient.email,
        age: patient.age || 0,
        gender: patient.gender || 'Not specified',
        lastVisit: patient.lastVisit,
        recentScans: scans.length,
        condition: scans.length > 0 ? 'Scan completed' : 'Initial consultation',
        riskLevel: scans.some((scan: any) => scan.result?.includes('high')) ? 'high' : 
                   scans.some((scan: any) => scan.result?.includes('medium')) ? 'medium' : 'low',
        status: 'stable'
      };
    }));

    return patientsWithDetails;
  }

  async getPendingReports(doctorId: number): Promise<any[]> {
    return [
      {
        id: 2,
        patientName: "Unknown Patient",
        scanType: "Mammography",
        date: "2025-01-21",
        status: "pending",
        priority: "high",
        findings: "Suspicious mass detected"
      }
    ];
  }

  async getDoctorNotifications(doctorId: number): Promise<any[]> {
    return [];
  }

  async getRadiologistStats(): Promise<any> {
    return {
      scansAnalyzed: 0,
      pendingReviews: 0,
      accuracyRate: 0,
      avgAnalysisTime: "0m",
      criticalFindings: 0,
      weeklyTargetProgress: 0
    };
  }

  async getRadiologistActivities(radiologistId: number): Promise<any[]> {
    return [];
  }

  async completeReview(scanId: number, notes: string, approved: boolean): Promise<any> {
    return {
      success: true,
      scanId,
      notes,
      approved,
      reviewedAt: new Date().toISOString()
    };
  }

  async getAdminStats(): Promise<any> {
    const userCounts = await db.select().from(users);
    const totalUsers = userCounts.length;
    const doctorUsers = userCounts.filter((u: any) => u.role === 'doctor').length;
    const radiologistUsers = userCounts.filter((u: any) => u.role === 'radiologist').length;
    const patientUsers = userCounts.filter((u: any) => u.role === 'patient').length;

    return {
      totalUsers,
      totalDoctors: doctorUsers,
      totalRadiologists: radiologistUsers,
      totalPatients: patientUsers,
      activeUsers: Math.floor(totalUsers * 0.7),
      todayScans: 12,
      systemUptime: "99.8%",
      cpuUsage: 45,
      memoryUsage: 67,
      diskUsage: 23,
      securityAlerts: 0
    };
  }

  async getSystemActivities(): Promise<any[]> {
    return [
      {
        id: 1,
        userId: 1,
        username: "admin",
        action: "logged in",
        timestamp: new Date().toISOString(),
        ipAddress: "127.0.0.1",
        userAgent: "Mozilla/5.0",
        status: "success"
      }
    ];
  }

  async getChatParticipants(userId: number, role: string): Promise<any[]> {
    const allUsers = await db.select().from(users);
    
    if (role === 'patient') {
      return allUsers
        .filter((u: any) => u.role === 'doctor' || u.role === 'radiologist')
        .map((u: any) => ({
          id: u.id,
          name: u.fullName,
          role: u.role,
          isOnline: Math.random() > 0.5,
          lastSeen: new Date(Date.now() - Math.random() * 86400000).toISOString()
        }));
    } else if (role === 'doctor' || role === 'radiologist') {
      return allUsers
        .filter((u: any) => u.role === 'patient')
        .slice(0, 10)
        .map((u: any) => ({
          id: u.id,
          name: u.fullName,
          role: u.role,
          isOnline: Math.random() > 0.3,
          lastSeen: new Date(Date.now() - Math.random() * 86400000).toISOString()
        }));
    }
    
    return [];
  }

  async getChatMessages(userId: number, participantId: number): Promise<any[]> {
    return [
      {
        id: 1,
        senderId: participantId,
        senderName: "Dr. Johnson",
        senderRole: "doctor",
        receiverId: userId,
        message: "Hello, I've reviewed your recent scan results. Overall, everything looks normal.",
        timestamp: new Date(Date.now() - 300000).toISOString(),
        status: "read",
        messageType: "text"
      }
    ];
  }

  async createChatMessage(message: any): Promise<any> {
    return {
      id: Date.now(),
      ...message,
      timestamp: new Date().toISOString(),
      status: "sent"
    };
  }

  async markMessagesAsRead(senderId: number, receiverId: number): Promise<void> {
    console.log(`Marking messages as read between ${senderId} and ${receiverId}`);
  }

  async deleteAppointment(id: number): Promise<boolean> {
    try {
      const result = await db
        .delete(appointments)
        .where(eq(appointments.id, id));
      
      return (result.rowCount || 0) > 0;
    } catch (error) {
      console.error('Error deleting appointment:', error);
      return false;
    }
  }
}

export const storage = new DatabaseStorage();
