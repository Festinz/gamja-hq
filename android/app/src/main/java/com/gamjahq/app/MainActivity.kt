package com.gamjahq.app

import android.annotation.SuppressLint
import android.content.Intent
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat

/**
 * 감자 작전본부의 Android 껍데기.
 *
 * 화면과 로직은 APK 에 묶인 웹앱(assets/web)이 맡는다. 이 Activity 는 웹앱을 WebView 에 띄우고,
 * Pleos SDK 이벤트를 차량 신호로 바꿔 넘기고, 웹앱이 부탁한 문장을 차량 스피커로 말하고,
 * 주차 중(기어 P)에 웹앱이 청하면 운전자의 대답을 한 번 듣는다.
 */
class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var bridge: WebBridge
    private lateinit var signals: PleosSignals
    private lateinit var speaker: Speaker
    private lateinit var voice: VoiceInput
    private lateinit var motion: MotionSensor
    private lateinit var speed: VehicleSpeed

    /** 앱 화면이 앞에 있다(onResume 과 onPause 사이). 말로 묻기는 이때만 듣는다. */
    private var foreground = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)
        }
        webView.settings.apply {
            javaScriptEnabled = true
            // 감자와 작전일지를 localStorage 에 둔다.
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
        }

        speaker = Speaker(applicationContext)
        bridge = WebBridge(
            webView,
            onSpeak = speaker::speak,
            onSpeakFirst = speaker::speakFirst,
            // 커피 묻기의 질문. 기어 P 가 확인됐을 때만 말한다.
            onSpeakWhileParked = { text -> speaker.speakWhileParked(text, parked = signals.isParked) },
            onUnspeak = speaker::unspeak,
            onStopSpeaking = speaker::hush,
            onPreferComfortRoute = { signals.preferComfortRoute() },
            onListen = { voice.listen() },
            onStopListening = { voice.cancel() },
        )
        webView.addJavascriptInterface(bridge, "PleosHost")

        signals = PleosSignals(
            applicationContext,
            bridge,
            onStatusChanged = ::sendStatus,
            // 주행 중에는 묻지도 듣지도 않는다. 출발 신호보다 먼저 아직 하지 못한 질문을 거두고 마이크를 닫는다.
            onLeftPark = {
                speaker.onLeftPark()
                voice.onLeftPark()
            },
        )
        // 말로 묻기. 기어가 P 이고 앱 화면이 앞에 있을 때만, 감자의 말이 끝난 뒤에 듣는다.
        voice = VoiceInput(
            applicationContext,
            isParked = { signals.isParked },
            isSpeaking = { speaker.isSpeaking },
            isForeground = { foreground },
            onMessage = bridge::sendStt,
            onSdkEvent = { name, detail -> bridge.sendSdkEvent(SDK_STT, name, detail) },
        )
        motion = MotionSensor(applicationContext) { x, y, z -> bridge.sendMotion(x, y, z) }
        speed = VehicleSpeed(applicationContext) { mps -> bridge.sendSpeed(mps) }

        requestPleosPermissions()
        sendStatus()
        speaker.start(onChanged = ::sendStatus)
        voice.start(onChanged = ::sendStatus)
        signals.start()
        speed.start()
        requestRouteFrom(intent)

        webView.loadUrl(APP_URL)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        requestRouteFrom(intent)
        sayFrom(intent)
    }

    /**
     * 시연 영상 녹음용. 넘긴 문장을 감자와 같은 Pleos 내장 음성으로 읽는다(하던 말이 있으면 끝난 뒤).
     * 영상의 내레이션을 감자 대사와 같은 목소리로 맞출 때 쓴다. 앱이 떠 있을 때만 읽고, 길이는 200자로 자른다.
     * 다른 앱이 감자 목소리로 아무 말이나 시키지 못하도록 시연 도구 빌드(`-PdemoTools=true`)에서만 켜진다.
     * 저장소의 APK 에는 꺼져 있다.
     * `adb shell am start -n com.gamjahq.app/.MainActivity --es say_text "매일 같은 길도, 함께 타면 이야기가 됩니다."`
     */
    private fun sayFrom(intent: Intent?) {
        if (!BuildConfig.DEMO_TOOLS) return
        val text = intent?.getStringExtra("say_text")?.trim()?.take(200) ?: return
        if (text.isNotEmpty()) speaker.speak(text)
    }

    /**
     * 시연과 시험용. 실행할 때 목적지를 함께 넘기면 내비에 안내를 청한다.
     * `adb shell am start -n com.gamjahq.app/.MainActivity --ef route_lat 37.39 --ef route_lng 127.11 --es route_name 판교역`
     */
    private fun requestRouteFrom(intent: Intent?) {
        val name = intent?.getStringExtra("route_name") ?: return
        val lat = intent.getFloatExtra("route_lat", Float.NaN)
        val lng = intent.getFloatExtra("route_lng", Float.NaN)
        if (lat.isNaN() || lng.isNaN()) return
        signals.requestRoute(lat.toDouble(), lng.toDouble(), name)
    }

    private fun sendStatus() {
        bridge.sendStatus(
            vehicle = signals.isVehicleConnected,
            navi = signals.isNaviConnected,
            tts = speaker.isReady,
            serverVoice = speaker.usesServerVoice,
            stt = voice.isReady,
            sttServer = voice.usesServer,
            parked = signals.isParked,
        )
    }

    /** 선언한 Pleos 권한 가운데 아직 허용되지 않은 것을 요청한다. */
    private fun requestPleosPermissions() {
        val missing = PLEOS_PERMISSIONS.filter {
            checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) requestPermissions(missing.toTypedArray(), REQUEST_PERMISSIONS)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_PERMISSIONS) return
        // 권한을 받은 뒤에 다시 연결을 시도한다.
        if (grantResults.any { it == PackageManager.PERMISSION_GRANTED }) {
            signals.stop()
            signals.start()
            speed.stop()
            speed.start()
            if (!voice.isReady) {
                voice.stop()
                voice.start(onChanged = ::sendStatus)
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onResume() {
        super.onResume()
        foreground = true
        motion.start()
    }

    /**
     * 화면이 가려졌다(내비 전체 화면, 다른 앱). 말로 묻기가 기다리거나 듣고 있었으면 그만두고 웹에 "paused" 를 알린다.
     * WebView 와 감자의 목소리는 멈추지 않는다. 내비가 앞에 있어도 주행 중 안내(방지턱 경고)는 이어져야 한다.
     */
    override fun onPause() {
        foreground = false
        voice.interrupt()
        motion.stop()
        super.onPause()
    }

    override fun onDestroy() {
        speed.stop()
        signals.stop()
        voice.stop()
        speaker.stop()
        webView.destroy()
        super.onDestroy()
    }

    private companion object {
        const val APP_URL = "https://appassets.androidplatform.net/assets/web/index.html"
        const val REQUEST_PERMISSIONS = 1
        const val SDK_STT = "SpeechToText SDK"
        val PLEOS_PERMISSIONS = listOf(
            "pleos.car.permission.CAR_DRIVE",
            "pleos.car.permission.NAVI_ROUTE",
            "pleos.car.permission.NAVI_ROUTE_SEARCH",
            "pleos.car.permission.NAVI_CUSTOM_ROUTE",
            "pleos.car.permission.NAVI_CUSTOM_ETC",
            "pleos.car.permission.TTS_SERVICE",
            // 말로 묻기 (SpeechToText SDK). 마이크는 Pleos 음성 서비스가 연다.
            "pleos.car.permission.STT_SERVICE",
            // 차량 속도 (Android Automotive). 지도 위의 차를 계기판과 같은 속도로 움직인다.
            "android.car.permission.CAR_SPEED",
        )
    }
}
