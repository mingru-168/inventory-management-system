Set WshShell = CreateObject("WScript.Shell") 
WshShell.Run """%~dp0启动.bat""", 0, False 
Set WshShell = Nothing
