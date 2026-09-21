@echo off
rem ==========================================================================
rem  一键发布：把安装包放到网站上（Xixi）
rem  用法一：直接把安装包拖到本文件上，按提示输入软件名字即可
rem  用法二：双击本文件，然后把安装包拖进黑窗口，输入路径和名字
rem  它会自动：装进 downloads/ → 算大小和 SHA256 → 写进 data/apps.json
rem            → 重新构建站点 → 自检 → 问你要不要推送上线
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
echo  一键发布：安装包 + 名字 = 网站上多一个软件
echo  ^(拖拽进来的路径会自动带上引号，不用管^)
echo.

node scripts\publish.mjs %*

echo.
pause
