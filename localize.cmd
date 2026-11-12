@echo off
setlocal
chcp 65001 >nul
where node.exe >nul 2>&1
if errorlevel 1 goto missing_node
node -e "process.exit(Number(process.versions.node.split('.')[0]) < 22 ? 1 : 0)"
if errorlevel 1 goto missing_node
if exist "%~dp0node_modules\yaml\package.json" goto run
call npm.cmd --prefix "%~dp0." ci --ignore-scripts --no-audit --no-fund
if errorlevel 1 goto install_failed

:run
node "%~dp0src\cli.mjs" %*
set "skill_menu_status=%errorlevel%"
if "%~1"=="" pause
exit /b %skill_menu_status%

:missing_node
echo Node.js 22 or newer with npm is required.
if "%~1"=="" pause
exit /b 1

:install_failed
echo Could not install the YAML dependency. Check the npm output above.
if "%~1"=="" pause
exit /b 1
