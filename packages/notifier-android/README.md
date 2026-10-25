# Aion Android 알리미

Windows AionUi의 사용자 확인 요청을 받는 개인용 Android 앱이다. 기존 Expo 대화 앱(`mobile/`)과 별도로 빌드한다. Android 8.0 이상을 지원하고, 사용자 문구는 한국어·영어 문자열 리소스로 관리한다.

## Firebase 준비 전

Android Studio에서 이 폴더를 열고 `previewDebug`를 선택한다. 또는 Windows에서 다음 명령을 실행한다.

```powershell
./support/build.ps1 -Verify
```

미리보기 APK는 `app/build/outputs/apk/preview/debug/app-preview-debug.apk`에 생성된다. 앱의 **알림 받기**는 기본으로 꺼져 있다. 켜고 Android 알림 권한을 허용한 뒤 **테스트 알림**을 누르면 알림과 받은 알림 목록을 확인할 수 있다. 알림을 누르면 해당 요청의 상세 화면이 열린다. 로컬 테스트는 Firebase를 거치지 않는다.

에뮬레이터나 테스트 기기가 연결되어 있으면 `-DeviceTests`로 실제 알림 선택까지 확인한다. 개발용 APK는 debug 키로 서명되며, 개인 배포용 서명키와 릴리스 APK는 별도 준비한다.

## Firebase 준비 후

1. Firebase Console에서 Android 앱을 등록한다. **패키지 이름은 `com.mabobsa.aionnotifier`**이다. 미리보기의 `.preview` 접미사는 등록하지 않는다.
2. 받은 Android 설정 파일을 `app/google-services.json`에 둔다. 이 파일은 Git에서 제외한다.
3. Authentication의 익명 로그인을 활성화하고 Firestore를 준비한다.
4. `support/firestore.rules`를 프로젝트에 맞게 검토하고 에뮬레이터에서 검증한 뒤 게시한다. 테스트 모드로 공개하지 않는다.
5. `./support/build.ps1 -Variant firebase -Verify`로 실제 수신용 APK를 빌드한다.
6. Windows 발송기의 기기 연결 화면과 연결하여 실기기에서 푸시를 검증한다.

앱에 서비스 계정 비밀키를 넣지 않는다. 서비스 계정은 Windows 발송기에서만 사용한다. Firebase 프로젝트가 준비되지 않으면 실제 수신 버전의 APK 빌드는 명시적으로 실패한다. 미리보기는 Firebase SDK를 포함하지 않아 설정 없이 실행된다.

## 연결 계약

`support/pairing.example.json`이 QR에 넣을 JSON 형식이다. Windows에서 `pairingId`를 암호학적 난수 32바이트의 Base64 URL 문자열로 생성한다. QR은 최대 10분간 유효하고, 모든 시각은 Unix 밀리초다. 예제의 ID·시각은 실제 연결에 사용할 수 없다.

Windows가 서비스 계정으로 `pairings/{pairingId}`에 다음 문서를 만든다.

- `sourceId`: Windows 설치본의 고유 ID
- `sourceName`: 휴대폰에 표시할 PC 이름
- `expiresAt`: Firestore Timestamp
- `claimedBy`: `null`

Android는 익명 인증 후 트랜잭션으로 `claimedBy`와 `claimedAt`을 기록한다. 다른 앱 설치본이 이미 사용한 연결은 거부한다. `devices/{Firebase 인증 UID}`에는 `pairingId`, `sourceId`, `deviceName`, `fcmToken`, `enabled`, `updatedAt`만 저장한다. 토큰 변경은 네트워크 연결 조건의 WorkManager 작업으로 재시도한다. 재설치로 앱 인증 UID가 바뀌면 다시 연결한다.

Windows 발송기는 자신의 사용 설정과 연결된 기기의 `enabled`를 모두 검사한다. 푸시 설정과 기기 연결 ID는 AionUi 사용자별로 나누고, 서비스 계정은 Electron main의 Windows 보안 저장소로 암호화한다. 키와 FCM 토큰을 renderer로 보내지 않는다.

## Windows AionUi 연결

