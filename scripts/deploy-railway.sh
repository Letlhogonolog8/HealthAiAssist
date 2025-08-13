#!/bin/bash

echo "🚀 Deploying HealthAI Assistant to Railway..."

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "📦 Installing Railway CLI..."
    npm install -g @railway/cli
fi

# Build the application
echo "🔨 Building application..."
npm run build

# Deploy to Railway
echo "🚂 Deploying to Railway..."
railway up

echo "🔧 Setting environment variables..."
echo "Please set these variables in Railway dashboard:"
echo "- DATABASE_URL (Supabase connection string)"
echo "- SUPABASE_URL (Supabase project URL)"
echo "- SUPABASE_ANON_KEY (Supabase anon key)"
echo "- SESSION_SECRET (secure random string)"
echo "- OPENAI_API_KEY (OpenAI API key)"
echo "- NODE_ENV=production"

echo "✅ Deployment initiated!"
echo "🌐 Your app will be available at: https://your-app.railway.app"