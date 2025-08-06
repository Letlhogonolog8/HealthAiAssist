@echo off
echo Starting ResNet50V2 Lung Cancer Model Training...
echo.
echo Dataset Path: C:\Users\mudau\Videos\HealthAiAssist\dataset\lung_cancer_MRI_dataset
echo Model Output: C:\Users\mudau\Videos\HealthAiAssist\dataset\resnet50v2_lung_cancer_model.h5
echo.

if exist venv\Scripts\activate.bat (
    echo Activating virtual environment...
    call venv\Scripts\activate.bat
) else (
    echo Warning: Virtual environment not found. Using global Python.
)

python server/train-lung-cancer-model.py

echo.
echo Training completed! Check the results in dataset/lung_cancer_training_results.json
pause