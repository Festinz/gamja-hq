package com.gamjahq.app

import com.gamjahq.app.ListenFlow.Conditions
import com.gamjahq.app.ListenFlow.Effect
import com.gamjahq.app.ListenFlow.Effect.CloseMic
import com.gamjahq.app.ListenFlow.Effect.OpenMic
import com.gamjahq.app.ListenFlow.Engine
import com.gamjahq.app.ListenFlow.Message
import com.gamjahq.app.ListenFlow.Phase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ListenFlowTest {
    private val quiet = Conditions(parked = true, engine = Engine.READY, speaking = false)
    private val speaking = quiet.copy(speaking = true)
    private val driving = quiet.copy(parked = false)
    private val hidden = quiet.copy(foreground = false)
    private val nothing = emptyList<Effect>()

    private fun send(state: String, text: String? = null) = Effect.Send(Message(state, text = text))

    private fun failed(error: String, detail: String? = null) =
        Effect.Send(Message(ListenFlow.ERROR, error = error, detail = detail))

    /** listen 부터 마이크가 열리기까지 [deadline] 마다 깨운다. 마이크를 연 시각을 돌려준다. */
    private fun ListenFlow.openMic(start: Long = 0L, conditions: Conditions = quiet): Long {
        listen(start, conditions)
        repeat(200) {
            val now = deadline ?: error("깨울 시각이 없다")
            if (tick(now, conditions) == listOf(OpenMic)) {
                micOpened(now)
                return now
            }
        }
        error("마이크가 열리지 않았다")
    }

    /** 무언가 일어날 때까지 [deadline] 마다 깨운다. */
    private fun ListenFlow.tickUntilSomething(conditions: Conditions): Pair<Long, List<Effect>> {
        repeat(200) {
            val now = deadline ?: error("깨울 시각이 없다")
            val effects = tick(now, conditions)
            if (effects.isNotEmpty()) return now to effects
        }
        error("아무 일도 일어나지 않았다")
    }

    @Test
    fun `기어가 P 가 아니면 듣지 않는다`() {
        val flow = ListenFlow()
        assertEquals(listOf(failed(ListenFlow.NOT_PARKED)), flow.listen(0, driving))
        assertEquals(Phase.IDLE, flow.phase)
        assertNull(flow.deadline)
    }

    @Test
    fun `음성 인식을 쓸 수 없으면 바로 알린다`() {
        val flow = ListenFlow()
        assertEquals(listOf(failed(ListenFlow.UNAVAILABLE)), flow.listen(0, quiet.copy(engine = Engine.ABSENT)))
        assertEquals(Phase.IDLE, flow.phase)
    }

    @Test
    fun `감자의 말이 끝나고 잠깐 뒤에 마이크를 연다`() {
        val flow = ListenFlow()
        assertEquals(nothing, flow.listen(0, speaking))
        assertEquals(300L, flow.deadline)
        assertEquals(nothing, flow.tick(300, speaking))
        assertEquals(nothing, flow.tick(500, quiet))
        assertEquals(nothing, flow.tick(700, quiet))
        assertEquals(listOf(OpenMic), flow.tick(900, quiet))
        assertEquals(listOf(send(ListenFlow.LISTENING)), flow.micOpened(900))
        assertEquals(Phase.LISTENING, flow.phase)
        assertEquals(900L + ListenFlow.LISTEN_TIMEOUT_MS, flow.deadline)
    }

    @Test
    fun `감자가 다시 말하면 조용한 시간을 처음부터 잰다`() {
        val flow = ListenFlow()
        flow.listen(0, quiet)
        assertEquals(nothing, flow.tick(300, quiet))
        assertEquals(nothing, flow.tick(500, speaking))
        assertEquals(nothing, flow.tick(700, quiet))
        assertEquals(nothing, flow.tick(900, quiet))
        assertEquals(listOf(OpenMic), flow.tick(1_100, quiet))
    }

    @Test
    fun `감자의 말이 너무 길면 15초 뒤에는 그래도 연다`() {
        val flow = ListenFlow()
        flow.listen(0, speaking)
        val (at, effects) = flow.tickUntilSomething(speaking)
        assertEquals(listOf(OpenMic), effects)
        assertTrue(at >= ListenFlow.MAX_WAIT_MS && at < ListenFlow.MAX_WAIT_MS + ListenFlow.POLL_MS)
    }

    @Test
    fun `SDK 가 늦게 준비되면 기다렸다가 열고 15초 안에 안 되면 unavailable`() {
        val starting = quiet.copy(engine = Engine.STARTING)
        val late = ListenFlow()
        late.listen(0, starting)
        assertEquals(nothing, late.tick(300, starting))
        assertEquals(nothing, late.tick(500, quiet))
        assertEquals(nothing, late.tick(700, quiet))
        assertEquals(listOf(OpenMic), late.tick(900, quiet))

        val never = ListenFlow()
        never.listen(0, starting)
        val (at, effects) = never.tickUntilSomething(starting)
        assertEquals(listOf(failed(ListenFlow.UNAVAILABLE)), effects)
        assertTrue(at >= ListenFlow.MAX_WAIT_MS)
        assertEquals(Phase.IDLE, never.phase)
    }

    @Test
    fun `기다리는 중에 P 를 벗어나면 마이크를 열지 않는다`() {
        val flow = ListenFlow()
        flow.listen(0, speaking)
        assertEquals(listOf(failed(ListenFlow.NOT_PARKED)), flow.tick(300, driving))
        assertEquals(Phase.IDLE, flow.phase)

        val other = ListenFlow()
        other.listen(0, speaking)
        assertEquals(listOf(failed(ListenFlow.NOT_PARKED)), other.leftPark())
        assertNull(other.deadline)
    }

    @Test
    fun `앱 화면이 가려져 있으면 듣지 않는다`() {
        val flow = ListenFlow()
        assertEquals(listOf(failed(ListenFlow.PAUSED)), flow.listen(0, hidden))
        assertEquals(Phase.IDLE, flow.phase)
        assertNull(flow.deadline)
        // 기어가 P 가 아니면 그 까닭을 먼저 알린다.
        assertEquals(listOf(failed(ListenFlow.NOT_PARKED)), flow.listen(0, hidden.copy(parked = false)))
    }

    @Test
    fun `기다리는 중에 화면이 가려지면 마이크를 열지 않는다`() {
        val flow = ListenFlow()
        flow.listen(0, speaking)
        assertEquals(listOf(failed(ListenFlow.PAUSED)), flow.tick(300, hidden))
        assertEquals(Phase.IDLE, flow.phase)

        val other = ListenFlow()
        other.listen(0, speaking)
        assertEquals(listOf(failed(ListenFlow.PAUSED)), other.paused())
        assertNull(other.deadline)
    }

    @Test
    fun `듣는 중에 화면이 가려지면 마이크를 닫고 들은 말을 버린다`() {
        val flow = ListenFlow()
        flow.openMic()
        flow.onPartial("스타벅스 톨")
        assertEquals(listOf(CloseMic, failed(ListenFlow.PAUSED)), flow.paused())
        assertEquals(Phase.IDLE, flow.phase)
        // 늦게 온 결과는 버리고, 쉬는 중에는 아무 일도 없다.
        assertEquals(nothing, flow.onFinal("스타벅스 톨"))
        assertEquals(nothing, flow.paused())
    }

    @Test
    fun `중간 결과를 보내고 같은 말은 다시 보내지 않는다`() {
        val flow = ListenFlow()
        flow.openMic()
        assertEquals(listOf(send(ListenFlow.PARTIAL, "스타벅스")), flow.onPartial(" 스타벅스 "))
        assertEquals(nothing, flow.onPartial("스타벅스"))
        assertEquals(nothing, flow.onPartial("  "))
        assertEquals(listOf(send(ListenFlow.PARTIAL, "스타벅스 그란데")), flow.onPartial("스타벅스 그란데"))
    }

    @Test
    fun `최종 결과를 보내고 마이크를 닫는다`() {
        val flow = ListenFlow()
        flow.openMic()
        flow.onPartial("스타벅스 그란데")
        assertEquals(
            listOf(CloseMic, send(ListenFlow.FINAL, "스타벅스 그란데 아이스")),
            flow.onFinal(" 스타벅스 그란데 아이스 "),
        )
        assertEquals(Phase.IDLE, flow.phase)
        assertNull(flow.deadline)
    }

    @Test
    fun `최종 결과가 비면 들은 말을 쓰고 그것도 없으면 no-speech`() {
        val withPartial = ListenFlow()
        withPartial.openMic()
        withPartial.onPartial("빽다방 아이스")
        assertEquals(listOf(CloseMic, send(ListenFlow.FINAL, "빽다방 아이스")), withPartial.onFinal(""))

        val silent = ListenFlow()
        silent.openMic()
        assertEquals(listOf(CloseMic, failed(ListenFlow.NO_SPEECH)), silent.onFinal(" "))
    }

    @Test
    fun `8초 안에 알아들은 말이 없으면 timeout`() {
        val flow = ListenFlow()
        val opened = flow.openMic()
        assertEquals(opened + 8_000, flow.deadline)
        assertEquals(nothing, flow.tick(opened + 7_999, quiet))
        assertEquals(listOf(CloseMic, failed(ListenFlow.TIMEOUT)), flow.tick(opened + 8_000, quiet))
        assertEquals(Phase.IDLE, flow.phase)
    }

    @Test
    fun `8초가 되면 그때까지 들은 말로 끝낸다`() {
        val flow = ListenFlow()
        val opened = flow.openMic()
        flow.onPartial("컴포즈 아메리카노 큰 거")
        assertEquals(
            listOf(CloseMic, send(ListenFlow.FINAL, "컴포즈 아메리카노 큰 거")),
            flow.tick(opened + 8_000, quiet),
        )
    }

    @Test
    fun `말이 끝났다는 신호 뒤 2초 안에 최종 결과가 없으면 들은 말로 끝낸다`() {
        val flow = ListenFlow()
        val opened = flow.openMic()
        flow.onPartial("메가커피 아이스")
        assertEquals(nothing, flow.onEnded(opened + 3_000))
        assertEquals(Phase.ENDING, flow.phase)
        assertEquals(opened + 5_000, flow.deadline)
        // 마무리 중에 온 최종 결과는 받는다.
        assertEquals(listOf(CloseMic, send(ListenFlow.FINAL, "메가커피 아이스 뚜껑 닫았어")), flow.onFinal("메가커피 아이스 뚜껑 닫았어"))

        val late = ListenFlow()
        val lateOpened = late.openMic()
        late.onEnded(lateOpened + 1_000)
        assertEquals(listOf(CloseMic, failed(ListenFlow.NO_SPEECH)), late.tick(lateOpened + 3_000, quiet))
    }

    @Test
    fun `말이 끝났다는 신호가 늦게 와도 8초를 넘기지 않는다`() {
        val flow = ListenFlow()
        val opened = flow.openMic()
        flow.onEnded(opened + 7_000)
        assertEquals(opened + 8_000, flow.deadline)
    }

    @Test
    fun `듣는 중에 P 를 벗어나면 마이크를 닫고 들은 말을 버린다`() {
        val flow = ListenFlow()
        flow.openMic()
        flow.onPartial("투썸 레귤러")
        assertEquals(listOf(CloseMic, failed(ListenFlow.NOT_PARKED)), flow.leftPark())
        assertEquals(Phase.IDLE, flow.phase)
        // 늦게 온 결과는 버린다.
        assertEquals(nothing, flow.onFinal("투썸 레귤러"))
    }

    @Test
    fun `stopListening 은 cancelled 로 끝내고 쉬는 중에는 아무 일도 없다`() {
        val flow = ListenFlow()
        assertEquals(nothing, flow.cancel())
        flow.openMic()
        assertEquals(listOf(CloseMic, failed(ListenFlow.CANCELLED)), flow.cancel())
        assertEquals(nothing, flow.cancel())

        val waiting = ListenFlow()
        waiting.listen(0, speaking)
        assertEquals(listOf(failed(ListenFlow.CANCELLED)), waiting.cancel())
    }

    @Test
    fun `SDK 오류는 웹이 아는 오류로 줄이고 이름을 detail 에 담는다`() {
        val mic = ListenFlow()
        mic.openMic()
        assertEquals(listOf(CloseMic, failed(ListenFlow.RECOGNIZER, "MIC_ERROR")), mic.onError("MIC_ERROR"))

        val permission = ListenFlow()
        permission.openMic()
        assertEquals(
            listOf(CloseMic, failed(ListenFlow.UNAVAILABLE, "PERMISSION_DENIED")),
            permission.onError("PERMISSION_DENIED"),
        )

        assertEquals(ListenFlow.TIMEOUT, ListenFlow.errorCodeOf("TIMEOUT"))
        assertEquals(ListenFlow.UNAVAILABLE, ListenFlow.errorCodeOf("NOT_SUPPORTED_API"))
        assertEquals(ListenFlow.RECOGNIZER, ListenFlow.errorCodeOf("NETWORK_ERROR"))
        assertEquals(ListenFlow.RECOGNIZER, ListenFlow.errorCodeOf("새로 생긴 오류"))
    }

    @Test
    fun `SDK 오류가 와도 들은 말이 있으면 그 말로 끝낸다`() {
        val flow = ListenFlow()
        flow.openMic()
        flow.onPartial("이디야 라지")
        assertEquals(listOf(CloseMic, send(ListenFlow.FINAL, "이디야 라지")), flow.onError("NETWORK_ERROR"))
    }

    @Test
    fun `마이크가 열려 있지 않으면 SDK 신호를 무시한다`() {
        val idle = ListenFlow()
        assertEquals(nothing, idle.onPartial("스타벅스"))
        assertEquals(nothing, idle.onFinal("스타벅스"))
        assertEquals(nothing, idle.onEnded(0))
        assertEquals(nothing, idle.onError("MIC_ERROR"))

        val waiting = ListenFlow()
        waiting.listen(0, speaking)
        assertEquals(nothing, waiting.onFinal("앞 차례의 결과"))
        assertEquals(nothing, waiting.onError("INVALID_REQUEST_ERROR"))
        assertEquals(Phase.WAITING, waiting.phase)
    }

    @Test
    fun `듣는 중에 다시 청하면 listening 만 다시 알린다`() {
        val flow = ListenFlow()
        flow.listen(0, speaking)
        assertEquals(nothing, flow.listen(100, speaking))
        assertEquals(300L, flow.deadline)

        val open = ListenFlow()
        val opened = open.openMic()
        assertEquals(listOf(send(ListenFlow.LISTENING)), open.listen(opened + 1_000, quiet))
        assertEquals(opened + 8_000, open.deadline)
    }

    @Test
    fun `마이크를 열지 못하면 unavailable`() {
        val flow = ListenFlow()
        flow.listen(0, quiet)
        val (_, effects) = flow.tickUntilSomething(quiet)
        assertEquals(listOf(OpenMic), effects)
        assertEquals(listOf(failed(ListenFlow.UNAVAILABLE)), flow.micFailed())
        assertEquals(Phase.IDLE, flow.phase)
    }

    @Test
    fun `앱을 닫으면 마이크만 닫고 웹에는 알리지 않는다`() {
        val flow = ListenFlow()
        assertEquals(nothing, flow.reset())
        flow.openMic()
        assertEquals(listOf(CloseMic), flow.reset())
        assertEquals(Phase.IDLE, flow.phase)
        assertNull(flow.deadline)
    }
}
