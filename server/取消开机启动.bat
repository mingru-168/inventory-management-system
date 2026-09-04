@echo off
chcp 65001 >nul

set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_NAME=ERP系统自动启动"

echo ========================================
echo   取消ERP系统开机自动启动
echo ========================================
echo.

if exist "%STARTUP_FOLDER%\%SHORTCUT_NAME%.lnk" (
    del "%STARTUP_FOLDER%\%SHORTCUT_NAME%.lnk"
    echo ✓ 成功！已取消开机自动启动。
) else (
    echo 未找到开机启动项，可能已经取消了。
)

echo.
pause
