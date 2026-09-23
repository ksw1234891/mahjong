@echo off
chcp 65001 >nul
rem 혼자 리치마작: 이 창을 켜 둔 동안 http://localhost:8765 에서 게임이 열립니다.
cd /d "%~dp0"
start "" http://localhost:8765/
echo 게임 서버 실행 중: http://localhost:8765/
echo 끝내려면 이 창을 닫으세요.
python -m http.server 8765 --directory public
pause
