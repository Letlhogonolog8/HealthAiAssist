@echo off
echo 🧹 Creating clean deployment without secrets...

echo ✅ Step 1: Remove sensitive files
if exist .env del .env
if exist healthai.db del healthai.db
if exist uploads rmdir /s /q uploads
if exist server\__pycache__ rmdir /s /q server\__pycache__

echo ✅ Step 2: Create fresh Git repository
rmdir /s /q .git
git init
git add .
git commit -m "Clean deployment - HealthAI Assistant for Railway"

echo ✅ Step 3: Add remote and push
git remote add origin https://github.com/Smart-Edge-Tech/HealthAiAssist.git
git branch -M main
git push -u origin main

echo 🎉 Clean deployment complete!
echo.
echo Next steps:
echo 1. Go to https://railway.app
echo 2. Deploy from GitHub repo
echo 3. Add PostgreSQL database
echo 4. Set environment variables
echo.
pause