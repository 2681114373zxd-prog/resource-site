@echo off
rem ==========================================================================
rem  Windows 一键本地预览：双击本文件即可
rem  作用：构建站点 + 启动本地服务器 + 自动打开浏览器
rem  关闭这个黑窗口 = 停止预览
rem ==========================================================================
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [x] 没有检测到 Node.js。
  echo      请先到 https://nodejs.org 下载安装 LTS 版本，然后再双击本文件。
  echo      ^(安装完记得关掉这个窗口重新双击一次^)
  echo.
  pause
  exit /b 1
)

echo.
echo  正在构建并启动本地预览，请稍等几秒...
echo  浏览器会自动打开 http://127.0.0.1:5173
echo  关闭本窗口即可停止。
echo.

node scripts\dev.mjs --open

echo.
echo  预览已停止。
pause
