package com.gamjahq.app

import ai.pleos.playground.tts.TextToSpeech
import ai.pleos.playground.tts.constant.ErrorType
import ai.pleos.playground.tts.constant.Mode
import ai.pleos.playground.tts.listener.EventListener
import ai.pleos.playground.tts.listener.OnInitializeListener
import ai.pleos.playground.tts.listener.OnServerConnectionListener
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import java.util.Locale

/**
 * 감자의 목소리. Pleos TextToSpeech SDK 로 말한다.
 *
 * - Pleos Playground 의 Client ID / Client Secret 이 설정돼 있으면 HYBRID 모드로 앱을 등록한다.
 *   서버 음성을 먼저 쓰고, 네트워크가 안 되면 SDK 가 차량 내장 엔진으로 넘어간다.
 *   HYBRID 는 SDK 의 기본 모드다.
 * - 설정돼 있지 않으면 ON_DEVICE 모드로 차량 내장 엔진만 쓴다. 네트워크와 앱 등록이 필요 없다.
 *
 * 자격 증명은 저장소에 넣지 않는다. android/local.properties 에 적으면 빌드 때 들어간다.
 *
 * SDK 의 speak 는 새 문장이 오면 하던 말을 끊는다. 그래서 말을 [SpeechQueue] 에 줄 세우고,
 * SDK 가 말이 끝났다고 알리면(onDone, onStop, onError) 다음 말을 꺼낸다. 끝 신호가 오지 않을
 * 때를 대비해 문장 길이에 맞춘 시간이 지나면 다음으로 넘어간다. 안전 경고만은 기다리지 않고
 * 하던 보통 말을 끊는다.
 *
 * 커피 묻기의 질문은 주차한 채(기어 P)에서만 하는 말이다([speakWhileParked]). 기어 P 가 확인되지 않으면 말하지
 * 않고, 기어가 P 를 벗어나면([onLeftPark]) 기다리던 질문을 버리고 하던 질문은 멈춘다. 웹이 묻기를 그만두면
 * [unspeak] 로 거둔다.
 */
class Speaker(private val context: Context) {
    private var tts: TextToSpeech? = null
    private val queue = SpeechQueue()
    private val main = Handler(Looper.getMainLooper())
    private var watchdog: Runnable? = null
    private var startedAt = 0L
    private var interruptedAt = -INTERRUPT_SIGNAL_MS

    private val events = object : EventListener {
        override fun onStart() {}

        override fun onReady() {}

        override fun onDone() {
            main.post { finished("onDone") }
        }

        override fun onStop() {
            main.post { finished("onStop") }
        }

        override fun onError(error: ErrorType) {
            Log.w(TAG, "말하는 중 오류: $error")
            main.post { finished("onError") }
        }

        override fun onUpdatedRms(rms: Double) {}
    }

    var isReady = false
        private set

    /** 서버 음성에 연결됐는가. false 면 차량 내장 엔진으로 말한다. */
    var usesServerVoice = false
        private set

    /** 하던 말이나 기다리는 말이 있다. 말로 묻기([VoiceInput])는 이 말이 끝난 뒤에 마이크를 연다. */
    val isSpeaking: Boolean
        get() = queue.speaking != null || queue.waitingTexts.isNotEmpty()

    private val hasCredentials =
        BuildConfig.PLEOS_CLIENT_ID.isNotBlank() && BuildConfig.PLEOS_CLIENT_SECRET.isNotBlank()

    /** 초기화한다. 상태가 바뀔 때마다 [onChanged] 로 알린다. */
    fun start(onChanged: () -> Unit) {
        try {
            val engine = TextToSpeech(context, if (hasCredentials) Mode.HYBRID else Mode.ON_DEVICE)
            tts = engine
            engine.initialize(object : OnInitializeListener {
                override fun onSuccess() {
                    engine.setLocale(Locale.KOREA)
                    engine.addEventListener(events)
                    isReady = true
                    onChanged()
                    if (hasCredentials) registerForServerVoice(engine, onChanged)
                }

                override fun onFailure(error: ErrorType) {
                    Log.w(TAG, "TextToSpeech 초기화 실패: $error")
                    onChanged()
                }
            })
        } catch (t: Throwable) {
            // Pleos 서비스가 없는 기기에서는 여기로 온다.
            Log.w(TAG, "TextToSpeech SDK 를 쓸 수 없습니다", t)
            onChanged()
        }
    }

    private fun registerForServerVoice(engine: TextToSpeech, onChanged: () -> Unit) {
        try {
            engine.registerApp(
                BuildConfig.PLEOS_CLIENT_ID,
                BuildConfig.PLEOS_CLIENT_SECRET,
                object : OnServerConnectionListener {
                    override fun onConnected() {
                        usesServerVoice = true
                        onChanged()
                    }

                    override fun onFailed(error: ErrorType) {
                        // 등록에 실패해도 HYBRID 는 내장 엔진으로 말할 수 있다.
                        Log.w(TAG, "서버 음성 등록 실패, 내장 엔진으로 말합니다: $error")
                    }
                },
            )
        } catch (t: Throwable) {
            Log.w(TAG, "registerApp 실패", t)
        }
    }

    /** 한 문장을 말한다. 하던 말이 있으면 끝난 뒤에 말한다. 메인 스레드에서 부른다. */
    fun speak(text: String) = offer(text, urgent = false)

