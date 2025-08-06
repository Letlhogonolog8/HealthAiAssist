# HealthAI Assistant - Architecture Diagrams

## 1. System Overview Diagram

```mermaid
graph TB
    subgraph "Client Layer"
        A[Patient Portal] 
        B[Doctor Dashboard]
        C[Radiologist Dashboard]
        D[Admin Dashboard]
    end
    
    subgraph "API Gateway"
        E[Express.js Server]
        F[Authentication Middleware]
        G[Rate Limiting]
    end
    
    subgraph "Business Logic Layer"
        H[User Service]
        I[Medical Service]
        J[AI/ML Service]
        K[Appointment Service]
        L[Translation Service]
    end
    
    subgraph "AI/ML Layer"
        M[Breast Cancer Model]
        N[Lung Cancer Model]
        O[Skin Cancer Model]
        P[Colon Cancer Model]
        Q[Prostate Cancer Model]
    end
    
    subgraph "Data Layer"
        R[(PostgreSQL)]
        S[(SQLite Fallback)]
        T[File Storage]
    end
    
    subgraph "External Services"
        U[OpenAI API]
        V[Google Calendar API]
        W[Translation API]
    end
    
    A --> E
    B --> E
    C --> E
    D --> E
    
    E --> F
    F --> G
    G --> H
    G --> I
    G --> J
    G --> K
    G --> L
    
    J --> M
    J --> N
    J --> O
    J --> P
    J --> Q
    
    H --> R
    I --> R
    K --> R
    R -.-> S
    
    I --> T
    J --> T
    
    L --> U
    K --> V
    L --> W
```

## 2. Component Architecture Diagram

```mermaid
graph LR
    subgraph "Frontend Components"
        subgraph "Authentication"
            A1[Login Form]
            A2[Registration]
            A3[Role Guard]
        end
        
        subgraph "Dashboards"
            B1[Patient Portal]
            B2[Doctor Dashboard]
            B3[Radiologist Dashboard]
            B4[Admin Dashboard]
        end
        
        subgraph "Medical Components"
            C1[Scan Upload]
            C2[Results Viewer]
            C3[Appointment Scheduler]
            C4[Medical Translator]
        end
        
        subgraph "Shared Components"
            D1[Navigation]
            D2[Charts]
            D3[UI Components]
        end
    end
    
    subgraph "Backend Services"
        E1[Auth Service]
        E2[User Service]
        E3[Medical Service]
        E4[AI Service]
        E5[Appointment Service]
        E6[Translation Service]
    end
    
    A1 --> E1
    A2 --> E2
    B1 --> E2
    B1 --> E3
    B1 --> E5
    C1 --> E3
    C1 --> E4
    C2 --> E3
    C3 --> E5
    C4 --> E6
```

## 3. Database Schema Diagram

```mermaid
erDiagram
    USERS {
        int id PK
        string username UK
        string email UK
        string password_hash
        enum role
        timestamp created_at
        timestamp updated_at
    }
    
    PATIENTS {
        int id PK
        int user_id FK
        string first_name
        string last_name
        date date_of_birth
        text medical_history
        json contact_info
        timestamp created_at
        timestamp updated_at
    }
    
    DOCTORS {
        int id PK
        int user_id FK
        string license_number
        string specialization
        json qualifications
        timestamp created_at
        timestamp updated_at
    }
    
    SCANS {
        int id PK
        int patient_id FK
        enum scan_type
        string file_path
        json ai_result
        float ai_confidence
        text doctor_review
        enum status
        timestamp created_at
        timestamp updated_at
    }
    
    APPOINTMENTS {
        int id PK
        int patient_id FK
        int doctor_id FK
        timestamp appointment_date
        enum status
        text notes
        text reason
        timestamp created_at
        timestamp updated_at
    }
    
    SCAN_HISTORY {
        int id PK
        int scan_id FK
        int reviewed_by FK
        text review_notes
        enum action
        timestamp created_at
    }
    
    USERS ||--o| PATIENTS : "has profile"
    USERS ||--o| DOCTORS : "has profile"
    PATIENTS ||--o{ SCANS : "has many"
    PATIENTS ||--o{ APPOINTMENTS : "books"
    DOCTORS ||--o{ APPOINTMENTS : "attends"
    SCANS ||--o{ SCAN_HISTORY : "has history"
    USERS ||--o{ SCAN_HISTORY : "reviews"
```

## 4. AI/ML Pipeline Architecture

```mermaid
graph TD
    subgraph "Input Processing"
        A[Medical Image Upload]
        B[Image Validation]
        C[Format Conversion]
        D[Preprocessing]
    end
    
    subgraph "AI Model Selection"
        E{Scan Type?}
        F[Breast Cancer Model]
        G[Lung Cancer Model]
        H[Skin Cancer Model]
        I[Colon Cancer Model]
        J[Prostate Cancer Model]
    end
    
    subgraph "Processing Pipeline"
        K[Image Normalization]
        L[Feature Extraction]
        M[Model Inference]
        N[Confidence Scoring]
    end
    
    subgraph "Output Processing"
        O[Result Validation]
        P[Report Generation]
        Q[Database Storage]
        R[Notification System]
    end
    
    A --> B
    B --> C
    C --> D
    D --> E
    
    E -->|Breast| F
    E -->|Lung| G
    E -->|Skin| H
    E -->|Colon| I
    E -->|Prostate| J
    
    F --> K
    G --> K
    H --> K
    I --> K
    J --> K
    
    K --> L
    L --> M
    M --> N
    N --> O
    O --> P
    P --> Q
    Q --> R
```

## 5. Security Architecture Diagram

