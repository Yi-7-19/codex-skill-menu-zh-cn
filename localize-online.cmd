@echo off
setlocal
call "%~dp0localize.cmd" --online %*
set "skill_menu_status=%errorlevel%"
if "%~1"=="" pause
exit /b %skill_menu_status%
