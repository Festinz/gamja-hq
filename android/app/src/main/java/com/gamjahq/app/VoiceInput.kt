package com.gamjahq.app

import ai.pleos.playground.stt.SpeechToText
import ai.pleos.playground.stt.constant.ErrorType
import ai.pleos.playground.stt.constant.Mode
import ai.pleos.playground.stt.listener.OnInitializeListener
import ai.pleos.playground.stt.listener.OnServerConnectionListener
import ai.pleos.playground.stt.listener.ResultListener
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import java.util.Locale

/**
 * 감자의 귀. Pleos SpeechToText SDK 로 운전자의 대답을 한 번 듣는다(말로 묻기).
 *
 * 커피 운송작전을 주차 중에 켜면 감자가 "오늘은 어떤 커피 실었어?" 하고 묻고, 웹앱이 [listen] 을 부른다.
 * 들은 말은 'stt' 메시지로 웹에 넘기고, 웹이 브랜드와 크기를 찾아 한 번에 고를 수 있게 보여준다.
 * 듣는 순서와 끝내는 규칙은 [ListenFlow] 가 정하고, 이 클래스는 SDK 호출과 타이머만 맡는다.
 *
 * - 기어가 P 일 때만 듣는다. 듣는 중에 P 를 벗어나면 [onLeftPark] 로 곧바로 마이크를 닫는다.
 * - 앱 화면이 앞에 있을 때만 듣는다. 화면이 가려지면(onPause) [interrupt] 로 곧바로 그만둔다.
 * - 감자가 하던 말이 끝난 뒤에 마이크를 연다. 마이크를 연 뒤 8초 안에 끝난다.
 * - 마이크는 Pleos 음성 서비스가 연다. 이 앱은 RECORD_AUDIO 없이 pleos.car.permission.STT_SERVICE 만 쓴다.
 * - Pleos Playground 자격 증명이 있으면 HYBRID(서버 인식, 네트워크가 안 되면 차량 내장 엔진)로,
 *   없으면 ON_DEVICE(차량 내장 엔진)로 듣는다. TextToSpeech 와 같은 자격 증명이다.
 * - 들은 문장은 웹으로만 넘기고 저장하지 않는다. 릴리스 로그에도 남기지 않는다.
 */
