import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Pleos Playground My Project 의 Client ID / Client Secret.
// android/local.properties 에 pleos.clientId, pleos.clientSecret 으로 적는다. 저장소에는 넣지 않는다.
// 비어 있으면 TextToSpeech 와 SpeechToText 를 ON_DEVICE 모드로 쓴다.
val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use(::load)
}
fun localProperty(name: String): String =
    localProperties.getProperty(name, "").replace("\\", "\\\\").replace("\"", "\\\"")

// 웹앱 빌드 결과(web/dist)를 APK의 assets/web 으로 묶는다.
val webDist = rootProject.layout.projectDirectory.dir("../web/dist")
val webAssets = layout.buildDirectory.dir("webAssets")

// Sync 는 web/dist 에 없는 파일을 지운다. Copy 로 두면 예전 빌드의 묶음 파일이 APK 에 계속 쌓인다.
val syncWebApp by tasks.registering(Sync::class) {
    description = "web/dist 를 assets/web 으로 옮긴다. 먼저 web 에서 npm run build 를 해야 한다."
    from(webDist)
    into(webAssets.map { it.dir("web") })
    doFirst {
        check(webDist.file("index.html").asFile.exists()) {
            "web/dist/index.html 이 없습니다. web 폴더에서 `npm run build` 를 먼저 실행하세요."
        }
    }
}

android {
    namespace = "com.gamjahq.app"
    compileSdk = 36
    // 차량 속도를 읽는 Android Automotive 차량 속성 API. SDK 의 optional/android.car.jar 로 컴파일한다.
    useLibrary("android.car")

    defaultConfig {
        applicationId = "com.gamjahq.app"
        // Pleos Connect 요건: Android API 28 이상.
        minSdk = 28
        // Pleos Connect 에뮬레이터 2.1.0 이 API 34 다.
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"

        buildConfigField("String", "PLEOS_CLIENT_ID", "\"${localProperty("pleos.clientId")}\"")
        buildConfigField("String", "PLEOS_CLIENT_SECRET", "\"${localProperty("pleos.clientSecret")}\"")
        // 시연 영상 녹음 도구(say_text). 저장소의 APK 에서는 꺼 둔다. 켜려면 -PdemoTools=true 로 빌드한다.
        buildConfigField("boolean", "DEMO_TOOLS", (findProperty("demoTools") == "true").toString())
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // 공모전 제출용 release APK. 팀의 서명 키가 정해지기 전까지는 디버그 키로 서명한다.
            // Pleos App Market 에 올릴 때는 팀의 릴리스 키로 바꿔야 한다.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets["main"].assets.srcDir(webAssets)
}

kotlin {
    jvmToolchain(17)
}

tasks.named("preBuild") {
    dependsOn(syncWebApp)
}

dependencies {
    // Pleos Connect SDK. 버전은 2026-11-14 기준 공개 저장소의 최신이다(SpeechToText 는 2026-11-15 확인).
    implementation("ai.pleos.playground:Vehicle:2.3.2")
    implementation("ai.pleos.playground:NaviHelper:3.0.5")
    implementation("ai.pleos.playground:TextToSpeech:3.3.1")
    // 말로 묻기. TextToSpeech 와 같은 버전이어야 두 SDK 의 매니페스트 값(Pleos 음성 서비스 최소 버전)이 맞는다.
    implementation("ai.pleos.playground:SpeechToText:3.3.1")

    // 앱에 묶인 웹앱을 https 출처로 띄우기 위한 WebViewAssetLoader.
    implementation("androidx.webkit:webkit:1.12.1")

    testImplementation("junit:junit:4.13.2")
}
