package com.gamjahq.app

/**
 * 말로 묻기의 듣기 한 번. 감자가 "오늘은 어떤 커피 실었어?" 하고 물은 뒤 운전자의 대답을 한 번 듣는다.
 * web/src/native/host.ts 의 'stt' 메시지와 짝을 이룬다.
 *
 *     쉼 ─listen─▶ 기다림 ─(감자의 말이 끝남)─▶ 듣는 중 ─(말 끝 신호)─▶ 마무리 ─▶ 쉼
 *
 * - 기어가 P 가 아니면 듣지 않는다(not-parked). 기다리거나 듣는 중에 P 를 벗어나도 곧바로 그만두고,
 *   그때까지 들은 말은 버린다. 주행 중에 확인 화면을 띄우지 않기 위해서다.
 * - 앱 화면이 가려져 있으면(내비 전체 화면, 다른 앱) 듣지 않는다(paused). 기다리거나 듣는 중에 가려져도
 *   곧바로 그만두고 들은 말은 버린다. 보이지 않는 화면을 위해 마이크를 열지 않기 위해서다.
 * - 감자가 하던 말이 끝나고 [QUIET_BEFORE_MIC_MS] 가 지난 뒤에 마이크를 연다. 감자 목소리가 대답으로 들어가지 않게 한다.
 *   감자의 말이 [MAX_WAIT_MS] 넘게 이어지면 그래도 연다.
 * - 마이크를 연 뒤 [LISTEN_TIMEOUT_MS] 안에 끝낸다. 그때까지 들은 말이 있으면 그 말을 최종 결과로 보낸다.
 * - SDK 가 말이 끝났다고 알렸는데(onEndedRecognition) 최종 결과가 [FINAL_GRACE_MS] 안에 오지 않아도 같은 식으로 끝낸다.
 * - 받아들인 listen 하나는 final 이나 error 하나로 끝난다. 앱이 닫힐 때([reset])만 알리지 않는다.
 *
 * 안드로이드와 SDK 에 기대지 않는 순수 클래스라서 단위 테스트로 확인한다. 시각은 밀리초(ms)로 받는다.
 */
class ListenFlow {
    enum class Phase { IDLE, WAITING, LISTENING, ENDING }

    /** SpeechToText SDK 의 상태. */
    enum class Engine { READY, STARTING, ABSENT }

    /** 마이크를 열어도 되는지 볼 때의 형편. foreground 는 앱 화면이 앞에 있다(onResume 과 onPause 사이). */
    data class Conditions(
        val parked: Boolean,
        val engine: Engine,
        val speaking: Boolean,
        val foreground: Boolean = true,
    )

    /**
     * 웹으로 보내는 'stt' 메시지 하나.
     * state 는 [LISTENING], [PARTIAL], [FINAL], [ERROR] 가운데 하나. error 는 [ERROR] 일 때만 있다.
     * detail 은 SDK 가 알린 오류의 이름(ErrorType)이다.
     */
    data class Message(
        val state: String,
        val text: String? = null,
        val error: String? = null,
        val detail: String? = null,
    )

    sealed class Effect {
        /** SDK 의 request(). 부른 쪽은 성공하면 [micOpened], 실패하면 [micFailed] 를 부른다. */
        data object OpenMic : Effect()

        /** SDK 의 stop(). 마이크를 닫는다. */
        data object CloseMic : Effect()

        data class Send(val message: Message) : Effect()
    }

    var phase = Phase.IDLE
        private set

    /** 다음에 [tick] 을 불러야 할 시각. 없으면 null. */
    var deadline: Long? = null
        private set

    private var waitStartedAt = 0L
    private var quietSince: Long? = null
    private var heard = ""

    /** 웹이 듣기를 청했다. */
    fun listen(now: Long, conditions: Conditions): List<Effect> = when (phase) {
        // 이미 듣는 중이다. 상태만 다시 알린다.
        Phase.LISTENING -> listOf(Effect.Send(Message(LISTENING)))
        Phase.WAITING, Phase.ENDING -> emptyList()
        Phase.IDLE -> when {
            !conditions.parked -> listOf(Effect.Send(failure(NOT_PARKED)))
            !conditions.foreground -> listOf(Effect.Send(failure(PAUSED)))
            conditions.engine == Engine.ABSENT -> listOf(Effect.Send(failure(UNAVAILABLE)))
            else -> {
                phase = Phase.WAITING
                waitStartedAt = now
                quietSince = null
                heard = ""
                // 웹이 질문(speak)을 listen 보다 조금 늦게 넘겨도 그 말이 끝나기를 기다리도록 잠깐 둔다.
                deadline = now + FIRST_CHECK_MS
                emptyList()
            }
        }
    }

