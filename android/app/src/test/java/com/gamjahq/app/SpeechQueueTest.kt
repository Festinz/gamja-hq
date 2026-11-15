package com.gamjahq.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SpeechQueueTest {
    @Test
    fun `말하는 중이 아니면 바로 말한다`() {
        val queue = SpeechQueue()
        assertEquals(SpeechQueue.Action.Speak("출발!"), queue.offer("출발!", urgent = false))
        assertEquals("출발!", queue.speaking)
    }

    @Test
    fun `보통 말은 하던 말을 끊지 않고 끝난 뒤에 나온다`() {
        val queue = SpeechQueue()
        queue.offer("근처 감자 부대를 찾는 중입니다!", urgent = false)
        assertEquals(SpeechQueue.Action.Wait, queue.offer("사령관님! 길이 막혔습니다.", urgent = false))
        assertEquals("근처 감자 부대를 찾는 중입니다!", queue.speaking)
        assertEquals("사령관님! 길이 막혔습니다.", queue.finished())
        assertNull(queue.finished())
    }

    @Test
    fun `같은 말은 다시 넣지 않는다`() {
        val queue = SpeechQueue()
        queue.offer("가", urgent = false)
        assertEquals(SpeechQueue.Action.Wait, queue.offer("가", urgent = false))
        queue.offer("나", urgent = false)
        queue.offer("나", urgent = false)
        assertEquals(listOf("나"), queue.waitingTexts)
    }

    @Test
    fun `안전 경고는 하던 보통 말을 끊고 바로 나온다`() {
        val queue = SpeechQueue()
        queue.offer("감자 넷이 모였어요", urgent = false)
        queue.offer("길이 풀렸습니다", urgent = false)
        assertEquals(
            SpeechQueue.Action.Interrupt("속도를 줄여 주십시오!"),
            queue.offer("속도를 줄여 주십시오!", urgent = true),
        )
        assertEquals("속도를 줄여 주십시오!", queue.speaking)
        assertTrue(queue.speakingUrgent)
        // 끊긴 말은 경고 뒤에 처음부터 다시 나오고, 기다리던 보통 말이 그 뒤를 잇는다.
        assertEquals(listOf("감자 넷이 모였어요", "길이 풀렸습니다"), queue.waitingTexts)
        assertEquals("감자 넷이 모였어요", queue.finished())
        assertFalse(queue.speakingUrgent)
        assertEquals("길이 풀렸습니다", queue.finished())
    }

    @Test
    fun `경고끼리는 끊지 않고 기다리는 보통 말 앞에 선다`() {
        val queue = SpeechQueue()
        queue.offer("방지턱입니다", urgent = true)
        queue.offer("감자 넷이 모였어요", urgent = false)
        assertEquals(SpeechQueue.Action.Wait, queue.offer("어린이 사고가 잦은 곳입니다", urgent = true))
        assertEquals("방지턱입니다", queue.speaking)
        assertEquals(listOf("어린이 사고가 잦은 곳입니다", "감자 넷이 모였어요"), queue.waitingTexts)
    }

    @Test
    fun `줄이 넘치면 오래된 보통 말부터 버리고 경고는 남긴다`() {
        val queue = SpeechQueue()
        queue.offer("경고 중", urgent = true)
        queue.offer("방지턱", urgent = true)
        queue.offer("하나", urgent = false)
        queue.offer("둘", urgent = false)
        queue.offer("셋", urgent = false)
        assertEquals(listOf("방지턱", "둘", "셋"), queue.waitingTexts)
    }

    @Test
    fun `거둔 말은 기다리는 줄에서 빠지고 하던 말이면 멈추라고 알린다`() {
        val queue = SpeechQueue()
        queue.offer("사령관님! 커피가 탑승했습니다.", urgent = false)
        queue.offer("오늘은 어떤 커피 실었어?", urgent = false, parkedOnly = true)
        assertFalse(queue.withdraw("오늘은 어떤 커피 실었어?"))
        assertEquals(emptyList<String>(), queue.waitingTexts)
        assertNull(queue.finished())

        queue.offer("오늘은 어떤 커피 실었어?", urgent = false, parkedOnly = true)
        assertTrue(queue.withdraw("오늘은 어떤 커피 실었어?"))
        assertNull(queue.finished())
        // 이미 끝난 말을 거둬도 아무 일도 없다.
        assertFalse(queue.withdraw("오늘은 어떤 커피 실었어?"))
    }

    @Test
    fun `기어가 P 를 벗어나면 주차 중에만 하는 말을 버리고 하던 그 말은 멈추라고 알린다`() {
        val queue = SpeechQueue()
        queue.offer("사령관님! 커피가 탑승했습니다.", urgent = false)
        queue.offer("오늘은 어떤 커피 실었어?", urgent = false, parkedOnly = true)
        // 기다리던 질문만 버리고 하던 탑승 인사는 이어 간다.
        assertFalse(queue.dropParkedOnly())
        assertEquals("사령관님! 커피가 탑승했습니다.", queue.speaking)
        assertEquals(emptyList<String>(), queue.waitingTexts)
        assertNull(queue.finished())

        // 하던 말이 질문이면 멈추라고 알린다. 뒤에 선 보통 말은 남는다.
        queue.offer("오늘은 어떤 커피 실었어?", urgent = false, parkedOnly = true)
        queue.offer("출발! 운전에 집중해.", urgent = false)
        assertTrue(queue.dropParkedOnly())
        assertEquals("출발! 운전에 집중해.", queue.finished())
        assertFalse(queue.dropParkedOnly())
    }

    @Test
    fun `안전 경고가 끊은 질문은 다시 설 때도 주차 중에만 하는 말이다`() {
        val queue = SpeechQueue()
        queue.offer("오늘은 어떤 커피 실었어?", urgent = false, parkedOnly = true)
        queue.offer("방지턱입니다", urgent = true)
        assertEquals(listOf("오늘은 어떤 커피 실었어?"), queue.waitingTexts)
        // 경고를 하는 중에 P 를 벗어나면 다시 서 있던 질문은 버리고 경고는 멈추지 않는다.
        assertFalse(queue.dropParkedOnly())
        assertEquals(emptyList<String>(), queue.waitingTexts)
        assertNull(queue.finished())
    }

    @Test
    fun `끝 신호를 기다리는 시간은 길이에 비례하고 15초를 넘지 않는다`() {
        assertEquals(2_250L, SpeechQueue.watchdogMs("가나다"))
        assertEquals(15_000L, SpeechQueue.watchdogMs("가".repeat(200)))
    }
}
