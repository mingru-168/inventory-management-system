# Inventory Management System - Startup Configuration Script

$startupFolder = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
$scriptPath = "$PSScriptRoot\隐藏启动.vbs"
$shortcutPath = "$startupFolder\InventorySystem.lnk"

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($shortcutPath)
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = """$scriptPath"""
$Shortcut.WorkingDirectory = $PSScriptRoot
$Shortcut.Description = "Inventory Management System"
$Shortcut.Save()

Write-Host "Successfully added to startup!"
Write-Host "Startup path: $shortcutPath"
Write-Host ""
Write-Host "The server will run automatically on next boot"
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")