@echo off
REM HealthAI Assistant - Windows Deployment Script

echo 🚀 HealthAI Assistant Deployment
echo ================================

if "%1"=="" (
    echo Usage: deploy.bat YOUR_PROJECT_ID
    echo Example: deploy.bat my-healthai-project
    exit /b 1
)

set PROJECT_ID=%1
set SERVICE_NAME=healthai-assistant
set REGION=us-central1

echo 📋 Project ID: %PROJECT_ID%
echo 🌍 Region: %REGION%
echo.

REM Set project
echo 🔧 Setting up Google Cloud project...
gcloud config set project %PROJECT_ID%

REM Enable APIs
echo 🔌 Enabling required APIs...
gcloud services enable run.googleapis.com cloudbuild.googleapis.com containerregistry.googleapis.com

REM Build and push
echo 🏗️ Building Docker image...
docker build -t gcr.io/%PROJECT_ID%/%SERVICE_NAME% .

echo 📤 Pushing to Container Registry...
docker push gcr.io/%PROJECT_ID%/%SERVICE_NAME%

REM Deploy to Cloud Run
echo 🚀 Deploying to Cloud Run...
gcloud run deploy %SERVICE_NAME% --image gcr.io/%PROJECT_ID%/%SERVICE_NAME% --platform managed --region %REGION% --allow-unauthenticated --memory 2Gi --cpu 2 --max-instances 10 --set-env-vars NODE_ENV=production,PORT=8080

echo.
echo ✅ Deployment complete!
echo 🌐 Your app will be available at the URL shown above
echo.
echo ⚠️  Don't forget to set your OpenAI API key:
echo gcloud run services update %SERVICE_NAME% --region %REGION% --set-env-vars OPENAI_API_KEY=your-key