```mermaid
graph TB
    subgraph "External Layer"
        A[Internet]
        B[Load Balancer]
        C[SSL/TLS Termination]
    end
    
    subgraph "Security Layer"
        D[Web Application Firewall]
        E[Rate Limiting]
        F[DDoS Protection]
    end
    
    subgraph "Application Layer"
        G[Authentication Service]
        H[Authorization Middleware]
        I[Input Validation]
        J[Session Management]
    end
    
    subgraph "Data Security"
        K[Encryption at Rest]
        L[Encryption in Transit]
        M[Access Control]
        N[Audit Logging]
    end
    
    subgraph "Infrastructure Security"
        O[Network Segmentation]
        P[Firewall Rules]
        Q[Intrusion Detection]
        R[Security Monitoring]
    end
    
    A --> B
    B --> C
    C --> D
    D --> E
    E --> F
    F --> G
    G --> H
    H --> I
    I --> J
    
    J --> K
    J --> L
    J --> M
    J --> N
    
    K --> O
    L --> P
    M --> Q
    N --> R
```

## 6. Deployment Architecture Diagram

```mermaid
graph TB
    subgraph "Production Environment"
        subgraph "Load Balancer Tier"
            A[Nginx Load Balancer]
            B[SSL Termination]
        end
        
        subgraph "Application Tier"
            C[Node.js App Server 1]
            D[Node.js App Server 2]
            E[Node.js App Server 3]
        end
        
        subgraph "AI Processing Tier"
            F[Python ML Server 1]
            G[Python ML Server 2]
        end
        
        subgraph "Database Tier"
            H[(PostgreSQL Primary)]
            I[(PostgreSQL Replica)]
        end
        
        subgraph "Storage Tier"
            J[File Storage]
            K[Backup Storage]
        end
        
        subgraph "Monitoring Tier"
            L[Application Monitoring]
            M[Infrastructure Monitoring]
            N[Log Aggregation]
        end
    end
    
    subgraph "External Services"
        O[OpenAI API]
        P[Google Calendar API]
        Q[CDN]
    end
    
    A --> C
    A --> D
    A --> E
    
    C --> F
    D --> F
    E --> G
    
    C --> H
    D --> H
    E --> H
    H --> I
    
    C --> J
    D --> J
    E --> J
    J --> K
    
    C --> L
    D --> M
    E --> N
    
    C --> O
    D --> P
    E --> Q
```

## 7. Data Flow Diagram

```mermaid
sequenceDiagram
    participant P as Patient
    participant UI as Frontend
    participant API as Backend API
    participant AI as AI Service
    participant DB as Database
    participant FS as File Storage
    
    P->>UI: Upload medical scan
    UI->>API: POST /api/scans/upload
    API->>FS: Store image file
    API->>DB: Create scan record
    API->>AI: Process image
    AI->>AI: Run ML model
    AI->>API: Return results
    API->>DB: Update scan with results
    API->>UI: Return scan results
    UI->>P: Display results
    
    Note over P,FS: Secure file handling with encryption
    Note over AI: Multiple cancer detection models
    Note over DB: Audit trail maintained
```

## 8. User Journey Flow

```mermaid
graph TD
    A[User Registration] --> B{Role Selection}
    B -->|Patient| C[Patient Onboarding]
    B -->|Doctor| D[Doctor Verification]
    B -->|Admin| E[Admin Setup]
    
    C --> F[Complete Profile]
    D --> G[License Verification]
    E --> H[System Configuration]
    
    F --> I[Patient Dashboard]
    G --> J[Doctor Dashboard]
    H --> K[Admin Dashboard]
    
    I --> L[Upload Scan]
    I --> M[Book Appointment]
    I --> N[View Results]
    
    J --> O[Review Scans]
    J --> P[Manage Appointments]
    J --> Q[Generate Reports]
    
    K --> R[User Management]
    K --> S[System Monitoring]
    K --> T[Analytics]
    
    L --> U[AI Analysis]
    U --> V[Results Available]
    V --> W[Doctor Review]
    W --> X[Final Report]
```

## 9. API Architecture Diagram

```mermaid
graph LR
    subgraph "Client Applications"
        A[Web App]
        B[Mobile App]
        C[Admin Panel]
    end
    
    subgraph "API Gateway"
        D[Rate Limiting]
        E[Authentication]
        F[Request Routing]
    end
    
    subgraph "Microservices"
        G[User Service]
        H[Medical Service]
        I[AI Service]
        J[Appointment Service]
        K[Notification Service]
    end
    
    subgraph "Data Layer"
        L[(User DB)]
        M[(Medical DB)]
        N[(File Storage)]
    end
    
    A --> D
    B --> D
    C --> D
    
    D --> E
    E --> F
    
    F --> G
    F --> H
    F --> I
    F --> J
    F --> K
    
    G --> L
    H --> M
    I --> N
    J --> L
    K --> L
```

## 10. Monitoring and Observability

```mermaid
graph TB
    subgraph "Application Layer"
        A[Frontend Metrics]
        B[API Metrics]
        C[AI Model Metrics]
    end
    
    subgraph "Infrastructure Layer"
        D[Server Metrics]
        E[Database Metrics]
        F[Network Metrics]
    end
    
    subgraph "Monitoring Stack"
        G[Metrics Collection]
        H[Log Aggregation]
        I[Alerting System]
    end
    
    subgraph "Observability Tools"
        J[Dashboards]
        K[Alerting]
        L[Tracing]
    end
    
    A --> G
    B --> G
    C --> G
    D --> G
    E --> G
    F --> G
    
    G --> H
    H --> I
    
    I --> J
    I --> K
    I --> L
```

---

*These architectural diagrams provide a comprehensive view of the HealthAI Assistant system design and can be used for development, deployment, and maintenance planning.*