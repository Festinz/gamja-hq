package com.gamjahq.app

/** 경로 앞의 과속방지턱 하나. NaviHelper 의 CautionPoint(SPEED_BUMP)에서 필요한 것만 옮긴다. */
data class BumpAhead(val id: String, val remainMeters: Int)

/**
 * 내비가 알려주는 "앞쪽 과속방지턱 목록"에서, 이제 막 가까워진 방지턱을 골라낸다.
 *
 * 내비는 같은 방지턱을 가까워지는 동안 여러 번 알려준다. 방지턱 하나에 한 번만 알리고 세도록,
 * [nearMeters] 안으로 처음 들어온 순간에만 새 방지턱으로 친다.
 */
class BumpTracker(private val nearMeters: Int = 150) {
    private val counted = HashSet<String>()

    /** 이번 목록에서 새로 가까워진 방지턱 수를 돌려준다. */
    fun onBumpsAhead(bumps: List<BumpAhead>): Int =
        bumps.count { it.remainMeters in 0..nearMeters && counted.add(it.id) }

    /** 주차하면 처음 상태로 돌린다. */
    fun reset() {
        counted.clear()
    }
}
