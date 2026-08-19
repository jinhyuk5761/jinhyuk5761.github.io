@echo off
chcp 65001 >nul
REM  allow-lan.bat 이 만든 방화벽 구멍을 도로 막는다.
REM  사용법: 오른쪽 클릭 - "관리자 권한으로 실행"

net session >nul 2>&1
if %errorLevel% neq 0 (
  echo [!] 관리자 권한이 필요합니다.
  pause
  exit /b 1
)

netsh advfirewall firewall delete rule name="pokemon-champions-meta dev (5173)"
echo.
echo [OK] 5173 포트를 도로 막았습니다.
pause
