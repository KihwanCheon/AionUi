# Aion Android 알리미

Windows AionUi의 새 사용자 확인 요청과 미확인 오류를 개인 Android 휴대폰으로 받는 앱이다. 이 저장소의 개인 fork 기능이며, 기존 Expo 대화 앱(`mobile/`)과 별도로 빌드한다.

**처음 설치하는 사용자는 아래 1~5단계를 순서대로 진행한다.** 본인의 Firebase 프로젝트를 사용하며 개발자의 설정 파일이나 비밀키를 받을 필요가 없다. Windows AionUi가 실행 중이고 인터넷에 연결되어 있어야 한다. PC와 휴대폰이 같은 Wi-Fi에 있을 필요는 없다.

| 단계                   | 완료 기준                                                         |
| ---------------------- | ----------------------------------------------------------------- |
| 1. 도구 준비           | JDK와 Android SDK 명령이 실행됨                                   |
| 2. Firebase 준비       | 본인 프로젝트의 두 JSON 파일, 익명 인증, Firestore 규칙 준비 완료 |
| 3. Android 빌드·설치   | 휴대폰에 실제 수신용 `firebaseDebug` 앱 설치                      |
| 4. Windows AionUi 준비 | 확인 알림을 지원하는 fork 백엔드와 데스크톱 앱 실행               |
| 5. 연결·테스트         | QR 연결 후 Windows 테스트 푸시를 휴대폰에서 확인                  |

Firebase 없이 앱 화면과 로컬 알림만 확인하려면 1단계 후 아래의 **미리보기 빌드**를 사용한다. 로컬 규칙 테스트와 실제 Firebase 개발 검증은 필수 설치 과정 뒤에 따로 설명한다.

## 1. 저장소와 도구 준비

처음 저장소를 받는 경우 Windows PowerShell에서 실행한다. 이미 이 fork를 받은 사용자는 저장소 루트에서 `$aionUiRoot = (Get-Location).Path`만 설정한다. 이후 예제는 같은 PowerShell 창에서 이어 실행한다.

```powershell
git clone https://github.com/mabobsa/AionUi.git
Set-Location AionUi
$aionUiRoot = (Get-Location).Path
```

Android 빌드에 필요한 도구는 다음과 같다. 앱 폴더의 Gradle Wrapper가 빌드 도구 버전을 관리하므로 Gradle을 전역 설치하지 않아도 된다.

