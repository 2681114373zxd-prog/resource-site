@echo off
rem ==========================================================================
rem  Xixi 本地后台：浏览器里发布软件 / 改站点信息 / 一键上传到 GitHub
rem  作用：启动本地服务器（只监听 127.0.0.1）并自动打开管理界面
rem  关闭这个黑窗口 = 关掉后台
rem ==========================================================================
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [x] 没有检测到 Node.js。
  echo      请先到 https://nodejs.org 下载安装 LTS 版本，然后再双击本文件。
  echo.
  pause
  exit /b 1
)

echo.
echo  正在启动 Xixi 本地后台，浏览器稍后会自动打开...
echo  终端里会打印登录密码（也存在 data\admin.json 里）。
echo.

node scripts\admin-server.mjs --open

echo.
echo  后台已关闭。
pause
