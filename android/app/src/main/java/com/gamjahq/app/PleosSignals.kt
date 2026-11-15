package com.gamjahq.app

import ai.pleos.playground.navi.constants.CautionPointType
import ai.pleos.playground.navi.constants.NaviErrorCode
import ai.pleos.playground.navi.constants.NavigationStatus
import ai.pleos.playground.navi.constants.RouteOption
import ai.pleos.playground.navi.constants.TrafficCongestionType
import ai.pleos.playground.navi.data.CautionPoint
import ai.pleos.playground.navi.data.CurrentLocationInfo
import ai.pleos.playground.navi.data.DestinationArrivedInfo
import ai.pleos.playground.navi.data.DestinationInfo
import ai.pleos.playground.navi.data.RouteInfo
import ai.pleos.playground.navi.data.TBTInfo
import ai.pleos.playground.navi.data.TripInfo
import ai.pleos.playground.navi.data.DrivingInfo
import ai.pleos.playground.navi.data.RouteStartInfo
import ai.pleos.playground.navi.data.RouteStateInfo
import ai.pleos.playground.navi.helper.NaviHelper
import ai.pleos.playground.navi.helper.listener.NaviHelperEventListener
import ai.pleos.playground.vehicle.Vehicle
import ai.pleos.playground.vehicle.constant.control.VehicleGear
import ai.pleos.playground.vehicle.listener.GearSelectionListener
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * 차량 신호원(VehicleSignalSource)의 실제 구현.
 *
 * Pleos SDK 이벤트를 웹앱이 아는 다섯 가지 신호로 바꾼다.
 *
 * | 신호        | 어디서 오는가                                                        |
 * |-------------|----------------------------------------------------------------------|
 * | 탑승        | Vehicle SDK: 앱이 켜졌을 때 기어가 P                                 |
 * | 출발        | Vehicle SDK: GearSelectionListener, P 에서 벗어남                    |
 * | 정체 진입   | NaviHelper SDK: getRouteStateInfo 의 정체 구간이 가까워짐 (SLOW 이상) |
 * | 정체 해소   | NaviHelper SDK: 가까운 정체 구간이 사라짐                            |
 * | 주차        | Vehicle SDK: GearSelectionListener, P 로 돌아옴                      |
 * | 방지턱      | NaviHelper SDK: onCautionPointInfo 의 SPEED_BUMP 가 150m 안으로 들어옴 |
 *
 * 출발지와 목적지 이름은 NaviHelper SDK 의 현재 위치, 안내 시작, 도착 이벤트에서 얻는다.
 * 좌표는 웹앱으로 넘기지 않는다.
 */
