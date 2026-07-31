@echo off
chcp 65001 >nul
title 悠行 - 出行游玩规划助手

echo.
echo  =================================
echo    悠行 - 出行游玩规划助手 启动中
echo  =================================
echo.

:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo  [错误] 未找到 Node.js，请先安装: https://nodejs.org/
  echo  安装后重新运行此脚本。
  pause
  exit /b 1
)

:: 检查 node_modules
if not exist "node_modules" (
  echo  [安装] 首次运行，正在安装依赖...
  call npm install
  if %errorlevel% neq 0 (
    echo  [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
  echo  [完成] 依赖安装成功。
  echo.
)

:: 检查 .env
if not exist ".env" (
  echo  [提示] 未找到 .env 配置文件，正在从模板创建...
  copy .env.example .env >nul
  echo  [完成] 已创建 .env 文件。
  echo  [提示] 如需接入真实API，请编辑 .env 填入Key。
  echo.
)

:: 启动服务
echo  [启动] 正在启动服务...
echo  [提示] 启动后请在浏览器打开 http://localhost:3000
echo  [提示] 按 Ctrl+C 可停止服务。
echo.
node src/server.js

pause
