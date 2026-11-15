# 감자 작전본부 Android 앱

웹앱(`../web`)을 WebView에 띄우고, Pleos Connect SDK 이벤트를 차량 신호로 바꿔 넘기는 껍데기다. 화면과 로직은 웹앱이 그대로 맡는다.

## 신호가 오는 길

| 웹앱이 받는 신호 | Pleos SDK | 조건 |
| --- | --- | --- |
| 탑승 | Vehicle SDK `Gear.getCurrentGearSelectionState` | 앱이 켜졌을 때 기어가 P |
| 출발 | Vehicle SDK `GearSelectionListener.onSelected` | 기어가 P에서 벗어남 |
| 정체 진입 | NaviHelper SDK `getRouteStateInfo` → `TrafficStatus.congestionItemList` | SLOW 이상인 정체 구간이 200m 안, 15초 간격으로 두 번 연속. 에뮬레이터에서는 만들 수 없어 앱의 "시험 값" 버튼으로 넣는다 |
| 정체 해소 | 위와 같음 | 가까운 정체 구간이 두 번 연속 없음 |
| 주차 | Vehicle SDK `GearSelectionListener.onSelected` | 기어가 P로 돌아옴 |

- 주행 지도: NaviHelper `onTBTInfo`(다음 회전들의 종류와 거리), `onCautionPointInfo`(SPEED_BUMP까지 남은 거리), `onRouteStateInfo`(앞쪽 정체 구간), `onDestinationInfo`(남은 거리와 시간)를 5초마다 물어 웹앱으로 넘긴다. 웹앱이 이 값으로 길의 모양을 만들어 약도로 그린다. 지도 그림이나 경로 좌표는 받지 않는다.
- 가속도 센서: `MotionSensor.kt`가 Android `SensorManager`의 가속도 센서(없으면 보정 전 가속도 센서) 값을 1초에 15번쯤 넘긴다. 커피 운송작전의 컵이 받는 힘으로 쓴다. 센서가 없으면 웹앱이 길의 모양과 속도로 계산한다.
- 출발지 이름: NaviHelper `onCurrentLocationInfo`의 주소에서 동네 이름만 꺼낸다. 위도와 경도는 쓰지 않는다.
- 목적지 이름: NaviHelper `onRouteStarted`, `onDestinationArrived`.
- 감자 음성: TextToSpeech SDK. 아래 "감자 음성" 참고.
- 말로 묻기: SpeechToText SDK. 주차 중(기어 P)에 커피 운송작전의 컵을 묻고 대답을 한 번 듣는다. 아래 "말로 묻기" 참고.
- Pleos 서비스가 없는 기기에서는 연결에 실패하고, 웹앱이 시뮬레이터로 동작한다.

코드는 `app/src/main/java/com/gamjahq/app/`에 있다. `PleosSignals.kt`가 SDK를 다루고, `GearTracker.kt`, `CongestionDetector.kt`, `AreaName.kt`, `SpeechQueue.kt`, `ListenFlow.kt`는 SDK 없이 테스트되는 순수 로직이다. `WebBridge.kt`는 웹앱의 `src/native/host.ts`와 짝을 이룬다.

## 감자 음성

TextToSpeech SDK에는 세 가지 모드가 있다. HYBRID가 SDK의 기본값으로, 서버 음성을 먼저 쓰고 네트워크가 안 되면 차량 내장 엔진으로 넘어간다. 서버 음성을 쓰려면 Pleos Playground에서 받은 자격 증명으로 앱을 등록해야 한다.

- 자격 증명이 **없으면** ON_DEVICE 모드로 차량 내장 엔진만 쓴다. 지금 저장소의 APK가 이 상태다.
- 자격 증명이 **있으면** HYBRID 모드로 앱을 등록해 서버 음성을 쓴다.

자격 증명 넣는 법:

