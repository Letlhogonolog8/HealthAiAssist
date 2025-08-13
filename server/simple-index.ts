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
      'patient': 'patient123',
      'admin': 'admin123',
      'doctor': 'doctor123',
      'Tlhox': 'inw73KYI'
    };
    
    if (validCredentials[username] === password) {
      req.session.userId = 28;
      req.session.user = {
        id: 28,
        role: username === 'admin' ? 'admin' : username === 'doctor' ? 'doctor' : 'patient',
        username: username,
        fullName: username === 'Tlhox' ? 'Tlhox Matlaela' : `${username.charAt(0).toUpperCase() + username.slice(1)} User`,
        email: `${username}@healthai.com`
      };
      
      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          return res.status(500).json({ error: 'Session error' });
        }
        
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