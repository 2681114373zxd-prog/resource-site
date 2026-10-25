@echo off
rem ==========================================================================
rem  一键提交到 GitHub：双击本文件即可
rem  它会自动：检查数据 -> 重新构建 -> 自检 -> 提交 main -> 推送
rem  首次运行如果弹出 GitHub 登录窗口，按提示登录一次即可。
rem ==========================================================================
chcp 65001 >nul
cd /d "%~dp0"

where powershell >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [x] 没有检测到 Windows PowerShell。
  echo      请确认系统里有 powershell.exe，然后再双击本文件。
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\auto-push.ps1"
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" (
  echo  提交没有完成，请看上面的提示。
) else (
  echo  完成。GitHub Pages 会在 1-2 分钟后自动更新。
)
echo.
pause
exit /b %EXITCODE%