1. developers.pleos.ai 에 로그인해 Workspace → My Project → 프로젝트 생성.
2. 프로젝트 정보의 SDK 항목에서 클라이언트 ID와 클라이언트 시크릿을 확인한다.
3. `android/local.properties`에 두 줄을 적고 다시 빌드한다. 이 파일은 저장소에 올라가지 않는다.

```
pleos.clientId=...
pleos.clientSecret=...
```

Pleos 문서는 모드별 음질 차이를 설명하지 않는다. 서버 음성이 내장 엔진보다 자연스러운지는 에뮬레이터에서 들어 보고 판단해야 한다. 음성 종류를 고르는 `setSpeakerType`도 있지만 허용 값이 문서에서 확인되지 않아 쓰지 않았다.

## 말로 묻기

커피 운송작전을 주차 중에 켜면 감자가 "오늘은 어떤 커피 실었어? 브랜드랑 사이즈를 말해 줘." 하고 묻고, 운전자의 대답을 SpeechToText SDK(3.3.1)로 한 번 듣는다. 웹앱이 들은 문장에서 브랜드, 크기, 뜨거운지 차가운지, 뚜껑을 찾아 한 번에 고를 수 있게 보여준다. 코드는 `VoiceInput.kt`(SDK와 타이머)와 `ListenFlow.kt`(순서와 끝내는 규칙, 단위 테스트)다.

- **기어 P에서만 듣는다.** 기어를 모르거나 P가 아니면 듣지 않는다. 기다리거나 듣는 중에 P를 벗어나면 곧바로 마이크를 닫고, 그때까지 들은 말도 버린다(`not-parked`).
- **질문도 기어 P에서만 한다.** 웹은 질문을 `speakWhileParked(text)`로 넘긴다. 네이티브는 기어 P를 확인했을 때만 말하고, 기어가 P를 벗어나면 출발 신호를 웹에 보내기 전에 기다리던 질문을 버리고 하던 질문은 멈춘다(`SpeechQueue.dropParkedOnly`). 웹이 묻기를 그만두면(출발, 커피 운송작전 끔, "묻지 않기") `unspeak(text)`로 그 질문을 거둔다. 상태 메시지(`status`)의 `parked`가 기어 P 확인이고, 기어가 바뀔 때마다 다시 보낸다. 웹은 `parked`가 true일 때만 묻는다.
- **앱 화면이 앞에 있을 때만 듣는다.** 화면이 가려지면(`onPause`: 내비 전체 화면, 다른 앱) 기다리거나 듣던 것을 그만두고 들은 말을 버린 뒤 `paused`를 보낸다. 가려진 동안 온 `listen()`도 `paused`로 끝낸다. 감자의 목소리와 WebView는 멈추지 않는다(내비가 앞에 있어도 주행 안내는 이어져야 한다).
- **감자의 말이 끝난 뒤에 마이크를 연다.** 질문은 웹이 보통 말로 넘기고 이어서 `listen`을 부른다. 하던 말과 기다리는 말이 모두 끝나고 0.4초 뒤에 연다. 감자의 말이 15초 넘게 이어지면 그래도 연다.
- **8초 안에 끝난다.** 마이크를 연 뒤 8초가 지나거나, SDK가 말이 끝났다고 알리고 2초 안에 최종 결과가 오지 않으면, 그때까지 들은 말을 최종 결과로 보낸다. 들은 말이 없으면 `timeout`이나 `no-speech`.
- **마이크는 Pleos 음성 서비스가 연다.** 앱은 `pleos.car.permission.STT_SERVICE`만 선언하고 `RECORD_AUDIO`는 쓰지 않는다(SDK 매니페스트와 문서 기준). 이 권한이 없으면 SDK의 모든 호출이 `SecurityException`을 던진다.
- **모드**: 자격 증명이 없으면 ON_DEVICE(차량 내장 엔진), 있으면 HYBRID로 앱을 등록한다. TextToSpeech와 같은 자격 증명이다. 언어는 `Locale.KOREA`.
- 들은 문장은 웹으로만 넘기고 저장하지 않는다. 릴리스 로그와 "Pleos 연동" 화면 로그에도 문장은 남기지 않는다.

