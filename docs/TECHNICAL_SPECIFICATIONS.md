# HealthAI Assistant - Technical Specifications

## 1. System Requirements

### 1.1 Hardware Requirements

#### Minimum Requirements
- **CPU**: 4-core processor (Intel i5 or AMD Ryzen 5 equivalent)
- **RAM**: 8GB DDR4
- **Storage**: 100GB SSD
- **GPU**: Optional (NVIDIA GTX 1060 or equivalent for AI processing)

#### Recommended Requirements
- **CPU**: 8-core processor (Intel i7 or AMD Ryzen 7 equivalent)
- **RAM**: 16GB DDR4
- **Storage**: 500GB NVMe SSD
- **GPU**: NVIDIA RTX 3060 or equivalent for optimal AI performance

#### Production Requirements
- **CPU**: 16+ cores (Intel Xeon or AMD EPYC)
- **RAM**: 32GB+ DDR4 ECC
- **Storage**: 1TB+ NVMe SSD with RAID configuration
- **GPU**: NVIDIA Tesla V100 or A100 for AI workloads
- **Network**: Gigabit Ethernet minimum

### 1.2 Software Requirements

#### Development Environment
- **Operating System**: Windows 10/11, macOS 10.15+, or Ubuntu 20.04+
- **Node.js**: Version 18.0 or higher
- **Python**: Version 3.8 or higher
- **Database**: PostgreSQL 12+ (SQLite 3.35+ as fallback)
- **Git**: Version 2.30 or higher

#### Production Environment
- **Operating System**: Ubuntu 20.04 LTS or CentOS 8
- **Web Server**: Nginx 1.18+ or Apache 2.4+
- **Process Manager**: PM2 or systemd
- **SSL Certificate**: Let's Encrypt or commercial certificate
- **Monitoring**: Prometheus, Grafana, or equivalent

## 2. API Specifications

### 2.1 Authentication Endpoints

```typescript
// POST /api/auth/login
interface LoginRequest {
  username: string;
  password: string;
}

interface LoginResponse {
  success: boolean;
  user: {
    id: number;
    username: string;
    role: 'admin' | 'doctor' | 'radiologist' | 'patient';
  };
  sessionId: string;
}

// POST /api/auth/register
interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  role: 'patient' | 'doctor' | 'radiologist';
  profile: PatientProfile | DoctorProfile;
}

// POST /api/auth/logout
interface LogoutResponse {
  success: boolean;
  message: string;
}
```

### 2.2 Medical Scan Endpoints

```typescript
// POST /api/scans/upload
interface ScanUploadRequest {
  file: File;
  scanType: 'breast' | 'lung' | 'skin' | 'colon' | 'prostate';
  patientId: number;
  metadata?: {
    age: number;
    gender: string;
    symptoms?: string[];
  };
}

interface ScanUploadResponse {
  scanId: number;
  status: 'uploaded' | 'processing' | 'completed' | 'failed';
  estimatedProcessingTime: number;
}

// GET /api/scans/:id/results
interface ScanResultResponse {
  scanId: number;
  result: {
    prediction: string;
    confidence: number;
    riskLevel: 'low' | 'medium' | 'high';
    recommendations: string[];
    technicalDetails: {
      modelVersion: string;
      processingTime: number;
      imageQuality: number;
    };
  };
  doctorReview?: {
    reviewedBy: number;
    notes: string;
    approved: boolean;
    reviewDate: string;
  };
}

// GET /api/scans/patient/:patientId
interface PatientScansResponse {
  scans: Array<{
    id: number;
    scanType: string;
    date: string;
    status: string;
    result?: string;
    confidence?: number;
  }>;
  totalCount: number;
  pagination: {
    page: number;
    limit: number;
    hasNext: boolean;
  };
}
```

### 2.3 Appointment Endpoints

