/**
 * 공공 API 자료.
 *
 * 빌드할 때 공공 API에서 받아 앱에 넣어 둔 자료(web/src/data/publicapi.json)를 읽는다.
 * - 사고 다발 지점: 한국도로교통공단 보행어린이·결빙 교통사고 다발지역 (공공데이터포털)
 * - 날씨: 기상청 단기예보 (공공데이터포털)
 * - 해 뜨고 지는 시각: 한국천문연구원 출몰시각 (공공데이터포털)
 * - 휴게소와 커피 매장: 한국도로공사 휴게소 기준정보와 브랜드 매장 (고속도로 공공데이터 포털)
 * 앱은 API 키를 갖지 않고, 실행 중에 이 API들을 부르지 않는다. 받은 값이 없거나 형식이 다르면 빈 자료로 돈다.
 *
 * 여기서는 그 자료를 읽고, 운행 시각에 맞는 날씨와 해 지는 시각을 고르고, 가까운 휴게소를 찾는다. 순수 함수다.
 * 날짜와 시각은 한국 시각(KST)으로 계산한다. 자료가 한국 시각으로 적혀 있기 때문이다.
 */
import {distance, type LngLat} from './geo';

// ───────────────────────── 자료의 모양 ─────────────────────────

/** 보행 어린이(`child`) 또는 결빙(`ice`) 교통사고 다발지역. */
export type HotspotKind = 'child' | 'ice';

/** 한국도로교통공단이 공개한 사고 다발 지점 하나. */
export interface Hotspot {
  kind: HotspotKind;
  /** 지점 이름. "성남시 분당구 정자동(…) 부근" 꼴이다. */
  name: string;
  lng: number;
  lat: number;
  /** 지점이 덮는 범위의 반지름 어림 (m). */
  radiusM: number;
  accidents: number | null;
  casualties: number | null;
  year: string | null;
  source: string;
}

/** 기상청 단기예보의 한 시간. */
export interface WeatherHour {
  /** 예보 시각 (epoch ms). */
  at: number;
  /** 기온 (°C). */
  tmp: number | null;
  /** 하늘 상태. 1 맑음, 3 구름많음, 4 흐림. */
  sky: 1 | 3 | 4 | null;
  /** 강수 형태. 0 없음, 1 비, 2 비/눈, 3 눈, 4 소나기, 5 빗방울, 6 빗방울눈날림, 7 눈날림. */
  pty: number | null;
  /** 강수 확률 (%). */
  pop: number | null;
}

/** 빌드할 때 받아 둔 단기예보. */
export interface WeatherSnapshot {
  /** 발표 시각 (epoch ms). */
  issuedAt: number | null;
  nx: number | null;
  ny: number | null;
  /** 시각 순서. */
  hours: WeatherHour[];
}

/** 한국천문연구원 출몰시각 하루치. 날짜와 시각은 한국 시각이다. */
export interface SunDay {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  sunrise: string;
  sunset: string;
}

/** 한국도로공사 휴게소 하나. coffee는 그 안의 커피 매장 상표다. */
export interface RestArea {
  name: string;
  /** 노선 이름. 예: 경부선. */
  route: string;
  /** 방향. 예: 서울방향. 모르면 null. */
  direction: string | null;
  lng: number;
  lat: number;
  coffee: string[];
}

/** 공공 API 자료의 항목. 출처마다 따로 받는다. */
export type PublicSection = 'hotspots' | 'weather' | 'sun' | 'restAreas';

export const PUBLIC_SECTIONS: readonly PublicSection[] = ['hotspots', 'weather', 'sun', 'restAreas'];

export interface PublicData {
  /** 빌드가 자료를 받은 시각 (epoch ms). 받지 못했으면 null. */
  fetchedAt: number | null;
  /**
   * 항목마다 실제로 받은 시각 (epoch ms). 한 출처가 실패하면 빌드 스크립트가 예전 파일의 그 항목을
   * 이어 쓰므로 fetchedAt보다 이를 수 있다. 받은 적이 없으면 null.
   */
  fetched: Record<PublicSection, number | null>;
  /** 날씨와 해 지는 시각의 기준 지역. */
  area: {name: string; center: LngLat} | null;
  hotspots: Hotspot[];
  weather: WeatherSnapshot | null;
  sun: SunDay[];
  restAreas: RestArea[];
  notes: {speedBumpApiSeongnamRows: number | null; riskIndex: string | null};
}

export const EMPTY_PUBLIC_DATA: PublicData = {
  fetchedAt: null,
  fetched: {hotspots: null, weather: null, sun: null, restAreas: null},
  area: null,
  hotspots: [],
  weather: null,
  sun: [],
  restAreas: [],
  notes: {speedBumpApiSeongnamRows: null, riskIndex: null},
};