웹 → 네이티브: `window.PleosHost.listen()`, `window.PleosHost.stopListening()`, 질문 `speakWhileParked(text)`, 거두기 `unspeak(text)`. 네이티브 → 웹은 다른 메시지와 같은 `window.gamjaHq.receive(json)`이다.

```
{"type":"stt","state":"listening"}                       마이크가 열렸다
{"type":"stt","state":"partial","text":"스타벅스 그란"}    중간 결과 (같은 말은 다시 보내지 않는다)
{"type":"stt","state":"final","text":"스타벅스 그란데 아이스"}
{"type":"stt","state":"error","error":"not-parked"}      error: not-parked | unavailable | timeout | no-speech | cancelled | paused | recognizer
{"type":"stt","state":"error","error":"recognizer","detail":"MIC_ERROR"}   detail: SDK의 ErrorType 이름
```

받아들인 `listen()` 하나는 `final`이나 `error` 하나로 끝난다(앱이 닫힐 때만 빼고). 듣는 중에 다시 `listen()`을 부르면 `listening`만 다시 온다. `stopListening()`은 `error: cancelled`로 끝낸다. 상태 메시지(`status`)에 `stt`(SDK 준비), `sttServer`(서버 인식 등록), `parked`(기어 P 확인)가 붙는다.

웹 쪽 짝은 `web/src/native/hostSpeech.ts`(메시지 읽기)와 `web/src/app/cupQuestion.ts`(커피 묻기)다. 웹 테스트(`hostSpeech.test.ts`)가 이 파일의 상수(`ListenFlow.kt`)와 `WebBridge.kt`의 키 이름을 읽어 웹과 같은지 본다. 웹은 `listen()`을 부른 뒤 끝날 때까지 감자의 보통 말을 미룬다. 웹은 받기를 끊은 뒤 `stopListening()`을 부르므로, 웹에 오는 `cancelled`는 지난 듣기의 늦은 대답으로 보고 버린다. `not-parked`가 오면 0.5초 기다려, 출발 때처럼 곧이어 출발 신호가 오면 멈추고, 그래도 웹이 주차 중이라고 알면(기어를 모를 때) 칩으로만 고르게 한다(차가 움직이는 중일 수 있어 글로 적는 칸은 열지 않는다). `paused`가 오면 다시 말하기를 권한다. 앱 안의 웹은 WebView의 Web Speech API를 쓰지 않는다(네이티브의 기어 P 확인을 거치지 않기 때문이다). SpeechToText SDK가 없으면 글로 적는다.

## 빌드

웹앱을 먼저 빌드해야 한다. Gradle이 `web/dist`를 APK의 `assets/web`으로 묶는다.

```bash
cd web && npm run build
```

```bash
cd android && ./gradlew testDebugUnitTest assembleDebug
```

APK는 `app/build/outputs/apk/debug/app-debug.apk`에 생긴다.

공모전 제출용 release APK는 다음으로 만든다. 결과는 `app/build/outputs/apk/release/app-release.apk`이고, 저장소 루트의 `apk/` 폴더에 `팀명_앱이름_release.apk`로 복사해 둔다.

```bash
cd android && ./gradlew assembleRelease
```

- JDK 17 이상, Android SDK(플랫폼 36)가 필요하다. `local.properties`에 `sdk.dir=`를 적는다.
- 버전: Vehicle 2.3.2, NaviHelper 3.0.5, TextToSpeech 3.3.1 (2026-11-14 기준 공개 저장소 최신), SpeechToText 3.3.1 (2026-11-15 기준 최신). minSdk 28, targetSdk 34. TextToSpeech와 SpeechToText는 같은 버전을 쓴다. 두 SDK가 매니페스트에 같은 이름의 값(Pleos 음성 서비스 최소 버전 4.1.29)을 넣기 때문이다.

## Pleos Connect 에뮬레이터에서 실행

