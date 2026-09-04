@echo off
chcp 65001 >nul
echo ========================================
echo   ERP系统 - SQLite版本 启动脚本
echo ========================================
echo.

cd /d "%~dp0"

echo [1/2] 正在检查数据库...
if not exist "erp.db" (
    echo 数据库文件不存在，正在创建并迁移数据...
    node migrate_sqlite.js
    echo.
) else (
    echo 数据库文件已存在: %cd%\erp.db
)

echo.
echo [2/2] 正在启动服务器...
echo.
echo 访问地址: http://localhost:3000
echo 按 Ctrl+C 停止服务器
echo.

npm start
