import { users, medicalScans, medicalTerms, appointments, chatMessages, type User, type InsertUser, type MedicalScan, type InsertScan, type MedicalTerm, type InsertTerm, type Appointment, type InsertAppointment } from "@shared/schema";
import { getDb } from "./db";
import { eq, ilike, or, and } from "drizzle-orm";

const db = getDb();

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
  
  // Real-time Chat
  getChatParticipants(userId: number, role: string): Promise<any[]>;
  getChatMessages(userId: number, participantId: number): Promise<any[]>;
  createChatMessage(message: any): Promise<any>;
  markMessagesAsRead(senderId: number, receiverId: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    try {
      const [user] = await (db as any).select().from(users).where(eq(users.id, id));
      return user || undefined;
    } catch (error) {
      console.error('Error fetching user:', error);
      return undefined;
    }
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await (db as any).select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await (db as any).select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await (db as any).insert(users)
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
    const [user] = await (db as any).update(users)
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
      return user;
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
      return await (db as any).select().from(medicalScans).where(eq(medicalScans.patientId, patientId));
    }
    return await (db as any).select().from(medicalScans);
  }

  async createScan(insertScan: InsertScan): Promise<MedicalScan> {
    const [scan] = await (db as any).insert(medicalScans)
      .values({
        ...insertScan,
        status: "pending",
        createdAt: new Date()
      })
      .returning();
    return scan;
  }

  async updateScan(id: number, updates: Partial<MedicalScan>): Promise<MedicalScan | undefined> {
    try {
      const [scan] = await (db as any).update(medicalScans)
        .set({
          ...updates,
          updatedAt: new Date()
        })
        .where(eq(medicalScans.id, id))
        .returning();
      return scan || undefined;
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
    return await (db as any).select().from(medicalScans).where(eq(medicalScans.status, 'pending'));
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
    return await (db as any).select().from(users);
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
      
      return messages;
    } catch (error) {
      console.error('Error fetching chat messages:', error);
      return [];
    }
  }

  async createChatMessage(messageData: any): Promise<any> {
    try {
      const [message] = await (db as any)
        .insert(chatMessages)
        .values({
          senderId: messageData.senderId,
          receiverId: messageData.receiverId,
          message: messageData.message,
          messageType: messageData.messageType || 'text',
          status: messageData.status || 'sent'
        })
        .returning();
      
      return message;
    } catch (error) {
      console.error('Error creating chat message:', error);
      throw error;
    }
  }

  async markMessagesAsRead(senderId: number, receiverId: number): Promise<void> {
    // Implementation would mark messages as read
  }
}

// Create storage instance with fallback mechanism
class FallbackStorage implements IStorage {
  private mockUsers: User[] = ([
    {
      id: 1,
      username: 'admin',
      password: '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj3QJflLxQjm', // admin123
      fullName: 'System Administrator',
      email: 'admin@healthai.com',
      role: 'admin',
      isActive: true,
      createdAt: new Date()
    },
    {
      id: 2,
      username: 'doctor',
      password: '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj3QJflLxQjm', // doctor123
      fullName: 'Dr. Sarah Johnson',
      email: 'doctor@healthai.com',
      role: 'doctor',
      specialization: 'General Practice',
      isActive: true,
      createdAt: new Date()
    },
    {
      id: 3,
      username: 'radiologist',
      password: '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj3QJflLxQjm', // radiologist123
      fullName: 'Dr. Michael Chen',
      email: 'radiologist@healthai.com',
      role: 'radiologist',
      specialization: 'Medical Imaging',
      isActive: true,
      createdAt: new Date()
    },
    {
      id: 4,
      username: 'patient',
      password: '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj3QJflLxQjm', // patient123
      fullName: 'John Patient',
      email: 'patient@healthai.com',
      role: 'patient',
      age: 35,
      gender: 'male',
      isActive: true,
      createdAt: new Date()
    }
  ] as unknown) as User[];

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
      id: Math.max(...this.mockUsers.map(u => u.id)) + 1,
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
  async markMessagesAsRead(senderId: number, receiverId: number): Promise<void> {}
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
    console.warn('⚠️ Database storage failed, using fallback storage:', error);
    storage = new FallbackStorage();
    return storage;
  }
}

// Initialize with fallback storage by default
storage = new FallbackStorage();

export { storage };