// ───────────────────────── 읽기 ─────────────────────────

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** 수. 숫자로 된 글자도 받는다. */
const numberOf = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/** ISO 시각 글자를 epoch ms로. */
const timeOf = (value: unknown): number | null => {
  const text = textOf(value);
  if (!text) return null;
  const at = Date.parse(text);
  return Number.isFinite(at) ? at : null;
};

/**
 * 우리나라 안의 좌표인가. 앱은 국내 자료만 쓴다.
 * 경도와 위도가 뒤바뀐 자료를 걸러 내는 데도 쓴다.
 */
const inKorea = (lng: number, lat: number) => lng >= 124 && lng <= 132.5 && lat >= 32.5 && lat <= 39.5;

/** "7:05", "0705" → "07:05". 읽을 수 없으면 null. */
const hhmmOf = (value: unknown): string | null => {
  const text = textOf(value);
  const match = text ? /^(\d{1,2}):?(\d{2})$/.exec(text) : null;
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h < 24 && m < 60 ? `${String(h).padStart(2, '0')}:${match[2]}` : null;
};

const HOTSPOT_SOURCE: Record<HotspotKind, string> = {
  child: '보행어린이 교통사고 다발지역',
  ice: '결빙 교통사고 다발지역',
};

function hotspotOf(raw: unknown): Hotspot | null {
  if (!isRecord(raw)) return null;
  const kind = raw.kind === 'child' || raw.kind === 'ice' ? raw.kind : null;
  const lng = numberOf(raw.lng);
  const lat = numberOf(raw.lat);
  if (!kind || lng === null || lat === null || !inKorea(lng, lat)) return null;
  const radius = numberOf(raw.radiusM);
  return {
    kind,
    name: textOf(raw.name) ?? '이름 없는 지점',
    lng,
    lat,
    // 범위를 모르면 100m로 본다. 지도에 그릴 만한 크기로 묶는다.
    radiusM: radius !== null && radius > 0 ? Math.min(500, Math.max(20, radius)) : 100,
    accidents: numberOf(raw.accidents),
    casualties: numberOf(raw.casualties),
    year: textOf(raw.year) ?? (typeof raw.year === 'number' ? String(raw.year) : null),
    source: textOf(raw.source) ?? HOTSPOT_SOURCE[kind],
  };
}

function weatherHourOf(raw: unknown): WeatherHour | null {
  if (!isRecord(raw)) return null;
  const at = timeOf(raw.at);
  if (at === null) return null;
  const sky = numberOf(raw.sky);
  const pty = numberOf(raw.pty);
  return {
    at,
    tmp: numberOf(raw.tmp),
    sky: sky === 1 || sky === 3 || sky === 4 ? sky : null,
    pty: pty !== null && Number.isInteger(pty) && pty >= 0 && pty <= 7 ? pty : null,
    pop: numberOf(raw.pop),
  };
}

function weatherOf(raw: unknown): WeatherSnapshot | null {
  if (!isRecord(raw)) return null;
  const hours = listOf(raw.hours)
    .map(weatherHourOf)
    .filter((hour): hour is WeatherHour => hour !== null)
    .sort((a, b) => a.at - b.at);
  if (hours.length === 0) return null;
  return {issuedAt: timeOf(raw.issuedAt), nx: numberOf(raw.nx), ny: numberOf(raw.ny), hours};
}

function sunDayOf(raw: unknown): SunDay | null {
  if (!isRecord(raw)) return null;
  const date = textOf(raw.date);
  const sunrise = hhmmOf(raw.sunrise);
  const sunset = hhmmOf(raw.sunset);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !sunrise || !sunset || sunrise >= sunset) return null;
  return {date, sunrise, sunset};
}

function restAreaOf(raw: unknown): RestArea | null {
  if (!isRecord(raw)) return null;
  const name = textOf(raw.name);
  const lng = numberOf(raw.lng);
  const lat = numberOf(raw.lat);
  if (!name || lng === null || lat === null || !inKorea(lng, lat)) return null;
  const coffee = [...new Set(listOf(raw.coffee).map(textOf).filter((brand): brand is string => brand !== null))];
  return {name, route: textOf(raw.route) ?? '', direction: textOf(raw.direction), lng, lat, coffee};
}

function areaOf(raw: unknown): PublicData['area'] {
  if (!isRecord(raw)) return null;
  const name = textOf(raw.name);
  const center = listOf(raw.center);
  const lng = numberOf(center[0]);
  const lat = numberOf(center[1]);
  return name && lng !== null && lat !== null && inKorea(lng, lat) ? {name, center: [lng, lat]} : null;
}

