@echo off
chcp 65001 >nul
setlocal

if "%~1"=="" (
  echo.
  echo  사용법
  echo    auto "https://기사링크"            링크 하나로 끝까지
  echo    auto 원문.txt                      기사 본문을 저장해 둔 파일로
  echo    auto "https://..." --dry-run       저장만 생략하고 확인
  echo    auto "https://..." --no-save       네이버는 건드리지 않고 초안까지만
  echo    auto "https://..." --force         하루 한도 무시
  echo.
  exit /b 1
)

node scripts\auto_post.js %*
exit /b %errorlevel%