1. 변경된 AionUi를 다시 실행하고 **설정 → 시스템 → Android 푸시 알림**으로 이동한다. AionCore 재빌드는 필요하지 않다. 개발 실행은 저장소 상위의 `run-aionui-dev-no-sentry.bat`을 사용한다.
2. **Firebase 서비스 계정 파일**의 기본 경로 `%LOCALAPPDATA%/AionUiPush/firebase/firebase-service-account.json`을 확인하고 **설정 불러오기**를 누른다. 다른 프로젝트의 키를 불러오면 푸시는 다시 꺼진다.
3. **휴대폰 푸시 사용**을 켜고 **휴대폰 연결**을 누른다. Android의 **알림 받기**와 알림 권한도 켜야 한다.
4. Aion 알리미의 연결 화면에서 QR을 스캔하거나 **코드 복사**로 복사한 JSON을 붙여넣는다. 연결 코드는 10분 동안 한 기기만 사용할 수 있다. 연결되면 Windows의 QR은 닫히고 휴대폰이 목록에 표시된다.
5. 해당 휴대폰의 **테스트 푸시**를 누른다. 전송 접수 표시는 Firebase가 요청을 받아들였다는 뜻이며, 휴대폰 수신 여부는 휴대폰에서 확인한다.

사용 설정 이후 새로 생긴 확인 요청과 미확인 오류를 전송한다. 앱 실행 전·활성화 전 알림은 전송하지 않는다. 사용자가 해제한 대기 알림과 사용 설정을 끈 뒤의 대기 발송은 취소한다. 같은 요청의 전송 결과를 기기별로 저장해 재시도·화면 재마운트 때 중복을 방지한다. 네트워크 오류는 최대 3회 시도하고, 기기가 아직 연결되지 않은 요청은 최대 15분 동안 연결을 기다린다.

기본값은 사용 꺼짐, 질문 미리보기 꺼짐이다. 기본 푸시는 공통 안내만 포함한다. **질문 미리보기 포함**을 켜면 대화 이름과 완료된 질문의 문단·선택지를 전송한다. 일반 텍스트 질문은 저장된 메시지가 완료될 때까지 기다리고, 구조화된 선택지 질문은 사용자의 답을 기다리는 상태에서도 전송한다. **연결 해제**는 해당 기기 등록과 연결 문서를 함께 삭제한다. WebUI에서 키 불러오기나 발송 설정을 조작할 수 없으며 Windows 앱의 전용 IPC만 허용한다.

같은 요청의 내용이 바뀌면 `noticeId`를 유지한 채 더 높은 `revision`으로 갱신한다. Android는 본문을 같은 보관 항목에 반영하고, 이미 열었거나 알림 창에서 없앤 요청을 다시 띄우지 않는다. 표시 중인 알림의 갱신은 소리 없이 처리한다. 이 처리는 새 APK 설치와 AionUi 재시작 후의 요청부터 적용되며, 과거에 수신한 짧은 본문을 자동으로 복구하지 않는다.

## 푸시 계약

`support/payload.example.json`은 FCM `message.data`에 넣는 문자열 맵이다. Windows는 FCM HTTP v1의 **data 메시지**로 보내고 Android 우선순위 `HIGH`와 만료 시간을 설정한다. `notification` 페이로드를 함께 넣으면 백그라운드에서 OS가 직접 표시해 앱의 수신 설정·중복 방지·저장 경로를 우회하므로 이 계약에서는 사용하지 않는다.