시스템 이미지는 4.1GB이고, 설치하려면 42dot의 SDK 라이선스에 동의해야 한다. 외장 그래픽(RTX 3060 Laptop급 이상)이 필요하다.

### Android Studio로

1. SDK Manager → SDK Update Sites에 이름 `Pleos Connect System Image`, 주소 `https://nexus-playground.pleos.ai/repository/raw-releases/connect-avd/2.x/crp-sys-img.xml`(Windows/Linux)을 추가한다.
2. SDK Platforms에서 Show Package Details를 켜고 Android API 34의 Pleos Connect system Image를 받는다.
3. Device Manager에서 Form Factor `Automotive`, `Pleos Connect v2.1.0`으로 AVD를 만든다. Default boot는 Cold(필수), RAM 4GB, 시스템 이미지는 API 34의 `Pleos Connect v2.1.0 APIs`.
4. 에뮬레이터를 띄우고 APK를 창에 끌어다 놓거나 `adb install`로 설치한다.

### Android Studio 없이 (명령줄 도구만)

`~/.android/repositories.cfg`에 Pleos 저장소를 등록하면 `sdkmanager`가 이미지를 찾는다.

```
### User Sources for Android SDK Manager
count=1
enabled00=true
disp00=Pleos Connect System Image
src00=https\://nexus-playground.pleos.ai/repository/raw-releases/connect-avd/2.x/crp-sys-img.xml
```

```bash
sdkmanager "system-images;android-34;pleos_car_emulator;x86_64"
```

### 기어 바꾸기 (Virtual Console)

에뮬레이터가 켜진 상태에서 아래를 실행하고, PC 브라우저로 `http://127.0.0.1:8088/`을 연다. Emulation Controls → Motion → Gear Selection에서 P, R, N, D를 누른다.

```bash
adb forward tcp:8088 tcp:8088
```

Virtual Console에는 속도와 내비 정체를 넣는 항목이 없다. 정체 장면은 앱 화면 오른쪽 위 "시험 값" 버튼으로 넣는다. 로그에는 실제 SDK 이벤트가 아니라 시험 값이라고 남는다.

### 내비 안내 시작하기와 시험 주행

주행 지도는 내비가 목적지를 안내하는 중에만 나온다. 내비 앱에서 목적지를 정하거나, 시험할 때는 앱을 띄우면서 목적지를 함께 넘긴다.

```bash
adb shell am start -n com.gamjahq.app/.MainActivity --ef route_lat 37.3947 --ef route_lng 127.1112 --es route_name "Pangyo Station"
```

에뮬레이터의 차는 제자리에 서 있어 지도가 움직이지 않는다. 기어를 D에 놓고 "시험 값" → "시험 주행 시작"을 누르면, 내비가 준 길 위를 가상의 차가 달린다. 길(회전, 정체 구간)은 내비 값 그대로이고 위치와 속도만 가상이다. 화면에 "시험 주행 · 위치만 가상"이라고 적힌다. 가상의 차가 정체 구간에 들어서면 정체 신호도 시험 값으로 들어간다. 시험 주행 중에 "과속방지턱 놓기 (70m 앞)"를 누르면 길 위에 방지턱이 놓이고, 넘을 때 컵이 반응한다. 운전 습관을 "거칠게"로 두면 넘친다.

## 아직 확인하지 못한 것

Pleos Connect Emulator v2.1.0에서 다음을 확인했다(2026-11-14, release APK).

