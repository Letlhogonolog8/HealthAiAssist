// Simplified server for Railway deployment
import express from 'express';
import session from 'express-session';
import cors from 'cors';
import { storage } from './storage';

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

app.get('/api/admin/users', (req, res) => {
  const users = [
    {
      id: 1,
      username: 'doctor_kenosi',
      fullName: 'Dr. Kenosi Rakgalane',
      email: 'docrakgalane@gmail.com',
      role: 'doctor',
      specialization: 'Oncologist',
      isActive: true,
      createdAt: new Date().toISOString()
    },
    {
      id: 2,
      username: 'sam',
      fullName: 'Dr. Sam Radiologist',
      email: 'sam@healthai.com',
      role: 'radiologist',
      specialization: 'Medical Imaging',
      isActive: true,
      createdAt: new Date().toISOString()
    },
    {
      id: 3,
      username: 'Letlhogonolo',
      fullName: 'Letlhogonolo Matlaela',
      email: 'LMatlaela@NW.CETC.edu.za',
      role: 'doctor',
      specialization: 'Oncologist',
      isActive: true,
      createdAt: new Date().toISOString()
    },
    {
      id: 28,
      username: 'Tlhox',
      fullName: 'Tlhox Matlaela',
      email: 'tlhox@healthai.com',
      role: 'admin',
      specialization: null,
      isActive: true,
      createdAt: new Date().toISOString()
    }
  ];
  res.json(users);
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
    activePatients: 12,
    todaysAppointments: 3,
    pendingReports: 2,
    criticalCases: 1,
    totalPatients: 25,
    appointmentsCompleted: 8,
    avgConsultationTime: '18m',
    patientSatisfaction: 94
  });
});

app.get('/api/doctor/patients', (req, res) => {
  res.json([
    {
      id: 1,
      name: 'John Smith',
      email: 'john@example.com',
      phone: '+1 555-0123',
      age: 45,
      gender: 'Male',
      lastVisit: new Date().toISOString(),
      condition: 'Hypertension',
      status: 'stable',
      recentScans: 2,
      riskLevel: 'low'
    },
    {
      id: 2,
      name: 'Sarah Johnson',
      email: 'sarah@example.com',
      phone: '+1 555-0124',
      age: 38,
      gender: 'Female',
      lastVisit: new Date().toISOString(),
      condition: 'Diabetes',
      status: 'monitoring',
      recentScans: 1,
      riskLevel: 'medium'
    }
  ]);
});

app.get('/api/doctor/appointments/today', (req, res) => {
  res.json([
    {
      id: 1,
      patientName: 'John Smith',
      time: '09:00 AM',
      type: 'Follow-up',
      status: 'scheduled'
    },
    {
      id: 2,
      patientName: 'Sarah Johnson',
      time: '10:30 AM',
      type: 'Consultation',
      status: 'completed'
    }
  ]);
});

app.get('/api/doctor/reports/pending', (req, res) => {
  res.json([
    {
      id: 1,
      patientName: 'John Smith',
      scanType: 'CT Scan',
      submittedAt: new Date().toISOString(),
      priority: 'medium',
      findings: 'Awaiting review',
      status: 'pending'
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