# Android 앱 (TWA)

웹 앱을 그대로 감싸는 껍데기다. 화면과 로직은 전부 https://jinhyuk5761.github.io 에서
오므로, **앱을 다시 올리지 않아도 사이트를 배포하면 앱 내용이 바뀐다.**
앱을 새로 빌드해야 하는 경우는 아이콘·이름·패키지 설정을 바꿀 때뿐이다.

| | |
|---|---|
| 패키지명 | `com.metamon.championsmeta` |
| 원본 사이트 | https://jinhyuk5761.github.io |
| 서명 키 | `~/.android-keys/champions-meta.keystore` (**저장소 밖**, 별칭 `champions-meta`) |
| 업로드 키 SHA-256 | `C7:96:56:FC:0E:9B:7F:92:6D:7B:30:C9:27:B7:6D:CB:A0:DD:EA:84:57:21:AB:C0:7B:A1:82:E2:DC:67:31:00` |

## 빌드

```powershell
cd android
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:JAVA_HOME    = "C:\jdk21"          # 공백 없는 경로여야 한다 (아래 참고)
$env:PATH         = "$PWD;$env:PATH"    # gradlew.bat 를 찾게 한다 (아래 참고)
$pw = (Select-String -Path "$HOME\.android-keys\README.txt" -Pattern '^비밀번호 : (.+)$').Matches[0].Groups[1].Value.Trim()
$env:BUBBLEWRAP_KEYSTORE_PASSWORD = $pw
$env:BUBBLEWRAP_KEY_PASSWORD      = $pw

bubblewrap build --skipPwaValidation
```

산출물: `app-release-bundle.aab` (Play 업로드용) · `app-release-signed.apk` (직접 설치·테스트용)

### 환경 설정에서 걸렸던 것 세 가지

이 세 개는 Bubblewrap 쪽 문제라 환경을 맞춰서 우회했다. 다시 세팅할 때 또 만난다.

1. **Android SDK 검사가 낡았다.** `<SDK>/tools` 나 `<SDK>/bin` 이 있어야 통과하는데
   요즘 SDK 는 `cmdline-tools/latest/bin` 에 둔다.
   → `mklink /J "<SDK>\bin" "<SDK>\cmdline-tools\latest\bin"`
2. **JDK 경로에 공백이 있으면 서명이 깨진다.** apksigner 를 부를 때 인용을 안 해서
   `C:\Program Files\...` 가 `C:\Program` 에서 잘린다.
   → `mklink /J C:\jdk21 "C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot"`
3. **`gradlew.bat` 를 `.\` 없이 부른다.** Windows 는 현재 폴더를 PATH 로 안 봐서 못 찾는다.
   → 빌드 전에 `$env:PATH = "$PWD;$env:PATH"`

`bubblewrap init` / `update` 는 대화형 질문을 하므로, 설정은 `twa-manifest.json` 을
직접 고치고 `bubblewrap update --skipVersionUpgrade` 로 반영한다.

## Play 콘솔에 올린 뒤 반드시 할 일

**Play 앱 서명을 쓰면 구글이 자기 키로 다시 서명한다.** 그래서 기기에서 실제로 검증되는
지문은 우리 업로드 키가 아니라 **구글의 앱 서명 키** 지문이다. 이걸 추가하지 않으면
앱이 주소창(Custom Tabs)이 보이는 채로 뜬다 — TWA 가 아니라 그냥 브라우저처럼 보인다.

1. AAB 업로드 → Play 콘솔 **설정 → 앱 서명** 으로 이동
2. **앱 서명 키 인증서**의 SHA-256 지문 복사
3. `public/.well-known/assetlinks.json` 의 `sha256_cert_fingerprints` 배열에 **추가**
   (업로드 키 지문은 지우지 말 것 — 로컬 APK 테스트에 쓴다)
4. 커밋·푸시하면 자동 배포된다
5. 앱을 다시 설치해 주소창이 사라졌는지 확인

```json
"sha256_cert_fingerprints": [
  "C7:96:...:00",           // 업로드 키 (로컬 테스트용)
  "<Play 앱 서명 키 지문>"   // ← 업로드 후 여기에 추가
]
```

## 버전 올리기

`twa-manifest.json` 의 `appVersion`(표시용)과 `appVersionCode`(정수, 매번 증가)를 고친 뒤
`bubblewrap update --skipVersionUpgrade` → `bubblewrap build`.

## 서명 키 주의

`~/.android-keys/` 를 **백업해 두어야 한다.** 잃어버리면 같은 앱의 업데이트를 올릴 수 없다.
(Play 콘솔에서 업로드 키 재설정은 가능하지만 절차가 번거롭다.)
저장소에는 절대 넣지 않는다 — `.gitignore` 로도 막아 뒀다.
