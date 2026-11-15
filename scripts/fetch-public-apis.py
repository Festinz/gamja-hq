# -*- coding: utf-8 -*-
"""공공 API에서 성남시 판교 일대의 값을 받아 web/src/data/publicapi.json 을 만든다.

usage (저장소 루트에서):
    python -I scripts/fetch-public-apis.py [--route 경로파일.json ...]

키는 web/.env.local 에서 읽는다.
- DATA_GO_KR_KEY  공공데이터포털(data.go.kr) 일반 인증키 (Decoding)
- EX_API_KEY      고속도로 공공데이터 포털(data.ex.co.kr) 인증키
키는 화면에 찍지 않고 어떤 파일에도 쓰지 않는다. 오류 문구에 섞여 나오면 *** 로 가린다.
이름에 VITE_ 가 없으므로 Vite가 웹 번들에 넣지 않는다.

받는 것 (빌드할 때 한 번 받은 값이다. 앱이 실행 중에 부르는 실시간 값이 아니다.)
1. 한국도로교통공단 보행어린이 교통사고 다발지역(data.go.kr 15058925), 결빙 교통사고 다발지역(15058135)
   성남시 수정구·중원구·분당구, 최근 7개 연도. 같은 지점이 여러 해에 나오면 가장 최근 해만 남긴다.
2. 기상청 단기예보 getVilageFcst(15084084): 데모 지점 격자, 앞으로 48시간의 기온·하늘·강수형태·강수확률
3. 한국천문연구원 출몰시각 getLCRiseSetInfo(15012688): 데모 지점, 오늘부터 60일의 일출·일몰
4. 한국도로공사 휴게소 기준정보(locationinfoRest)와 휴게소 브랜드 매장(restBrandList, apiId 0501)
5. 확인만 하고 합치지 않는 것: 행정안전부 과속방지턱정보(15155087)의 성남시 행 수,
   한국도로교통공단 세부링크 도로위험지수(15057452)

한 출처가 실패하면 기존 파일에 있던 그 항목을 그대로 이어 쓰고, 그 항목을 받은 시각(fetched)도 예전 것을 둔다.
기존 파일에도 없으면 빈 배열이나 null 로 둔다. 네 출처(1~4)가 모두 실패하면 기존 파일을 그대로 둔다.
5의 확인만 하는 출처는 이 판단에 넣지 않는다.
--route 로 경로 파일(좌표 배열이나 GeoJSON)을 더 주면, 경로가 지나는 다발지역(앱과 같은 기준: 한가운데가
경로에서 반지름 안, 많아야 150 m)을 그 경로에서도 찾아 찍는다.
"""
import http.client
import json
import math
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / "web" / ".env.local"
TARGET = ROOT / "web" / "src" / "data" / "publicapi.json"
DEMO_ROUTE = ROOT / "web" / "src" / "data" / "pangyo-route.json"

# 한국은 일광절약시간이 없으므로 고정 +09:00 으로 둔다 (Windows 에는 tz 데이터가 없을 수 있다).
KST = timezone(timedelta(hours=9))
# 데모 출발점: 성남시 수정구 시흥동, 판교 제2테크노밸리 (pangyo-route.json 의 첫 점).
DEMO_LAT, DEMO_LNG = 37.4127212, 127.094681
AREA_NAME = "성남시 판교 일대"

DATA_GO = "https://apis.data.go.kr"
EX = "https://data.ex.co.kr/openapi"
USER_AGENT = "gamja-hq-build/1.0"
PAUSE = 0.15  # 호출 사이 쉬는 시간(초). 일일 호출 한도를 아낀다.
# 경로가 다발지역의 반지름 안을 지나야 그 길의 지점으로 본다. 반지름이 넓어도 한가운데가 이 거리 안이어야 한다.
# 앱의 web/src/core/realroute.ts HOTSPOT_MATCH_METERS 와 같은 값이다.
NEAR_ROUTE_M = 150
# 받은 자료의 항목. 출처마다 따로 받고, 실패하면 기존 파일의 값을 이어 쓴다.
SECTIONS = (("hotspots", "사고다발지역"), ("weather", "단기예보"), ("sun", "출몰시각"), ("restAreas", "휴게소"))
MAX_BYTES = 400 * 1024
EARTH_M = 6371008.8

HOTSPOT_KINDS = (
    ("child", "B552061/frequentzoneChild/getRestFrequentzoneChild", "보행어린이 교통사고 다발지역"),
    ("ice", "B552061/frequentzoneFreezing/getRestFrequentzoneFreezing", "결빙 교통사고 다발지역"),
)
# 시도 41(경기도) 아래 시군구 코드의 끝 세 자리. 성남시는 구 단위로만 답한다.
SEONGNAM_GU = (("131", "수정구"), ("133", "중원구"), ("135", "분당구"))
HOTSPOT_YEARS = 7
SAME_SPOT_M = 120  # 다른 해의 다발지역 중심이 이만큼 가까우면 같은 지점으로 본다.

KMA_BASE_HOURS = (2, 5, 8, 11, 14, 17, 20, 23)
WEATHER_HOURS = 48
SKY_TEXT = {1: "맑음", 3: "구름많음", 4: "흐림"}
PTY_TEXT = {1: "비", 2: "비/눈", 3: "눈", 4: "소나기", 5: "빗방울", 6: "빗방울눈날림", 7: "눈날림"}
SUN_DAYS = 60

