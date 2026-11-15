package com.gamjahq.app

/**
 * 주소에서 지역 이름만 꺼낸다.
 *
 * 작전일지에는 "정자동"처럼 동네 이름까지만 남기고 번지와 좌표는 남기지 않는다.
 * 동·읍·면·리가 있으면 그것을, 없으면 구·군·시를 쓴다. 도로명(…로, …길)과 번지는 버린다.
 */
fun areaNameOf(address: String?): String {
    val tokens = address.orEmpty().trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    val neighborhood = tokens.lastOrNull { it.length >= 2 && it.last() in "동읍면리" && it.none(Char::isDigit) }
    if (neighborhood != null) return neighborhood
    val district = tokens.lastOrNull { it.length >= 2 && it.last() in "구군시" && it.none(Char::isDigit) }
    return district.orEmpty()
}

/** 내비가 준 좌표가 쓸 수 있는 값인가. 값을 모를 때 오는 (0, 0)과 범위를 벗어난 값은 버린다. */
fun isValidCoordinate(latitude: Double, longitude: Double): Boolean =
    latitude.isFinite() && longitude.isFinite() &&
        latitude in -90.0..90.0 && longitude in -180.0..180.0 &&
        !(latitude == 0.0 && longitude == 0.0)
