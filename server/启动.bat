@echo off
chcp 65001 >nul
echo ========================================
echo   ERP系统 启动脚本
echo ========================================
echo.
cd /d "%~dp0"
echo 正在启动服务器...
echo.
echo 访问地址: http://localhost:3000
echo 按 Ctrl+C 停止服务器
echo.
node index.js
