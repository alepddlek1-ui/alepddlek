@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

rem 앱을 켜고 브라우저를 여는 파일입니다. 더블클릭하면 됩니다.
rem 이 창을 닫으면 앱이 꺼집니다.

if not exist "node_modules" (
  echo.
  echo [1/2] 처음 켜는 것 같습니다. 필요한 프로그램을 내려받습니다. 1~3분 걸립니다.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo 내려받기에 실패했습니다. 이 창의 내용을 그대로 복사해 물어보세요.
    pause
    exit /b 1
  )
)

echo.
echo [2/2] 앱을 켭니다. 잠시 뒤 브라우저가 저절로 열립니다.
echo 이 창은 닫지 마세요. 닫으면 앱이 꺼집니다.
echo.

start "" cmd /c "timeout /t 8 >nul & start http://localhost:4123"
call npm run dev

echo.
echo 앱이 꺼졌습니다. 창을 닫으셔도 됩니다.
pause