class PleosSignals(
    private val context: Context,
    private val bridge: WebBridge,
    private val onStatusChanged: () -> Unit,
    /** 기어가 P 를 벗어났다. 말로 묻기의 질문을 거두고, 듣고 있었으면 곧바로 마이크를 닫는다. 출발 신호보다 먼저 부른다. */
    private val onLeftPark: () -> Unit = {},
) {
    private val main = Handler(Looper.getMainLooper())
    private val gearTracker = GearTracker()
    private val congestion = CongestionDetector()
    private val bumps = BumpTracker()

    // 내비 안내 상태. 웹앱의 주행 화면이 이 값으로 다음 회전, 도착 예정, 경로 띠를 그린다.
    private var guiding = false
    private var destination = ""
    private var totalMeters = 0
    private var remainMeters = 0
    private var remainSeconds = 0
    private var nextTurn: JSONObject? = null
    /** 앞으로 만날 회전들. 웹앱이 지도 위 길의 모양을 이 값으로 만든다. */
    private var turns = JSONArray()
    /** 앞쪽 정체 구간. 지금 자리에서 잰 시작과 끝 거리 (m). */
    private var jamsAhead = JSONArray()
    private var traffic = JSONArray()
    private var bumpsAhead = JSONArray()
    /** 지금 위치와 목적지의 좌표. 주행 화면이 실제 지도를 그리는 데만 쓰고 운행 기록에는 넣지 않는다. */
    private var position: JSONObject? = null
    private var destinationPoint: JSONObject? = null
    private var pendingRoute: RouteInfo? = null
    /** 이번 운행의 출발 지역을 아직 보내지 않았다. 탑승할 때 켠다. */
    private var wantStartArea = true
    private var pollCount = 0

    private var vehicle: Vehicle? = null
    private var navi: NaviHelper? = null

    var isVehicleConnected = false
        private set
    var isNaviConnected = false
        private set

    /** 기어가 P 로 확인됐다. 기어를 아직 모르면 false. 말로 묻기는 이때만 듣는다. */
    val isParked: Boolean
        get() = gearTracker.isParked

    private val gearListener = object : GearSelectionListener {
        override fun onSelected(gear: VehicleGear?) {
            main.post { onGear(gear, "GearSelectionListener.onSelected") }
        }

        override fun onFailed(e: Exception) {
            Log.w(TAG, "기어 구독 실패", e)
        }
    }

    private val naviListener = object : NaviHelperEventListener {
        override fun onRouteStarted(routeStartInfo: RouteStartInfo) {
            main.post {
                val name = routeStartInfo.name.orEmpty()
                Log.i(TAG, "onRouteStarted: $name distance=${routeStartInfo.distance} duration=${routeStartInfo.duration}")
                guiding = true
                destination = name
                totalMeters = routeStartInfo.distance
                remainMeters = routeStartInfo.distance
                remainSeconds = routeStartInfo.duration
                pushNavi()
                bridge.sendSdkEvent(SDK_NAVI, "onRouteStarted", "$name 안내 시작")
                bridge.sendTripInfo(to = name)
            }
        }

        override fun onDestinationArrived(destinationArrivedInfo: DestinationArrivedInfo) {
            main.post {
                val name = destinationArrivedInfo.name.orEmpty()
                    .ifBlank { areaNameOf(destinationArrivedInfo.address) }
                bridge.sendSdkEvent(SDK_NAVI, "onDestinationArrived", "$name 도착")
                bridge.sendTripInfo(to = name)
                endGuidance()
            }
        }

        override fun onCurrentLocationInfo(currentLocationInfo: CurrentLocationInfo) {
            main.post {
                // 주소와 좌표는 디버그 빌드에서만 로그에 남긴다. 주행 중 5초마다 오므로 릴리스 로그에 동선이 남지 않게 한다.
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "onCurrentLocationInfo: address=${currentLocationInfo.address}")
                    Log.d(TAG, "position=${currentLocationInfo.latitude},${currentLocationInfo.longitude} heading=${currentLocationInfo.heading}")
                }
                // 좌표는 주행 화면이 실제 지도를 그리는 데만 쓴다. 운행 기록에는 동네 이름만 남긴다.
                if (isValidCoordinate(currentLocationInfo.latitude, currentLocationInfo.longitude)) {
                    position = pointJson(currentLocationInfo.latitude, currentLocationInfo.longitude)
                        .put("heading", currentLocationInfo.heading)
                    pushNavi()
                }
                // 출발 지역은 탑승할 때 한 번만 보낸다. 주행 중의 위치 조회가 도착한 뒤에 답해도 출발지를 덮지 않는다.
                val area = areaNameOf(currentLocationInfo.address)
                if (area.isNotEmpty() && wantStartArea && !gearTracker.isMoving) {
                    wantStartArea = false
                    bridge.sendSdkEvent(SDK_NAVI, "onCurrentLocationInfo", "출발 지역 $area")
                    bridge.sendTripInfo(from = area)
                }
            }
        }

        override fun onRouteStateInfo(routeStateInfo: RouteStateInfo) {
            main.post { onRouteState(routeStateInfo) }
        }

        override fun onCautionPointInfo(cautionPoints: List<CautionPoint>) {
            main.post { onCautionPoints(cautionPoints) }
        }

        override fun onNavigationStatus(status: NavigationStatus) {
            Log.i(TAG, "onNavigationStatus: $status")
            main.post {
                bridge.sendSdkEvent(SDK_NAVI, "onNavigationStatus", status.name)
                // 경로 안내 중이 아니면 내비 화면 요소를 치운다.
                if (status != NavigationStatus.ROUTE_DRIVE && guiding) endGuidance()
            }
        }

        override fun onDrivingInfo(drivingInfo: DrivingInfo) {
            // 남은 거리와 시간. 자주 오므로 화면 로그에는 남기지 않는다.
            val d = drivingInfo.destination ?: return
            Log.d(TAG, "onDrivingInfo: ${d.name} distance=${d.distance} duration=${d.duration}")
            main.post { onRemaining(d.name.orEmpty(), d.distance, d.duration) }
        }

        override fun onDestinationInfo(destinationInfo: DestinationInfo) {
            Log.i(
                TAG,
                "onDestinationInfo: ${destinationInfo.name} remainDistance=${destinationInfo.remainDistance} remainTime=${destinationInfo.remainTime}",
            )
            main.post {
                if (isValidCoordinate(destinationInfo.latitude, destinationInfo.longitude)) {
                    destinationPoint = pointJson(destinationInfo.latitude, destinationInfo.longitude)
                }
                onRemaining(
                    destinationInfo.name.orEmpty(),
                    destinationInfo.remainDistance,
                    destinationInfo.remainTime,
                )
            }
        }

        override fun onTBTInfo(tbtInfos: List<TBTInfo>) {
            Log.i(TAG, "onTBTInfo: " + tbtInfos.take(2).joinToString { "${it.type}@${it.distance}m(${it.description})" })
            main.post {
                nextTurn = tbtInfos.firstOrNull()?.let(::turnJson)
                turns = JSONArray().also { array -> tbtInfos.take(MAX_TURNS).forEach { array.put(turnJson(it)) } }
                pushNavi()
            }
        }

        override fun onTripInfo(tripInfo: TripInfo) {
            val conditions = tripInfo.summary?.trafficConditions.orEmpty()
            Log.i(
                TAG,
                "onTripInfo: distance=${tripInfo.distance} eta=${tripInfo.eta} traffic=" +
                    conditions.joinToString { "${it.congestionType}:${it.startRatio}-${it.endRatio}" },
            )
            main.post {
                traffic = JSONArray().also { array ->
                    conditions.forEach {
                        array.put(
                            JSONObject()
                                .put("start", it.startRatio / 100.0)
                                .put("end", it.endRatio / 100.0)
                                .put("level", it.congestionType.name.lowercase()),
                        )
                    }
                }
                pushNavi()
            }
        }

        override fun onRoutingCompleted() {
            Log.i(TAG, "onRoutingCompleted")
        }

        override fun onRouteCancelled() {
            Log.i(TAG, "onRouteCancelled")
            main.post { endGuidance() }
        }

        override fun onRouteEnded() {
            // 에뮬레이터에서는 안내를 시작한 직후에도 온다. 안내 종료로 보지 않는다.
            Log.i(TAG, "onRouteEnded")
        }

        override fun onError(errorCode: NaviErrorCode) {
            Log.w(TAG, "NaviHelper 오류: $errorCode")
        }
    }

    private val pollRouteState = object : Runnable {
        override fun run() {
            if (!gearTracker.isMoving) return
            try {
                // 다음 회전과 남은 거리는 자주, 경로 위 정체는 세 번에 한 번 묻는다.
                navi?.getTBTInfo()
                navi?.getDestinationInfo()
                navi?.getCurrentLocationInfo()
                if (pollCount % 3 == 0) navi?.getRouteStateInfo()
                pollCount += 1
            } catch (t: Throwable) {
                Log.w(TAG, "내비 상태 조회 실패", t)
            }
            main.postDelayed(this, NAVI_POLL_INTERVAL_MS)
        }
    }

    private fun onRemaining(name: String, meters: Int, seconds: Int) {
        if (meters <= 0 && seconds <= 0) return
        guiding = true
        if (name.isNotBlank()) destination = name
        remainMeters = meters
        remainSeconds = seconds
        if (totalMeters < meters) totalMeters = meters
        pushNavi()
    }

    private fun endGuidance() {
        guiding = false
        totalMeters = 0
        destinationPoint = null
        nextTurn = null
        turns = JSONArray()
        jamsAhead = JSONArray()
        traffic = JSONArray()
        bumpsAhead = JSONArray()
        bridge.sendNavi(JSONObject().put("type", "navi").put("active", false))
    }

    /** 지금의 내비 안내 상태를 웹앱으로 보낸다. */
    private fun pushNavi() {
        if (!guiding) return
        bridge.sendNavi(
            JSONObject()
                .put("type", "navi")
                .put("active", true)
                .put("destination", destination)
                .put("totalMeters", totalMeters)
                .put("remainMeters", remainMeters)
                .put("remainSeconds", remainSeconds)
                .put("next", nextTurn ?: JSONObject.NULL)
                .put("turns", turns)
                .put("jamsAhead", jamsAhead)
                .put("traffic", traffic)
                .put("bumpsAheadMeters", bumpsAhead)
                .put("position", position ?: JSONObject.NULL)
                .put("destinationPoint", destinationPoint ?: JSONObject.NULL),
        )
    }

    private fun pointJson(latitude: Double, longitude: Double): JSONObject =
        JSONObject().put("lat", latitude).put("lng", longitude)

    private fun turnJson(info: TBTInfo): JSONObject = JSONObject()
        .put("turn", turnOf(info.type.name))
        .put("meters", info.distance)
        .put("description", info.description.orEmpty())

    /** TurnType 이름을 화면이 아는 다섯 가지로 줄인다. */
    private fun turnOf(name: String): String = when {
        name.contains("UTURN") -> "uturn"
        name.endsWith("_L") || name.endsWith("LEFT") -> "left"
        name.endsWith("_R") || name.endsWith("RIGHT") -> "right"
        name.endsWith("_C") || name.endsWith("STRAIGHT") -> "straight"
        else -> "other"
    }

    /**
     * 내비에 목적지 안내를 청한다. 내비가 아직 연결되지 않았으면 연결된 뒤에 청한다.
     * 시연과 시험에서 내비 앱을 만지지 않고 안내를 시작할 때 쓴다.
     */
    fun requestRoute(latitude: Double, longitude: Double, name: String) {
        val route = RouteInfo(latitude, longitude, null, null, name, "", "", "", RouteOption.RECOMMENDED, "", false)
        if (isValidCoordinate(latitude, longitude)) destinationPoint = pointJson(latitude, longitude)
        if (!isNaviConnected) {
            pendingRoute = route
            return
        }
        try {
            navi?.requestRoute(route)
            bridge.sendSdkEvent(SDK_NAVI, "requestRoute", name)
        } catch (t: Throwable) {
            Log.w(TAG, "requestRoute 실패", t)
        }
    }

    fun start() {
        startVehicle()
        startNavi()
    }

    private fun startVehicle() {
        try {
            val v = Vehicle(context)
            vehicle = v
            v.initialize()
            val gear = v.getGear()
            gear.getCurrentGearSelectionState(
                { current ->
                    main.post {
                        isVehicleConnected = true
                        onStatusChanged()
                        onGear(current, "Gear.getCurrentGearSelectionState")
                    }
                },
                { e -> Log.w(TAG, "현재 기어를 읽지 못했습니다", e) },
            )
            gear.registerGearSelection(gearListener)
        } catch (t: Throwable) {
            // Pleos 차량 서비스가 없는 기기(일반 폰, 일반 에뮬레이터)에서는 여기로 온다.
            Log.w(TAG, "Vehicle SDK 를 쓸 수 없습니다", t)
        }
    }

    private fun startNavi() {
        try {
            val n = NaviHelper(context)
            navi = n
            n.initialize(
                {
                    main.post {
                        isNaviConnected = true
                        onStatusChanged()
                        try {
                            n.addListener(naviListener)
                            n.getCurrentLocationInfo()
                        } catch (t: Throwable) {
                            Log.w(TAG, "NaviHelper 리스너 등록 실패", t)
                        }
                        pendingRoute?.let {
                            pendingRoute = null
                            try {
                                n.requestRoute(it)
                                bridge.sendSdkEvent(SDK_NAVI, "requestRoute", it.poiName.orEmpty())
                            } catch (t: Throwable) {
                                Log.w(TAG, "requestRoute 실패", t)
                            }
                        }
                    }
                },
                { e -> Log.w(TAG, "NaviHelper 초기화 실패", e) },
            )
        } catch (t: Throwable) {
            Log.w(TAG, "NaviHelper SDK 를 쓸 수 없습니다", t)
        }
    }

    private fun onGear(gear: VehicleGear?, source: String) {
        val state = when (gear) {
            VehicleGear.GEAR_PARK -> GearState.PARK
            null, VehicleGear.GEAR_UNKNOWN -> GearState.UNKNOWN
            else -> GearState.MOVING
        }
        val signal = gearTracker.onGear(state) ?: return
        // 주행 중에는 묻지도 듣지도 않는다. 출발 신호보다 먼저 질문을 거두고 마이크를 닫고 웹에 알린다.
        if (signal == Signal.DEPART) onLeftPark()
        // 기어 P 확인(isParked)은 신호가 날 때만 바뀐다. 웹은 상태의 parked 가 true 일 때만 커피를 묻는다.
        onStatusChanged()
        bridge.sendSdkEvent(SDK_VEHICLE, source, gear?.name.orEmpty())
        bridge.sendSignal(signal)

        when (signal) {
            Signal.BOARD -> {
                wantStartArea = true
                requestCurrentLocation()
            }
            Signal.DEPART -> {
                main.removeCallbacks(pollRouteState)
                main.postDelayed(pollRouteState, NAVI_POLL_INTERVAL_MS)
            }
            Signal.PARK -> {
                main.removeCallbacks(pollRouteState)
                congestion.reset()
                bumps.reset()
            }
            else -> Unit
        }
    }

    private fun requestCurrentLocation() {
        try {
            navi?.getCurrentLocationInfo()
        } catch (t: Throwable) {
            Log.w(TAG, "getCurrentLocationInfo 실패", t)
        }
    }

    private fun onRouteState(info: RouteStateInfo) {
        Log.i(
            TAG,
            "onRouteStateInfo: routing=${info.isRouting} congestion=" +
                info.trafficStatus?.congestionItemList.orEmpty()
                    .joinToString { "${it.trafficCongestionType}@${it.offset}m+${it.distance}m(${it.roadName})" },
        )
        // 지도에 그릴 정체 구간. 기어와 상관없이 보낸다.
        jamsAhead = JSONArray().also { array ->
            info.trafficStatus?.congestionItemList.orEmpty().forEach {
                val level = when (it.trafficCongestionType) {
                    TrafficCongestionType.HEAVY -> "heavy"
                    TrafficCongestionType.SLOW -> "slow"
                    else -> null
                }
                if (level != null) {
                    val from = it.offset.toDouble()
                    array.put(
                        JSONObject()
                            .put("from", from)
                            .put("to", from + it.distance.toDouble())
                            .put("level", level)
                            .put("road", it.roadName.orEmpty()),
                    )
                }
            }
        }
        pushNavi()
        if (!gearTracker.isMoving) return
        val items = info.trafficStatus?.congestionItemList.orEmpty().map {
            CongestionItem(
                offsetMeters = it.offset,
                isSlowOrWorse = it.trafficCongestionType == TrafficCongestionType.SLOW ||
                    it.trafficCongestionType == TrafficCongestionType.HEAVY,
                roadName = it.roadName.orEmpty(),
            )
        }
        when (val change = congestion.onRouteState(items)) {
            is CongestionChange.Entered -> {
                bridge.sendSdkEvent(SDK_NAVI, "onRouteStateInfo", "${change.roadName} 정체 진입")
                bridge.sendSignal(Signal.CONGESTION_START, road = change.roadName)
            }
            CongestionChange.Left -> {
                bridge.sendSdkEvent(SDK_NAVI, "onRouteStateInfo", "정체 해소")
                bridge.sendSignal(Signal.CONGESTION_END)
            }
            null -> Unit
        }
    }

    private fun onCautionPoints(points: List<CautionPoint>) {
        Log.i(TAG, "onCautionPointInfo: " + points.joinToString { "${it.type}@${it.remainDistance}m" })
        if (!gearTracker.isMoving) return
        val ahead = points
            .filter { it.type == CautionPointType.SPEED_BUMP }
            .map { BumpAhead(it.id, it.remainDistance) }
        bumpsAhead = JSONArray().also { array -> ahead.forEach { array.put(it.remainMeters) } }
        pushNavi()
        repeat(bumps.onBumpsAhead(ahead)) {
            bridge.sendSdkEvent(SDK_NAVI, "onCautionPointInfo", "SPEED_BUMP 150m 이내")
            bridge.sendBump()
        }
    }

    /** 커피 운송작전: 내비의 경로 옵션을 '편안한 길'로 바꿔 달라고 청한다. */
    fun preferComfortRoute() {
        try {
            navi?.changeRouteOption(RouteOption.COMFORTABLE)
            bridge.sendSdkEvent(SDK_NAVI, "changeRouteOption", "COMFORTABLE")
        } catch (t: Throwable) {
            Log.w(TAG, "changeRouteOption 실패", t)
        }
    }

    fun stop() {
        main.removeCallbacks(pollRouteState)
        try {
            vehicle?.getGear()?.unregisterGearSelection(gearListener)
            vehicle?.release()
        } catch (t: Throwable) {
            Log.w(TAG, "Vehicle 해제 실패", t)
        }
        try {
            navi?.removeListener(naviListener)
            navi?.release()
        } catch (t: Throwable) {
            Log.w(TAG, "NaviHelper 해제 실패", t)
        }
        vehicle = null
        navi = null
    }

    private companion object {
        const val TAG = "GamjaSignals"
        const val SDK_VEHICLE = "Vehicle SDK"
        const val SDK_NAVI = "NaviHelper SDK"

        /** 내비에 다음 회전과 남은 거리를 다시 묻는 간격. 경로 위 정체는 이 간격의 세 배마다 묻는다. */
        const val NAVI_POLL_INTERVAL_MS = 5_000L

        /** 지도에 그릴 회전의 수. */
        const val MAX_TURNS = 4
    }
}