```typescript
// POST /api/appointments
interface CreateAppointmentRequest {
  patientId: number;
  doctorId: number;
  appointmentDate: string;
  reason: string;
  notes?: string;
}

interface CreateAppointmentResponse {
  appointmentId: number;
  status: 'scheduled' | 'conflict' | 'failed';
  conflictDetails?: {
    existingAppointment: boolean;
    calendarConflict: boolean;
    suggestedTimes: string[];
  };
}

// GET /api/appointments/patient/:patientId
interface PatientAppointmentsResponse {
  appointments: Array<{
    id: number;
    doctorName: string;
    date: string;
    status: 'scheduled' | 'completed' | 'cancelled';
    reason: string;
  }>;
}

// PUT /api/appointments/:id/status
interface UpdateAppointmentStatusRequest {
  status: 'completed' | 'cancelled' | 'rescheduled';
  notes?: string;
  newDate?: string;
}
```

### 2.4 AI Service Endpoints

```typescript
// POST /api/ai/analyze
interface AIAnalysisRequest {
  imageData: string; // Base64 encoded
  scanType: 'breast' | 'lung' | 'skin' | 'colon' | 'prostate';
  metadata: {
    patientAge: number;
    patientGender: string;
    imageFormat: string;
    imageSize: {
      width: number;
      height: number;
    };
  };
}

interface AIAnalysisResponse {
  analysisId: string;
  prediction: {
    classification: string;
    confidence: number;
    riskScore: number;
    detectedAnomalies: Array<{
      type: string;
      location: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      confidence: number;
    }>;
  };
  modelInfo: {
    version: string;
    accuracy: number;
    trainingDate: string;
  };
  processingTime: number;
}
```

## 3. Database Specifications

### 3.1 Connection Configuration

```typescript
// PostgreSQL Configuration
interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
  pool: {
    min: number;
    max: number;
    idle: number;
  };
}

// SQLite Fallback Configuration
interface SQLiteConfig {
  filename: string;
  mode: number;
  cache: 'shared' | 'private';
  timeout: number;
}
```

### 3.2 Schema Definitions

```sql
-- Users table with role-based access
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) CHECK (role IN ('admin', 'doctor', 'radiologist', 'patient')) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Patient profiles
CREATE TABLE patients (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    date_of_birth DATE NOT NULL,
    gender VARCHAR(10),
    phone VARCHAR(20),
    address TEXT,
    emergency_contact JSONB,
    medical_history TEXT,
    allergies TEXT[],
    current_medications TEXT[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Doctor profiles
CREATE TABLE doctors (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    license_number VARCHAR(50) UNIQUE NOT NULL,
    specialization VARCHAR(100) NOT NULL,
    qualifications JSONB,
    experience_years INTEGER,
    phone VARCHAR(20),
    email VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Medical scans
CREATE TABLE scans (
    id SERIAL PRIMARY KEY,
    patient_id INTEGER REFERENCES patients(id) ON DELETE CASCADE,
    scan_type VARCHAR(20) CHECK (scan_type IN ('breast', 'lung', 'skin', 'colon', 'prostate')) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size INTEGER,
    file_format VARCHAR(10),
    ai_result JSONB,
    ai_confidence DECIMAL(5,4),
    ai_processing_time INTEGER,
    doctor_review TEXT,
    reviewed_by INTEGER REFERENCES doctors(id),
    review_date TIMESTAMP,
    status VARCHAR(20) DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'processing', 'completed', 'failed', 'reviewed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Appointments
CREATE TABLE appointments (
    id SERIAL PRIMARY KEY,
    patient_id INTEGER REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id INTEGER REFERENCES doctors(id) ON DELETE CASCADE,
    appointment_date TIMESTAMP NOT NULL,
    duration_minutes INTEGER DEFAULT 30,
    status VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'rescheduled')),
    reason TEXT NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Audit logs
CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(50) NOT NULL,
    resource_type VARCHAR(50),
    resource_id INTEGER,
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_scans_patient_id ON scans(patient_id);
CREATE INDEX idx_scans_status ON scans(status);
CREATE INDEX idx_scans_created_at ON scans(created_at);
CREATE INDEX idx_appointments_patient_id ON appointments(patient_id);
CREATE INDEX idx_appointments_doctor_id ON appointments(doctor_id);
CREATE INDEX idx_appointments_date ON appointments(appointment_date);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
```

