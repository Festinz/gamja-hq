package com.gamjahq.app

import android.car.Car
import android.car.VehiclePropertyIds
import android.car.hardware.CarPropertyValue
import android.car.hardware.property.CarPropertyManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * 차량 속도 (Android Automotive 의 PERF_VEHICLE_SPEED, m/s).
 *
 * Pleos Vehicle SDK 에는 속도 값이 없어 Android 의 차량 속성 API 로 읽는다. 계기판이 보여주는 속도와 같은 값이다.
 * 웹앱은 이 속도로 내비가 알려준 길 위를 나아간다. 내비의 위치가 바뀌면 그 위치로 맞춘다.
 * Pleos Connect 에뮬레이터에서는 Virtual Console 이 넣는 속도가 이 값으로 들어온다.
 *
 * 차량 서비스가 없거나 권한(android.car.permission.CAR_SPEED)이 없으면 아무것도 보내지 않는다.
 */
class VehicleSpeed(
    private val context: Context,
    private val onSpeed: (metersPerSecond: Float) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private var car: Car? = null
    private var manager: CarPropertyManager? = null
    private var lastSentAt = 0L

    var isAvailable = false
        private set

    private val callback = object : CarPropertyManager.CarPropertyEventCallback {
        override fun onChangeEvent(value: CarPropertyValue<*>) {
            val speed = (value.value as? Float) ?: return
            if (!speed.isFinite()) return
            val now = System.currentTimeMillis()
            // 1초에 10번이면 지도와 컵을 움직이기에 충분하다.
            if (now - lastSentAt < SEND_INTERVAL_MS) return
            lastSentAt = now
            main.post { onSpeed(speed.coerceAtLeast(0f)) }
        }

        override fun onErrorEvent(propertyId: Int, areaId: Int) {
            Log.w(TAG, "차량 속도 오류: property=$propertyId area=$areaId")
        }
    }

    fun start() {
        if (manager != null) return
        try {
            val c = Car.createCar(context) ?: return
            car = c
            val m = c.getCarManager(Car.PROPERTY_SERVICE) as? CarPropertyManager ?: return
            manager = m
            isAvailable = m.registerCallback(callback, VehiclePropertyIds.PERF_VEHICLE_SPEED, SENSOR_RATE_HZ)
            Log.i(TAG, "차량 속도 구독: $isAvailable")
        } catch (t: Throwable) {
            // 차량 서비스가 없는 기기, 또는 권한이 아직 없는 경우.
            Log.w(TAG, "차량 속도를 읽을 수 없습니다", t)
            stop()
        }
    }

    fun stop() {
        try {
            manager?.unregisterCallback(callback)
        } catch (t: Throwable) {
            Log.w(TAG, "차량 속도 구독 해제 실패", t)
        }
        try {
            car?.disconnect()
        } catch (t: Throwable) {
            Log.w(TAG, "차량 서비스 연결 해제 실패", t)
        }
        manager = null
        car = null
        isAvailable = false
    }

    private companion object {
        const val TAG = "GamjaSpeed"
        const val SEND_INTERVAL_MS = 100L
        const val SENSOR_RATE_HZ = 10f
    }
}
