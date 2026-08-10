# Production Deployment Guide

## Pre-Deployment Checklist

### 1. Security Preparation (CRITICAL)
- [ ] All API keys rotated and updated
- [ ] Git history cleaned of secrets
- [ ] SESSION_SECRET set to secure value (32+ chars)
- [ ] DEBUG_BYPASS_AUTH set to false
- [ ] NODE_ENV set to production
- [ ] HTTPS_ONLY set to true
- [ ] PROD_ORIGIN set to your domain
- [ ] All environment variables reviewed and set

### 2. Database Setup
- [ ] PostgreSQL 14+ installed and configured
- [ ] Database created: `HealthAIAssistant`
- [ ] Database user created (non-admin)
- [ ] SSL connections enabled
- [ ] Backups configured
- [ ] Database password changed to strong value
- [ ] Connection pooling configured (pg-boss or similar)

### 3. SSL/TLS Certificate
- [ ] Valid SSL certificate obtained (Let's Encrypt or commercial)
- [ ] Certificate placed in correct location
- [ ] Private key secured
- [ ] Certificate renewal automated (certbot for Let's Encrypt)
- [ ] Key rotation schedule established

### 4. Application Configuration
- [ ] All dependencies installed: `npm install --production`
- [ ] Build completed: `npm run build`
- [ ] Build output verified
- [ ] Environment variables set in deployment
- [ ] Log directory created and writable
- [ ] Upload directory created and writable

### 5. Infrastructure
- [ ] Load balancer configured with HTTPS
- [ ] HSTS enabled on load balancer
- [ ] WAF (Web Application Firewall) configured
- [ ] DDoS protection enabled
- [ ] Monitoring agents installed
- [ ] Alerting configured

---

## Environment Variables for Production

Create `.env.production` with these values:

```bash
# Application Configuration
NODE_ENV=production
PORT=5000
PROD_ORIGIN=https://your-domain.com

# Security
DEBUG_BYPASS_AUTH=false
HTTPS_ONLY=true
SESSION_SECRET=<generate-secure-random-string>

# Database (use strong password, SSL connection)
DATABASE_URL=postgresql://healthai_user:STRONG_PASSWORD_HERE@db.production.com:5432/HealthAIAssistant?sslmode=require

# External Services (use new API keys)
OPENAI_API_KEY=sk-proj-<new-key>
TWILIO_ACCOUNT_SID=<new-sid>
TWILIO_AUTH_TOKEN=<new-token>
TWILIO_PHONE_NUMBER=+1234567890
GOOGLE_CALENDAR_CREDENTIALS=<json-config>
GOOGLE_CALENDAR_ID=your-calendar@gmail.com

# Optional: Logging & Monitoring
LOG_LEVEL=info
SENTRY_DSN=https://your-sentry-dsn@sentry.io
```

### Generating Secure SESSION_SECRET

```bash
# Linux/Mac
openssl rand -base64 32

# Or using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

## Deployment Steps

### Option 1: Render.com (Recommended for Simplicity)

#### Setup:
1. **Create Render account** at https://render.com
2. **Connect GitHub repository**
3. **Create PostgreSQL database**
4. **Create Web Service**
   - GitHub repo: Select your repository
   - Branch: main
   - Build command: `npm run build`
   - Start command: `npm start`
5. **Set Environment Variables** in Render Dashboard:
   - Copy all production variables from above
   - Render will automatically rotate them securely
6. **Deploy**
   - Render auto-deploys on git push
   - Monitor deployment logs

#### Cost: ~$7-10/month

---

### Option 2: Railway.app

#### Setup:
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Create project
railway init

# Add PostgreSQL database
railway add --plugin postgres

# Set environment variables
railway variables
# Add all production variables

# Deploy
railway up
```

#### Cost: ~$5/month (hobby plan)

---

### Option 3: AWS (ECS + RDS)

#### Setup:
1. **Create RDS PostgreSQL instance**
   - Multi-AZ for production
   - Automated backups
   - SSL connections enabled

2. **Create ECS Cluster**
   - Fargate launch type
   - Load balancer (ALB)

3. **Create ECR Repository**
   ```bash
   # Build Docker image
   docker build -t healthai-assistant .
   
   # Tag for ECR
   docker tag healthai-assistant:latest <account>.dkr.ecr.<region>.amazonaws.com/healthai-assistant:latest
   
   # Push to ECR
   aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com
   docker push <account>.dkr.ecr.<region>.amazonaws.com/healthai-assistant:latest
   ```

4. **Create ECS Task Definition**
   - Image: Your ECR image URL
   - Memory: 1024 MB
   - CPU: 512
   - Environment variables: Set all production vars

5. **Create ECS Service**
   - Load balancer: ALB
   - Port: 5000
   - Health check: /api/health

#### Cost: ~$30-50/month (minimum)

---

### Option 4: Docker (Any Cloud Provider)

#### Build and Test Locally:
```bash
# Build image
docker build -t healthai-assistant:latest .

# Run locally
docker run -p 5000:5000 \
  -e NODE_ENV=production \
  -e DATABASE_URL=postgresql://user:pass@db:5432/healthai \
  -e SESSION_SECRET=<secure-string> \
  healthai-assistant:latest

# Test
curl http://localhost:5000/api/health
```

#### Push to Registry:
```bash
# Docker Hub
docker tag healthai-assistant:latest yourusername/healthai-assistant:latest
docker push yourusername/healthai-assistant:latest

# AWS ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account>.dkr.ecr.us-east-1.amazonaws.com
docker tag healthai-assistant:latest <account>.dkr.ecr.us-east-1.amazonaws.com/healthai-assistant:latest
docker push <account>.dkr.ecm.us-east-1.amazonaws.com/healthai-assistant:latest

# Google Cloud
gcloud auth configure-docker
docker tag healthai-assistant:latest gcr.io/project-id/healthai-assistant:latest
docker push gcr.io/project-id/healthai-assistant:latest
```

---

## Post-Deployment Verification

### 1. Health Checks
```bash
# Check application health
curl -s https://your-domain.com/api/health
# Expected response: {"status":"ok","env":"production",...}

# Check response headers
curl -i https://your-domain.com/api/health
# Expected headers:
# - Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
# - Content-Security-Policy: default-src 'self'; ...
# - X-Content-Type-Options: nosniff
# - X-Frame-Options: DENY
```

### 2. Authentication Testing
```bash
# Verify authentication required
curl https://your-domain.com/api/scans
# Expected: {"error":"Authentication required"}
# Should NOT include debug information

# Test login
curl -X POST https://your-domain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}'
```

### 3. HTTPS Enforcement
```bash
# Verify HTTPS redirect
curl -i http://your-domain.com
# Expected: 301/302 redirect to https://

# Check certificate
openssl s_client -connect your-domain.com:443
```

### 4. Database Connectivity
```bash
# Verify database connection via application
curl https://your-domain.com/api/health
# Should show database is connected
```

### 5. Rate Limiting
```bash
# Test rate limiting (run multiple times)
for i in {1..15}; do 
  curl -X POST https://your-domain.com/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{}' | grep -o "error\|Retry-After"
done
# Should eventually get rate limit error
```

---

## Monitoring & Maintenance

### Daily Checks
```bash
# Check uptime
curl https://your-domain.com/api/health

# Check logs for errors
# Provider-specific: Review logs in dashboard
```

### Weekly Tasks
- [ ] Review security logs
- [ ] Check for dependency updates: `npm outdated`
- [ ] Verify backups completed
- [ ] Monitor disk space usage
- [ ] Check SSL certificate expiration

### Monthly Tasks
- [ ] Run `npm audit` for security vulnerabilities
- [ ] Update dependencies: `npm update`
- [ ] Review performance metrics
- [ ] Test disaster recovery procedures
- [ ] Review access logs for suspicious activity

### Quarterly Tasks
- [ ] Security penetration testing
- [ ] Full disaster recovery drill
- [ ] Review and update security policies
- [ ] Audit database access
- [ ] Review and update documentation

---

## Troubleshooting

### "Cannot connect to database"
- [ ] Verify DATABASE_URL is correct
- [ ] Check database is running
- [ ] Verify network connectivity to database
- [ ] Check database user permissions
- [ ] Verify SSL certificates if using SSL mode

### "HTTPS not working"
- [ ] Verify SSL certificate is valid
- [ ] Check certificate is installed correctly
- [ ] Verify HTTPS_ONLY=true in environment
- [ ] Check load balancer HTTPS configuration
- [ ] Review logs for certificate errors

### "High CPU usage"
- [ ] Check for long-running queries
- [ ] Review application logs for errors
- [ ] Check database performance
- [ ] Monitor WebSocket connections
- [ ] Review rate limiting settings

### "Database performance degradation"
- [ ] Check indexes are created
- [ ] Review slow query logs
- [ ] Check disk space on database server
- [ ] Review connection pool settings
- [ ] Consider database optimization

### "Memory usage increasing"
- [ ] Check for memory leaks in code
- [ ] Review long-running processes
- [ ] Check database connection count
- [ ] Review cache settings
- [ ] Monitor event listener leaks

---

## Rollback Procedures

If deployment fails or causes issues:

```bash
# Render.com
# Use Render Dashboard → Deploys → Rollback

# Railway
railway rollback

# Docker/Kubernetes
# Revert to previous image version
docker run -d <previous-image-version>
kubectl rollout undo deployment/healthai

# Git-based rollback
git revert <commit-hash>
git push origin main
```

---

## Performance Optimization

### Application Level
- [ ] Enable gzip compression
- [ ] Implement caching headers
- [ ] Use CDN for static assets
- [ ] Optimize database queries
- [ ] Implement connection pooling

### Database Level
- [ ] Add indexes on frequently queried columns
- [ ] Archive old data
- [ ] Optimize table structure
- [ ] Enable query result caching
- [ ] Use read replicas for read-heavy loads

### Infrastructure Level
- [ ] Use load balancer for horizontal scaling
- [ ] Enable auto-scaling
- [ ] Use CDN for static content
- [ ] Enable gzip compression at reverse proxy
- [ ] Implement rate limiting at edge

---

## Scaling for High Traffic

When traffic increases:

1. **Horizontal Scaling**: Add more application instances
   - Load balancer distributes traffic
   - Session store must be in database/Redis (not memory)

2. **Database Scaling**: 
   - Read replicas for queries
   - Connection pooling
   - Query optimization

3. **Caching Layer**:
   - Redis for session/cache storage
   - CDN for static assets

4. **Asynchronous Processing**:
   - Queue long-running jobs
   - Process in background workers
   - Return async responses to users

---

## Disaster Recovery

### Backup Strategy
- [ ] Automated daily backups of database
- [ ] Point-in-time recovery capability (7+ days)
- [ ] Off-site backup copies
- [ ] Test restore procedure monthly

### Disaster Recovery Runbook
1. **Database Loss**: Restore from latest backup
2. **Application Failure**: Rollback to previous version
3. **Data Corruption**: Restore from backup, notify users
4. **Complete Outage**: Failover to backup infrastructure

### Recovery Time Objectives (RTO)
- Database loss: 1 hour
- Application failure: 15 minutes
- Complete outage: 1 hour

---

## Security Hardening Checklist

- [ ] HTTPS enforced
- [ ] HSTS enabled
- [ ] CSP headers set
- [ ] Rate limiting active
- [ ] Input validation working
- [ ] Authentication required for endpoints
- [ ] Error messages don't leak information
- [ ] Logging captures security events
- [ ] Database using SSL connections
- [ ] Backups encrypted
- [ ] API keys rotated quarterly
- [ ] Dependencies updated monthly
- [ ] Security audit scheduled

---

## Going Live Checklist

- [ ] All environment variables set in production
- [ ] Database migrations completed
- [ ] SSL certificate valid and auto-renewing
- [ ] Load balancer configured and tested
- [ ] Monitoring and alerting active
- [ ] Backup procedures tested
- [ ] Documentation complete
- [ ] Team trained on operations
- [ ] Security audit completed
- [ ] Performance baselines established
- [ ] Incident response plan documented
- [ ] On-call rotation established

---

**After deployment, continuously monitor and optimize for performance, security, and reliability.**
