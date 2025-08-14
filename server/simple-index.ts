// Simplified server for Railway deployment
import express from 'express';
import session from 'express-session';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const app = express();
const port = process.env.PORT || 5000;

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// CORS
app.use(cors({
  origin: true,
  credentials: true
}));

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Basic auth
app.post('/api/auth/login', async (req, res) => {
  try {
    console.log('Login attempt:', req.body);
    const { username, password } = req.body || {};
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    // Simple auth check - multiple valid credentials
    const validCredentials = {
      'doctor_kenosi': 'kenosi123!',
      'sam': 'inw73KYI!!',
      'Letlhogonolo': 'gontseg8',
      'Tlhox': 'inw73KYI'
    };
    
    if (validCredentials[username] === password) {
      // Map users to their details
      const userDetails = {
        'doctor_kenosi': { id: 1, role: 'doctor', fullName: 'Dr. Kenosi Rakgalane', email: 'docrakgalane@gmail.com' },
        'sam': { id: 2, role: 'radiologist', fullName: 'Dr. Sam Radiologist', email: 'sam@healthai.com' },
        'Letlhogonolo': { id: 3, role: 'doctor', fullName: 'Letlhogonolo Matlaela', email: 'LMatlaela@NW.CETC.edu.za' },
        'Tlhox': { id: 28, role: 'admin', fullName: 'Tlhox Matlaela', email: 'tlhox@healthai.com' }
      };
      
      const user = userDetails[username];
      req.session.userId = user.id;
      req.session.user = {
        id: user.id,
        role: user.role,
        username: username,
        fullName: user.fullName,
        email: user.email
      };
      
      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          return res.status(500).json({ error: 'Session error' });
        }
        
        console.log('Login successful for:', username, 'Role:', req.session.user.role);
        res.json({
          id: req.session.user.id,
          username: req.session.user.username,
          fullName: req.session.user.fullName,
          role: req.session.user.role,
          email: req.session.user.email
        });
      });
    } else {
      console.log('Invalid credentials:', username, password);
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Auth check
app.get('/api/auth/me', (req, res) => {
  if (req.session?.user) {
    res.json(req.session.user);
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

// Basic patient profile
app.get('/api/patient/profile/:id', (req, res) => {
  res.json({
    id: 28,
    personalInfo: {
      name: 'John Patient',
      email: 'patient@healthai.com',
      phone: '+1 (555) 123-4567',
      age: 34,
      gender: 'Male'
    },
    recentScans: [],
    appointments: [],
    vitals: {
      bloodPressure: '120/80',
      heartRate: 72,
      temperature: 98.6
    },
    healthScore: {
      overall: 85
    }
  });
});

// Patient stats
app.get('/api/patient/stats', (req, res) => {
  res.json({
    completedScans: 0,
    pendingResults: 0,
    nextAppointment: '7 days',
    healthScore: 'Good'
  });
});

// Patient activities
app.get('/api/patient/activities/recent', (req, res) => {
  res.json([]);
});

// Appointments
app.get('/api/appointments', (req, res) => {
  res.json([]);
});

// Scans
app.get('/api/scans', (req, res) => {
  res.json([]);
});

// Admin endpoints
app.get('/api/admin/users/metrics', (req, res) => {
  res.json({
    totalUsers: 4,
    admins: 1,
    doctors: 2,
    radiologists: 1,
    patients: 0,
    activeUsers: 4,
    newUsersToday: 0,
    loginRate: 85,
    avgSessionTime: 24
  });
});

app.get('/api/admin/users', async (req, res) => {
  try {
    if (supabase) {
      const { data: users, error } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }
      
      const formattedUsers = users.map(user => ({
        id: user.id,
        username: user.username,
        fullName: user.full_name || user.username,
        email: user.email,
        role: user.role,
        specialization: user.specialization,
        isActive: user.is_active !== false,
        createdAt: user.created_at
      }));
      
      res.json(formattedUsers);
    } else {
      // Fallback data
      res.json([{
        id: 1,
        username: 'database_offline',
        fullName: 'Database Not Connected',
        email: 'configure@supabase.com',
        role: 'admin',
        specialization: null,
        isActive: false,
        createdAt: new Date().toISOString()
      }]);
    }
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.get('/api/admin/stats', (req, res) => {
  res.json({
    totalUsers: 4,
    activeScans: 0,
    systemUptime: 99.8,
    aiAccuracy: 94,
    dailyScans: 0,
    criticalAlerts: 0,
    databaseHealth: 98,
    securityStatus: 'secure'
  });
});

app.get('/api/admin/activities/recent', (req, res) => {
  res.json([
    {
      message: 'System started successfully',
      timestamp: new Date().toLocaleTimeString(),
      type: 'system'
    }
  ]);
});

// Doctor dashboard endpoints
app.get('/api/doctor/stats', (req, res) => {
  res.json({
    activePatients: 24,
    todaysAppointments: 4,
    pendingReports: 3,
    criticalCases: 2,
    totalPatients: 156,
    appointmentsCompleted: 12,
    avgConsultationTime: '22m',
    patientSatisfaction: 96,
    cancerDetections: 8,
    earlyStageDetections: 6,
    followUpRequired: 5,
    screeningsCompleted: 45
  });
});

app.get('/api/doctor/patients', async (req, res) => {
  try {
    if (supabase) {
      // Get patients from Supabase database
      const { data: patients, error } = await supabase
        .from('users')
        .select('*')
        .eq('role', 'patient');
      
      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }
      
      // Get scan counts for each patient
      const patientsWithScans = await Promise.all(
        patients.map(async (patient) => {
          const { data: scans } = await supabase
            .from('scans')
            .select('*')
            .eq('patient_id', patient.id);
          
          return {
            id: patient.id,
            name: patient.full_name || patient.username,
            email: patient.email,
            phone: patient.phone || '+27 XX XXX XXXX',
            age: patient.age || 35,
            gender: patient.gender || 'Not specified',
            lastVisit: patient.updated_at || patient.created_at,
            condition: 'Cancer Screening',
            status: 'stable',
            recentScans: scans?.length || 0,
            riskLevel: scans?.length > 2 ? 'medium' : 'low'
          };
        })
      );
      
      res.json(patientsWithScans);
    } else {
      // Fallback data if Supabase not configured
      res.json([{
        id: 1,
        name: 'No patients found',
        email: 'Configure Supabase to see real patients',
        phone: '+27 XX XXX XXXX',
        age: 0,
        gender: 'Unknown',
        lastVisit: new Date().toISOString(),
        condition: 'Database not connected',
        status: 'offline',
        recentScans: 0,
        riskLevel: 'low'
      }]);
    }
  } catch (error) {
    console.error('Error fetching patients:', error);
    res.status(500).json({ error: 'Failed to fetch patients' });
  }
});

app.get('/api/doctor/appointments/today', (req, res) => {
  res.json([
    {
      id: 1,
      patientName: 'Thabo Mthembu',
      time: '09:00 AM',
      type: 'Lung Cancer Follow-up',
      status: 'scheduled',
      priority: 'high',
      notes: 'Review CT scan results'
    },
    {
      id: 2,
      patientName: 'Nomsa Dlamini',
      time: '10:30 AM',
      type: 'Breast Cancer Consultation',
      status: 'completed',
      priority: 'medium',
      notes: 'Post-treatment checkup'
    },
    {
      id: 3,
      patientName: 'Lerato Mokoena',
      time: '14:00 PM',
      type: 'Skin Cancer Assessment',
      status: 'scheduled',
      priority: 'urgent',
      notes: 'Suspicious lesion evaluation'
    },
    {
      id: 4,
      patientName: 'Sipho Ndlovu',
      time: '15:30 PM',
      type: 'Prostate Screening',
      status: 'scheduled',
      priority: 'routine',
      notes: 'Annual screening appointment'
    }
  ]);
});

app.get('/api/doctor/reports/pending', (req, res) => {
  res.json([
    {
      id: 1,
      patientName: 'Thabo Mthembu',
      scanType: 'Lung CT Scan',
      submittedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      priority: 'high',
      findings: 'Suspicious nodule detected in right upper lobe',
      status: 'pending',
      aiConfidence: '92%',
      radiologist: 'Dr. Sam Radiologist'
    },
    {
      id: 2,
      patientName: 'Lerato Mokoena',
      scanType: 'Skin Lesion Analysis',
      submittedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
      priority: 'urgent',
      findings: 'Irregular pigmentation pattern - possible melanoma',
      status: 'pending',
      aiConfidence: '87%',
      radiologist: 'Dr. Sam Radiologist'
    },
    {
      id: 3,
      patientName: 'Mandla Khumalo',
      scanType: 'Colonoscopy Images',
      submittedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      priority: 'medium',
      findings: 'Polyp identified - requires histological examination',
      status: 'pending',
      aiConfidence: '89%',
      radiologist: 'Dr. Sam Radiologist'
    }
  ]);
});

app.get('/api/doctor/activities/recent', (req, res) => {
  res.json([
    {
      message: 'Patient consultation completed',
      timestamp: new Date().toLocaleTimeString(),
      type: 'appointment'
    },
    {
      message: 'Medical report reviewed',
      timestamp: new Date().toLocaleTimeString(),
      type: 'report'
    }
  ]);
});

// Serve static files
app.use(express.static('dist/public'));

// Catch all
app.get('*', (req, res) => {
  res.sendFile('index.html', { root: 'dist/public' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`✅ HealthAI Assistant running on port ${port}`);
  console.log(`🌐 Health check: http://localhost:${port}/api/health`);
});