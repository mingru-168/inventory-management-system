@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "BAT_PATH=%~dp0启动_后台.bat"
set "SHORTCUT_NAME=ERP系统自动启动"

echo ========================================
echo   设置ERP系统开机自动启动
echo ========================================
echo.
echo 正在创建快捷方式...

powershell -Command "$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%STARTUP_FOLDER%\%SHORTCUT_NAME%.lnk'); $Shortcut.TargetPath = '%BAT_PATH%'; $Shortcut.WorkingDirectory = '%~dp0'; $Shortcut.WindowStyle = 7; $Shortcut.Description = 'ERP系统开机自动启动'; $Shortcut.Save();"

if exist "%STARTUP_FOLDER%\%SHORTCUT_NAME%.lnk" (
    echo.
    echo ✓ 成功！已设置开机自动启动。
    echo.
    echo 快捷方式位置: %STARTUP_FOLDER%\%SHORTCUT_NAME%.lnk
    echo.
    echo 下次开机时服务器将自动在后台运行。
) else (
    echo.
    echo ✗ 创建快捷方式失败，请手动操作。
    echo.
    echo 手动操作步骤:
    echo 1. 右键点击 "启动_后台.bat"
    echo 2. 选择 "发送到" ^> "桌面快捷方式"
    echo 3. 按 Win+R，输入 shell:startup 回车
    echo 4. 将桌面的快捷方式拖到打开的文件夹中
)

echo.
pause
