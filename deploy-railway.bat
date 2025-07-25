@echo off
echo 🚀 Preparing HealthAI Assistant for Railway deployment...

echo.
echo ✅ Step 1: Checking Git status...
git status

echo.
echo ✅ Step 2: Adding all files...
git add .

echo.
echo ✅ Step 3: Committing changes...
git commit -m "Deploy to Railway - %date% %time%"

echo.
echo ✅ Step 4: Pushing to GitHub...
git push origin main

echo.
echo 🎉 Code pushed to GitHub successfully!
echo.
echo Next steps:
echo 1. Go to https://railway.app
echo 2. Sign in with GitHub
echo 3. Click "New Project" → "Deploy from GitHub repo"
echo 4. Select your HealthAiAssist repository
echo 5. Add PostgreSQL database service
echo 6. Set environment variables (see .env.railway file)
echo.
echo 📖 Full guide: See RAILWAY_DEPLOYMENT.md
echo.
pause