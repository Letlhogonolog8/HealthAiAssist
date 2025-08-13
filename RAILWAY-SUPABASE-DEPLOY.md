# 🚀 Railway + Supabase Deployment Guide

## Quick Setup (5 minutes)

### 1. Setup Supabase Database
```bash
# 1. Go to supabase.com and create account
# 2. Create new project
# 3. Go to SQL Editor and run supabase-setup.sql
# 4. Get connection details from Settings > Database
```

### 2. Deploy to Railway
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Deploy project
railway up

# Add environment variables
railway variables set NODE_ENV=production
railway variables set DATABASE_URL="postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres"
railway variables set SUPABASE_URL="https://[project].supabase.co"
railway variables set SUPABASE_ANON_KEY="your-anon-key"
railway variables set SESSION_SECRET="your-secure-secret"
railway variables set OPENAI_API_KEY="your-openai-key"
```

## 📋 Step-by-Step Instructions

### Step 1: Supabase Setup
1. **Create Supabase Account**: Go to [supabase.com](https://supabase.com)
2. **New Project**: Click "New Project"
3. **Database Setup**: 
   - Go to SQL Editor
   - Copy and paste content from `supabase-setup.sql`
   - Click "Run"
4. **Get Credentials**:
   - Settings → Database → Connection string
   - Settings → API → Project URL and anon key

### Step 2: Railway Deployment
1. **Install CLI**: `npm install -g @railway/cli`
2. **Login**: `railway login`
3. **Deploy**: `railway up`
4. **Set Variables** (in Railway dashboard or CLI):
   ```bash
   DATABASE_URL=your-supabase-connection-string
   SUPABASE_URL=your-supabase-project-url
   SUPABASE_ANON_KEY=your-supabase-anon-key
   SESSION_SECRET=your-secure-session-secret
   OPENAI_API_KEY=your-openai-api-key
   NODE_ENV=production
   ```

### Step 3: Test Deployment
- Visit your Railway app URL
- Check `/api/health` endpoint
- Test login with default credentials

## 🔑 Environment Variables

### Required Variables
```bash
NODE_ENV=production
DATABASE_URL=postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres
SUPABASE_URL=https://[project].supabase.co
SUPABASE_ANON_KEY=eyJ...
SESSION_SECRET=your-256-bit-secret
```

### Optional Variables
```bash
OPENAI_API_KEY=sk-...
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
GOOGLE_CALENDAR_CREDENTIALS={"type":"service_account"...}
```

## 🏥 Default Login Credentials
- **Admin**: admin / admin123
- **Doctor**: doctor / doctor123
- **Patient**: patient / patient123
- **Radiologist**: radiologist / radiologist123

## 📱 Features Available
- ✅ Multi-cancer AI detection
- ✅ Patient management
- ✅ Appointment scheduling
- ✅ Real-time chat
- ✅ Mobile responsive
- ✅ QR code access
- ✅ Medical chatbot

## 💰 Cost Estimate
- **Railway**: $5/month (Hobby plan)
- **Supabase**: Free tier (up to 500MB database)
- **Total**: ~$5/month for production app

## 🔧 Maintenance
```bash
# Update deployment
git push origin main
railway up

# View logs
railway logs

# Check status
railway status
```

## 🐛 Troubleshooting
- **Database connection**: Check Supabase connection string
- **Build errors**: Ensure Node.js 18+ in Railway
- **Session issues**: Verify SESSION_SECRET is set
- **API errors**: Check environment variables in Railway dashboard

Your app will be live at: `https://your-app.railway.app` 🎉