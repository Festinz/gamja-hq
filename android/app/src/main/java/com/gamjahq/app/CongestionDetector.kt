package com.gamjahq.app

/** 경로 위 정체 구간 하나. NaviHelper 의 TrafficCongestionInfo 에서 필요한 것만 옮긴다. */
data class CongestionItem(
    /** 구간 시작까지 남은 거리 (m). */
    val offsetMeters: Double,
    /** 정체 정도가 SLOW 이상인가. */
    val isSlowOrWorse: Boolean,
    val roadName: String,
)

sealed interface CongestionChange {
    data class Entered(val roadName: String) : CongestionChange
    data object Left : CongestionChange
}

/**
 * 경로 상태를 주기적으로 받아 "정체 구간에 들어섰다 / 벗어났다"를 판정한다.
 *
 * 차가 정체 구간 시작점에서 [nearMeters] 안에 있으면 정체 안으로 본다.
 * 한 번의 튀는 값에 흔들리지 않도록 같은 판정이 [confirmations]번 이어져야 바뀐다.
 *
 * TrafficCongestionInfo.offset 이 "현재 위치에서 구간 시작까지의 거리"라는 가정 위에 있다.
 * 이 가정은 Pleos Connect 에뮬레이터에서 실제 값을 보고 확인해야 한다.
 */
class CongestionDetector(
    private val nearMeters: Double = 200.0,
    private val confirmations: Int = 2,
) {
    private var inside = false
    private var streak = 0

    fun onRouteState(items: List<CongestionItem>): CongestionChange? {
        val current = items
            .filter { it.isSlowOrWorse && it.offsetMeters <= nearMeters }
            .minByOrNull { it.offsetMeters }
        val nowInside = current != null

        if (nowInside == inside) {
            streak = 0
            return null
        }
        streak += 1
        if (streak < confirmations) return null

        inside = nowInside
        streak = 0
        return if (current != null) CongestionChange.Entered(current.roadName) else CongestionChange.Left
    }

    /** 주차하면 처음 상태로 돌린다. */
    fun reset() {
        inside = false
        streak = 0
    }
}