# 앞에 있을수록 먼저 적는다. 마지막 두 낱말은 이름에 커피·카페가 들어간 그 밖의 매장.
COFFEE_WORDS = ("스타벅스", "투썸", "할리스", "엔제리너스", "이디야", "폴바셋", "탐앤탐스", "커피빈",
                "카페베네", "메가커피", "메가MGC", "빽다방", "컴포즈", "드롭탑", "파스쿠찌", "달콤",
                "커피", "카페")

SECRETS = []


# ---------------------------------------------------------------- 키와 출력

def remember_secret(value):
    """찍거나 쓸 문자열에서 가릴 값을 모은다. 원래 값과 URL 인코딩한 값을 함께 둔다."""
    if not value or len(value) < 6:
        return
    for form in (value, urllib.parse.quote(value, safe=""), urllib.parse.quote_plus(value), urllib.parse.unquote(value)):
        if form and form not in SECRETS:
            SECRETS.append(form)
    SECRETS.sort(key=len, reverse=True)


def redact(text):
    text = str(text)
    for secret in SECRETS:
        text = text.replace(secret, "***")
    return text


def say(*parts):
    print(redact(" ".join(str(part) for part in parts)))


def read_env(path):
    values = {}
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except OSError:
        return values
    for line in lines:
        if line.lstrip().startswith("#"):
            continue
        match = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$", line)
        if match:
            values[match.group(1)] = match.group(2).strip().strip('"').strip("'")
    return values


# ---------------------------------------------------------------- HTTP

class ApiError(Exception):
    """API가 오류를 돌려줬거나 닿지 못했다. 문구에는 키를 넣지 않는다."""


