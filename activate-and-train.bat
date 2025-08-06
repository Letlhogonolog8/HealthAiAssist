@echo off
echo Activating virtual environment and training lung cancer model...

call venv\Scripts\activate.bat
python server/train-lung-cancer-model.py

echo Training completed!
pause