- `sourceId`와 `noticeId`는 동일한 요청에 대해 재전송되어도 유지한다.
- `createdAt`, `expiresAt`은 Unix 밀리초 문자열이다. 만료되거나 잘못된 요청은 표시하지 않는다.
- `revision`은 기기별 갱신 번호이고 `updatedAt`은 갱신 시각이다. 이전 번호나 같은 번호가 늦게 도착해도 최신 본문을 덮어쓰지 않는다. 기존 페이로드는 갱신 번호 0으로 읽는다.
- `silent=true`인 갱신은 알림음을 내지 않는다. 전송한 내용의 지문이 같으면 재전송하지 않는다.
- 고정 320자 절단 대신 전체 데이터 JSON을 UTF-8 3,800바이트 이내로 맞춘다. 한도를 넘는 본문에는 `…`를 붙인다. 이는 [FCM의 4,096바이트 페이로드 한도](https://firebase.google.com/docs/cloud-messaging/customize-messages/set-message-type) 안에 여유를 두는 제한이다.
- `conversationId`, `messageId`, `markerIndex`는 원래 확인 요청의 위치다.
- 선택적인 `webUrl`은 접근 가능한 HTTPS 대화 주소만 허용한다.
- 받은 알림은 최근 100개를 로컬 보관한다. 같은 내용의 재수신은 무시하며 본문 갱신은 항목 수와 열람 상태를 유지한다.
- 휴대폰 알림을 열거나 쓸어 없애도 AionUi 확인 요청의 상태는 변경하지 않는다.

Android 절전·네트워크·강제 종료 상태에 따라 수신이 지연될 수 있다. 실제 개인 휴대폰의 수신 상태는 Windows의 테스트 푸시로 확인한다.

## 검증

미리보기의 단위 테스트는 기본 비활성 상태, 재시작 후 중복 방지, PC별 요청 구분, 열람 상태 보존, 최대 보관 개수, 만료·잘못된 페이로드·외부 링크 거부, 연결 코드 만료, 알림 클릭 대상 보존을 확인한다. 기기 테스트는 수신 사용 설정과 로컬 테스트 알림의 상세 화면 이동을 확인한다.

실제 Firebase 프로젝트로 Android 에뮬레이터의 전경·백그라운드 푸시 수신, 알림 선택 후 상세 화면 이동, 익명 인증 기반 기기 연결을 확인했다. 다른 기기 조회·기기 목록 조회·등록된 PC ID 변조가 차단되는 것도 확인했다. 검증용 연결 문서·기기 등록·이번 검증에서 만든 익명 계정은 검증 후 정리했다.

Windows의 실제 Electron 보안 저장소와 발송 모듈로도 연결 코드 생성 → Android 기기 등록 → 새 확인 요청 전송 → Android 수신 → 연결 해제·목록 재조회를 확인했다. 테스트는 별도 Electron 사용자 데이터와 테스트용 Android 에뮬레이터를 사용했다.

본문 보완에서는 작성 중인 질문의 발송 보류, 320자를 넘는 한글·선택지 수신, 같은 알림의 무음 갱신과 상세 이동을 실제 Windows 발송 모듈 및 Firebase와 Android 에뮬레이터로 확인했다. 단위 테스트는 이전 갱신 번호의 재수신 거부, 열람 상태 유지, 사용자가 없앤 알림의 재등장 방지도 검증한다.

실제 푸시 검사를 다시 실행하려면 테스트 전용 에뮬레이터에서 `support/verifyFirebasePush.mjs`를 실행하고, 다른 터미널에서 다음 명령을 실행한다. 도구는 지정한 에뮬레이터의 테스트 앱 내부 파일에서만 등록 토큰을 읽고 콘솔에 출력하지 않는다.

```powershell
node support/verifyFirebasePush.mjs
# 다른 터미널에서 실행
./gradlew.bat :app:connectedFirebaseDebugAndroidTest '-Pandroid.testInstrumentationRunnerArguments.class=com.aionui.notifier.FirebasePushTest' '-Pandroid.testInstrumentationRunnerArguments.liveFcm=true'
```

이 검증 도구는 `%LOCALAPPDATA%/AionUiPush/firebase/firebase-service-account.json`을 사용한다. 키 파일은 앱·Git·로그에 포함하지 않는다. 기기 연결 검증 도구 `verifyFirebasePairing.mjs`의 `prepare` → `watch` → `cleanup`은 검증용 문서를 만들고 정리하므로 테스트 환경에서만 사용한다. 재검증 전에는 테스트 앱의 이전 연결 데이터를 비운다.

서비스 계정에 규칙 관리 권한이 없으면 Firebase Console의 Firestore 규칙 편집기에서 `support/firestore.rules`를 게시한다. FCM 발송과 기기 등록에는 규칙 관리 권한이 필요하지 않다.

Firebase 설정 없이 SDK 연결 코드의 컴파일만 확인할 때는 `./gradlew.bat :app:compileFirebaseDebugKotlin -x :app:preFirebaseDebugBuild`를 사용한다. 이 검사는 실제 Firebase 연결·전달 검증을 대신하지 않는다.
