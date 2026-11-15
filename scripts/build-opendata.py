# -*- coding: utf-8 -*-
"""공공데이터포털에서 받은 원본에서 성남시 일대의 점만 추려 web/src/data/opendata.json 을 만든다.

usage: python -I scripts/build-opendata.py <원본 폴더>

원본 폴더에는 다음이 있어야 한다 (2026-11-15에 받은 구성).
- datagokr_seongnam_speed_bump_15157263/*.csv     경기도 성남시_과속방지턱 (파일데이터 15157263)
- datagokr_school_zone_std_15012891/standard_page_*.json   전국어린이보호구역표준데이터
- datagokr_parking_std_15012896/standard_page_*.json       전국주차장정보표준데이터
원본은 저장소에 넣지 않는다. 가공한 결과만 넣는다.
"""
import csv
import glob
import io
import json
import os
import sys

# 성남시와 그 둘레.
SOUTH, NORTH, WEST, EAST = 37.33, 37.48, 127.02, 127.20


def number(text):
    try:
        value = float(str(text).strip())
    except (TypeError, ValueError):
        return None
    return value if value == value else None


def inside(lat, lng):
    return lat is not None and lng is not None and SOUTH <= lat <= NORTH and WEST <= lng <= EAST


def read_text(path):
    raw = open(path, "rb").read()
    for encoding in ("utf-8-sig", "cp949"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise SystemExit("읽을 수 없는 인코딩: " + path)


def bumps(base):
    out = []
    for path in glob.glob(os.path.join(base, "datagokr_seongnam_speed_bump_15157263", "*.csv")):
        for row in csv.DictReader(io.StringIO(read_text(path))):
            lat, lng = number(row.get("위도")), number(row.get("경도"))
            if not inside(lat, lng):
                continue
            height = number(row.get("과속방지턱높이"))
            # 표준데이터에서 '폭'은 차가 지나가는 방향의 길이(표준 3.6m), '연장'은 도로를 가로지르는 길이다.
            width = number(row.get("과속방지턱폭"))
            kind = (row.get("과속방지턱형태구분") or "").strip()
            if not kind and "페인트" in (row.get("과속방지턱재료") or ""):
                kind = "가상형"
            out.append({
                "lat": round(lat, 6),
                "lng": round(lng, 6),
                # 높이는 cm, 폭은 m로 적혀 있다. 범위를 벗어난 값(단위가 섞인 값)은 모르는 것으로 둔다.
                "heightCm": height if height is not None and 3 <= height <= 20 else None,
                "lengthCm": round(width * 100) if width is not None and 1 <= width <= 8 else None,
                "kind": kind,
            })
    return out


def pages(base, folder):
    for path in sorted(glob.glob(os.path.join(base, folder, "standard_page_*.json"))):
        for row in json.load(open(path, encoding="utf-8")):
            yield row


def school_zones(base):
    out, seen = [], set()
    for row in pages(base, "datagokr_school_zone_std_15012891"):
        lat, lng = number(row.get("LATITUDE")), number(row.get("LONGITUDE"))
        name = (row.get("TRGET_FCLTY_NM") or "").strip()
        if not inside(lat, lng) or not name or name in seen:
            continue
        seen.add(name)
        out.append({"lat": round(lat, 6), "lng": round(lng, 6), "name": name})
    return out


def parking(base):
    out = []
    for row in pages(base, "datagokr_parking_std_15012896"):
        lat, lng = number(row.get("LATITUDE")), number(row.get("LONGITUDE"))
        name = (row.get("PRKPLCE_NM") or "").strip()
        if not inside(lat, lng) or not name:
            continue
        whole = lambda key: (lambda v: int(v) if v is not None else None)(number(row.get(key)))
        out.append({
            "lat": round(lat, 6),
            "lng": round(lng, 6),
            "name": name,
            "feeType": (row.get("PARKINGCHRGE_INFO") or "").strip(),
            "baseMinutes": whole("BASIC_TIME"),
            "baseFee": whole("BASIC_CHARGE"),
            "unitMinutes": whole("ADD_UNIT_TIME"),
            "unitFee": whole("ADD_UNIT_CHARGE"),
        })
    return out


def main():
    base = sys.argv[1]
    data = {
        "sources": [
            {"name": "경기도 성남시_과속방지턱", "provider": "공공데이터포털 (data.go.kr)", "url": "https://www.data.go.kr/data/15157263/fileData.do", "retrieved": "2026-11-15"},
            {"name": "전국어린이보호구역표준데이터", "provider": "공공데이터포털 (data.go.kr)", "url": "https://www.data.go.kr/data/15012891/standard.do", "retrieved": "2026-11-15"},
            {"name": "전국주차장정보표준데이터", "provider": "공공데이터포털 (data.go.kr)", "url": "https://www.data.go.kr/data/15012896/standard.do", "retrieved": "2026-11-15"},
        ],
        "area": {"south": SOUTH, "north": NORTH, "west": WEST, "east": EAST, "note": "성남시 일대"},
        "bumps": bumps(base),
        "schoolZones": school_zones(base),
        "parking": parking(base),
    }
    target = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "src", "data", "opendata.json")
    with open(target, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    print("bumps %d, school zones %d, parking %d, bytes %d" % (
        len(data["bumps"]), len(data["schoolZones"]), len(data["parking"]), os.path.getsize(target)))
    dims = sum(1 for b in data["bumps"] if b["heightCm"]), sum(1 for b in data["bumps"] if b["lengthCm"])
    print("bumps with height %d, with length %d" % dims)


if __name__ == "__main__":
    main()