class VoiceInput(
    private val context: Context,
    private val isParked: () -> Boolean,
    private val isSpeaking: () -> Boolean,
    /** 앱 화면이 앞에 있다(onResume 과 onPause 사이). */
    private val isForeground: () -> Boolean,
    private val onMessage: (ListenFlow.Message) -> Unit,
    private val onSdkEvent: (name: String, detail: String) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private val flow = ListenFlow()
    private var sdk: SpeechToText? = null
    private var engine = ListenFlow.Engine.ABSENT

    /** SpeechToText SDK 가 준비됐다. */
    val isReady: Boolean
        get() = engine == ListenFlow.Engine.READY

    /** 서버 인식에 등록됐다. false 면 차량 내장 엔진으로 듣는다. */
    var usesServer = false
        private set

    private val hasCredentials =
        BuildConfig.PLEOS_CLIENT_ID.isNotBlank() && BuildConfig.PLEOS_CLIENT_SECRET.isNotBlank()

    private val wake = Runnable { follow(flow.tick(now(), conditions())) }

    // SDK 는 결과를 메인 스레드로 알린다. 다른 메시지와 순서가 섞이지 않게 한 번 더 메인 줄에 넣는다.
    private val results = object : ResultListener {
        override fun onReady() = Unit

        override fun onStartedRecognition() = Unit

        override fun onUpdated(stt: String, completed: Boolean) {
            main.post { follow(if (completed) flow.onFinal(stt) else flow.onPartial(stt)) }
        }

        override fun onUpdatedEpdData(on: Long, off: Long) = Unit

        override fun onUpdatedRms(rms: Double) = Unit

        override fun onEndedRecognition() {
            main.post { follow(flow.onEnded(now())) }
        }

        override fun onError(errorType: ErrorType) {
            Log.w(TAG, "음성 인식 오류: $errorType")
            main.post { follow(flow.onError(errorType.name)) }
        }
    }

    /** SDK 를 연결한다. 상태가 바뀔 때마다 [onChanged] 로 알린다. 메인 스레드에서 부른다. */
    fun start(onChanged: () -> Unit) {
        if (sdk != null) return
        engine = ListenFlow.Engine.STARTING
        try {
            val stt = SpeechToText(context, if (hasCredentials) Mode.HYBRID else Mode.ON_DEVICE)
            sdk = stt
            stt.initialize(object : OnInitializeListener {
                override fun onSuccess() {
                    main.post { if (sdk === stt) onInitialized(stt, onChanged) }
                }

                override fun onFailure(errorType: ErrorType) {
                    Log.w(TAG, "SpeechToText 초기화 실패: $errorType")
                    main.post {
                        if (sdk !== stt) return@post
                        engine = ListenFlow.Engine.ABSENT
                        onChanged()
                    }
                }
            })
        } catch (t: Throwable) {
            // Pleos 음성 서비스가 없는 기기, 또는 STT_SERVICE 권한이 아직 없을 때 여기로 온다.
            // 권한을 받은 뒤 다시 start 할 수 있게 비워 둔다.
            Log.w(TAG, "SpeechToText SDK 를 쓸 수 없습니다", t)
            sdk = null
            engine = ListenFlow.Engine.ABSENT
            onChanged()
        }
    }

    private fun onInitialized(stt: SpeechToText, onChanged: () -> Unit) {
        try {
            // 결과를 놓치지 않게 request 보다 먼저 리스너를 단다.
            stt.addListener(results)
            stt.setLocale(Locale.KOREA)
        } catch (t: Throwable) {
            Log.w(TAG, "SpeechToText 설정 실패", t)
            engine = ListenFlow.Engine.ABSENT
            onChanged()
            return
        }
        engine = ListenFlow.Engine.READY
        onSdkEvent("initialize", if (hasCredentials) "HYBRID 모드 연결" else "ON_DEVICE 모드 연결 (차량 내장 엔진)")
        onChanged()
        if (hasCredentials) registerForServer(stt, onChanged)
    }

    private fun registerForServer(stt: SpeechToText, onChanged: () -> Unit) {
        try {
            stt.registerApp(
                BuildConfig.PLEOS_CLIENT_ID,
                BuildConfig.PLEOS_CLIENT_SECRET,
                object : OnServerConnectionListener {
                    override fun onConnected() {
                        main.post {
                            if (sdk !== stt) return@post
                            usesServer = true
                            onChanged()
                        }
                    }

                    override fun onFailed(errorType: ErrorType) {
                        // HYBRID 는 서버에 닿지 못하면 차량 내장 엔진으로 듣는다.
                        Log.w(TAG, "서버 인식 등록 실패: $errorType")
                    }
                },
            )
        } catch (t: Throwable) {
            Log.w(TAG, "registerApp 실패", t)
        }
    }

    /** 한 번 듣는다. 결과는 'stt' 메시지로 간다. 메인 스레드에서 부른다. */
    fun listen() = follow(flow.listen(now(), conditions()))

    /** 듣기를 그만둔다. 듣고 있었으면 'stt' error "cancelled" 를 보낸다. */
    fun cancel() = follow(flow.cancel())

    /** 기어가 P 를 벗어났다. 듣고 있었으면 마이크를 닫고 'stt' error "not-parked" 를 보낸다. */
    fun onLeftPark() = follow(flow.leftPark())

    /**
     * 앱 화면이 가려졌다(onPause). 기다리거나 듣고 있었으면 마이크를 닫고 'stt' error "paused" 를 보낸다.
     * 웹은 cancelled 를 지난 듣기의 늦은 대답으로 보고 버리므로 cancel 과 따로 둔다.
     */
    fun interrupt() = follow(flow.paused())

    fun stop() {
        follow(flow.reset())
        main.removeCallbacks(wake)
        try {
            sdk?.removeListener(results)
            sdk?.release()
        } catch (t: Throwable) {
            Log.w(TAG, "SpeechToText 해제 실패", t)
        }
        sdk = null
        engine = ListenFlow.Engine.ABSENT
        usesServer = false
    }

    private fun conditions() = ListenFlow.Conditions(
        parked = isParked(),
        engine = engine,
        speaking = isSpeaking(),
        foreground = isForeground(),
    )

    /** [ListenFlow] 가 정한 일을 차례로 하고, 다음에 깨어날 시각을 맞춘다. */
    private fun follow(effects: List<ListenFlow.Effect>) {
        val todo = ArrayDeque(effects)
        while (todo.isNotEmpty()) {
            when (val effect = todo.removeFirst()) {
                ListenFlow.Effect.OpenMic -> todo.addAll(openMic())
                ListenFlow.Effect.CloseMic -> closeMic()
                is ListenFlow.Effect.Send -> deliver(effect.message)
            }
        }
        main.removeCallbacks(wake)
        flow.deadline?.let { main.postAtTime(wake, it) }
    }

    private fun openMic(): List<ListenFlow.Effect> {
        val stt = sdk ?: return flow.micFailed()
        return try {
            stt.request()
            flow.micOpened(now())
        } catch (t: Throwable) {
            Log.w(TAG, "request 실패", t)
            flow.micFailed()
        }
    }

    private fun closeMic() {
        try {
            sdk?.stop()
        } catch (t: Throwable) {
            Log.w(TAG, "stop 실패", t)
        }
    }

    private fun deliver(message: ListenFlow.Message) {
        if (BuildConfig.DEBUG) Log.d(TAG, "stt ${message.state} ${message.error.orEmpty()} ${message.text.orEmpty()}")
        onMessage(message)
        sdkLogOf(message)?.let { (name, detail) -> onSdkEvent(name, detail) }
    }

    /** "Pleos 연동" 화면 로그에 남길 한 줄. 들은 문장은 남기지 않는다. */
    private fun sdkLogOf(message: ListenFlow.Message): Pair<String, String>? = when (message.state) {
        ListenFlow.LISTENING -> "request" to "기어 P · 듣기 시작"
        ListenFlow.FINAL -> "onUpdated" to "인식 완료"
        ListenFlow.ERROR -> when (message.error) {
            ListenFlow.NOT_PARKED -> "stop" to "기어가 P 가 아니라 듣지 않음"
            ListenFlow.CANCELLED -> "stop" to "듣기 그만"
            ListenFlow.PAUSED -> "stop" to "앱 화면이 가려져 듣지 않음"
            ListenFlow.TIMEOUT -> "stop" to "대답을 알아듣지 못함 (시간 초과)"
            ListenFlow.NO_SPEECH -> "onEndedRecognition" to "알아들은 말이 없음"
            ListenFlow.UNAVAILABLE -> "request" to "음성 인식을 쓸 수 없음 ${message.detail.orEmpty()}".trim()
            else -> "onError" to message.detail.orEmpty()
        }
        else -> null
    }

    private fun now() = SystemClock.uptimeMillis()

    private companion object {
        const val TAG = "GamjaVoiceInput"
    }
}