## 4. AI/ML Model Specifications

**This section was rewritten on 2026-09-20.** The version it replaces described
a breast-cancer model at "0.94 accuracy", a three-class lung CT model at
"0.91", and a skin model at "0.88", with a `modelBenchmarks` table of
"expected performance". None of those models existed and none of those numbers
was measured. They were removed rather than corrected, because a specification
that carries a benchmark nobody measured is the defect the rest of this
repository exists to prevent.

### 4.1 What exists

| Model | Artifact | Status | Where it is specified |
|---|---|---|---|
| Skin lesion classifier | `dataset/data/resnet50v2_skin_cancer_model.h5` — ResNet50V2 ImageNet trunk (frozen) + trained head; normalisation fused into the graph; 224×224 RGB | **Serving** | `MODEL_CARDS.md`, `server/model-availability.ts` (`MODEL_REGISTRY.skin`) |
| Lung classifier (legacy) | `dataset/lung_cancer_MRI_dataset/resnet50v2_lung_cancer_model.h5` — same architecture, trained on web-sourced chest PNGs | **Withdrawn 2026-09-20** — accepted real CT it had never been measured on | `MODEL_CARDS.md` (lung card), `docs/MODEL_CHANGELOG.md` |
| Lung nodule characteriser | `dataset/lung_nodule_model/resnet50v2_lung_nodule_model.h5` — same architecture, trained on 64 px LIDC-IDRI CT nodule crops rendered at the lung window | **Trained, calibrated, OOD-screened; not bound, not serving** | `dataset/lung_nodule_model/lung_nodule_training.json`, `scripts/train-lung-nodule-model.py` |
| Breast, colon, prostate, cervical | — | **No model.** Requests return 503 and are queued for a human. | `MODEL_CARDS.md` § "Modalities with no model" |

No model here is clinically validated or cleared by any regulator
(`docs/REGULATORY_PATHWAY.md`).

### 4.2 Where the performance figures live

There is no benchmark table in this document, deliberately. Every published
figure is bound to the artifact it was measured on by a content fingerprint
(`server/model-governance.ts`, `docs/MODEL_GOVERNANCE.md`) and served at
`GET /api/models/cards`, with the reproduction command beside it. If a figure
in any document disagrees with that endpoint, the endpoint is right and the
document is stale.

The serving pipeline for an image is: byte-level type verification
(`server/upload-validation.ts`) → DICOM de-identification and windowing where
applicable (`inference/dicom_ingest.py`) → pixel quality gate → out-of-
distribution screen validated in both directions (`scripts/build-ood-reference.py`)
→ classifier → temperature calibration → operating point → clinician review →
adjudicated outcome (`server/production-performance.ts`). Each stage refuses
rather than guesses, and a refusal is never rendered as a negative finding.

## 5. Security Specifications

### 5.1 Authentication & Authorization

```typescript
// Session configuration
interface SessionConfig {
  secret: string;
  resave: boolean;
  saveUninitialized: boolean;
  cookie: {
    secure: boolean;
    httpOnly: boolean;
    maxAge: number;
    sameSite: 'strict' | 'lax' | 'none';
  };
  store: SessionStore;
}

// Role-based permissions
interface RolePermissions {
  admin: string[];
  doctor: string[];
  radiologist: string[];
  patient: string[];
}

const permissions: RolePermissions = {
  admin: [
    'user:create', 'user:read', 'user:update', 'user:delete',
    'scan:read', 'scan:delete',
    'appointment:read', 'appointment:update',
    'system:configure', 'system:monitor'
  ],
  doctor: [
    'patient:read', 'patient:update',
    'scan:read', 'scan:review',
    'appointment:create', 'appointment:read', 'appointment:update'
  ],
  radiologist: [
    'scan:read', 'scan:review', 'scan:analyze',
    'patient:read'
  ],
  patient: [
    'profile:read', 'profile:update',
    'scan:upload', 'scan:read:own',
    'appointment:create', 'appointment:read:own'
  ]
};
```