- 설치와 실행. 앱 창은 1682×1210이다.
- Vehicle, NaviHelper, TextToSpeech SDK 연결.
- Virtual Console에서 기어를 D로 바꾸면 출발해 주행 잠금 화면이 나오고, P로 바꾸면 작전 결과가 열린다.
- 주행 중에도 화면이 가려지지 않는다. 매니페스트의 `distractionOptimized` 선언이 없으면 시스템이 "주행 중에는 사용할 수 없습니다"로 가린다.
- 시험 값으로 넣은 정체에서 공동작전이 진행된다.
- TextToSpeech가 내장 엔진으로 문장을 재생한다(로그 기준, 기본 화자 `seoyoon`).
- 앱이 `requestRoute`로 안내를 청하면 `onRouteStarted`(3.1km, 9분), `onTBTInfo`(좌회전 80m, 우회전 380m), `onRouteStateInfo`(대왕판교로 HEAVY·SLOW 구간)가 오고, 그 값으로 주행 지도가 그려진다.
- 시험 주행에서 가상의 차가 그 길을 따라 달리고, 커피 컵이 가속과 회전에 반응한다. 시험 값으로 놓은 방지턱을 거칠게 넘으면 커피가 넘치고 남은 양이 줄어든다(99% → 90%). P로 바꾸면 커피 운송 결과가 나온다.
- 가속도 센서 값이 들어온다(화면에 "차량 가속도 센서로 계산"). 서 있는 차라 수면은 평평했다.

아래는 아직 확인하지 못했다.

- **정체 판정**: `TrafficCongestionInfo.offset`을 "현재 위치에서 구간 시작까지의 거리(m)"로 가정했다. 에뮬레이터에서 실제 값을 보고 `CongestionDetector`의 기준을 맞춰야 한다. 내비 안내 중이 아니면 정체 정보가 오지 않는다.
- **회전 거리**: `TBTInfo.distance`가 지금 자리에서 잰 거리인지, 앞 회전에서 잰 거리인지 확인하지 못했다. 지금 자리에서 잰 것으로 보고 그린다. 첫 회전은 어느 쪽이든 맞다.
- **과속방지턱**: 에뮬레이터의 경로에서는 `onCautionPointInfo`에 SPEED_BUMP가 오지 않았다. 실제 값으로 방지턱이 그려지는 것은 확인하지 못했다. 시험 값으로 놓은 방지턱에서는 지도 표시와 컵의 반응을 에뮬레이터에서 확인했다.
- **가속도 센서**: 에뮬레이터의 가속도 주입(`adb emu sensor set acceleration`)이 꺼져 있어, 값이 변할 때 컵이 반응하는지는 실행해 보지 못했다. 계산 자체는 `web/src/core/drive.test.ts`로 확인한다. 실제 헤드유닛에 이 센서가 있는지, 화면이 달린 방향이 가정(화면 오른쪽이 차의 오른쪽, 화면 뒤쪽이 차의 앞쪽)과 맞는지도 모른다.
- **실제 이동**: 차가 실제로 움직일 때 남은 거리의 변화로 속도를 잡는 부분은 에뮬레이터에서 확인할 수 없다.
- **권한**: 에뮬레이터에서는 세 SDK가 권한 문제 없이 연결됐다. App Market 승인이 필요한지는 확인이 필요하다.
- **말로 묻기**: SpeechToText SDK는 빌드와 단위 테스트까지만 했고 에뮬레이터에서 실행해 보지 않았다. 내장 엔진(ON_DEVICE)이 한국어 브랜드 이름("컴포즈", "빽다방")을 얼마나 알아듣는지, 에뮬레이터의 마이크 설정(Pleos 문서의 "Configure microphone access"), `STT_SERVICE` 권한을 묻는 창이 뜨는지 확인해야 한다. SDK가 말이 끝났다는 신호(`onEndedRecognition`)를 최종 결과 앞에 보내는지 뒤에 보내는지도 확인하지 못해 두 순서를 모두 받는다.
- **백그라운드**: 내비 앱이 앞에 있어 이 앱이 뒤로 가면 프로세스가 죽을 수 있다. 신호를 놓치지 않으려면 포그라운드 서비스로 옮겨야 한다.
- **주행 제한**: 앱의 화면 잠금은 기어 신호로만 한다. AAOS `CarUxRestrictions`는 아직 읽지 않는다. 앱 전체를 `distractionOptimized`로 선언했으므로, 주행 중에 잠금 화면 말고 다른 화면이 보이는 경로가 생기지 않게 해야 한다.
- **다른 감자**: 서버가 없어 감자 부대와 스티커는 여전히 가상이다.