/**
 * 앱에 넣어 둔 공공 API 자료를 읽는다. 형식에 맞지 않는 항목은 하나씩 버리고,
 * 파일이 비었거나 통째로 다르면 빈 자료를 돌려준다. 앱은 빈 자료로도 그대로 돈다.
 */
export function readPublicData(raw: unknown): PublicData {
  if (!isRecord(raw)) return EMPTY_PUBLIC_DATA;
  const notes = isRecord(raw.notes) ? raw.notes : {};
  const fetchedAt = timeOf(raw.fetchedAt);
  const hotspots = listOf(raw.hotspots)
    .map(hotspotOf)
    .filter((spot): spot is Hotspot => spot !== null);
  const weather = weatherOf(raw.weather);
  const sun = listOf(raw.sun)
    .map(sunDayOf)
    .filter((day): day is SunDay => day !== null);
  const restAreas = listOf(raw.restAreas)
    .map(restAreaOf)
    .filter((area): area is RestArea => area !== null);
  // 예전 파일에는 항목마다의 시각이 없다. 그때는 자료가 있는 항목을 fetchedAt에 받은 것으로 본다.
  const by = isRecord(raw.fetched) ? raw.fetched : null;
  const fetchedOf = (section: PublicSection, has: boolean) => (by ? timeOf(by[section]) : has ? fetchedAt : null);
  return {
    fetchedAt,
    fetched: {
      hotspots: fetchedOf('hotspots', hotspots.length > 0),
      weather: fetchedOf('weather', weather !== null),
      sun: fetchedOf('sun', sun.length > 0),
      restAreas: fetchedOf('restAreas', restAreas.length > 0),
    },
    area: areaOf(raw.area),
    hotspots,
    weather,
    sun,
    restAreas,
    notes: {
      speedBumpApiSeongnamRows: numberOf(notes.speedBumpApiSeongnamRows),
      riskIndex: textOf(notes.riskIndex),
    },
  };
}

// ───────────────────────── 한국 시각 ─────────────────────────

const KST_OFFSET_MS = 9 * 3_600_000;

