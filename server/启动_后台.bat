@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "erp.db" (
    node migrate_sqlite.js
)

start /min "" node index_sqlite.js
