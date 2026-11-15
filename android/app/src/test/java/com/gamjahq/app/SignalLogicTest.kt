package com.gamjahq.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GearTrackerTest {
    @Test
    fun `앱이 켜졌을 때 기어가 P 면 탑승이다`() {
        assertEquals(Signal.BOARD, GearTracker().onGear(GearState.PARK))
    }

    @Test
    fun `주행 중에 앱이 켜지면 출발이다`() {
        assertEquals(Signal.DEPART, GearTracker().onGear(GearState.MOVING))
    }

    @Test
    fun `P 에서 벗어나면 출발이고 P 로 돌아오면 주차다`() {
        val tracker = GearTracker()
        tracker.onGear(GearState.PARK)
        assertEquals(Signal.DEPART, tracker.onGear(GearState.MOVING))
        assertEquals(Signal.PARK, tracker.onGear(GearState.PARK))
    }

    @Test
    fun `주행 기어끼리 바뀌는 것은 신호가 아니다`() {
        val tracker = GearTracker()
        tracker.onGear(GearState.PARK)
        tracker.onGear(GearState.MOVING)
        assertNull(tracker.onGear(GearState.MOVING))
    }

    @Test
    fun `기어가 P 로 확인됐을 때만 주차 중이다`() {
        val tracker = GearTracker()
        assertEquals(false, tracker.isParked)
        tracker.onGear(GearState.UNKNOWN)
        assertEquals(false, tracker.isParked)
        tracker.onGear(GearState.PARK)
        assertEquals(true, tracker.isParked)
        tracker.onGear(GearState.MOVING)
        assertEquals(false, tracker.isParked)
    }

    @Test
    fun `알 수 없는 기어 값은 무시하고 직전 상태를 지킨다`() {
        val tracker = GearTracker()
        tracker.onGear(GearState.PARK)
        assertNull(tracker.onGear(GearState.UNKNOWN))
        assertEquals(Signal.DEPART, tracker.onGear(GearState.MOVING))
    }
}

class CongestionDetectorTest {
    private val jam = CongestionItem(offsetMeters = 50.0, isSlowOrWorse = true, roadName = "경부고속도로")
    private val farJam = jam.copy(offsetMeters = 3_000.0)
    private val smooth = jam.copy(isSlowOrWorse = false)

    @Test
    fun `가까운 정체가 두 번 이어지면 진입이다`() {
        val detector = CongestionDetector()
        assertNull(detector.onRouteState(listOf(jam)))
        assertEquals(CongestionChange.Entered("경부고속도로"), detector.onRouteState(listOf(jam)))
    }

    @Test
    fun `멀리 있는 정체와 원활한 구간은 진입이 아니다`() {
        val detector = CongestionDetector()
        repeat(3) { assertNull(detector.onRouteState(listOf(farJam, smooth))) }
    }

    @Test
    fun `한 번 튄 값으로는 진입하지 않는다`() {
        val detector = CongestionDetector()
        assertNull(detector.onRouteState(listOf(jam)))
        assertNull(detector.onRouteState(emptyList()))
        assertNull(detector.onRouteState(listOf(jam)))
    }

    @Test
    fun `정체가 두 번 연달아 사라지면 해소다`() {
        val detector = CongestionDetector()
        detector.onRouteState(listOf(jam))
        detector.onRouteState(listOf(jam))
        assertNull(detector.onRouteState(emptyList()))
        assertEquals(CongestionChange.Left, detector.onRouteState(emptyList()))
    }

    @Test
    fun `가까운 정체가 여럿이면 가장 가까운 도로 이름을 쓴다`() {
        val detector = CongestionDetector()
        val items = listOf(jam.copy(offsetMeters = 150.0, roadName = "양재대로"), jam)
        detector.onRouteState(items)
        assertEquals(CongestionChange.Entered("경부고속도로"), detector.onRouteState(items))
    }

    @Test
    fun `reset 뒤에는 처음부터 다시 판정한다`() {
        val detector = CongestionDetector()
        detector.onRouteState(listOf(jam))
        detector.onRouteState(listOf(jam))
        detector.reset()
        assertNull(detector.onRouteState(listOf(jam)))
        assertEquals(CongestionChange.Entered("경부고속도로"), detector.onRouteState(listOf(jam)))
    }
}

class AreaNameTest {
    @Test
    fun `지번 주소에서 동 이름을 꺼낸다`() {
        assertEquals("정자동", areaNameOf("경기도 성남시 분당구 정자동 178-1"))
    }

    @Test
    fun `도로명 주소는 구 이름까지만 쓴다`() {
        assertEquals("강남구", areaNameOf("서울특별시 강남구 테헤란로 152"))
    }

    @Test
    fun `읍면리도 지역 이름이다`() {
        assertEquals("안목리", areaNameOf("강원특별자치도 강릉시 견소동 안목리"))
    }

    @Test
    fun `주소가 없으면 빈 문자열이다`() {
        assertEquals("", areaNameOf(null))
        assertEquals("", areaNameOf("   "))
    }

    @Test
    fun `번지와 좌표는 남기지 않는다`() {
        assertEquals("성수동", areaNameOf("서울 성동구 성수동 2가 277-43"))
    }
}

class BumpTrackerTest {
    @Test
    fun `150m 안으로 들어온 방지턱을 한 번만 센다`() {
        val tracker = BumpTracker()
        assertEquals(0, tracker.onBumpsAhead(listOf(BumpAhead("a", 400))))
        assertEquals(1, tracker.onBumpsAhead(listOf(BumpAhead("a", 140))))
        assertEquals(0, tracker.onBumpsAhead(listOf(BumpAhead("a", 60))))
    }

    @Test
    fun `서로 다른 방지턱은 각각 센다`() {
        val tracker = BumpTracker()
        assertEquals(2, tracker.onBumpsAhead(listOf(BumpAhead("a", 100), BumpAhead("b", 120), BumpAhead("c", 900))))
        assertEquals(1, tracker.onBumpsAhead(listOf(BumpAhead("c", 90))))
    }

    @Test
    fun `reset 뒤에는 같은 방지턱도 다시 센다`() {
        val tracker = BumpTracker()
        tracker.onBumpsAhead(listOf(BumpAhead("a", 100)))
        tracker.reset()
        assertEquals(1, tracker.onBumpsAhead(listOf(BumpAhead("a", 100))))
    }
}

class CoordinateTest {
    @Test
    fun `한국 안의 좌표는 쓸 수 있다`() {
        assertEquals(true, isValidCoordinate(37.3947, 127.1112))
    }

    @Test
    fun `값을 모를 때 오는 좌표는 버린다`() {
        assertEquals(false, isValidCoordinate(0.0, 0.0))
        assertEquals(false, isValidCoordinate(Double.NaN, 127.0))
        assertEquals(false, isValidCoordinate(91.0, 127.0))
        assertEquals(false, isValidCoordinate(37.0, 181.0))
    }
}
