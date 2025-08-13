#!/bin/bash

# HealthAI Assistant Deployment Script
echo "🚀 Starting HealthAI Assistant deployment..."

# Check if platform is specified
if [ -z "$1" ]; then
    echo "Usage: ./deploy.sh [render|vercel|railway|docker|gcp]"
    exit 1
fi

PLATFORM=$1

# Build the application
echo "📦 Building application..."
npm run build

case $PLATFORM in
    "render")
        echo "🌐 Deploying to Render..."
        echo "1. Push your code to GitHub"
        echo "2. Connect your GitHub repo to Render"
        echo "3. Render will automatically deploy using render.yaml"
        echo "4. Set environment variables in Render dashboard"
        ;;
    
    "vercel")
        echo "⚡ Deploying to Vercel..."
        npx vercel --prod
        ;;
    
    "railway")
        echo "🚂 Deploying to Railway..."
        echo "1. Install Railway CLI: npm install -g @railway/cli"
        echo "2. Login: railway login"
        echo "3. Deploy: railway up"
        ;;
    
    "docker")
        echo "🐳 Building Docker image..."
        docker build -t healthai-assistant .
        echo "Docker image built successfully!"
        echo "To run: docker run -p 5000:5000 --env-file .env healthai-assistant"
        ;;
    
    "gcp")
        echo "☁️ Deploying to Google Cloud Platform..."
        gcloud app deploy app.yaml --quiet
        ;;
    
    *)
        echo "❌ Unknown platform: $PLATFORM"
        echo "Supported platforms: render, vercel, railway, docker, gcp"
        exit 1
        ;;
esac

echo "✅ Deployment process completed!"