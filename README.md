# HealthAI Assistant - Advanced Cancer Detection Platform

A comprehensive AI-powered healthcare platform for multi-modal cancer detection across breast, lung, skin, colon, and prostate cancers.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm
- Python 3.8+ with pip
- PostgreSQL 12+ (optional - SQLite fallback available)

### Installation

1. **Clone and Install Dependencies**
   ```bash
   git clone <repository-url>
   cd HealthAiAssist
   npm install
   ```

2. **Setup Python Virtual Environment (Recommended)**
   ```bash
   # Windows
   setup-venv.bat
   
   # Or manually:
   python -m venv venv
   venv\Scripts\activate
   pip install -r requirements.txt
   ```

2. **Environment Setup**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

   **OpenAI API Key Setup (Required for AI Chatbot):**
   - Get your API key from [OpenAI Platform](https://platform.openai.com/api-keys)
   - Add to Windows System Environment Variables:
     1. Press `Win + R`, type `sysdm.cpl`, press Enter
     2. Click "Environment Variables" button
     3. Under "System Variables", click "New"
     4. Variable name: `OPENAI_API_KEY`
     5. Variable value: `your_openai_api_key_here`
     6. Restart your terminal/IDE after setting
   
   **Test API Key:**
   ```bash
   node server/test-openai.mjs
   ```

3. **Database Setup** (Optional)
   ```bash
   # For PostgreSQL
   createdb healthai_db
   npm run db:push
   
   # Initialize with sample data
   npx tsx scripts/init-database.ts
   ```

4. **Run Startup Check**
   ```bash
   npx tsx scripts/startup-check.ts
   ```

5. **Start Application**
   ```bash
   npm run dev
   ```

## 🏥 Default User Accounts

| Role | Username | Password | Description |
|------|----------|----------|-------------|
| Admin | admin | admin123 | System administration |
| Doctor | doctor | doctor123 | Medical professional |
| Radiologist | radiologist | radiologist123 | Imaging specialist |
| Patient | patient | patient123 | Patient portal |

## 🔧 Features

### Core Functionality
- **Multi-Cancer Detection**: Breast, lung, skin, colon, prostate
- **Real-time AI Analysis**: TensorFlow-powered image analysis
- **Role-based Dashboards**: Admin, Doctor, Radiologist, Patient
- **Appointment Management**: Scheduling and tracking
- **Medical Translation**: Multi-language support
- **Ambient Therapy**: Stress reduction features

### Technical Features
- **Database Flexibility**: PostgreSQL with SQLite fallback
- **Error Handling**: Comprehensive error boundaries
- **Security**: Session-based authentication
- **Real-time Updates**: WebSocket support
- **Responsive Design**: Mobile-friendly interface
- **Calendar Integration**: Google Calendar conflict checking

## 🛠️ Troubleshooting

### Common Issues

1. **Database Connection Failed**
   - Check PostgreSQL is running
   - Verify DATABASE_URL in .env
   - Application will use SQLite fallback

2. **Python Model Errors**
   - Install Python dependencies: `pip install -r requirements.txt`
   - Check Python is in PATH
   - Model files will use fallback predictions if missing

3. **Port 5000 Already in Use**
   - Kill existing process: `lsof -ti:5000 | xargs kill`
   - Or change port in server configuration

4. **Missing Environment Variables**
   - Copy .env.example to .env
   - Run startup check: `npx tsx scripts/startup-check.ts`

### Debug Mode
```bash
# Enable detailed logging
NODE_ENV=development npm run dev

# Check component status
npx tsx scripts/startup-check.ts
```

## 📁 Project Structure

```
HealthAiAssist/
├── client/src/           # React frontend
│   ├── components/       # UI components
│   ├── pages/           # Page components
│   └── lib/             # Utilities
├── server/              # Express backend
│   ├── routes.ts        # API endpoints
│   ├── db.ts           # Database config
│   └── *.py            # Python AI models
├── shared/              # Shared types/schemas
├── scripts/             # Utility scripts
└── dataset/             # AI model files
```

## 🔒 Security

- Session-based authentication
- Password hashing with bcrypt
- Rate limiting on API endpoints
- Input validation and sanitization
- HTTPS enforcement in production

## 🚀 Deployment

### Production Setup
1. Set NODE_ENV=production
2. Configure production database
3. Set secure session secrets
4. Enable HTTPS
5. Configure monitoring

### Environment Variables
```bash
DATABASE_URL=postgresql://user:pass@host:5432/db
SESSION_SECRET=your-secure-secret
OPENAI_API_KEY=your-openai-key  # Set in System Environment Variables
GOOGLE_CALENDAR_CREDENTIALS=your-service-account-json  # Optional
GOOGLE_CALENDAR_ID=your-calendar-id@group.calendar.google.com  # Optional
NODE_ENV=production
```

### System Environment Variables (Production)

In production, the app reads from System/Platform environment variables. `.env` is only used in development.

- Required: `DATABASE_URL`, `SESSION_SECRET`
- Optional: `OPENAI_API_KEY`, `GOOGLE_CALENDAR_CREDENTIALS`, `GOOGLE_CALENDAR_ID`, `ENCRYPTION_KEY`, `JWT_SECRET`

### Health Check

- `GET /api/health` returns `{ status: 'ok', env, uptimeSec, websocket }`.

### Docker Deployment (Alternative)

```bash
# Build
docker build -t healthai:latest .

# Run (set env vars)
docker run -p 5000:5000 \
  -e NODE_ENV=production \
  -e DATABASE_URL=postgresql://user:pass@host:5432/db \
  -e SESSION_SECRET=your-secret \
  --name healthai \
  healthai:latest
```

### One-click deploy options

- Render: add `render.yaml` from the repo root. Create a new Render Web Service from this repo. Set env vars `DATABASE_URL`, `SESSION_SECRET`, `PROD_ORIGIN` to your domain (e.g., `https://app.yourdomain.com`). Render will run `npm run build` then `npm start`.
- Google Cloud Run: use the Dockerfile in the repo.
  ```bash
  gcloud builds submit --tag gcr.io/PROJECT/healthai:latest
  gcloud run deploy healthai \
    --image gcr.io/PROJECT/healthai:latest \
    --region REGION \
    --platform managed \
    --allow-unauthenticated \
    --set-env-vars NODE_ENV=production,DATABASE_URL=...,SESSION_SECRET=...,PROD_ORIGIN=https://app.yourdomain.com
  ```

### Google Calendar Integration (Optional)

To prevent appointment conflicts with external calendar events:

1. Follow the setup guide in `docs/google-calendar-setup.md`
2. Configure Google Calendar credentials in environment variables
3. The system will automatically check for conflicts when booking appointments
4. If not configured, appointments work normally without external calendar checking

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Run tests and checks
4. Submit pull request

## 📞 Support

For issues and support:
1. Check troubleshooting section
2. Run startup diagnostics
3. Review error logs
4. Contact development team

## 📄 License

MIT License - see LICENSE file for details.