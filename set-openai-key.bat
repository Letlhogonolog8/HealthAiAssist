@echo off
echo Setting OpenAI API Key...
setx OPENAI_API_KEY "***REMOVED-OPENAI-KEY***"
echo OpenAI API Key has been set in system environment variables.
echo Please restart your terminal/IDE for changes to take effect.
echo.
echo Testing API connection...
node server/test-openai.mjs
pause