### 5.2 Data Encryption

```typescript
// Encryption configuration
interface EncryptionConfig {
  algorithm: 'aes-256-gcm';
  keyLength: 32;
  ivLength: 16;
  tagLength: 16;
  saltLength: 32;
}

// File encryption for medical images
interface FileEncryption {
  encryptFile(filePath: string, key: Buffer): Promise<string>;
  decryptFile(encryptedPath: string, key: Buffer): Promise<Buffer>;
  generateKey(): Buffer;
  hashPassword(password: string, salt: string): Promise<string>;
  verifyPassword(password: string, hash: string): Promise<boolean>;
}
```

## 6. Performance Specifications

### 6.1 Response Time Requirements

```typescript
interface PerformanceTargets {
  apiResponseTime: {
    authentication: 200; // milliseconds
    dataRetrieval: 500;
    fileUpload: 2000;
    aiAnalysis: 30000;
  };
  
  pageLoadTime: {
    dashboard: 1500;
    scanResults: 2000;
    appointments: 1000;
  };
  
  concurrentUsers: {
    development: 10;
    staging: 50;
    production: 500;
  };
  
  throughput: {
    apiRequestsPerSecond: 100;
    fileUploadsPerMinute: 20;
    aiAnalysesPerHour: 200;
  };
}
```

### 6.2 Scalability Specifications

```typescript
interface ScalabilityConfig {
  horizontalScaling: {
    minInstances: 2;
    maxInstances: 10;
    scaleUpThreshold: 70; // CPU percentage
    scaleDownThreshold: 30;
    cooldownPeriod: 300; // seconds
  };
  
  databaseScaling: {
    connectionPoolSize: 20;
    maxConnections: 100;
    queryTimeout: 30000;
    replicationLag: 1000; // milliseconds
  };
  
  caching: {
    redisCluster: boolean;
    cacheExpiry: 3600; // seconds
    maxMemoryUsage: '2gb';
  };
}
```

## 7. Monitoring & Logging

### 7.1 Application Monitoring

```typescript
interface MonitoringMetrics {
  application: {
    responseTime: number;
    errorRate: number;
    throughput: number;
    activeUsers: number;
  };
  
  infrastructure: {
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
    networkLatency: number;
  };
  
  business: {
    scansProcessed: number;
    appointmentsBooked: number;
    userRegistrations: number;
    aiAccuracy: number;
  };
}

interface AlertThresholds {
  criticalResponseTime: 5000; // milliseconds
  highErrorRate: 0.05; // 5%
  maxCpuUsage: 0.8; // 80%
  maxMemoryUsage: 0.85; // 85%
  maxDiskUsage: 0.9; // 90%
}
```

### 7.2 Logging Configuration

```typescript
interface LoggingConfig {
  level: 'error' | 'warn' | 'info' | 'debug';
  format: 'json' | 'text';
  rotation: {
    maxSize: '100MB';
    maxFiles: 10;
    datePattern: 'YYYY-MM-DD';
  };
  
  destinations: {
    console: boolean;
    file: boolean;
    database: boolean;
    external: string; // Log aggregation service
  };
  
  sensitiveFields: string[]; // Fields to redact
}
```

## 8. Deployment Specifications

### 8.1 Container Configuration

```dockerfile
# Production Dockerfile specifications
FROM node:18-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM python:3.9-slim AS ai-base
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Multi-stage build for optimization
FROM base AS production
COPY . .
RUN npm run build
EXPOSE 5000
CMD ["npm", "start"]
```

### 8.2 Infrastructure as Code

```yaml
# Kubernetes deployment specification
apiVersion: apps/v1
kind: Deployment
metadata:
  name: healthai-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: healthai-app
  template:
    metadata:
      labels:
        app: healthai-app
    spec:
      containers:
      - name: app
        image: healthai:latest
        ports:
        - containerPort: 5000
        env:
        - name: NODE_ENV
          value: "production"
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: url
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
```

---

*These technical specifications provide detailed implementation guidelines for the HealthAI Assistant platform and should be referenced during development and deployment phases.*