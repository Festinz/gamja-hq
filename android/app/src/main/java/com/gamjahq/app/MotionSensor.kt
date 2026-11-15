package com.gamjahq.app

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager

/**
 * 차량(헤드유닛)의 가속도 센서.
 *
 * 커피 운송작전의 컵 모형은 차가 받는 힘으로 수면을 계산한다. 센서가 있으면 그 값을 그대로 쓰고,
 * 없으면 웹앱이 내비가 준 길의 모양과 속도로 힘을 계산한다.
 * 값은 기기 좌표계의 m/s² 이다. 어느 쪽이 "아래"인지는 웹앱이 서 있는 동안의 값으로 배운다.
 */
class MotionSensor(
    context: Context,
    private val onSample: (x: Float, y: Float, z: Float) -> Unit,
) : SensorEventListener {
    private val manager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    private val sensor: Sensor? =
        manager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
            ?: manager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER_UNCALIBRATED)
    private val smooth = FloatArray(3)
    private var hasValue = false
    private var lastSentAt = 0L

    val isAvailable: Boolean get() = sensor != null

    fun start() {
        val s = sensor ?: return
        manager?.registerListener(this, s, SensorManager.SENSOR_DELAY_GAME)
    }

    fun stop() {
        manager?.unregisterListener(this)
        hasValue = false
    }

    override fun onSensorChanged(event: SensorEvent) {
        // 잔떨림을 걸러낸다. 컵 속 수면의 출렁임(약 3.4Hz)보다 빠른 떨림은 수면에 닿지 않는다.
        for (i in 0..2) {
            smooth[i] = if (hasValue) smooth[i] + SMOOTHING * (event.values[i] - smooth[i]) else event.values[i]
        }
        hasValue = true
        val now = event.timestamp / 1_000_000
        if (now - lastSentAt < SEND_INTERVAL_MS) return
        lastSentAt = now
        onSample(smooth[0], smooth[1], smooth[2])
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    private companion object {
        /** 1초에 15번쯤 웹앱으로 보낸다. */
        const val SEND_INTERVAL_MS = 66L
        const val SMOOTHING = 0.35f
    }
}
