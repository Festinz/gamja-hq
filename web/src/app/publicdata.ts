/**
 * 앱에 넣어 둔 공공 API 자료 (web/src/data/publicapi.json).
 *
 * 빌드할 때 저장소의 scripts/fetch-public-apis.py 가 공공 API에서 받아 쓴 파일이다. 키는 들어 있지 않고,
 * 앱은 실행 중에 이 API들을 부르지 않는다. 파일이 비어 있어도 앱은 그대로 돈다 (해당 기능만 쉰다).
 * 읽기와 계산은 core/publicdata.ts 가 하고, 여기서는 앱의 "지금"(시뮬레이션 시계)에 맞춰 꺼내 준다.
 */
import raw from '../data/publicapi.json';
import {
  isIcyAt,
  readPublicData,
  sunOn,
  weatherAt,
  type SunTimes,
  type TripWeather,
} from '../core/publicdata';
import {now} from '../sim/clock';

/** 형식을 확인한 공공 API 자료. 형식에 맞지 않는 항목은 버렸다. */
export const PUBLIC_DATA = readPublicData(raw as unknown);

/** at 시각의 날씨 (기상청 단기예보). 앱에 넣어 둔 예보가 그 시각을 덮지 못하면 null. */
export function weatherNear(at: number): TripWeather | null {
  return weatherAt(PUBLIC_DATA.weather, at);
}

/** at이 속한 날의 해 뜨고 지는 시각 (한국천문연구원). 그날 자료가 없으면 null. */
export function sunFor(at: number): SunTimes | null {
  return sunOn(PUBLIC_DATA.sun, at);
}

let icy: {minute: number; value: boolean} | null = null;

/** 지금 결빙을 조심할 때인가. 1분에 한 번만 다시 계산한다. */
export function icyNow(): boolean {
  const at = now();
  const minute = Math.floor(at / 60_000);
  if (icy?.minute !== minute) icy = {minute, value: isIcyAt(at, PUBLIC_DATA.weather)};
  return icy.value;
}
