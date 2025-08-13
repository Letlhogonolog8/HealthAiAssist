# HealthAI Assistant - Cloud Deployment Guide

## 🚀 Quick Deploy Options

### 1. Render.com (Recommended - Free Tier Available)
```bash
# 1. Push code to GitHub
git add .
git commit -m "Deploy to production"
git push origin main

# 2. Go to render.com and create new Web Service
# 3. Connect your GitHub repository
# 4. Render will auto-deploy using render.yaml
```

**Environment Variables to set in Render:**
- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Random secure string
- `OPENAI_API_KEY` - Your OpenAI API key
- `PROD_ORIGIN` - Your Render app URL (e.g., https://your-app.onrender.com)

### 2. Railway (Simple Deploy)
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway up
```

### 3. Vercel (Serverless)
```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod
```

### 4. Docker (Any Cloud Provider)
```bash
# Build image
docker build -t healthai-assistant .

# Run locally
docker run -p 5000:5000 --env-file .env.production healthai-assistant

# Deploy to cloud (AWS, GCP, Azure)
# Push to container registry and deploy
```

## 🔧 Pre-Deployment Checklist

### 1. Environment Setup
- [ ] Copy `.env.production` and set all values
- [ ] Set `DEBUG_BYPASS_AUTH=false` for production
- [ ] Configure production database (PostgreSQL recommended)
- [ ] Set secure `SESSION_SECRET`

### 2. Database Setup
```bash
# Create production database
# Run migrations
npm run db:push

# Initialize with sample data (optional)
npm run db:init
```

### 3. Build Test
```bash
# Test production build locally
npm run build
npm start
```

## 🌐 Platform-Specific Instructions

### Render.com Setup
1. Create account at render.com
2. Connect GitHub repository
3. Create PostgreSQL database
4. Create Web Service
5. Set environment variables
6. Deploy automatically triggers

### Railway Setup
1. Install CLI: `npm install -g @railway/cli`
2. Login: `railway login`
3. Create project: `railway up`
4. Add PostgreSQL: `railway add postgresql`
5. Set environment variables in dashboard

### Vercel Setup
1. Install CLI: `npm install -g vercel`
2. Login: `vercel login`
3. Deploy: `vercel --prod`
4. Add PostgreSQL database (Neon, Supabase, etc.)
5. Set environment variables in dashboard

## 🔒 Security Considerations

### Production Environment Variables
```bash
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@host:port/db
SESSION_SECRET=your-256-bit-secret
HTTPS_ONLY=true
DEBUG_BYPASS_AUTH=false
PROD_ORIGIN=https://your-domain.com
```

### Database Security
- Use SSL connections
- Restrict database access by IP
- Use strong passwords
- Regular backups

## 📊 Monitoring & Health Checks

### Health Check Endpoint
- `GET /api/health` - Returns application status
- Use for load balancer health checks
- Monitor uptime and performance

### Logging
- Application logs available in platform dashboards
- Monitor error rates and performance metrics
- Set up alerts for critical issues

## 🐛 Troubleshooting

### Common Issues
1. **Build Failures**: Check Node.js version (18+)
2. **Database Connection**: Verify DATABASE_URL format
3. **Session Issues**: Ensure SESSION_SECRET is set
4. **CORS Errors**: Set PROD_ORIGIN correctly

### Debug Commands
```bash
# Check application health
curl https://your-app.com/api/health

# View logs (platform specific)
railway logs
vercel logs
```

## 📱 Mobile Access
- App automatically works on mobile devices
- QR code shows correct production URL
- Responsive design optimized for mobile

## 🔄 Updates & Maintenance
```bash
# Deploy updates
git push origin main  # Auto-deploys on most platforms

# Database migrations
npm run db:push

# Monitor application health
# Check platform dashboards regularly
```

## 💰 Cost Estimates
- **Render**: Free tier available, $7/month for production
- **Railway**: $5/month for hobby plan
- **Vercel**: Free tier available, $20/month for pro
- **Database**: $5-15/month for managed PostgreSQL

Choose the platform that best fits your needs and budget!