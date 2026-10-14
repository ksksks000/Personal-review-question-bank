@echo off
chcp 65001 >nul
title 题库
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 没检测到 Node.js，请先安装: https://nodejs.org
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo 首次运行，正在安装依赖，请稍候...
    call npm install
    if errorlevel 1 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
)

echo ============================================
echo   题库启动中... 将自动打开浏览器
echo   关闭浏览器页面后，后台会自动停止
echo   也可按 Ctrl+C 手动停止
echo ============================================
echo.
node scripts\dev-launcher.cjs
pause
