@echo off
setlocal enabledelayedexpansion
title نصب پنل پروکسی MTProto

echo ===================================================
echo   در حال بررسی پیش‌نیازها...
echo ===================================================

where git >nul 2>nul
if errorlevel 1 (
  echo [خطا] گیت روی این سیستم نصب نیست.
  echo از این آدرس نصبش کنید: https://git-scm.com/download/win
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [خطا] Node.js روی این سیستم نصب نیست.
  echo از این آدرس نصبش کنید: https://nodejs.org
  pause
  exit /b 1
)

REM ---- این خط رو با ریپوی خودتون جایگزین کنید ----
set REPO_URL=https://github.com/USERNAME/local-panel.git
set DIR_NAME=local-panel

echo ===================================================
echo   در حال دریافت کد از گیت‌هاب...
echo ===================================================

if exist "%DIR_NAME%" (
  echo پوشه از قبل وجود دارد، در حال به‌روزرسانی...
  cd "%DIR_NAME%"
  git pull
) else (
  git clone "%REPO_URL%" "%DIR_NAME%"
  cd "%DIR_NAME%"
)

echo ===================================================
echo   در حال نصب وابستگی‌ها...
echo ===================================================
call npm install

echo ===================================================
echo   در حال اجرای پنل روی http://localhost:4000
echo ===================================================

REM چند ثانیه صبر می‌کنیم تا سرور بالا بیاد، بعد مرورگر رو باز می‌کنیم
start "" cmd /c "ping -n 4 127.0.0.1 >nul && start http://localhost:4000"

call npm start
