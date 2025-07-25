# Docker & Google Cloud Run Deployment Guide

## Prerequisites

1. **Docker Desktop** - Install from [docker.com](https://www.docker.com/products/docker-desktop)
2. **Google Cloud CLI** - Install from [cloud.google.com/sdk](https://cloud.google.com/sdk/docs/install)
3. **Google Cloud Project** - Create at [console.cloud.google.com](https://console.cloud.google.com)

## Local Docker Setup

### 1. Build Docker Image
```bash
docker build -t healthai-assistant .
```

### 2. Run with Docker Compose
```bash
# Copy environment file
cp .env.docker .env

# Edit .env with your OpenAI API key
# OPENAI_API_KEY=your-actual-api-key

# Start services
docker-compose up -d

# View logs
docker-compose logs -f healthai
```

### 3. Test Local Deployment
```bash
# Check if running
curl http://localhost:5000/api/health

# Access application
open http://localhost:5000
```

## Google Cloud Run Deployment

### 1. Setup Google Cloud
```bash
# Login to Google Cloud
gcloud auth login

# Set project (replace with your project ID)
gcloud config set project YOUR_PROJECT_ID

# Enable required APIs
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable containerregistry.googleapis.com
```

### 2. Build and Push to Container Registry
```bash
# Build for Cloud Run (port 8080)
docker build -t gcr.io/YOUR_PROJECT_ID/healthai-assistant .

# Push to Google Container Registry
docker push gcr.io/YOUR_PROJECT_ID/healthai-assistant
```

### 3. Deploy to Cloud Run
```bash
gcloud run deploy healthai-assistant \
  --image gcr.io/YOUR_PROJECT_ID/healthai-assistant \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --max-instances 10 \
  --set-env-vars NODE_ENV=production,PORT=8080 \
  --set-env-vars OPENAI_API_KEY=your-openai-api-key
```

### 4. Set Environment Variables (Secure)
```bash
# Set OpenAI API Key securely
gcloud run services update healthai-assistant \
  --region us-central1 \
  --set-env-vars OPENAI_API_KEY=your-actual-openai-api-key

# Set session secret
gcloud run services update healthai-assistant \
  --region us-central1 \
  --set-env-vars SESSION_SECRET=your-secure-session-secret
```

## Automated Deployment with Cloud Build

### 1. Connect GitHub Repository
```bash
# Connect your GitHub repo to Cloud Build
gcloud builds triggers create github \
  --repo-name=HealthAiAssist \
  --repo-owner=mudau-coder \
  --branch-pattern="^main$" \
  --build-config=cloudbuild.yaml
```

### 2. Manual Trigger
```bash
# Trigger build manually
gcloud builds submit --config cloudbuild.yaml .
```

## Environment Variables for Production

Set these in Cloud Run:
```bash
NODE_ENV=production
PORT=8080
DATABASE_URL=sqlite:./healthai.db
SESSION_SECRET=your-secure-session-secret
OPENAI_API_KEY=your-openai-api-key
```

## Monitoring and Logs

```bash
# View Cloud Run logs
gcloud run services logs read healthai-assistant --region us-central1

# Monitor service
gcloud run services describe healthai-assistant --region us-central1
```

## Scaling Configuration

```bash
# Update scaling settings
gcloud run services update healthai-assistant \
  --region us-central1 \
  --min-instances 1 \
  --max-instances 20 \
  --concurrency 100
```

## Custom Domain (Optional)

```bash
# Map custom domain
gcloud run domain-mappings create \
  --service healthai-assistant \
  --domain your-domain.com \
  --region us-central1
```

## Troubleshooting

### Common Issues:
1. **Build Failures**: Check Dockerfile and dependencies
2. **Memory Issues**: Increase memory allocation
3. **Cold Starts**: Set min-instances to 1
4. **Environment Variables**: Verify all required vars are set

### Debug Commands:
```bash
# Check service status
gcloud run services list

# View detailed service info
gcloud run services describe healthai-assistant --region us-central1

# Check recent deployments
gcloud run revisions list --service healthai-assistant --region us-central1
```