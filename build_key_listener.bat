@echo off
setlocal
set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo [ERROR] Microsoft C# compiler was not found.
  exit /b 1
)
set "TEMP_EXE=%TEMP%\PremiereSubtitleNavigator.KeyListener.exe"
if exist "%TEMP_EXE%" del /q "%TEMP_EXE%"
"%CSC%" /nologo /target:exe /optimize+ /out:"%TEMP_EXE%" "%~dp0native\KeyListener.cs"
if errorlevel 1 exit /b 1
if exist "%~dp0native\KeyListener.exe" del /q "%~dp0native\KeyListener.exe"
copy /y "%TEMP_EXE%" "%~dp0native\KeyListener.exe" >nul
if errorlevel 1 exit /b 1
del /q "%TEMP_EXE%" >nul 2>nul
echo Built native\KeyListener.exe
