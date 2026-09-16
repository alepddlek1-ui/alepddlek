@echo off
chcp 65001 >nul
setlocal
set BRANCH=claude/magical-fermi-mzso3v
set REPO=https://github.com/alepddlek1-ui/alepddlek.git

echo.
echo  최신 버전을 받아옵니다...
echo.

if exist _tmp rmdir /s /q _tmp
git clone -b %BRANCH% --depth 1 %REPO% _tmp
if errorlevel 1 goto err

rem 툴 본체만 덮어쓴다 (/Y = 묻지 않고 덮어쓰기)
xcopy /Y /E /I /Q "_tmp\naver-blog\scripts"  "scripts"  >nul
xcopy /Y /E /I /Q "_tmp\naver-blog\.claude"  ".claude"  >nul
xcopy /Y /E /I /Q "_tmp\naver-blog\tests"    "tests"    >nul
xcopy /Y /E /I /Q "_tmp\naver-blog\prompts"  "prompts"  >nul
xcopy /Y /Q "_tmp\naver-blog\auto.cmd"       "."        >nul
xcopy /Y /Q "_tmp\naver-blog\CLAUDE.md"      "."        >nul
xcopy /Y /Q "_tmp\naver-blog\README.md"      "."        >nul
xcopy /Y /Q "_tmp\naver-blog\사용법.md"      "."        >nul
xcopy /Y /Q "_tmp\naver-blog\package.json"   "."        >nul

rem 초안 JSON 도 같이 받는다 (검증 산출물 .dump.txt / .png 는 건드리지 않는다)
if exist "_tmp\naver-blog\drafts" xcopy /Y /Q "_tmp\naver-blog\drafts\*.json" "drafts\" >nul

for /f "delims=" %%v in ('node -e "const m=require('fs').readFileSync('scripts/naver_draft.js','utf8').match(/BUILD = '([^']+)'/);console.log(m?m[1]:'unknown')"') do set NBVER=%%v
echo.
echo  완료했습니다.  (설치된 버전: %NBVER%)
echo  data\ 폴더(내 블로그 정보)와 사진·영상은 건드리지 않았습니다.
echo.

rem 맨 마지막: update.cmd 자신도 갱신한다.
rem 실행 중인 배치 파일을 덮어쓰기 때문에 반드시 다른 작업이 모두 끝난 뒤에 한다.
xcopy /Y /Q "_tmp\naver-blog\update.cmd" "." >nul
rmdir /s /q _tmp
exit /b 0

:err
echo.
echo  실패: git clone 이 되지 않았습니다. 인터넷 연결을 확인해 주세요.
echo.
if exist _tmp rmdir /s /q _tmp
exit /b 1
