@echo off
chcp 65001 >nul
title 大六壬排盘系统

cd /d "%~dp0backend"
set PYTHONPATH=%~dp0backend

echo ================================
echo   大六壬 · 排盘解盘系统
echo   后端地址: http://localhost:8000
echo   关闭此窗口即停止服务
echo ================================
echo.

C:\Users\ccczy\anaconda3\python -m uvicorn app:app --host 0.0.0.0 --port 8000

pause
