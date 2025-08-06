@echo off
echo Creating Python virtual environment for HealthAI Assistant...

python -m venv venv
call venv\Scripts\activate.bat

echo Installing dependencies...
pip install --upgrade pip
pip install -r requirements.txt

echo.
echo Virtual environment created successfully!
echo To activate: call venv\Scripts\activate.bat
echo To deactivate: deactivate
pause