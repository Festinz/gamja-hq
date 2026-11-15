package com.gamjahq.app

/** 웹앱의 작전본부 코어가 받는 차량 신호. web/src/core/hq.ts 의 VehicleSignal 과 같다. */
enum class Signal(val wire: String) {
    BOARD("board"),
    DEPART("depart"),
    CONGESTION_START("congestion-start"),
    CONGESTION_END("congestion-end"),
    PARK("park"),
}

/** 기어를 주차와 주행 두 가지로만 본다. N, R, D, 수동 단수는 모두 주행이다. */
enum class GearState { PARK, MOVING, UNKNOWN }

/**
 * 기어 변화를 차량 신호로 바꾼다.
 *
 * - 처음 읽은 기어가 P 면 탑승, 주행이면 출발 (주행 중에 앱이 켜진 경우)
 * - P 에서 벗어나면 출발
 * - P 로 돌아오면 주차
 *
 * 순수 로직이라 Pleos SDK 없이 테스트한다.
 */
class GearTracker {
    private var last: GearState? = null

    fun onGear(gear: GearState): Signal? {
        if (gear == GearState.UNKNOWN) return null
        val previous = last
        last = gear
        return when {
            previous == null -> if (gear == GearState.PARK) Signal.BOARD else Signal.DEPART
            previous == GearState.PARK && gear == GearState.MOVING -> Signal.DEPART
            previous == GearState.MOVING && gear == GearState.PARK -> Signal.PARK
            else -> null
        }
    }

    val isMoving: Boolean
        get() = last == GearState.MOVING

    /** 기어가 P 로 확인됐다. 기어를 아직 모르면 false 다. 말로 묻기는 이때만 듣는다. */
    val isParked: Boolean
        get() = last == GearState.PARK
}