/** at이 속한 한국 시각의 날짜. YYYY-MM-DD. */
export function kstDate(at: number): string {
  return new Date(at + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** at이 속한 한국 시각의 달 (1~12). */
const kstMonth = (at: number) => new Date(at + KST_OFFSET_MS).getUTCMonth() + 1;

// ───────────────────────── 날씨 ─────────────────────────

/** 운행 시각과 예보 시각이 이보다 멀면 그 예보를 쓰지 않는다 (ms). 오래된 자료로 날씨를 지어내지 않는다. */
export const WEATHER_REACH_MS = 90 * 60_000;

/** 발표한 지 이보다 오래된 예보는 쓰지 않는다 (ms). 이틀 뒤를 내다본 예보는 빗나가기 쉽다. */
export const WEATHER_MAX_AGE_MS = 24 * 3_600_000;

/** at에 가장 가까운 예보 한 시간. 90분 안에 없거나, 예보를 발표한 지 24시간이 지났으면 null. */
export function forecastHourAt(weather: WeatherSnapshot | null, at: number): WeatherHour | null {
  if (!weather) return null;
  if (weather.issuedAt !== null && at - weather.issuedAt > WEATHER_MAX_AGE_MS) return null;
  let best: WeatherHour | null = null;
  for (const hour of weather.hours) if (!best || Math.abs(hour.at - at) < Math.abs(best.at - at)) best = hour;
  return best && Math.abs(best.at - at) <= WEATHER_REACH_MS ? best : null;
}

/**
 * 앱에 넣어 둔 예보로 날씨를 쓸 수 있는 출발 시각의 범위 (epoch ms). 첫 예보 90분 앞부터
 * 마지막 예보 90분 뒤까지이고, 발표한 지 24시간이 되면 끝난다. 예보가 없으면 null.
 */
export function weatherWindow(weather: WeatherSnapshot | null): {from: number; to: number} | null {
  if (!weather || weather.hours.length === 0) return null;
  const last = weather.hours[weather.hours.length - 1].at + WEATHER_REACH_MS;
  return {
    from: weather.hours[0].at - WEATHER_REACH_MS,
    to: weather.issuedAt === null ? last : Math.min(last, weather.issuedAt + WEATHER_MAX_AGE_MS),
  };
}

export type WeatherCondition =
  | 'clear'
  | 'cloudy'
  | 'overcast'
  | 'rain'
  | 'shower'
  | 'drizzle'
  | 'sleet'
  | 'snow'
  | 'flurry';

/** 운행에 붙이는 날씨. 출발 시각의 단기예보에서 온다. */
export interface TripWeather {
  condition: WeatherCondition;
  /** 기온 (°C). 예보에 없으면 null. */
  tempC: number | null;
}

const BY_PRECIPITATION: Record<number, WeatherCondition> = {
  1: 'rain',
  2: 'sleet',
  3: 'snow',
  4: 'shower',
  5: 'drizzle',
  6: 'sleet',
  7: 'flurry',
};
const BY_SKY: Record<1 | 3 | 4, WeatherCondition> = {1: 'clear', 3: 'cloudy', 4: 'overcast'};

/** at의 날씨 예보. 비나 눈 예보가 있으면 그것을, 아니면 하늘 상태를 쓴다. 예보가 없거나 오래됐으면 null. */
export function weatherAt(weather: WeatherSnapshot | null, at: number): TripWeather | null {
  const hour = forecastHourAt(weather, at);
  if (!hour) return null;
  const condition =
    (hour.pty !== null ? BY_PRECIPITATION[hour.pty] : undefined) ?? (hour.sky !== null ? BY_SKY[hour.sky] : undefined);
  return condition ? {condition, tempC: hour.tmp} : null;
}

/**
 * 작전일지에서 날씨를 꾸미는 말. "맑은 아침", "비 소식이 있던 저녁"처럼 때를 나타내는 말 앞에 붙는다.
 * 값은 빌드할 때 받은 예보이므로, 비나 눈은 "왔다"고 하지 않고 "소식이 있었다"고 적는다.
 */
export const WEATHER_WORD: Record<WeatherCondition, string> = {
  clear: '맑은',
  cloudy: '구름 많은',
  overcast: '흐린',
  rain: '비 소식이 있던',
  shower: '소나기 소식이 있던',
  drizzle: '비 소식이 있던',
  sleet: '진눈깨비 소식이 있던',
  snow: '눈 소식이 있던',
  flurry: '눈 소식이 있던',
};

/** 기상청 예보의 말. SDK 로그에 "예보 비"처럼 적는다. */
export const WEATHER_TEXT: Record<WeatherCondition, string> = {
  clear: '맑음',
  cloudy: '구름많음',
  overcast: '흐림',
  rain: '비',
  shower: '소나기',
  drizzle: '빗방울',
  sleet: '비/눈',
  snow: '눈',
  flurry: '눈날림',
};

/**
 * where가 앱에 넣어 둔 자료의 지역(area의 가운데)에서 reach 미터 안인가.
 * 날씨와 해 지는 시각은 한 지역의 값이라, 그 지역 밖의 운행에는 붙이지 않는다. 위치나 지역을 모르면 false.
 */
export function isNearArea(where: LngLat | null, area: PublicData['area'], reach: number): boolean {
  return where !== null && area !== null && distance(where, area.center) <= reach;
}

/** 비, 눈, 진눈깨비 가운데 무엇이 오는가. 오지 않거나 모르면 null. */
export function precipitationOf(weather: TripWeather | null): 'rain' | 'snow' | 'sleet' | null {
  switch (weather?.condition) {
    case 'rain':
    case 'shower':
    case 'drizzle':
      return 'rain';
    case 'snow':
    case 'flurry':
      return 'snow';
    case 'sleet':
      return 'sleet';
    default:
      return null;
  }
}

// ───────────────────────── 사고 다발 지점 ─────────────────────────

/** 기온이 이 값 이하이면 결빙을 조심한다 (°C). */
export const ICY_TEMP_C = 3;

/** 결빙을 조심할 때인가. 그 시각의 예보 기온이 3°C 이하이거나, 한국 시각으로 12~2월이다. */
export function isIcyAt(at: number, weather: WeatherSnapshot | null): boolean {
  const month = kstMonth(at);
  if (month === 12 || month <= 2) return true;
  const tmp = forecastHourAt(weather, at)?.tmp;
  return tmp !== null && tmp !== undefined && tmp <= ICY_TEMP_C;
}

/** 알려야 하는 사고 다발 지점인가. 어린이 지점은 늘, 결빙 지점은 추울 때만 알린다. */
export function isHotspotActive(kind: HotspotKind, icy: boolean): boolean {
  return kind === 'child' || icy;
}

/** 지도 칩과 화면에 적는 이름. */
export const HOTSPOT_LABEL: Record<HotspotKind, string> = {
  child: '보행 어린이 사고 다발 지점',
  ice: '결빙 사고 다발 지점',
};

/** 사고 다발 지점 100m 앞에서 감자가 하는 말. 안전 경고라 다른 말보다 먼저 나간다. */
export const HOTSPOT_WARNING: Record<HotspotKind, string> = {
  child: '사령관님! 어린이 교통사고가 잦은 곳입니다. 살펴 가겠습니다.',
  ice: '사령관님! 겨울철 결빙 사고가 잦은 곳입니다. 천천히 가겠습니다.',
};

// ───────────────────────── 해 뜨고 지는 시각 ─────────────────────────

/** 운행에 붙이는 해 뜨고 지는 시각 (epoch ms). */
export interface SunTimes {
  sunrise: number;
  sunset: number;
}

/** 해 뜨고 지는 시각 자료의 첫날과 끝날 (YYYY-MM-DD, 한국 시각). 자료가 없으면 null. */
export function sunWindow(sun: readonly SunDay[]): {from: string; to: string} | null {
  if (sun.length === 0) return null;
  const dates = sun.map(day => day.date).sort();
  return {from: dates[0], to: dates[dates.length - 1]};
}

/** at이 속한 날(한국 시각)의 해 뜨고 지는 시각. 그날 자료가 없으면 null. */
export function sunOn(sun: readonly SunDay[], at: number): SunTimes | null {
  const date = kstDate(at);
  const day = sun.find(d => d.date === date);
  if (!day) return null;
  const sunrise = Date.parse(`${date}T${day.sunrise}:00+09:00`);
  const sunset = Date.parse(`${date}T${day.sunset}:00+09:00`);
  return Number.isFinite(sunrise) && Number.isFinite(sunset) && sunrise < sunset ? {sunrise, sunset} : null;
}

/** 그림일기의 하늘. 낮, 해 질 녘(해 지는 시각 앞뒤 30분), 밤. */
export type SkyPhase = 'day' | 'sunset' | 'night';

/** 해 지는 시각 앞뒤로 이만큼을 해 질 녘으로 본다 (ms). */
export const SUNSET_SPAN_MS = 30 * 60_000;

export function skyPhase(at: number, sun: SunTimes): SkyPhase {
  if (Math.abs(at - sun.sunset) <= SUNSET_SPAN_MS) return 'sunset';
  if (at < sun.sunrise || at > sun.sunset) return 'night';
  return 'day';
}

/** 해가 진 지 몇 분 뒤인가. 해가 지기 전이면 null. */
export function minutesAfterSunset(at: number, sun: SunTimes): number | null {
  return at < sun.sunset ? null : Math.round((at - sun.sunset) / 60_000);
}

// ───────────────────────── 휴게소 ─────────────────────────

/**
 * 화면에 적는 휴게소 이름. 이름에 "휴게소"나 "쉼터"가 없으면 "휴게소"를 붙인다. "죽전" → "죽전휴게소".
 * 한국도로공사 자료의 "죽전(서울)휴게소"처럼 방향이 괄호로 붙은 이름은 그대로 둔다.
 */
export function restAreaName(name: string): string {
  return /휴게소|쉼터/.test(name) ? name : `${name}휴게소`;
}

/**
 * 감자가 소리 내어 부르는 휴게소 이름. 괄호 안의 방향을 뺀다. "죽전(서울)휴게소" → "죽전휴게소".
 * 경로 곁의 휴게소는 진행 방향 쪽만 고르므로 방향을 따로 말하지 않아도 된다.
 */
function spokenRestAreaName(name: string): string {
  return restAreaName(name.replace(/\s*\([^()]*\)\s*/g, '').trim() || name);
}

/**
 * 한 점에서 가까운, 커피 매장이 있는 휴게소. 가까운 순서이고 거리는 직선거리다.
 * 지금 위치를 모르면 시연 출발지에서 잰다.
 */
export function nearestCoffeeStops(
  areas: readonly RestArea[],
  from: LngLat,
  count = 3,
): (RestArea & {meters: number})[] {
  return areas
    .filter(area => area.coffee.length > 0)
    .map(area => ({...area, meters: distance(from, [area.lng, area.lat])}))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, count);
}

/**
 * 경로가 커피 매장이 있는 휴게소 곁을 지날 때 감자가 한 번 하는 말.
 * 커피 운송작전 중에는 보고하는 말투, 아니면 평소 말투다.
 */
export function restAreaLine(name: string, coffeeMission: boolean): string {
  const place = spokenRestAreaName(name);
  return coffeeMission ? `사령관님! 다음 ${place}에 커피 매장이 있습니다.` : `다음 ${place}에 커피 매장이 있어.`;
}