def decode(raw):
    for encoding in ("utf-8", "cp949"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


def explain(body):
    """오류 응답에서 결과 코드와 메시지만 뽑는다. 응답이 요청 주소를 되풀이할 수 있어 자르기 전에 키부터 가린다."""
    text = redact(body or "")
    found = []
    for tag in ("returnReasonCode", "returnAuthMsg", "errMsg", "resultCode", "resultMsg"):
        match = re.search(r"<%s>([^<]*)</%s>" % (tag, tag), text)
        if match and match.group(1).strip():
            found.append(match.group(1).strip())
    if not found:
        try:
            parsed = json.loads(text)
        except ValueError:
            parsed = None
        if isinstance(parsed, dict):
            response = parsed.get("response")
            header = response.get("header") if isinstance(response, dict) else None
            source = header if isinstance(header, dict) else parsed
            found = [str(source[k]) for k in ("resultCode", "resultMsg", "code", "message") if source.get(k) not in (None, "")]
    if not found:
        found.append(re.sub(r"\s+", " ", text).strip()[:120] or "(빈 응답)")
    return redact(" ".join(found))


def http_get(url, params, timeout=20, tries=3):
    query = urllib.parse.urlencode(params, safe=":[]")
    request = urllib.request.Request(url + "?" + query, headers={"User-Agent": USER_AGENT})
    for attempt in range(1, tries + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return decode(response.read())
        except urllib.error.HTTPError as error:
            try:
                body = decode(error.read() or b"")
            except Exception:
                body = ""
            problem = "HTTP %d %s" % (error.code, explain(body))
            retry = error.code in (429, 500, 502, 503, 504)
        except (urllib.error.URLError, OSError, http.client.HTTPException) as error:
            problem = "%s: %s" % (type(error).__name__, getattr(error, "reason", None) or error)
            retry = True
        if not retry or attempt == tries:
            raise ApiError(redact(problem))
        time.sleep(1.5 * attempt)
    raise ApiError("호출하지 못함")


def as_json(text):
    try:
        return json.loads(text)
    except ValueError:
        raise ApiError(explain(text)) from None


def item_list(container):
    """data.go.kr 응답의 items 는 {"item": [...]}, {"item": {...}}, "" 가운데 하나로 온다."""
    if isinstance(container, dict):
        container = container.get("item")
    if isinstance(container, dict):
        return [container]
    if isinstance(container, list):
        return [row for row in container if isinstance(row, dict)]
    return []


def header_of(body):
    response = body.get("response") if isinstance(body, dict) else None
    response = response if isinstance(response, dict) else {}
    header = response.get("header") if isinstance(response.get("header"), dict) else {}
    inner = response.get("body") if isinstance(response.get("body"), dict) else {}
    return str(header.get("resultCode", "")), str(header.get("resultMsg", "")), inner


def number(value):
    try:
        result = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    if result != result or abs(result) == float("inf"):
        return None
    return int(result) if result.is_integer() else result


def whole(value):
    result = number(value)
    return int(result) if result is not None else None


# ---------------------------------------------------------------- 거리

def meters_between(lng1, lat1, lng2, lat2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2
    return 2 * EARTH_M * math.asin(math.sqrt(min(1.0, a)))


def nearest_on_route(route, lng, lat):
    """경로에서 가장 가까운 거리(m), 그 점까지 출발지부터 잰 거리(m), 경로 전체 길이(m)."""
    kx = math.radians(1) * EARTH_M * math.cos(math.radians(lat))
    ky = math.radians(1) * EARTH_M
    best, best_along, along = float("inf"), 0.0, 0.0
    for (ax, ay), (bx, by) in zip(route, route[1:]):
        x1, y1 = (ax - lng) * kx, (ay - lat) * ky
        dx, dy = (bx - ax) * kx, (by - ay) * ky
        seg = dx * dx + dy * dy
        t = 0.0 if seg == 0 else max(0.0, min(1.0, -(x1 * dx + y1 * dy) / seg))
        gap = math.hypot(x1 + t * dx, y1 + t * dy)
        length = math.sqrt(seg)
        if gap < best:
            best, best_along = gap, along + t * length
        along += length
    return best, best_along, along


def route_points(path):
    """좌표 배열({"coordinates": [...]}) 이나 GeoJSON FeatureCollection 의 선을 [(lng, lat)] 로 읽는다."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    raw = []
    if isinstance(data, list):
        raw = data
    elif isinstance(data, dict) and data.get("type") == "FeatureCollection":
        for feature in data.get("features") or []:
            geometry = (feature or {}).get("geometry") or {}
            if geometry.get("type") == "LineString":
                raw.extend(geometry.get("coordinates") or [])
            elif geometry.get("type") == "MultiLineString":
                for part in geometry.get("coordinates") or []:
                    raw.extend(part)
    elif isinstance(data, dict) and isinstance(data.get("coordinates"), list):
        raw = data["coordinates"]
    points = []
    for pair in raw:
        try:
            point = (float(pair[0]), float(pair[1]))
        except (TypeError, ValueError, IndexError):
            continue
        if not points or point != points[-1]:
            points.append(point)
    return points


# ---------------------------------------------------------------- 1. 사고다발지역

def spot_name(raw):
    return re.sub(r"^\s*경기(?:도)?\s+", "", str(raw or "")).strip()


def app_radius(spot):
    """앱(web/src/core/publicdata.ts)이 읽는 반지름. 모르면 100 m, 20~500 m 로 묶는다."""
    radius = number(spot.get("radiusM"))
    return min(500, max(20, radius)) if radius and radius > 0 else 100


def polygon_radius(geom, lng, lat):
    """다발지역 폴리곤 꼭짓점까지의 평균 거리(m, 10 m 단위). 모르면 None."""
    try:
        shape = json.loads(geom) if isinstance(geom, str) else geom
        coords = shape["coordinates"]
        ring = coords[0][0] if shape.get("type") == "MultiPolygon" else coords[0]
        gaps = [meters_between(lng, lat, float(p[0]), float(p[1])) for p in ring]
    except (TypeError, ValueError, KeyError, IndexError, AttributeError):
        return None
    if not gaps:
        return None
    return max(10, int(round(sum(gaps) / len(gaps) / 10.0)) * 10)


def fetch_hotspots(key, today):
    years = [str(today.year - back) for back in range(HOTSPOT_YEARS)]
    found, errors = [], []
    calls = answered = 0
    for kind, path, source in HOTSPOT_KINDS:
        for year in years:
            for gu, _ in SEONGNAM_GU:
                page = 1
                while True:
                    calls += 1
                    try:
                        body = as_json(http_get("%s/%s" % (DATA_GO, path), {
                            "ServiceKey": key, "searchYearCd": year, "siDo": "41", "guGun": gu,
                            "type": "json", "numOfRows": 100, "pageNo": page}))
                        code = str(body.get("resultCode", "")) if isinstance(body, dict) else ""
                        if code not in ("00", "0", "03"):
                            raise ApiError("%s %s" % (code or "?", body.get("resultMsg", "") if isinstance(body, dict) else ""))
                    except ApiError as error:
                        errors.append("%s %s %s: %s" % (kind, year, gu, error))
                        if not answered and len(errors) >= 3:
                            raise ApiError(errors[0])
                        break
                    answered += 1
                    if code == "03":  # NODATA_ERROR: 그 해 그 구에는 다발지역이 없다.
                        break
                    rows = item_list(body.get("items"))
                    for row in rows:
                        lng, lat = number(row.get("lo_crd")), number(row.get("la_crd"))
                        if lng is None or lat is None:
                            continue
                        found.append({
                            "kind": kind,
                            "name": spot_name(row.get("spot_nm")),
                            "lng": round(lng, 6),
                            "lat": round(lat, 6),
                            "radiusM": polygon_radius(row.get("geom_json"), lng, lat) or 100,
                            "accidents": whole(row.get("occrrnc_cnt")),
                            "casualties": whole(row.get("caslt_cnt")),
                            "year": year,
                            "source": source,
                        })
                    total = whole(body.get("totalCount")) or 0
                    if not rows or page * 100 >= total:
                        break
                    page += 1
                time.sleep(PAUSE)
    if not answered:
        raise ApiError(errors[0] if errors else "응답 없음")

    # 같은 지점이 여러 해에 나오면 가장 최근 해만 남긴다.
    found.sort(key=lambda spot: (spot["kind"], -int(spot["year"])))
    kept, merged = [], []
    for spot in found:
        twin = next((k for k in kept if k["kind"] == spot["kind"] and k["year"] != spot["year"] and (
            meters_between(k["lng"], k["lat"], spot["lng"], spot["lat"]) <= SAME_SPOT_M
            or (k["name"] == spot["name"] and meters_between(k["lng"], k["lat"], spot["lng"], spot["lat"]) <= 500))), None)
        if twin:
            merged.append((spot, twin))
            continue
        kept.append(spot)
    order = {kind: i for i, (kind, _, _) in enumerate(HOTSPOT_KINDS)}
    kept.sort(key=lambda spot: (order[spot["kind"]], -int(spot["year"]), spot["name"]))
    return kept, {"years": years, "calls": calls, "errors": errors, "merged": merged}


# ---------------------------------------------------------------- 2. 단기예보

def kma_grid(lat, lng):
    """기상청 격자(LCC, 5 km) 변환 공식."""
    re_, grid, slat1, slat2, olon, olat, xo, yo = 6371.00877, 5.0, 30.0, 60.0, 126.0, 38.0, 43, 136
    d = math.pi / 180.0
    re_ /= grid
    slat1, slat2, olon, olat = slat1 * d, slat2 * d, olon * d, olat * d
    sn = math.log(math.cos(slat1) / math.cos(slat2)) / math.log(
        math.tan(math.pi * 0.25 + slat2 * 0.5) / math.tan(math.pi * 0.25 + slat1 * 0.5))
    sf = math.pow(math.tan(math.pi * 0.25 + slat1 * 0.5), sn) * math.cos(slat1) / sn
    ro = re_ * sf / math.pow(math.tan(math.pi * 0.25 + olat * 0.5), sn)
    ra = re_ * sf / math.pow(math.tan(math.pi * 0.25 + lat * d * 0.5), sn)
    theta = lng * d - olon
    if theta > math.pi:
        theta -= 2.0 * math.pi
    if theta < -math.pi:
        theta += 2.0 * math.pi
    theta *= sn
    return int(math.floor(ra * math.sin(theta) + xo + 0.5)), int(math.floor(ro - ra * math.cos(theta) + yo + 0.5))


def kma_bases(now, count=3):
    """받을 수 있는 가장 최근 발표 시각부터 거꾸로. 발표 10분 뒤부터 받을 수 있어 15분을 둔다."""
    moment = (now - timedelta(minutes=15)).replace(minute=0, second=0, microsecond=0)
    bases = []
    while len(bases) < count:
        if moment.hour in KMA_BASE_HOURS:
            bases.append(moment)
        moment -= timedelta(hours=1)
    return bases


def kma_value(value):
    result = number(value)
    # 기상청은 빠진 값을 -999, 900 이상 같은 값으로 적는다.
    return None if result is None or result <= -900 or result >= 900 else result


def fetch_weather(key, now):
    nx, ny = kma_grid(DEMO_LAT, DEMO_LNG)
    start = now.replace(minute=0, second=0, microsecond=0)
    last = "NO_DATA"
    for base in kma_bases(now):
        rows, page, total = [], 1, None
        while True:
            body = as_json(http_get(DATA_GO + "/1360000/VilageFcstInfoService_2.0/getVilageFcst", {
                "serviceKey": key, "pageNo": page, "numOfRows": 1000, "dataType": "JSON",
                "base_date": base.strftime("%Y%m%d"), "base_time": base.strftime("%H%M"), "nx": nx, "ny": ny}))
            code, message, inner = header_of(body)
            if code != "00":
                if page == 1 and code == "03":
                    break
                if page == 1:
                    raise ApiError("%s %s" % (code or "?", message or explain(json.dumps(body, ensure_ascii=False))))
                break
            got = item_list(inner.get("items"))
            rows.extend(got)
            total = whole(inner.get("totalCount")) or len(rows)
            future = {(r.get("fcstDate"), r.get("fcstTime")) for r in rows}
            if not got or len(rows) >= total or len(future) > WEATHER_HOURS + 6 or page >= 4:
                break
            page += 1
            time.sleep(PAUSE)
        if not rows:
            last = "%s 발표 NO_DATA" % base.strftime("%H%M")
            time.sleep(PAUSE)
            continue
        slots = {}
        for row in rows:
            category = row.get("category")
            if category not in ("TMP", "SKY", "PTY", "POP"):
                continue
            try:
                at = datetime.strptime(str(row["fcstDate"]) + str(row["fcstTime"]).zfill(4), "%Y%m%d%H%M").replace(tzinfo=KST)
            except (KeyError, ValueError):
                continue
            slots.setdefault(at, {})[category] = row.get("fcstValue")
        hours = []
        for at in sorted(slots):
            if at < start:
                continue
            values = slots[at]
            hours.append({
                "at": at.isoformat(),
                "tmp": kma_value(values.get("TMP")),
                "sky": whole(kma_value(values.get("SKY"))),
                "pty": whole(kma_value(values.get("PTY"))),
                "pop": whole(kma_value(values.get("POP"))),
            })
            if len(hours) == WEATHER_HOURS:
                break
        if not hours:
            last = "%s 발표에 앞으로의 시각이 없음" % base.strftime("%H%M")
            continue
        return {"issuedAt": base.isoformat(), "nx": nx, "ny": ny, "hours": hours}
    raise ApiError(last)


# ---------------------------------------------------------------- 3. 출몰시각

def hhmm(value):
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) < 4:
        return None
    hour, minute = int(digits[:2]), int(digits[2:4])
    return "%02d:%02d" % (hour, minute) if hour <= 24 and minute <= 59 else None


def fetch_sun(key, today):
    days, errors = [], []
    for offset in range(SUN_DAYS):
        day = today + timedelta(days=offset)
        try:
            body = as_json(http_get(DATA_GO + "/B090041/openapi/service/RiseSetInfoService/getLCRiseSetInfo", {
                "serviceKey": key, "locdate": day.strftime("%Y%m%d"),
                "longitude": DEMO_LNG, "latitude": DEMO_LAT, "dnYn": "Y", "_type": "json"}))
            code, message, inner = header_of(body)
            if code not in ("00", "0"):
                raise ApiError("%s %s" % (code or "?", message))
            rows = item_list(inner.get("items"))
            sunrise = hhmm(rows[0].get("sunrise")) if rows else None
            sunset = hhmm(rows[0].get("sunset")) if rows else None
            if not (sunrise and sunset):
                raise ApiError("일출·일몰 값 없음")
            days.append({"date": day.isoformat(), "sunrise": sunrise, "sunset": sunset})
        except ApiError as error:
            errors.append("%s: %s" % (day.isoformat(), error))
            if not days and len(errors) >= 3:
                raise ApiError(errors[0])
        time.sleep(PAUSE)
    return days, errors


# ---------------------------------------------------------------- 4. 휴게소

def ex_rows(key, path):
    rows, page, pages = [], 1, 1
    while page <= pages and page <= 50:
        body = as_json(http_get("%s/%s" % (EX, path), {"key": key, "type": "json", "numOfRows": 99, "pageNo": page}))
        if not isinstance(body, dict) or str(body.get("code", "")).upper() != "SUCCESS":
            raise ApiError(explain(json.dumps(body, ensure_ascii=False)))
        got = body.get("list") or []
        rows.extend(row for row in got if isinstance(row, dict))
        pages = whole(body.get("pageSize")) or 1
        if not got:
            break
        page += 1
        time.sleep(PAUSE)
    return rows


def brand_label(raw):
    return re.sub(r"\s*\([^)]*\)\s*", "", str(raw or "")).strip()


def direction_of(name):
    """휴게소 이름 괄호 속의 행선지. "서울만남(부산)휴게소" -> "부산방향", "양북임시(상)휴게소" -> "상행"."""
    match = re.search(r"\(([^)]*)\)", name)
    text = match.group(1).strip() if match else ""
    if not text:
        return None
    if text in ("상", "하"):
        return text + "행"
    return text if text.endswith(("방향", "행")) else text + "방향"


def coffee_rank(label):
    return next((i for i, word in enumerate(COFFEE_WORDS) if word in label), None)


def fetch_rest_areas(key):
    places = ex_rows(key, "locationinfo/locationinfoRest")
    brand_error, brands = None, []
    try:
        brands = ex_rows(key, "restinfo/restBrandList")
    except ApiError as error:
        brand_error = str(error)
    place_codes = {str(row.get("stdRestCd") or "").strip() for row in places} - {""}
    place_names = {str(row.get("unitName") or "").strip() for row in places} - {""}
    by_code, by_name, unplaced, unplaced_coffee = {}, {}, set(), set()
    for row in brands:
        code, name = str(row.get("stdRestCd") or "").strip(), str(row.get("stdRestNm") or "").strip()
        label = brand_label(row.get("brdName"))
        is_coffee = bool(label) and coffee_rank(label) is not None
        # 브랜드 매장 목록에는 있는데 기준정보(좌표)에는 없는 휴게소. 새로 연 휴게소가 많다.
        if code not in place_codes and name not in place_names:
            unplaced.add(name or code)
            if is_coffee:
                unplaced_coffee.add(name or code)
        if not is_coffee:
            continue
        if code:
            by_code.setdefault(code, set()).add(label)
        if name:
            by_name.setdefault(name, set()).add(label)
    areas, skipped, seen = [], 0, set()
    for row in places:
        name = str(row.get("unitName") or "").strip()
        lng, lat = number(row.get("xValue")), number(row.get("yValue"))
        if not name or lng is None or lat is None or not (124 <= lng <= 132 and 33 <= lat <= 39.5):
            skipped += 1
            continue
        if (name, round(lng, 5), round(lat, 5)) in seen:
            continue
        seen.add((name, round(lng, 5), round(lat, 5)))
        code = str(row.get("stdRestCd") or "").strip()
        labels = by_code.get(code) or by_name.get(name) or set()
        areas.append({
            "name": name,
            "route": str(row.get("routeName") or "").strip(),
            "direction": direction_of(name),
            "lng": round(lng, 6),
            "lat": round(lat, 6),
            "coffee": sorted(labels, key=lambda label: (coffee_rank(label), label)),
        })
    stats = {
        "places": len(places), "skipped": skipped, "brandRows": len(brands), "brandError": brand_error,
        "coffeeBrands": Counter(label for labels in by_code.values() for label in labels),
        "unplaced": sorted(unplaced), "unplacedCoffee": sorted(unplaced_coffee),
    }
    return areas, stats


# ---------------------------------------------------------------- 5. 확인만

def check_speed_bumps(key):
    def total(extra):
        params = {"serviceKey": key, "pageNo": 1, "numOfRows": 1, "returnType": "json"}
        params.update(extra)
        code, message, inner = header_of(as_json(http_get(DATA_GO + "/1741000/speed_bump_info/info", params)))
        if code not in ("0", "00"):
            raise ApiError("%s %s" % (code or "?", message))
        return whole(inner.get("totalCount"))
    seongnam = total({"cond[SGG_NM::LIKE]": "성남"})
    time.sleep(PAUSE)
    return seongnam, total({})


def thin_route(route, gap_m):
    """앞 점에서 gap_m 이상 떨어진 점만 남긴다. 처음과 끝 점은 늘 남긴다."""
    points = [route[0]]
    for point in route[1:-1]:
        if meters_between(points[-1][0], points[-1][1], point[0], point[1]) >= gap_m:
            points.append(point)
    points.append(route[-1])
    while len(points) > 2 and meters_between(points[-2][0], points[-2][1], points[-1][0], points[-1][1]) < gap_m:
        del points[-2]
    return points


def check_risk_index(key, route):
    if len(route) < 2:
        return None
    # 구간이 짧은 점(약 80 m 아래)이 섞이면 10 INVALID_REQUEST_PARAMETER_ERROR 가 온다. 점 사이를 넓혀 가며 부른다.
    for gap in (120, 200, 400):
        points = thin_route(route, gap)
        line = "LineString(" + ",".join("%.6f %.6f" % point for point in points) + ")"
        body = as_json(http_get(DATA_GO + "/B552061/roadDgdgrLink/getRestRoadDgdgrLink", {
            "ServiceKey": key, "searchLineString": line, "vhctyCd": "01", "type": "json", "numOfRows": 100, "pageNo": 1}))
        code = str(body.get("resultCode", "")) if isinstance(body, dict) else ""
        if code != "10":
            break
        time.sleep(PAUSE)
    if code == "03":
        return ("세부링크 도로위험지수(15057452): 데모 경로를 %d점 라인스트링(승용차 01)으로 넣었으나 NODATA. "
                "5분마다 바뀌는 실시간 값이라 합치지 않음." % len(points))
    if code not in ("00", "0"):
        raise ApiError("%s %s" % (code or "?", body.get("resultMsg", "") if isinstance(body, dict) else ""))
    rows = item_list(body.get("items"))
    grades = Counter(str(row.get("anals_grd") or "?") for row in rows)
    values = [v for v in (number(row.get("anals_value")) for row in rows) if v is not None]
    grade_text = ", ".join("%s등급 %d개" % (grade, grades[grade]) for grade in sorted(grades))
    return ("세부링크 도로위험지수(15057452): 데모 경로를 %d점 라인스트링(승용차 01)으로 넣으면 구간 %d개마다 "
            "실시간(5분 단위) 위험지수와 위험등급(01~04)이 온다. 이번 조회 %s, 최고 지수 %s. 시점마다 바뀌는 값이라 합치지 않음."
            % (len(points), len(rows), grade_text or "없음", ("%.2f" % max(values)) if values else "-"))


# ---------------------------------------------------------------- 파일

def read_previous(path):
    """기존 publicapi.json. 없거나 읽지 못하면 빈 dict."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def carry_over(data, previous, fresh):
    """이번에 받지 못한 항목은 기존 파일의 값과 그 값을 받은 시각을 이어 쓴다. 이어 쓴 (이름, 받은 시각) 목록."""
    previous_fetched = previous.get("fetched") if isinstance(previous.get("fetched"), dict) else {}
    carried = []
    for name, _ in SECTIONS:
        if name in fresh:
            data["fetched"][name] = data["fetchedAt"]
            continue
        old = previous.get(name)
        if old:  # 빈 배열이나 null 은 이어 쓸 것이 없다.
            data[name] = old
            # 예전 파일에 항목별 시각이 없으면 그 파일을 받은 시각이 곧 그 항목을 받은 시각이다.
            data["fetched"][name] = previous_fetched.get(name) or previous.get("fetchedAt")
            carried.append((name, data["fetched"][name]))
    return carried


def dumps(data):
    """배열은 한 줄에 하나씩 적는다. 크기는 작게, diff 는 읽기 쉽게."""
    def one(value):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

    def rows(name, items):
        if not items:
            return ['"%s":[]' % name]
        return ['"%s":[' % name] + [one(item) + ("," if i < len(items) - 1 else "") for i, item in enumerate(items)] + ["]"]

    blocks = []
    for name, value in data.items():
        if isinstance(value, list):
            blocks.append(rows(name, value))
        elif name == "weather" and isinstance(value, dict) and len(value) > 1 and isinstance(value.get("hours"), list):
            head = one({k: v for k, v in value.items() if k != "hours"})
            blocks.append(['"weather":{' + head[1:-1] + ","] + rows("hours", value["hours"]) + ["}"])
        else:
            blocks.append(['"%s":%s' % (name, one(value))])
    lines = ["{"]
    for i, block in enumerate(blocks):
        if i < len(blocks) - 1:
            block[-1] += ","
        lines.extend(block)
    lines.append("}")
    text = "\n".join(lines) + "\n"
    if json.loads(text) != data:
        text = json.dumps(data, ensure_ascii=False, indent=1) + "\n"
    return text


# ---------------------------------------------------------------- main

def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    extra_routes = []
    args = list(argv)
    while args:
        arg = args.pop(0)
        if arg == "--route" and args:
            extra_routes.append(Path(args.pop(0)))
        else:
            say("알 수 없는 인자:", arg)
            say("usage: python -I scripts/fetch-public-apis.py [--route 경로파일.json ...]")
            return 2

    env = read_env(ENV_FILE)
    for value in env.values():
        remember_secret(value)
    data_key = env.get("DATA_GO_KR_KEY", "")
    if "%" in data_key:  # Encoding 키를 넣었으면 한 번 풀어서 쓴다.
        data_key = urllib.parse.unquote(data_key)
        remember_secret(data_key)
    ex_key = env.get("EX_API_KEY", "")

    now = datetime.now(KST).replace(microsecond=0)
    today = now.date()
    previous = read_previous(TARGET)
    data = {
        "fetchedAt": now.isoformat(),
        # 항목마다 실제로 받은 시각. 받지 못해 예전 값을 이어 쓰면 예전 시각이 남는다.
        "fetched": {name: None for name, _ in SECTIONS},
        "area": {"name": AREA_NAME, "center": [DEMO_LNG, DEMO_LAT]},
        "hotspots": [],
        "weather": None,
        "sun": [],
        "restAreas": [],
        "notes": {"speedBumpApiSeongnamRows": None, "riskIndex": None},
    }
    failed, info = [], {}

    def run(label, key, job):
        if not key:
            failed.append("%s: 키 없음 (web/.env.local)" % label)
            return None
        try:
            return job()
        except ApiError as error:
            failed.append("%s: %s" % (label, error))
        except Exception as error:  # 예상하지 못한 응답 모양
            failed.append("%s: %s %s" % (label, type(error).__name__, redact(error)))
        return None

    try:
        demo_route = route_points(DEMO_ROUTE)
    except (OSError, ValueError) as error:
        demo_route = []
        failed.append("경로 파일 %s: %s" % (DEMO_ROUTE.name, type(error).__name__))

    # 새로 받은 항목. 확인만 하는 출처(과속방지턱 API, 도로위험지수)는 넣지 않는다.
    # 성남 세 구의 7년치 다발지역이나 전국 휴게소가 하나도 없다는 답은 일시적인 오류로 보고 기존 값을 둔다.
    fresh = set()
    result = run("사고다발지역", data_key, lambda: fetch_hotspots(data_key, today))
    if result and result[0]:
        data["hotspots"], info["hotspots"] = result
        fresh.add("hotspots")
    elif result:
        failed.append("사고다발지역: 답은 왔지만 지점이 하나도 없음")
    result = run("단기예보", data_key, lambda: fetch_weather(data_key, now))
    if result:
        data["weather"] = result
        fresh.add("weather")
    result = run("출몰시각", data_key, lambda: fetch_sun(data_key, today))
    if result and result[0]:
        data["sun"], info["sunErrors"] = result
        fresh.add("sun")
    result = run("휴게소", ex_key, lambda: fetch_rest_areas(ex_key))
    if result and result[0]:
        data["restAreas"], info["rest"] = result
        fresh.add("restAreas")
    elif result:
        failed.append("휴게소: 답은 왔지만 좌표가 있는 휴게소가 하나도 없음")
    previous_notes = previous.get("notes") if isinstance(previous.get("notes"), dict) else {}
    result = run("과속방지턱 API 확인", data_key, lambda: check_speed_bumps(data_key))
    if result:
        data["notes"]["speedBumpApiSeongnamRows"], info["bumpsNationwide"] = result
    elif previous_notes.get("speedBumpApiSeongnamRows") is not None:
        data["notes"]["speedBumpApiSeongnamRows"] = previous_notes["speedBumpApiSeongnamRows"]
    result = run("도로위험지수 확인", data_key, lambda: check_risk_index(data_key, demo_route))
    if result:
        data["notes"]["riskIndex"] = result
    elif previous_notes.get("riskIndex"):
        data["notes"]["riskIndex"] = previous_notes["riskIndex"]

    if not fresh:
        say("사고다발지역, 단기예보, 출몰시각, 휴게소를 하나도 받지 못해 %s 를 그대로 둔다." % TARGET.name)
        for line in failed:
            say("  실패", line)
        return 1

    # 받지 못한 항목은 기존 파일의 값을 이어 쓴다. 한 출처가 잠깐 막혔다고 앱에서 그 기능이 사라지지 않게 한다.
    carried = carry_over(data, previous, fresh)

    text = dumps(data)
    if any(secret in text for secret in SECRETS):
        say("결과에 키 값이 섞여 있어 쓰지 않는다.")
        return 1
    TARGET.write_text(text, encoding="utf-8", newline="\n")
    size = len(text.encode("utf-8"))

    # ------------------------------------------------------------ 요약
    say("%s %s bytes%s, fetchedAt %s, %s" % (
        TARGET.relative_to(ROOT).as_posix(), format(size, ","), " (400 KB 넘음!)" if size > MAX_BYTES else "",
        data["fetchedAt"], AREA_NAME))
    labels = dict(SECTIONS)
    if carried:
        say("[이어 씀] 이번에 받지 못해 기존 파일의 값을 그대로 둔 항목 (앱의 Pleos 연동 화면에 받은 시각이 따로 나온다)")
        for name, fetched_at in carried:
            say("  %s: %s 에 받은 값" % (labels[name], fetched_at or "받은 시각 모름"))
    missing = [labels[name] for name, _ in SECTIONS if name not in fresh and name not in dict(carried)]
    if missing:
        say("[비어 있음] %s: 받지 못했고 이어 쓸 값도 없어 앱에서 그 기능이 쉰다." % ", ".join(missing))

    spots = data["hotspots"]
    if "hotspots" in info:
        h = info["hotspots"]
        say("[다발지역] 보행어린이 %d곳, 결빙 %d곳 (%s~%s년 x 수정·중원·분당구, 호출 %d회, 다른 해의 같은 지점 %d곳 합침, 호출 오류 %d회)" % (
            sum(1 for s in spots if s["kind"] == "child"), sum(1 for s in spots if s["kind"] == "ice"),
            h["years"][-1], h["years"][0], h["calls"], len(h["merged"]), len(h["errors"])))
        for spot in spots[:16]:
            say("  %s %s %s 사고 %s건 사상자 %s명 반경 %d m (%.5f, %.5f)" % (
                spot["kind"], spot["year"], spot["name"], spot["accidents"], spot["casualties"], spot["radiusM"], spot["lat"], spot["lng"]))
        for older, newer in h["merged"]:
            say("  합침: %s %s %s -> %s %s (%d m)" % (older["kind"], older["year"], older["name"], newer["year"], newer["name"],
                                                     meters_between(older["lng"], older["lat"], newer["lng"], newer["lat"])))
        for line in h["errors"][:3]:
            say("  호출 오류:", line)

    weather = data["weather"] if "weather" in fresh else None
    if weather:
        hours = weather["hours"]
        parts = []
        for hour in hours[:6]:
            sky = PTY_TEXT.get(hour["pty"]) or SKY_TEXT.get(hour["sky"], "?")
            parts.append("%s시 %s° %s %s%%" % (hour["at"][11:13], hour["tmp"], sky, hour["pop"]))
        say("[날씨] %s 발표, 격자 %d,%d, %d시간 (%s ~ %s). 앱은 발표 뒤 24시간까지만 쓴다." % (
            weather["issuedAt"][:16].replace("T", " "), weather["nx"], weather["ny"], len(hours),
            hours[0]["at"][5:16].replace("T", " ") if hours else "-", hours[-1]["at"][5:16].replace("T", " ") if hours else "-"))
        say("  " + " / ".join(parts))

    sun = data["sun"] if "sun" in fresh else []
    if sun:
        first = next((d for d in sun if d["date"] == today.isoformat()), None)
        say("[해] %d일 (%s ~ %s), 오늘 일출 %s 일몰 %s%s" % (
            len(sun), sun[0]["date"], sun[-1]["date"], first["sunrise"] if first else "-", first["sunset"] if first else "-",
            (", 빠진 날 %d" % len(info.get("sunErrors") or [])) if info.get("sunErrors") else ""))

    areas = data["restAreas"]
    if "rest" in info:
        rest = info["rest"]
        with_coffee = [a for a in areas if a["coffee"]]
        say("[휴게소] 기준정보 %d행 -> %d곳 (좌표 없음 %d), 커피 매장 있는 곳 %d곳, 브랜드 매장 %d행%s" % (
            rest["places"], len(areas), rest["skipped"], len(with_coffee), rest["brandRows"],
            (" (브랜드 실패: %s)" % rest["brandError"]) if rest["brandError"] else ""))
        say("  커피 브랜드: " + ", ".join("%s %d" % kv for kv in rest["coffeeBrands"].most_common()))
        if rest["unplaced"]:
            sample = [name for name in rest["unplacedCoffee"] or rest["unplaced"] if not name.isdigit()][:6]
            say("  기준정보에 없어 넣지 못한 휴게소 %d곳 (그중 커피 매장 %d곳), 예: %s" % (
                len(rest["unplaced"]), len(rest["unplacedCoffee"]), ", ".join(sample)))
        nearby = sorted(areas, key=lambda a: meters_between(DEMO_LNG, DEMO_LAT, a["lng"], a["lat"]))[:3]
        for area in nearby:
            say("  가까운 곳: %s [%s] %.1f km: %s" % (area["name"], area["route"],
                                                 meters_between(DEMO_LNG, DEMO_LAT, area["lng"], area["lat"]) / 1000,
                                                 ", ".join(area["coffee"]) or "커피 매장 없음"))

    notes = data["notes"]
    say("[확인] 과속방지턱 API 성남 행 수: %s%s" % (
        notes["speedBumpApiSeongnamRows"], (" (전국 %s행)" % format(info["bumpsNationwide"], ",")) if info.get("bumpsNationwide") is not None else ""))
    say("[확인] %s" % (notes["riskIndex"] or "도로위험지수: 없음"))

    routes = [(DEMO_ROUTE.name, demo_route)]
    for path in extra_routes:
        try:
            routes.append((path.name, route_points(path)))
        except (OSError, ValueError) as error:
            failed.append("경로 파일 %s: %s" % (path.name, type(error).__name__))
    say("[경로가 지나는 다발지역] 한가운데가 경로에서 반지름 안(많아야 %d m)인 지점. 앱이 경로에 얹는 기준과 같다." % NEAR_ROUTE_M)
    for label, points in routes:
        if len(points) < 2 or not spots:
            say("  %s: 비교할 경로나 다발지역 없음" % label)
            continue
        measured = sorted(((nearest_on_route(points, s["lng"], s["lat"]), s) for s in spots), key=lambda x: x[0][0])
        length = measured[0][0][2]
        close = [(m, s) for m, s in measured if m[0] <= min(app_radius(s), NEAR_ROUTE_M)]
        say("  %s (%s m): %s" % (label, format(round(length), ","), "%d곳" % len(close) if close else "없음. 가까운 순 세 곳"))
        for (gap, along, _), spot in (close or measured[:3]):
            say("    %s %s %s: 경로에서 %s m, 출발 후 %s m 지점" % (
                spot["kind"], spot["year"], spot["name"], format(round(gap), ","), format(round(along), ",")))

    say("[실패] " + ("없음" if not failed else ""))
    for line in failed:
        say("  " + line)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as error:  # 마지막 그물: 어떤 경우에도 키가 찍히지 않게 가린다.
        print(redact("중단: %s %s" % (type(error).__name__, error)))
        sys.exit(1)
