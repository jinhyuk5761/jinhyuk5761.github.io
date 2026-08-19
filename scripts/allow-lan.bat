@echo off
chcp 65001 >nul
REM ---------------------------------------------------------------------------
REM  같은 와이파이의 폰에서 개발 서버(npm run dev:lan)에 접속할 수 있게 한다.
REM
REM  Windows 는 네트워크가 'Public' 이면 들어오는 접속을 기본 차단한다.
REM  이 파일은 그 차단에 구멍을 하나만 낸다:
REM    - TCP 5173 포트 하나
REM    - 같은 서브넷(집 와이파이) 에서 오는 접속만
REM  인터넷 전체에 여는 것이 아니다.
REM
REM  사용법: 이 파일을 마우스 오른쪽 클릭 → "관리자 권한으로 실행"
REM  되돌리기: scripts\block-lan.bat
REM ---------------------------------------------------------------------------

net session >nul 2>&1
if %errorLevel% neq 0 (
  echo [!] 관리자 권한이 필요합니다.
  echo     이 파일을 오른쪽 클릭 - "관리자 권한으로 실행" 을 눌러 주세요.
  pause
  exit /b 1
)

netsh advfirewall firewall delete rule name="pokemon-champions-meta dev (5173)" >nul 2>&1
netsh advfirewall firewall add rule ^
  name="pokemon-champions-meta dev (5173)" ^
  dir=in action=allow protocol=TCP localport=5173 ^
  remoteip=localsubnet profile=private,public

if %errorLevel% equ 0 (
  echo.
  echo [OK] 5173 포트를 같은 와이파이에만 열었습니다.
  echo      이제 PC 에서 npm run dev:lan 을 켜고, 폰 브라우저에서 접속하세요.
  echo.
  ipconfig ^| findstr /C:"IPv4"
  echo.
  echo      위 주소 중 192.168.x.x 뒤에 :5173 을 붙이면 됩니다.
) else (
  echo [!] 규칙 추가에 실패했습니다.
)
pause
