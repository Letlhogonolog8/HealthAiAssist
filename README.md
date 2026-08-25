# HealthAI Assistant

A cancer **screening triage** platform. Two image classifiers — skin and lung —
produce a calibrated probability and route every result to a clinician. Nothing
here produces a diagnosis.

This line used to read "multi-modal cancer detection across breast, lung, skin,
colon, and prostate cancers". Breast, colon and prostate have no trained
classifier: requests for them return HTTP 503 and queue the scan for manual
review. Measured performance, and the limits of what was measured, are in
[MODEL_CARDS.md](MODEL_CARDS.md).

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
     6. (Optional) Variable name: `OPENAI_MODEL` and value: `gpt-4o-mini` (or your preferred model). Defaults to `gpt-4o-mini` if not set.
     6. Restart your terminal/IDE after setting
   
   **Test API Key:**
   ```bash
   # Powershell
   $env:OPENAI_API_KEY="sk-..."; $env:OPENAI_MODEL="gpt-4o-mini"; node server/test-openai.mjs
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

`npx tsx scripts/init-database.ts` creates one account per role — `admin`,
`doctor`, `radiologist`, `patient` — each with a **randomly generated password
printed once** at the end of the run. Save them then; they are not stored
anywhere in plaintext.

To pin a password for repeatable local work, set it before seeding:

```bash
SEED_ADMIN_PASSWORD=your-dev-password npx tsx scripts/init-database.ts
```

Seeding refuses to run when `NODE_ENV=production` unless `ALLOW_PROD_SEED=true`.

> Earlier versions shipped fixed credentials (`admin`/`admin123` and similar) and
> documented them here. Those are the first passwords anyone tries. If you seeded
> a database with a previous version, change those passwords now.

## 🔧 Features

### Core Functionality
- **Two screening modalities**: skin and lung. ResNet50V2 classifiers, evaluated
  on held-out splits, with calibration and out-of-distribution screening measured
  and recorded in [MODEL_CARDS.md](MODEL_CARDS.md)
- **Refusal by design**: inputs unlike the training distribution are rejected
  rather than classified, and a modality with no validated model returns 503
  with no diagnostic content — never a fabricated negative
- **Mandatory clinician review**: no path through the system bypasses it
- **Outcome recording**: confirmed diagnoses are stored against scans, so
  production performance is measurable at `GET /api/models/performance`
- **Role-based dashboards**: admin, doctor, radiologist, patient
- **Appointment management**: scheduling, conflict checking, notifications
- **Genomics**: PGS Catalog polygenic scores with ancestry-aware reporting that
  withholds a percentile where the score does not transfer — see
  [GENOMICS.md](GENOMICS.md)

Inference currently takes **8–14 seconds** per scan: a Python process is spawned
per request and loads TensorFlow from cold. It is not real-time, and the README
should not have called it that.

### Technical Features
- **PostgreSQL** via Drizzle. There is no SQLite fallback — `DATABASE_URL` is
  required and the server refuses to start without it. When the database is
  unreachable the in-memory store holds **no accounts**, so logins fail rather
  than falling back to built-in credentials
- **Encryption at rest** for clinical free text, under a rotatable keyring
- **Append-only audit trail** for sensitive operations, and for genomic access
- **POPIA §72 handling** for the cross-border transfer the AI assistant performs
- **Authorisation matrix enforced in CI** on every push
- **WebSocket** presence and notifications (single instance — state is
  process-local)
- **Responsive design**, light and dark
- **Calendar integration**: Google Calendar conflict checking

### Not implemented
Named here because they have been claimed before: no DICOM, HL7 or FHIR
interoperability; no offline mode; no MFA; English is the only language the
translation gate currently passes; no ambient therapy module; no clinical
validation and no regulatory clearance in any jurisdiction.

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
OPENAI_MODEL=gpt-4o-mini        # Optional: defaults to gpt-4o-mini
GOOGLE_CALENDAR_CREDENTIALS=your-service-account-json  # Optional
GOOGLE_CALENDAR_ID=your-calendar-id@group.calendar.google.com  # Optional
NODE_ENV=production
```

### Careful: system environment variables override `.env`

`dotenv` does **not** overwrite variables that are already set. On Windows, a
User- or Machine-level environment variable therefore wins over anything in
`.env`, silently — editing `.env` appears to work and changes nothing.

This bit us: a User-level `SESSION_SECRET=dev_secret_123` and a Machine-level
`SESSION_SECRET=xyz789...` were shadowing the `.env` value, so the app signed
every session cookie with a trivially guessable key regardless of the file.

Check what the process actually sees before trusting `.env`:

```powershell
[Environment]::GetEnvironmentVariable('SESSION_SECRET','User')
[Environment]::GetEnvironmentVariable('SESSION_SECRET','Machine')
```

Generate a strong secret with:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

The server refuses to start in production if `SESSION_SECRET` is missing, shorter
than 64 characters, or still a placeholder. In development it warns and uses an
ephemeral secret rather than a known one.

### Backing up model artifacts

`dataset/` is gitignored, so the trained models are not version controlled. The
skin model is rebuildable from `scripts/train-skin-cancer-model.py`; **the lung
model is not** — no working training script for it remains. Losing that file
loses the lung modality permanently.

```bash
npm run backup:models                    # copy + checksum to ../HealthAiAssist-model-backups
npm run backup:models -- <destination>   # somewhere else
npm run backup:models -- --verify        # re-hash an existing backup
```

The script refuses a copy whose hash does not match the source, and warns when the
destination is on the same volume — which protects against an accidental delete
but not against the disk failure that would actually lose the model.

### System Environment Variables (Production)

In production, the app reads from System/Platform environment variables. `.env` is only used in development.

- Required: `DATABASE_URL`, `SESSION_SECRET`
- Optional: `OPENAI_API_KEY`, `OPENAI_MODEL`, `GOOGLE_CALENDAR_CREDENTIALS`, `GOOGLE_CALENDAR_ID`, `ENCRYPTION_KEY`, `JWT_SECRET`

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