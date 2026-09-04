@echo off
setlocal

where node >nul 2>&1
if %errorlevel%==0 (
  set "NODE=node"
) else if defined NODE_EXE (
  set "NODE=%NODE_EXE%"
) else (
  set "NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
)

if not exist "%NODE%" (
  echo Node.js was not found. Install Node.js or set NODE_EXE.
  exit /b 1
)

"%NODE%" %*