    /** [deadline] 이 됐다. 기다리는 중이면 마이크를 열지 보고, 듣는 중이면 끝낸다. */
    fun tick(now: Long, conditions: Conditions): List<Effect> {
        val due = deadline ?: return emptyList()
        if (now < due) return emptyList()
        return when (phase) {
            Phase.IDLE -> {
                deadline = null
                emptyList()
            }
            Phase.WAITING -> checkWaiting(now, conditions)
            Phase.LISTENING -> closeWith(heardOr(TIMEOUT))
            Phase.ENDING -> closeWith(heardOr(NO_SPEECH))
        }
    }

    private fun checkWaiting(now: Long, conditions: Conditions): List<Effect> {
        if (!conditions.parked) return finishWith(failure(NOT_PARKED))
        if (!conditions.foreground) return finishWith(failure(PAUSED))
        val waited = now - waitStartedAt
        when (conditions.engine) {
            Engine.ABSENT -> return finishWith(failure(UNAVAILABLE))
            Engine.STARTING -> {
                if (waited >= MAX_WAIT_MS) return finishWith(failure(UNAVAILABLE))
                deadline = now + POLL_MS
                return emptyList()
            }
            Engine.READY -> Unit
        }
        val since = quietSince
        quietSince = when {
            conditions.speaking -> null
            since == null -> now
            else -> since
        }
        val quietLongEnough = quietSince?.let { now - it >= QUIET_BEFORE_MIC_MS } ?: false
        if (!quietLongEnough && waited < MAX_WAIT_MS) {
            deadline = now + POLL_MS
            return emptyList()
        }
        deadline = null
        return listOf(Effect.OpenMic)
    }

    /** request() 가 성공했다. */
    fun micOpened(now: Long): List<Effect> {
        if (phase != Phase.WAITING) return emptyList()
        phase = Phase.LISTENING
        deadline = now + LISTEN_TIMEOUT_MS
        return listOf(Effect.Send(Message(LISTENING)))
    }

    /** request() 가 실패했다. */
    fun micFailed(): List<Effect> {
        if (phase != Phase.WAITING) return emptyList()
        return finishWith(failure(UNAVAILABLE))
    }

    /** SDK 가 중간 결과를 알렸다(onUpdated, completed = false). */
    fun onPartial(text: String): List<Effect> {
        if (!isMicOpen) return emptyList()
        val words = text.trim()
        if (words.isEmpty() || words == heard) return emptyList()
        heard = words
        return listOf(Effect.Send(Message(PARTIAL, text = words)))
    }

    /** SDK 가 최종 결과를 알렸다(onUpdated, completed = true). 비어 있으면 그때까지 들은 말을 쓴다. */
    fun onFinal(text: String): List<Effect> {
        if (!isMicOpen) return emptyList()
        heard = text.trim().ifEmpty { heard }
        return closeWith(heardOr(NO_SPEECH))
    }

    /** SDK 가 말이 끝났다고 알렸다(onEndedRecognition). 최종 결과는 조금 뒤에 올 수 있다. */
    fun onEnded(now: Long): List<Effect> {
        if (phase != Phase.LISTENING) return emptyList()
        phase = Phase.ENDING
        deadline = minOf(deadline ?: Long.MAX_VALUE, now + FINAL_GRACE_MS)
        return emptyList()
    }

    /** SDK 가 오류를 알렸다(onError). [sdkError] 는 ErrorType 의 이름이다. 들은 말이 있으면 그 말로 끝낸다. */
    fun onError(sdkError: String): List<Effect> {
        if (!isMicOpen) return emptyList()
        return closeWith(
            if (heard.isNotEmpty()) Message(FINAL, text = heard) else failure(errorCodeOf(sdkError), detail = sdkError),
        )
    }

