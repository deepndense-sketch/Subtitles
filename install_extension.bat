@echo off
setlocal
set "SRC=%~dp0"
if "%SRC:~-1%"=="\" set "SRC=%SRC:~0,-1%"
set "PARENT=%APPDATA%\Adobe\CEP\extensions"
set "DEST=%PARENT%\Subtitle"

title Install Subtitle
if not exist "%SRC%\native\KeyListener.exe" (
  echo Building the Windows arrow-key listener...
  call "%SRC%\build_key_listener.bat"
  if errorlevel 1 (
    echo [ERROR] Could not build KeyListener.exe.
    pause
    exit /b 1
  )
)
if not exist "%PARENT%" mkdir "%PARENT%"
for %%V in (8 9 10 11 12 13) do reg add "HKCU\Software\Adobe\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>nul
if exist "%DEST%" (
  rmdir /s /q "%DEST%"
  if exist "%DEST%" (
    echo [ERROR] Close Premiere Pro and run this installer again.
    pause
    exit /b 1
  )
)
robocopy "%SRC%" "%DEST%" /MIR /XD .git tests backups node_modules /XF install_extension.bat build_key_listener.bat >nul
if errorlevel 8 (
  echo [ERROR] Extension copy failed.
  pause
  exit /b 1
)
echo.
echo [DONE] Subtitle installed.
echo Restart Premiere Pro, then open Window ^> Extensions ^> Subtitle.
echo.
pause
