package com.gamjahq.app

/**
 * 감자의 말을 차례로 내보내는 줄. web/src/app/speechQueue.ts 와 같은 규칙이다.
 *
 * Pleos TextToSpeech 의 speak 는 새 문장이 오면 하던 말을 끊는다. 그래서 정체에 들어설 때
 * "근처 감자 부대를 찾는 중입니다!"가 반쯤 잘리고 다음 말이 나왔다. 이제는 하던 말이 끝난 뒤에
 * 다음 말을 꺼낸다.
 *
 * - 지금 말하는 문장이나 이미 기다리는 문장과 같은 말은 넣지 않는다.
 * - 보통 말은 하던 말을 끊지 않는다.
 * - 안전 경고(urgent)는 늦으면 안 된다. 보통 말을 하는 중이면 그 말을 끊고 바로 말한다.
 *   끊긴 말은 보통 말들 맨 앞으로 돌아가 경고 뒤에 처음부터 다시 한다.
 *   경고끼리는 끊지 않고, 기다리는 보통 말들 앞에 선다.
 * - 기다리는 말이 [MAX_WAITING] 개를 넘으면 오래된 보통 말부터 버린다.
 * - 거둔 말([withdraw])은 줄에서 빼고, 하던 말이면 부른 쪽이 멈추고 다음 말로 넘어간다.
 * - 주차한 채(기어 P)에서만 하는 말([Item.parkedOnly], 커피 묻기의 질문)은 P 를 벗어나면([dropParkedOnly])
 *   버리고, 하던 말이면 멈춘다. 주행 중에 "브랜드랑 사이즈를 말해 줘"가 나오지 않게 한다.
 *
 * 안드로이드에 기대지 않는 순수 클래스라서 단위 테스트로 확인한다.
 */
class SpeechQueue {
    data class Item(val text: String, val urgent: Boolean, val parkedOnly: Boolean = false)

    /** 말을 넣은 뒤 할 일. */
    sealed class Action {
        /** 바로 말한다(하던 말이 없었다). */
        data class Speak(val text: String) : Action()

        /** 하던 보통 말을 끊고 이 경고를 바로 말한다. */
        data class Interrupt(val text: String) : Action()

        /** 기다린다. */
        data object Wait : Action()
    }

    private val waiting = ArrayList<Item>()

    /** 지금 말하는 문장. 없으면 null. */
    var speaking: String? = null
        private set

    /** 지금 말하는 문장이 안전 경고인가. */
    var speakingUrgent = false
        private set

    /** 지금 말하는 문장이 주차한 채에서만 하는 말인가. */
    var speakingParkedOnly = false
        private set

    val waitingTexts: List<String> get() = waiting.map { it.text }

    /** 말을 줄에 넣고 할 일을 돌려준다. [parkedOnly] 는 주차한 채(기어 P)에서만 하는 말이다. */
    fun offer(text: String, urgent: Boolean, parkedOnly: Boolean = false): Action {
        if (text == speaking || waiting.any { it.text == text }) return Action.Wait
        val cut = speaking
        if (urgent && cut != null && !speakingUrgent) {
            // 끊긴 보통 말은 보통 말들 맨 앞으로 돌아가, 경고가 끝난 뒤 처음부터 다시 한다.
            // 주차한 채에서만 하는 말이었으면 그 표시도 남긴다.
            waiting.removeAll { it.text == cut }
            val firstNormal = waiting.indexOfFirst { !it.urgent }
            waiting.add(if (firstNormal == -1) waiting.size else firstNormal, Item(cut, false, speakingParkedOnly))
            trim()
            speaking = text
            speakingUrgent = true
            speakingParkedOnly = parkedOnly
            return Action.Interrupt(text)
        }
        val item = Item(text, urgent, parkedOnly)
        if (urgent) {
            val firstNormal = waiting.indexOfFirst { !it.urgent }
            if (firstNormal == -1) waiting.add(item) else waiting.add(firstNormal, item)
        } else {
            waiting.add(item)
        }
        trim()
        return if (speaking == null) next()?.let { Action.Speak(it) } ?: Action.Wait else Action.Wait
    }

    private fun trim() {
        while (waiting.size > MAX_WAITING) {
            val oldestNormal = waiting.indexOfFirst { !it.urgent }
            waiting.removeAt(if (oldestNormal == -1) 0 else oldestNormal)
        }
    }

    /** 하던 말이 끝났다. 다음에 말할 문장을 돌려준다(없으면 null). */
    fun finished(): String? {
        speaking = null
        speakingUrgent = false
        speakingParkedOnly = false
        return next()
    }

    /**
     * 한 문장을 거둔다. 기다리던 그 말은 버린다. 지금 하는 말이면 true 를 돌려준다:
     * 부른 쪽이 엔진을 멈추고 [finished] 로 다음 말을 꺼낸다. 이미 끝난 말이면 아무 일도 없다.
     */
    fun withdraw(text: String): Boolean {
        waiting.removeAll { it.text == text }
        return speaking == text
    }

    /**
     * 기어가 P 를 벗어났다. 주차한 채에서만 하는 말([Item.parkedOnly])을 버린다. 지금 하는 말이 그런 말이면
     * true 를 돌려준다: 부른 쪽이 엔진을 멈추고 [finished] 로 다음 말을 꺼낸다.
     */
    fun dropParkedOnly(): Boolean {
        waiting.removeAll { it.parkedOnly }
        return speaking != null && speakingParkedOnly
    }

    /** 모두 비운다. 앱을 닫을 때 쓴다. */
    fun clear() {
        waiting.clear()
        speaking = null
        speakingUrgent = false
        speakingParkedOnly = false
    }

    private fun next(): String? {
        if (waiting.isEmpty()) return null
        val item = waiting.removeAt(0)
        speaking = item.text
        speakingUrgent = item.urgent
        speakingParkedOnly = item.parkedOnly
        return item.text
    }

    companion object {
        const val MAX_WAITING = 3

        /** 끝 신호가 오지 않을 때 다음 말로 넘어갈 시간(ms). 한국어는 한 글자에 0.2초 안팎이다. */
        fun watchdogMs(text: String): Long = minOf(15_000L, 1_500L + text.length * 250L)
    }
}
