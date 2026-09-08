@echo off
title SIH26171 Browser AI Agent - Local Reasoning Gateway
cls
echo =====================================================================
echo   SIH26171 Browser AI Agent - Local Reasoning & Voice Gateway
echo   Smart India Hackathon (SIH) - Privacy-Preserving Vision Agent
echo =====================================================================
echo.
echo Checking Python environment...
py -3 -V >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set PY_CMD=py -3
    goto START_SERVER
)

py -V >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set PY_CMD=py
    goto START_SERVER
)

python -V >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set PY_CMD=python
    goto START_SERVER
)

echo [ERROR] Python 3.11 was not found in PATH or py launcher.
echo Please install Python 3.11 and ensure faster-whisper and flask are installed.
pause
exit /b 1

:START_SERVER
echo [OK] Using Python: %PY_CMD%
echo.
echo Starting HTTP reasoning gateway at http://127.0.0.1:5000...
echo High-Accuracy Whisper Voice Pipeline: ENABLED
echo Local Document Parser (PDF/Images/Docs): ENABLED
echo Structured Qwen2.5 Summarizer: ENABLED
echo.
%PY_CMD% server/run.py
pause
