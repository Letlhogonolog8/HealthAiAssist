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
    const { username, password } = req.body;
    
    // Simple auth check
    if (username === 'patient' && password === 'patient123') {
      req.session.userId = 28;
      req.session.user = {
        id: 28,
        role: 'patient',
        username: 'patient',
        fullName: 'John Patient',
        email: 'patient@healthai.com'
      };
      
      res.json({
        id: 28,
        username: 'patient',
        fullName: 'John Patient',
        role: 'patient',
        email: 'patient@healthai.com'
      });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
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