package com.gamjahq.app

import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject

/**
 * 웹앱과 주고받는 다리. web/src/native/host.ts 와 짝을 이룬다.
 *
 * 웹 → 네이티브: `window.PleosHost.ready()`, `speak(text)`, `speakFirst(text)`, `speakWhileParked(text)`, `unspeak(text)`,
 * `stopSpeaking()`, `preferComfortRoute()`, `listen()`, `stopListening()`
 * 네이티브 → 웹: `window.gamjaHq.receive(json)`
 *
 * 웹이 준비되기 전에 생긴 메시지는 모아 두었다가 준비되면 순서대로 보낸다.
 */
class WebBridge(
    private val webView: WebView,
    private val onSpeak: (String) -> Unit,
    private val onSpeakFirst: (String) -> Unit,
    private val onSpeakWhileParked: (String) -> Unit,
    private val onUnspeak: (String) -> Unit,
    private val onStopSpeaking: () -> Unit,
    private val onPreferComfortRoute: () -> Unit,
    private val onListen: () -> Unit,
    private val onStopListening: () -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private var isReady = false
    private val pending = ArrayList<String>()

    @JavascriptInterface
    fun ready() {
        main.post {
            isReady = true
            pending.forEach(::deliver)
            pending.clear()
        }
    }

    @JavascriptInterface
    fun speak(text: String) {
        main.post { onSpeak(text) }
    }

    /** 안전 경고. 하던 보통 말을 끊고 먼저 말한다. */
    @JavascriptInterface
    fun speakFirst(text: String) {
        main.post { onSpeakFirst(text) }
    }

    /**
     * 주차한 채(기어 P)에서만 하는 보통 말 (커피 묻기의 질문). 기어 P 가 확인됐을 때만 말하고,
     * P 를 벗어나면 기다리던 말은 버리고 하던 말은 멈춘다.
     */
    @JavascriptInterface
    fun speakWhileParked(text: String) {
        main.post { onSpeakWhileParked(text) }
    }

    /** 한 문장을 거둔다. 기다리던 그 말을 버리고, 하는 중이면 멈춘다 (출발하거나 묻기를 그만둘 때). */
    @JavascriptInterface
    fun unspeak(text: String) {
        main.post { onUnspeak(text) }
    }

    /** 기다리는 말을 버리고 하던 말을 멈춘다(주차, 음성 안내 끔). */
    @JavascriptInterface
    fun stopSpeaking() {
        main.post { onStopSpeaking() }
    }

    @JavascriptInterface
    fun preferComfortRoute() {
        main.post { onPreferComfortRoute() }
    }

    /**
     * 말로 묻기. 운전자의 대답을 한 번 듣고 'stt' 메시지로 알린다. 기어가 P 일 때만 듣는다.
     * 질문은 먼저 speak 로 넘긴다. 감자의 말이 끝난 뒤에 마이크가 열린다.
     */
    @JavascriptInterface
    fun listen() {
        main.post { onListen() }
    }

    /** 듣기를 그만둔다. 듣고 있었으면 'stt' error "cancelled" 가 간다. */
    @JavascriptInterface
    fun stopListening() {
        main.post { onStopListening() }
    }

    /** 내비 안내 상태. 모양은 web/src/app/navi.ts 의 NaviSnapshot 과 같다. */
    fun sendNavi(message: JSONObject) {
        send(message)
    }

    /** 가속도 센서 값 하나. 자주 오므로 웹이 준비되기 전의 값은 버린다. */
    fun sendMotion(x: Float, y: Float, z: Float) {
        val json = JSONObject()
            .put("type", "motion")
            .put("x", x.toDouble())
            .put("y", y.toDouble())
            .put("z", z.toDouble())
            .toString()
        main.post { if (isReady) deliver(json) }
    }

    /** 차량 속도 (m/s). 자주 오므로 웹이 준비되기 전의 값은 버린다. */
    fun sendSpeed(metersPerSecond: Float) {
        val json = JSONObject().put("type", "speed").put("mps", metersPerSecond.toDouble()).toString()
        main.post { if (isReady) deliver(json) }
    }

    /** 과속방지턱 하나가 가까워졌다. */
    fun sendBump() {
        send(JSONObject().put("type", "bump"))
    }

    fun sendSignal(signal: Signal, road: String? = null) {
        send(JSONObject().put("type", "signal").put("signal", signal.wire).putOpt("road", road))
    }

    fun sendTripInfo(from: String? = null, to: String? = null) {
        if (from.isNullOrBlank() && to.isNullOrBlank()) return
        send(
            JSONObject().put("type", "trip-info")
                .putOpt("from", from?.takeIf { it.isNotBlank() })
                .putOpt("to", to?.takeIf { it.isNotBlank() }),
        )
    }

    /**
     * 연결 상태. parked 는 Vehicle SDK 가 기어 P 를 읽었다는 뜻이다(모르면 false). 기어가 바뀔 때마다 다시 보낸다.
     * 웹은 parked 가 true 일 때만 커피를 말로 묻는다.
     */
    fun sendStatus(
        vehicle: Boolean,
        navi: Boolean,
        tts: Boolean,
        serverVoice: Boolean,
        stt: Boolean,
        sttServer: Boolean,
        parked: Boolean,
    ) {
        send(
            JSONObject().put("type", "status")
                .put("vehicle", vehicle).put("navi", navi).put("tts", tts)
                .put("serverVoice", serverVoice)
                .put("stt", stt).put("sttServer", sttServer)
                .put("parked", parked),
        )
    }

    /**
     * 말로 묻기의 듣기 상태. `{type:"stt", state, text?, error?, detail?}`
     * state: listening(마이크가 열림) | partial(중간 결과) | final(최종 결과) | error. 모양은 [ListenFlow.Message] 참고.
     */
    fun sendStt(message: ListenFlow.Message) {
        send(
            JSONObject().put("type", "stt")
                .put("state", message.state)
                .putOpt("text", message.text)
                .putOpt("error", message.error)
                .putOpt("detail", message.detail),
        )
    }

    /** 앱 안의 "Pleos 연동" 화면 로그에 남길 한 줄. */
    fun sendSdkEvent(sdk: String, name: String, detail: String) {
        send(
            JSONObject().put("type", "sdk-event")
                .put("sdk", sdk).put("name", name).put("detail", detail),
        )
    }

    private fun send(message: JSONObject) {
        val json = message.toString()
        main.post { if (isReady) deliver(json) else pending.add(json) }
    }

    private fun deliver(json: String) {
        webView.evaluateJavascript(
            "window.gamjaHq && window.gamjaHq.receive(${JSONObject.quote(json)})",
            null,
        )
    }
}