| 항목                 | 준비할 내용                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Android Studio       | 이 프로젝트의 AGP 8.10.0을 지원하는 버전                                                                                                                                 |
| JDK                  | Android 빌드 최소 17, 이 문서의 공통 예제와 로컬 규칙 테스트는 **JDK 21** 사용. Android Studio의 `jbr` 사용 가능                                                         |
| Android SDK          | SDK Manager에서 **Android SDK Platform 35**, **SDK Build-Tools 36.1.0**, **Platform-Tools** 설치 및 라이선스 동의                                                        |
| 휴대폰               | **Android 8.0 이상**, 실제 FCM 수신과 QR 스캔에는 **Google Play services** 필요                                                                                          |
| Windows 앱 개발 도구 | Node.js 22 이상, Bun, Rust stable·Cargo. 네이티브 모듈 빌드에 필요한 Python·MSVC 도구는 [공통 개발 환경 안내](../../docs/contributing/development.md#prerequisites) 참고 |

Android Studio의 **SDK Manager → SDK Tools → Show Package Details**에서 지정된 Build-Tools 버전을 선택할 수 있다. 기본 설치 위치를 사용한다면 다음과 같이 설정한다. 다른 위치에 설치했다면 SDK Manager와 Gradle JDK에 표시되는 실제 경로로 바꾼다.

```powershell
$env:JAVA_HOME = Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
java -version
adb version
```

`java -version`은 이 예제에서 **주 버전 21**을 표시해야 한다. Android Studio의 `jbr`가 다른 버전이거나 Unity 등에 포함된 오래된 JDK를 가리킨다면 설치한 JDK 21의 실제 경로로 `JAVA_HOME`과 `Path`를 수정한다. 설정은 이 PowerShell 창에 적용되므로 새 창을 열면 다시 설정하거나 Windows 사용자 환경 변수에 등록한다.

## 2. 본인의 Firebase 프로젝트 준비

### 프로젝트와 Android 설정 파일

1. [Firebase Console](https://console.firebase.google.com/)에서 알리미 전용 프로젝트를 만든다. **Spark 무료 요금제**로 시작할 수 있다. 이 기능은 FCM, 익명 Authentication, Firestore를 사용하며 Cloud Functions·Cloud Run 배포는 필요하지 않다. 서비스별 무료 한도는 [Firebase 요금표](https://firebase.google.com/pricing)를 확인한다.
2. 프로젝트 개요에서 **앱 추가 → Android**를 선택한다. Android 패키지 이름은 **`com.mabobsa.aionnotifier`**로 입력한다. 앱 닉네임은 자유롭게 정한다. 이 패키지 이름으로 본인의 Firebase 프로젝트에 새로 등록하면 된다.
3. `google-services.json`을 내려받아 **`packages/notifier-android/app/google-services.json`**에 저장한다. `.preview` 패키지를 등록하거나 Kotlin `namespace`를 바꿀 필요는 없다.
4. **Build → Authentication → 시작하기 → 로그인 방법**에서 **익명(Anonymous)**을 사용 설정하고 저장한다.
5. **Build → Firestore Database → 데이터베이스 만들기**에서 **Standard / Native mode**, 데이터베이스 ID **`(default)`**, 사용할 리전을 선택한다. 보안 모드는 **프로덕션 모드**로 시작한다. 현재 앱은 이름을 별도로 지정한 데이터베이스를 사용하지 않는다.
6. Firestore의 **규칙(Rules)** 탭에 [support/firestore.rules](support/firestore.rules)의 내용을 복사하고 **게시(Publish)**한다. 새 전용 프로젝트를 기준으로 한 규칙이며, 다른 앱의 기존 규칙에 그대로 덮어쓰는 용도는 아니다. `allow read, write: if true` 형태의 공개 규칙을 사용하지 않는다.
7. 프로젝트 설정의 **Cloud Messaging**에서 **Firebase Cloud Messaging API (HTTP v1)**가 활성 상태인지 확인한다. 필요하면 연결된 Google Cloud Console에서 해당 API를 사용 설정한다. Firestore API도 활성화되어 있어야 한다.

Android 등록은 [공식 Android 설정 안내](https://firebase.google.com/docs/android/setup), 익명 인증은 [공식 익명 인증 안내](https://firebase.google.com/docs/auth/android/anonymous-auth), 데이터베이스 준비는 [Firestore 시작 안내](https://firebase.google.com/docs/firestore/quickstart)를 참고할 수 있다.

### Windows 발송용 서비스 계정 키

1. 같은 Firebase 프로젝트의 **프로젝트 설정 → 서비스 계정 → Firebase Admin SDK**로 이동한다.
2. **새 비공개 키 생성(Generate New Private Key)**을 눌러 JSON 파일을 내려받는다.
3. 다음 명령으로 보관 폴더를 만들고, 내려받은 파일을 그 폴더에 **`firebase-service-account.json`**이라는 이름으로 저장한다.

```powershell
$firebaseDirectory = Join-Path $env:LOCALAPPDATA 'AionUiPush\firebase'
New-Item -ItemType Directory -Force -Path $firebaseDirectory | Out-Null
```

두 파일의 용도와 위치가 다르다.

| 파일                            | 용도                                                | 저장 위치                                                          |
| ------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------ |
| `google-services.json`          | 본인 Firebase 프로젝트에 연결하는 Android 빌드 설정 | `packages/notifier-android/app/google-services.json`               |
| `firebase-service-account.json` | Windows에서 Firestore와 FCM에 접근하는 비밀키       | `%LOCALAPPDATA%\AionUiPush\firebase\firebase-service-account.json` |

두 파일은 **같은 Firebase 프로젝트**의 것이어야 한다. 다음 검사는 프로젝트 ID만 출력하며 비밀키 본문을 출력하지 않는다.

```powershell
$androidProject = (Get-Content -Raw -LiteralPath "$aionUiRoot\packages\notifier-android\app\google-services.json" | ConvertFrom-Json).project_info.project_id
$senderProject = (Get-Content -Raw -LiteralPath "$firebaseDirectory\firebase-service-account.json" | ConvertFrom-Json).project_id
if (-not $androidProject -or -not $senderProject -or $androidProject -ne $senderProject) { throw '두 설정 파일의 Firebase 프로젝트 ID를 확인해 주세요.' }
Write-Output "프로젝트 일치: $senderProject"
```

서비스 계정 키는 APK·소스·Git에 넣지 않고 Windows에서만 사용한다. 저장소의 `.gitignore`는 두 JSON 파일을 제외한다. 별도 서비스 계정을 만들었다면 FCM 메시지 발송과 Firestore 데이터 읽기·쓰기 권한이 필요하다. 키 생성 절차는 [공식 FCM 인증 안내](https://firebase.google.com/docs/cloud-messaging/send/v1-api#provide_credentials_manually), 역할은 [FCM IAM](https://docs.cloud.google.com/iam/docs/roles-permissions/firebasecloudmessaging)과 [Firestore IAM](https://docs.cloud.google.com/firestore/native/docs/security/iam)을 참고한다. 규칙 게시를 위해 Windows 발송 계정에 규칙 관리 권한을 추가할 필요는 없다.

## 3. Android 앱 빌드·설치

### 실제 푸시 수신용 빌드

다음 명령은 **Android 앱 폴더**에서 실행한다. 실행 정책을 영구 변경하지 않고 이 저장소의 빌드 스크립트만 실행하는 예제다. Firebase 설정 파일이 없으면 실제 수신용 빌드는 명시적으로 실패한다.

```powershell
Set-Location "$aionUiRoot\packages\notifier-android"
powershell -NoProfile -ExecutionPolicy Bypass -File .\support\build.ps1 -Variant firebase -Verify
```

APK는 **`app/build/outputs/apk/firebase/debug/app-firebase-debug.apk`**에 생성된다. `-Verify`는 해당 변형의 단위 테스트와 Android 린트도 실행한다. Android Studio에서는 이 폴더를 열고 Build Variants에서 **`firebaseDebug`**를 선택해 실행해도 된다.

### 휴대폰 설치

APK를 휴대폰으로 옮겨 열고, Android가 요청하는 경우 해당 파일 앱의 **이 출처의 앱 설치 허용**을 설정해 설치한다. 또는 휴대폰의 개발자 옵션·USB 디버깅을 켜고 USB 연결 및 디버깅 인증을 완료한 뒤 다음 명령을 실행한다.

```powershell
adb devices
adb -d install -r .\app\build\outputs\apk\firebase\debug\app-firebase-debug.apk
```

`-d`는 USB 연결된 실기기를 대상으로 한다. 여러 기기를 연결했다면 `adb -s <기기ID> install -r <APK경로>`로 대상을 지정한다. 설치한 **Aion 알리미**에서 **알림 받기**를 켜고 Android 알림 권한을 허용한다.

개발용 APK는 빌드 PC의 debug 키로 서명된다. 같은 서명키로 빌드한 APK는 덮어 설치해 설정과 연결을 유지할 수 있다. 다른 PC에서 만든 APK나 다른 배포자의 APK는 서명이 달라 덮어 설치가 거부될 수 있다. 이 경우 기존 앱 제거·재설치 시 이력과 연결 정보가 초기화되므로 다시 연결해야 한다. 장기 사용·배포 시에는 같은 서명키를 보관해서 사용한다. 별도 릴리스 서명 자동화와 Play Store 배포는 현재 제공하지 않는다.

### Firebase 없는 미리보기 빌드

```powershell
Set-Location "$aionUiRoot\packages\notifier-android"
powershell -NoProfile -ExecutionPolicy Bypass -File .\support\build.ps1 -Variant preview -Verify
```

APK는 `app/build/outputs/apk/preview/debug/app-preview-debug.apk`다. `previewDebug`는 Firebase SDK를 포함하지 않아 설정 파일 없이 빌드할 수 있다. `.preview`가 붙은 별도 앱으로 설치되며, **테스트 알림**은 로컬 알림·이력·상세 화면 확인용이다. 실제 휴대폰 푸시 수신은 `firebaseDebug`에서만 가능하다.

## 4. Windows AionUi 최초 실행

**이 저장소의 데스크톱 코드와 확인 알림을 지원하는 AionCore fork가 함께 필요하다.** 일반 upstream 설치 파일에 이 기능이 포함되어 있다고 가정하지 않는다. 공통 개발 가이드의 필수 도구 설명은 참고하되, 아래 예제는 이 개인 fork 저장소를 사용한다.

2026-10-26 확인 기준은 AionUi [`ea751ad6d`](https://github.com/mabobsa/AionUi/commit/ea751ad6d), AionCore [`8959393d`](https://github.com/mabobsa/AionCore/commit/8959393d)다. 새 설치에는 두 fork의 관련 기능을 유지한 `main`을 사용한다. 이후 버전의 문제를 재현할 때는 이 검증 기준을 참고한다.

처음 준비하는 경우 AionUi와 AionCore를 형제 폴더로 두고 PowerShell에서 실행한다. 이미 AionCore를 받은 경우 기존 fork 폴더에서 설치 명령을 실행한다.

```powershell
Set-Location (Split-Path -Parent $aionUiRoot)
git clone https://github.com/mabobsa/AionCore.git
Set-Location AionCore
cargo install --path crates/aionui-app --locked --force
$cargoBin = if ($env:CARGO_HOME) { Join-Path $env:CARGO_HOME 'bin' } else { Join-Path $env:USERPROFILE '.cargo\bin' }
$env:Path = "$cargoBin;$env:Path"
where.exe aioncore
$env:AIONUI_BACKEND_BIN = (Get-Command aioncore -CommandType Application -ErrorAction Stop).Source
& $env:AIONUI_BACKEND_BIN --help

Set-Location $aionUiRoot
bun install
bun run start
```

`AIONUI_BACKEND_BIN`은 이 PowerShell 창에서 사용할 백엔드를 지정한다. 출력 경로가 방금 설치한 fork 바이너리인지 확인한다. AionUi가 백엔드를 자동으로 실행하므로 별도 백엔드 서버를 띄우지 않는다. 위 절차에는 저장소 외부의 개인용 배치 파일이 필요하지 않다.

기존에 호환되는 fork 백엔드를 사용 중이면 Firebase 설정이나 Android APK를 바꿀 때마다 AionCore를 다시 빌드할 필요는 없다. 새 데스크톱 코드를 반영하려면 AionUi를 완전히 종료한 뒤 다시 실행한다. 백엔드 코드를 갱신한 경우에는 위 `cargo install ... --force`도 다시 실행한다.

## 5. 휴대폰 연결·테스트

1. Windows AionUi의 **설정 → 시스템 → Android 푸시 알림**으로 이동한다.
2. **Firebase 서비스 계정 파일**에 2단계에서 저장한 키 파일 경로를 입력하고 **설정 불러오기**를 누른다. 표시되는 프로젝트가 Android 앱과 같은지 확인한다.
3. **휴대폰 푸시 사용**을 켠다. PC 이름은 휴대폰에서 구분하기 좋은 이름으로 정한다.
4. **휴대폰 연결**을 누르고, Aion 알리미의 연결 화면에서 QR을 스캔한다. 스캔 대신 Windows의 **코드 복사**로 복사한 JSON을 휴대폰에 붙여넣을 수도 있다. 코드는 10분간 유효하며 한 기기가 사용할 수 있다.
5. 연결되면 Windows에 휴대폰이 표시되고 QR이 닫힌다. 필요하면 **새로고침**을 누른다. 휴대폰의 **알림 받기**와 Android 알림 권한도 켜져 있어야 한다.
6. Windows의 해당 기기에서 **테스트 푸시**를 누르고 휴대폰 수신을 확인한다. 전송 접수 표시는 Firebase가 요청을 받아들였다는 뜻이며 휴대폰 도착까지 보장하는 표시는 아니다.
7. 새 사용자 확인 요청으로 자동 발송을 확인한다. 대화 이름·질문·선택지도 받고 싶다면 Windows의 **질문 미리보기 포함**을 켠다.

사용과 미리보기의 기본값은 모두 꺼짐이다. 미리보기를 켜면 대화 이름과 질문·선택지가 Firebase를 거쳐 휴대폰으로 전송된다. Windows 설정과 발송 이력은 AionUi 사용자별로 분리하며, 서비스 계정은 Windows 보안 저장소로 암호화한다. 키와 FCM 토큰을 renderer로 보내지 않는다.

앱 실행 전·활성화 전 알림은 새 푸시로 보내지 않는다. 일반 질문은 완료된 메시지를 기다리며, 구조화된 선택지 질문은 사용자의 답을 기다리는 상태에서도 전송한다. 변경된 본문은 같은 알림에 무음으로 반영하고 열람 상태를 유지한다. 이미 열었거나 알림 창에서 없앤 요청은 다시 띄우지 않는다. 과거에 짧게 받은 본문은 자동 복구하지 않는다.

사용자가 AionUi에서 해제한 대기 알림과 사용 설정을 끈 뒤의 대기 발송은 취소한다. 네트워크 오류는 최대 3회 시도하고 기기가 연결되지 않은 요청은 최대 15분 동안 연결을 기다린다. Android 절전·네트워크·강제 종료에 따라 수신이 늦어질 수 있다. 휴대폰에서 알림을 열거나 쓸어 없애도 AionUi의 확인 요청 자체는 해제되지 않는다.

Windows에서 **연결 해제**를 누르면 기기 등록과 연결 문서를 함께 삭제한다. Android 앱 재설치로 인증 UID가 바뀌면 새 QR로 다시 연결한다. 현재 Android 설치본은 하나의 PC 연결을 보관한다.

## 문제 해결

| 증상                                                  | 확인·조치                                                                                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JAVA_HOME` 오류 또는 Java 버전 오류                  | 1단계의 `JAVA_HOME`과 `Path`를 다시 설정하고 `java -version` 확인                                                                                                                     |
| SDK 위치 또는 Build-Tools 오류                        | `ANDROID_HOME`, SDK Platform 35, Build-Tools 36.1.0, SDK 라이선스 확인                                                                                                                |
| PowerShell 스크립트 실행이 차단됨                     | 위의 프로세스 단위 실행 명령 사용. 조직 정책으로도 차단되면 Android 앱 폴더에서 `./gradlew.bat :app:assembleFirebaseDebug :app:testFirebaseDebugUnitTest :app:lintFirebaseDebug` 실행 |
| `google-services.json` 누락 또는 `No matching client` | 파일 위치가 `app/google-services.json`인지, Firebase 등록 패키지가 `com.mabobsa.aionnotifier`인지 확인                                                                                |
| 실제 푸시 메뉴가 없음                                 | `previewDebug` 대신 `firebaseDebug` 설치 여부 확인. Windows 설정 메뉴라면 이 fork 코드로 실행한 Windows Electron 앱인지 확인하고 재시작. WebUI에서는 제공하지 않음                    |
| `aioncore`를 찾지 못하거나 확인 알림 API에서 404      | 4단계의 fork 백엔드 설치, `where.exe aioncore`, `AIONUI_BACKEND_BIN` 확인. 공통 upstream 백엔드와 혼용하지 않도록 실행 경로 확인                                                      |
| Windows의 서비스 계정 설정 불러오기 실패              | Android용 JSON과 서비스 계정 JSON을 혼동하지 않았는지, 파일 경로와 비공개 키 파일을 확인                                                                                              |
| QR 연결 실패·권한 오류                                | 두 JSON의 프로젝트 ID 일치, 익명 인증 활성화, Firestore `(default)`, 규칙 게시 여부 확인. 만료된 QR은 새로 생성                                                                       |
| Firebase 전송 또는 기기 조회 실패                     | FCM HTTP v1·Firestore API 활성화 및 해당 서비스 계정의 발송·데이터 접근 권한 확인. 규칙을 공개하는 방식으로 해결하지 않음                                                             |
| 테스트 전송은 접수됐지만 휴대폰에 없음                | Android 앱의 알림 받기, OS 알림 권한·채널, Google Play services, 인터넷·절전 제한 확인. PC가 실행 중인지 확인                                                                         |
| 로컬 테스트만 동작함                                  | 휴대폰의 테스트 알림은 Firebase를 거치지 않음. QR 연결 후 Windows에서 테스트 푸시 실행                                                                                                |
| 앱 설치 시 서명 충돌                                  | 기존 APK와 같은 서명키로 빌드. 다른 키로 재설치하면 기존 앱 제거와 재연결이 필요할 수 있음                                                                                            |
| 본문이 짧거나 예전 내용 그대로임                      | Windows 미리보기 설정, 새 APK 덮어 설치와 AionUi 재시작 확인. 새로 발생한 요청으로 검증                                                                                               |
| 알림을 열어도 Windows 확인 요청이 남음                | 정상 동작. AionUi에서 직접 답하거나 알림 해제                                                                                                                                         |

## 개발 검증

### 로컬 Firestore 규칙 테스트: Firebase 프로젝트·키 불필요

이 테스트의 에뮬레이터는 **Firebase Local Emulator Suite**이며 Android 에뮬레이터와 다르다. Node.js 22 이상과 JDK 21을 준비하고 1단계처럼 Java를 `Path`에 넣는다. 다음 명령은 전용 데모 프로젝트와 로컬 `127.0.0.1:18080`에만 연결하며 실제 Firestore를 사용하거나 규칙을 게시하지 않는다.

```powershell
Set-Location "$aionUiRoot\packages\notifier-android\support\rules-tests"
npm install --ignore-scripts --no-package-lock --workspaces=false
npm test --workspaces=false
```

테스트는 [로컬 설정](support/firebase.json)으로 Firestore 에뮬레이터를 실행하고 종료한다. 최초 실행에는 테스트 의존성과 에뮬레이터 다운로드를 위한 인터넷이 필요하다. 전역 Firebase CLI 설치나 `firebase login`은 필요하지 않다. 18080 포트를 다른 프로그램이 사용하면 해당 프로그램을 확인한 뒤 다시 실행한다.

현재 규칙 파일을 그대로 읽어 유효한 기기 등록·자기 기기 접근, 미인증 접근 차단, 다른 기기의 조회·삭제·재사용 차단, 만료된 연결과 PC ID 변조 차단, 목록 조회 차단, 등록 후 토큰 갱신·연결 해제를 검증한다. [공식 규칙 테스트 안내](https://firebase.google.com/docs/rules/unit-tests)를 참고할 수 있다. 이 검사는 실제 FCM 수신이나 Windows 설정 검증을 대신하지 않는다.

### 실제 Firebase 수신·Android 기기 테스트

개인 설치는 5단계의 수동 테스트로 충분하다. 자동 검증은 테스트 전용 Android 에뮬레이터에서 실행한다. Android Studio Device Manager에서 **Google Play 이미지**의 기기를 준비하고 `adb devices`로 확인한다. 실제 개인 휴대폰을 자동 검증 대상으로 사용하지 않는다.

두 PowerShell 창 모두 1단계의 Java·SDK 환경과 다음 작업 폴더를 설정한다. 새 창에서는 먼저 저장소 루트로 이동해 `$aionUiRoot = (Get-Location).Path`도 설정한다. 2단계의 실제 Firebase 파일과 게시된 규칙이 필요하다. 기본 테스트 기기는 `emulator-5554`이며 다른 에뮬레이터는 `$env:AION_NOTIFIER_TEST_DEVICE`와 `$env:ANDROID_SERIAL`을 같은 값으로 설정한다.

```powershell
Set-Location "$aionUiRoot\packages\notifier-android"
# 첫 번째 창: 수신 테스트가 준비되면 실제 FCM 발송
node support/verifyFirebasePush.mjs
```

```powershell
Set-Location "$aionUiRoot\packages\notifier-android"
$env:ANDROID_SERIAL = 'emulator-5554'
# 두 번째 창: 전경·백그라운드 수신 및 알림 선택 검증
./gradlew.bat :app:connectedFirebaseDebugAndroidTest '-Pandroid.testInstrumentationRunnerArguments.class=com.aionui.notifier.FirebasePushTest' '-Pandroid.testInstrumentationRunnerArguments.liveFcm=true'
```

도구는 지정한 테스트 앱 내부 파일에서만 FCM 토큰을 읽고 콘솔에 출력하지 않는다. 서비스 계정은 기본 외부 경로에서 읽는다. 기기 연결 검증 도구 `support/verifyFirebasePairing.mjs`는 `prepare` → `watch` → `cleanup` 순서로 쓰며 실제 프로젝트에 임시 자료를 만드는 개발용 도구다. 일반 설치에는 실행하지 않는다.

미리보기의 알림 선택 UI 검증은 테스트 기기를 연결한 뒤 `support/build.ps1 -Variant preview -Verify -DeviceTests`로 실행한다. Firebase 설정 없이 수신 코드 컴파일만 확인하려면 `./gradlew.bat :app:compileFirebaseDebugKotlin -x :app:preFirebaseDebugBuild`를 사용할 수 있다. 이 검사는 실제 연결·수신 검증을 대신하지 않는다.

## 연결과 푸시 계약

- 연결 QR 형식: [support/pairing.example.json](support/pairing.example.json). `pairingId`는 난수 32바이트의 Base64 URL 문자열이며 10분 유효하다. 예제의 ID와 시각은 실제 연결에 사용할 수 없다.
- Windows가 `pairings/{pairingId}`에 `sourceId`, `sourceName`, `expiresAt`(Firestore Timestamp), `claimedBy=null`을 만든다. Android는 익명 인증 후 트랜잭션으로 `claimedBy`와 `claimedAt`을 기록한다.
- `devices/{Firebase 인증 UID}`에는 `pairingId`, `sourceId`, `deviceName`, `fcmToken`, `enabled`, `updatedAt`을 저장한다. 토큰 변경은 네트워크 조건의 WorkManager 작업으로 재시도한다.
- 푸시 형식: [support/payload.example.json](support/payload.example.json). FCM HTTP v1의 **data 메시지**, Android 우선순위 `HIGH`, 만료 시간을 사용한다. `notification` 페이로드를 함께 쓰면 앱의 수신 설정·중복 방지·저장 경로를 우회할 수 있으므로 사용하지 않는다.
- `sourceId`와 `noticeId`는 같은 요청에서 유지하고, `revision`은 기기별 갱신 번호, `updatedAt`은 갱신 시각이다. 이전 번호나 같은 번호는 최신 본문을 덮어쓰지 않는다. 기존 페이로드는 갱신 번호 0으로 읽는다. `silent=true` 갱신은 알림음을 내지 않는다.
- `createdAt`, `expiresAt`은 Unix 밀리초 문자열이며 만료되거나 잘못된 요청은 표시하지 않는다. `conversationId`, `messageId`, `markerIndex`는 원래 요청의 위치다.
- 전체 데이터 JSON은 UTF-8 3,800바이트 이내로 맞추며 초과 본문에는 `…`를 붙인다. [FCM의 4,096바이트 한도](https://firebase.google.com/docs/cloud-messaging/customize-messages/set-message-type) 안에 여유를 두는 제한이다.
- 최근 알림 100개를 로컬 보관하며 내용 갱신은 항목 수와 열람 상태를 유지한다. 선택적인 `webUrl`은 접근 가능한 HTTPS 주소만 허용한다.

## 검증 기록

커밋된 Android 소스만 추출하고 Firebase 설정 파일을 제외한 복사본에서 미리보기 APK 빌드·단위 테스트 18개·린트가 통과했다. 기존 개발 환경의 SDK·Gradle 캐시를 사용한 검증이며 새 PC에 도구가 자동 설치된다는 뜻은 아니다.

문서 보완에서는 로컬 Firestore 규칙 테스트 6개, PowerShell 명령 예제의 구문 검사, 상대 링크 검사를 통과했다. 새로운 Firebase 프로젝트 생성과 실기기 설치는 이 로컬 검증에 포함하지 않았다.

실제 Firebase와 Android 에뮬레이터에서는 전경·백그라운드 수신, 알림 선택 후 상세 본문, 익명 기기 등록과 다른 기기 접근 차단을 확인했다. 별도 Electron 프로세스로 Windows 보안 저장소, QR 생성·기기 등록·발송·연결 해제도 확인했다. 본문 보완에서는 완료 전 발송 보류, 320자 이상 본문과 선택지 수신, 같은 알림의 무음 갱신을 확인했다. 실제 Firebase 검증에 만든 기기·연결·익명 계정은 검증 후 정리했다.