    /** 웹이 듣기를 그만두라고 했다(stopListening). */
    fun cancel(): List<Effect> = abort(CANCELLED)

    /** 기어가 P 를 벗어났다. 들은 말도 버린다. */
    fun leftPark(): List<Effect> = abort(NOT_PARKED)

    /** 앱 화면이 가려졌다(onPause). 기다리거나 듣고 있었으면 그만두고 들은 말도 버린다. 웹은 다시 말하기를 권한다. */
    fun paused(): List<Effect> = abort(PAUSED)

    /** 앱을 닫는다. 마이크가 열려 있으면 닫고, 웹에는 알리지 않는다. */
    fun reset(): List<Effect> {
        val wasOpen = isMicOpen
        clear()
        return if (wasOpen) listOf(Effect.CloseMic) else emptyList()
    }

    private val isMicOpen: Boolean
        get() = phase == Phase.LISTENING || phase == Phase.ENDING

    private fun abort(code: String): List<Effect> = when (phase) {
        Phase.IDLE -> emptyList()
        Phase.WAITING -> finishWith(failure(code))
        Phase.LISTENING, Phase.ENDING -> closeWith(failure(code))
    }

    private fun heardOr(code: String): Message =
        if (heard.isNotEmpty()) Message(FINAL, text = heard) else failure(code)

    /** 마이크를 열기 전에 끝낸다. */
    private fun finishWith(message: Message): List<Effect> {
        clear()
        return listOf(Effect.Send(message))
    }

    /** 마이크를 닫고 끝낸다. 웹이 곧바로 다시 청해도 마이크는 닫힌 뒤다. */
    private fun closeWith(message: Message): List<Effect> {
        clear()
        return listOf(Effect.CloseMic, Effect.Send(message))
    }

    private fun clear() {
        phase = Phase.IDLE
        deadline = null
        quietSince = null
        heard = ""
    }

    companion object {
        const val LISTENING = "listening"
        const val PARTIAL = "partial"
        const val FINAL = "final"
        const val ERROR = "error"

        /** 기어가 P 가 아니다(기어를 모를 때도). 기다리거나 듣는 중에 P 를 벗어났을 때도. */
        const val NOT_PARKED = "not-parked"

        /** SpeechToText SDK 를 쓸 수 없다. Pleos 음성 서비스가 없거나, 권한이 없거나, 마이크를 열지 못했다. */
        const val UNAVAILABLE = "unavailable"

        /** 마이크를 연 뒤 [LISTEN_TIMEOUT_MS] 안에 알아들은 말이 없다. */
        const val TIMEOUT = "timeout"

        /** 인식이 끝났는데 알아들은 말이 없다. */
        const val NO_SPEECH = "no-speech"

        /** 웹이 stopListening() 으로 그만두게 했다. */
        const val CANCELLED = "cancelled"

        /** 앱 화면이 가려져 그만뒀거나, 가려진 동안 듣기를 청했다. */
        const val PAUSED = "paused"

        /** 그 밖의 SDK 오류. detail 에 ErrorType 이름이 있다. */
        const val RECOGNIZER = "recognizer"

        const val FIRST_CHECK_MS = 300L
        const val POLL_MS = 200L

        /** 감자의 말이 끝난 뒤 마이크를 열기까지 둘 틈. 스피커에 남은 소리가 들어가지 않게 한다. */
        const val QUIET_BEFORE_MIC_MS = 400L

        /** 감자의 말이나 SDK 준비를 기다리는 가장 긴 시간. */
        const val MAX_WAIT_MS = 15_000L

        /** 마이크를 연 뒤 듣는 가장 긴 시간. */
        const val LISTEN_TIMEOUT_MS = 8_000L

        /** 말이 끝났다는 신호 뒤 최종 결과를 기다리는 시간. */
        const val FINAL_GRACE_MS = 2_000L

        /** SDK 의 ErrorType 이름을 웹이 아는 오류로 줄인다. */
        fun errorCodeOf(sdkError: String): String = when (sdkError) {
            "TIMEOUT" -> TIMEOUT
            "PERMISSION_DENIED", "NOT_SUPPORTED_API" -> UNAVAILABLE
            else -> RECOGNIZER
        }

        private fun failure(code: String, detail: String? = null) = Message(ERROR, error = code, detail = detail)
    }
}
