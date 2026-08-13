@echo off
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Please install Node.js 18 or newer.
  pause
  exit /b 1
)

if not exist "node_modules\electron\install.js" (
  echo Installing dependencies, please wait...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed. Please run: npm install
    pause
    exit /b 1
  )
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Downloading the Electron runtime, please wait...
  set "electron_config_cache=%~dp0.electron-cache"
  node "node_modules\electron\install.js"
  if errorlevel 1 (
    echo Electron download failed. Please check your network and run again.
    pause
    exit /b 1
  )
)

if not exist "dist\renderer\index.html" (
  echo Building the interface...
  call npm run build
)

echo Starting the workbench...
call npm start
pause
