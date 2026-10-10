@echo off
REM EarlyEye edge on Windows. Usage: edge\run_edge.bat [options]   (e.g. --camera 1, --fake, --no-post)
cd /d "%~dp0\.."
if not exist edge\.venv\Scripts\python.exe (
  echo Creating edge\.venv with Python 3.11 ...
  py -3.11 -m venv edge\.venv || (echo Install Python 3.11 from python.org first & exit /b 1)
  edge\.venv\Scripts\python -m pip install --upgrade pip
  edge\.venv\Scripts\python -m pip install -r edge\requirements.txt || exit /b 1
)
edge\.venv\Scripts\python edge\earlyeye_edge.py %*
