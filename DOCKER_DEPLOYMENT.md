# 🐳 Docker Deployment Guide

## Prerequisites
- Docker Desktop installed
- Docker Compose installed

## Quick Start

### 1. Set Environment Variables
```bash
cp .env.docker .env
# Edit .env with your OPENAI_API_KEY
```

### 2. Build and Run
```bash
docker-compose up --build
```

### 3. Access Application
- **App**: http://localhost:5000
- **Database**: localhost:5432

## Commands

### Development
```bash
# Build and start
docker-compose up --build

# Run in background
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Production
```bash
# Build for production
docker build -t healthai-assistant .

# Run with external database
docker run -p 5000:5000 \
  -e DATABASE_URL=your-production-db-url \
  -e OPENAI_API_KEY=your-key \
  healthai-assistant
```

## Database Setup

### Initialize Database
```bash
# Access database container
docker-compose exec db psql -U healthai -d healthai_db

# Or run initialization script
docker-compose exec app npm run db:push
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection | ✅ |
| `OPENAI_API_KEY` | OpenAI API key | ✅ |
| `SESSION_SECRET` | Session encryption key | ✅ |
| `NODE_ENV` | Environment (production) | ✅ |

## Troubleshooting

### Port Already in Use
```bash
# Kill process on port 5000
lsof -ti:5000 | xargs kill

# Or change port in docker-compose.yml
ports:
  - "3000:5000"  # Use port 3000 instead
```

### Database Connection Issues
```bash
# Check database is running
docker-compose ps

# Restart database
docker-compose restart db

# Check logs
docker-compose logs db
```

### Build Failures
```bash
# Clean build
docker-compose down
docker system prune -f
docker-compose up --build
```

## Cloud Deployment

### AWS ECS
```bash
# Build and push to ECR
docker build -t healthai-assistant .
docker tag healthai-assistant:latest your-ecr-repo
docker push your-ecr-repo
```

### Google Cloud Run
```bash
# Build and deploy
gcloud builds submit --tag gcr.io/PROJECT-ID/healthai-assistant
gcloud run deploy --image gcr.io/PROJECT-ID/healthai-assistant
```

### Azure Container Instances
```bash
# Build and push to ACR
docker build -t healthai-assistant .
docker tag healthai-assistant your-registry.azurecr.io/healthai-assistant
docker push your-registry.azurecr.io/healthai-assistant
```

## Default Login Credentials
- **Admin**: admin / admin123
- **Doctor**: doctor / doctor123
- **Patient**: patient / patient123

## Support
- Check logs: `docker-compose logs -f`
- Restart services: `docker-compose restart`
- Clean reset: `docker-compose down -v && docker-compose up --build`