    /**
     * 안전 경고. 기다리는 보통 말보다 먼저 말하고, 하던 보통 말은 끊는다(끊긴 말은 경고 뒤에 처음부터 다시 한다).
     * 경고끼리는 끊지 않는다. 메인 스레드에서 부른다.
     */
    fun speakFirst(text: String) = offer(text, urgent = true)

    /**
     * 주차한 채(기어 P)에서만 하는 보통 말 (커피 묻기의 질문). [parked] 가 false 면(기어를 모르거나 P 가 아니면)
     * 말하지 않는다. 말하기 전이나 말하는 중에 P 를 벗어나면 [onLeftPark] 가 버리거나 멈춘다. 메인 스레드에서 부른다.
     */
    fun speakWhileParked(text: String, parked: Boolean) {
        if (parked) offer(text, urgent = false, parkedOnly = true)
    }

    /** 한 문장을 거둔다. 기다리던 그 말을 버리고, 하는 중이면 멈추고 다음 말로 넘어간다. 메인 스레드에서 부른다. */
    fun unspeak(text: String) {
        if (queue.withdraw(text)) skipCurrent()
    }

    /**
     * 기어가 P 를 벗어났다. 주차한 채에서만 하는 말을 버리고, 하는 중이면 멈추고 다음 말로 넘어간다.
     * 출발 신호를 웹에 보내기 전에 부른다. 메인 스레드에서 부른다.
     */
    fun onLeftPark() {
        if (queue.dropParkedOnly()) skipCurrent()
    }

    private fun offer(text: String, urgent: Boolean, parkedOnly: Boolean = false) {
        if (!isReady) return
        when (val action = queue.offer(text, urgent, parkedOnly)) {
            is SpeechQueue.Action.Speak -> say(action.text)
            is SpeechQueue.Action.Interrupt -> {
                // 안전 경고가 하던 보통 말을 끊는다. 끊긴 말이 보내는 끝 신호는 무시한다.
                interruptedAt = SystemClock.uptimeMillis()
                watchdog?.let(main::removeCallbacks)
                say(action.text)
            }
            SpeechQueue.Action.Wait -> Unit
        }
    }

    private fun finished(reason: String) {
        val now = SystemClock.uptimeMillis()
        // 새 문장을 막 시작했을 때 들어온 끝 신호는 앞 문장의 것이다.
        if (queue.speaking != null && now - startedAt < STALE_SIGNAL_MS) return
        // 경고가 끊은 말의 멈춤 신호는 조금 늦게 올 수 있다.
        if (reason == "onStop" && now - interruptedAt < INTERRUPT_SIGNAL_MS) return
        if (BuildConfig.DEBUG) Log.d(TAG, "말 끝남: $reason")
        watchdog?.let(main::removeCallbacks)
        watchdog = null
        queue.finished()?.let(::say)
    }

    private fun say(text: String) {
        startedAt = SystemClock.uptimeMillis()
        try {
            // 줄의 맨 앞 문장만 여기로 온다. 하던 말이 없을 때만 부르므로 끊기는 말은 없다.
            tts?.speak(text, true)
        } catch (t: Throwable) {
            Log.w(TAG, "speak 실패", t)
        }
        val guard = Runnable { if (queue.speaking == text) finished("시간 초과") }
        watchdog = guard
        main.postDelayed(guard, SpeechQueue.watchdogMs(text))
    }

    /**
     * 하던 말을 멈추고 다음 말로 넘어간다([unspeak], [onLeftPark]). 멈춘 말이 보내는 끝 신호는 무시한다.
     * 다음 말이 있으면 그 말의 speak 가 하던 말을 끊는다(안전 경고가 보통 말을 끊을 때와 같다).
     */
    private fun skipCurrent() {
        watchdog?.let(main::removeCallbacks)
        watchdog = null
        interruptedAt = SystemClock.uptimeMillis()
        val next = queue.finished()
        if (next != null) {
            say(next)
            return
        }
        try {
            tts?.stop()
        } catch (t: Throwable) {
            Log.w(TAG, "멈추기 실패", t)
        }
    }

    /** 기다리는 말을 버리고 하던 말을 멈춘다. 주차했거나 음성 안내를 껐을 때 웹이 부른다. */
    fun hush() {
        watchdog?.let(main::removeCallbacks)
        watchdog = null
        queue.clear()
        interruptedAt = SystemClock.uptimeMillis()
        try {
            tts?.stop()
        } catch (t: Throwable) {
            Log.w(TAG, "멈추기 실패", t)
        }
    }

    fun stop() {
        watchdog?.let(main::removeCallbacks)
        watchdog = null
        queue.clear()
        try {
            tts?.removeEventListener(events)
            tts?.stop()
            tts?.release()
        } catch (t: Throwable) {
            Log.w(TAG, "release 실패", t)
        }
        tts = null
        isReady = false
        usesServerVoice = false
    }

    private companion object {
        const val TAG = "GamjaSpeaker"

        /** 새 문장을 시작한 직후 이 시간 안에 온 끝 신호는 앞 문장의 것으로 본다. */
        const val STALE_SIGNAL_MS = 300L

        /** 경고가 하던 말을 끊은 뒤 이 시간 안에 온 멈춤 신호(onStop)는 끊긴 말의 것으로 본다. */
        const val INTERRUPT_SIGNAL_MS = 1_500L
    }
}
