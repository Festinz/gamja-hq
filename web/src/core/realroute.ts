/**
 * 실제 경로.
 *
 * 내비(NaviHelper)는 길의 모양을 주지 않는다. 그래서 출발지와 목적지의 좌표로 경로 탐색 서비스에서
 * 길의 모양(경도·위도의 꺾은선)을 받아 오고, 그 위에 공공데이터의 과속방지턱과 어린이 보호구역,
 * 공공 API의 사고 다발 지점과 휴게소를 얹는다.
 * 여기서는 받아 온 값을 주행 모형이 쓰는 길(Route)로 바꾼다. 순수 함수다.
 */
import {bearing, bendsOf, distance, headingAt, lineOf, nearestOnLine, turnBetween, type Line, type LngLat} from './geo';
import type {JamLevel, Route, RouteTurn} from './drive';
import type {HotspotKind, PublicData} from './publicdata';

export type RouteProvider = 'osrm' | 'tmap' | 'bundled';

/** 경로 탐색 서비스가 알려준 안내 지점. 굽이에 길 이름을 붙이는 데 쓴다. */
export interface RealStep {
  /** 출발지부터의 거리 (m). */
  at: number;
  /** 이 지점부터 달리는 길의 이름. 모르면 빈 문자열. */
  name: string;
}

/** 공공데이터에서 온 과속방지턱 하나. 높이와 길이는 자료에 있을 때만 있다. */
export interface RealBump {
  at: number;
  /** 높이 (m). */
  height: number | null;
  /** 차가 넘어가는 방향의 길이 (m). */
  length: number | null;
  kind: string;
}

/** 경로가 지나가는 어린이 보호구역. */
export interface RealZone {
  from: number;
  to: number;
  name: string;
}

/** 경로가 지나가는 사고 다발 지점 (한국도로교통공단). */
export interface RealHotspot {
  /** 지점 한가운데에서 가장 가까운 경로 위의 자리 (m). 감자는 이 자리를 지나면 센다. */
  at: number;
  /** 경로가 지점의 범위(반지름 radiusM의 원)에 들어서는 자리 (m). 감자는 이 자리 앞에서 알린다. */
  from: number;
  /** 경로가 지점의 범위를 벗어나는 자리 (m). */
  to: number;
  kind: HotspotKind;
  name: string;
  /** 지점 한가운데. 지도에 그릴 때만 쓴다. */
  center: LngLat;
  /** 지점이 덮는 범위의 반지름 어림 (m). */
  radiusM: number;
}

/** 경로 곁의, 커피 매장이 있는 휴게소 (한국도로공사). */
export interface RealRestArea {
  /** 휴게소에서 가장 가까운 경로 위의 자리 (m). */
  at: number;
  name: string;
  coffee: string[];
}

export interface RealRoute {
  provider: RouteProvider;
  line: Line;
  steps: RealStep[];
  bumps: RealBump[];
  zones: RealZone[];
  hotspots: RealHotspot[];
  restAreas: RealRestArea[];
}

// ───────────────────────── 경로 탐색 결과 읽기 ─────────────────────────

const isPoint = (value: unknown): value is [number, number] =>
  Array.isArray(value) &&
  value.length >= 2 &&
  typeof value[0] === 'number' &&
  typeof value[1] === 'number' &&
  Number.isFinite(value[0]) &&
  Number.isFinite(value[1]);

/** OSRM(OpenStreetMap 경로 탐색)의 응답. 형식이 다르면 null. */
export function fromOsrm(json: unknown): RealRoute | null {
  const route = (json as {routes?: unknown[]} | null)?.routes?.[0] as
    | {geometry?: {coordinates?: unknown[]}; legs?: {steps?: unknown[]}[]}
    | undefined;
  const coordinates = route?.geometry?.coordinates;
  if (!Array.isArray(coordinates)) return null;
  const points = coordinates.filter(isPoint).map(([lng, lat]): LngLat => [lng, lat]);
  if (points.length < 2) return null;
  const steps: RealStep[] = [];
  let at = 0;
  for (const leg of route?.legs ?? []) {
    for (const raw of leg.steps ?? []) {
      const step = raw as {distance?: number; name?: string};
      steps.push({at, name: typeof step.name === 'string' ? step.name : ''});
      at += typeof step.distance === 'number' ? step.distance : 0;
    }
  }
  return {provider: 'osrm', line: lineOf(points), steps, bumps: [], zones: [], hotspots: [], restAreas: []};
}

/**
 * TMAP 자동차 경로안내의 응답(GeoJSON). 선(LineString)을 이어 길의 모양을 만들고,
 * 안내 지점(Point)의 설명을 길 이름으로 쓴다. 형식이 다르면 null.
 */
export function fromTmap(json: unknown): RealRoute | null {
  const features = (json as {features?: unknown[]} | null)?.features;
  if (!Array.isArray(features)) return null;
  const points: LngLat[] = [];
  const steps: RealStep[] = [];
  let at = 0;
  for (const raw of features) {
    const feature = raw as {
      geometry?: {type?: string; coordinates?: unknown};
      properties?: {name?: string; description?: string; distance?: number};
    };
    const coordinates = feature.geometry?.coordinates;
    if (feature.geometry?.type === 'LineString' && Array.isArray(coordinates)) {
      const name = typeof feature.properties?.name === 'string' ? feature.properties.name : '';
      steps.push({at, name});
      for (const point of coordinates) if (isPoint(point)) points.push([point[0], point[1]]);
      at += typeof feature.properties?.distance === 'number' ? feature.properties.distance : 0;
    }
  }
  if (points.length < 2) return null;
  return {provider: 'tmap', line: lineOf(points), steps, bumps: [], zones: [], hotspots: [], restAreas: []};
}

/** 앱에 넣어 둔 경로 (web/src/data). 시뮬레이터와 테스트가 쓴다. */
export function fromBundled(data: {
  coordinates: number[][];
  steps: {at: number; name: string}[];
}): RealRoute {
  return {
    provider: 'bundled',
    line: lineOf(data.coordinates.filter(isPoint).map(([lng, lat]): LngLat => [lng, lat])),
    steps: data.steps.map(step => ({at: step.at, name: step.name})),
    bumps: [],
    zones: [],
    hotspots: [],
    restAreas: [],
  };
}

// ───────────────────────── 공공데이터 얹기 ─────────────────────────

/** 공공데이터포털 표준데이터에서 추린 점들. web/src/data/opendata.json의 모양이다. */
export interface OpenData {
  bumps: {lat: number; lng: number; heightCm: number | null; lengthCm: number | null; kind: string}[];
  schoolZones: {lat: number; lng: number; name: string}[];
  parking: {
    lat: number;
    lng: number;
    name: string;
    /** '무료', '유료', '혼합' */
    feeType: string;
    baseMinutes: number | null;
    baseFee: number | null;
    unitMinutes: number | null;
    unitFee: number | null;
  }[];
}

/** 방지턱이 길 한가운데에서 이만큼 안쪽에 있어야 그 길의 방지턱으로 본다 (m). */
export const BUMP_MATCH_METERS = 12;
/** 어린이 보호구역은 시설에서 이 거리 안의 길로 어림한다 (m). 법이 정한 범위는 주 출입문에서 300m 이내다. */
export const SCHOOL_ZONE_METERS = 300;

const near = (line: Line, lng: number, lat: number, reach: number): boolean => {
  // 경로를 둘러싼 네모 밖의 점은 일찍 버린다.
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [x, y] of line.points) {
    if (x < minLng) minLng = x;
    if (x > maxLng) maxLng = x;
    if (y < minLat) minLat = y;
    if (y > maxLat) maxLat = y;
  }
  const padLat = reach / 111_000;
  const padLng = reach / 88_000;
  return lng >= minLng - padLng && lng <= maxLng + padLng && lat >= minLat - padLat && lat <= maxLat + padLat;
};

/** 경로 위에 놓인 과속방지턱과, 경로가 지나가는 어린이 보호구역을 찾아 붙인다. */
export function withOpenData(real: RealRoute, data: OpenData): RealRoute {
  const line = real.line;
  const bumps: RealBump[] = [];
  for (const bump of data.bumps) {
    // 가상형은 도로에 페인트로 그린 입체 표시라 차가 들썩이지 않는다.
    if (bump.kind.includes('가상')) continue;
    if (!near(line, bump.lng, bump.lat, BUMP_MATCH_METERS)) continue;
    const found = nearestOnLine(line, [bump.lng, bump.lat]);
    if (found.offset > BUMP_MATCH_METERS) continue;
    // 같은 방지턱이 차로마다 따로 적힌 자료가 있다. 10m 안의 것은 하나로 본다.
    if (bumps.some(other => Math.abs(other.at - found.meters) < 10)) continue;
    bumps.push({
      at: found.meters,
      height: bump.heightCm && bump.heightCm > 0 ? bump.heightCm / 100 : null,
      length: bump.lengthCm && bump.lengthCm > 0 ? bump.lengthCm / 100 : null,
      kind: bump.kind,
    });
  }
  bumps.sort((a, b) => a.at - b.at);

  const zones: RealZone[] = [];
  for (const school of data.schoolZones) {
    if (!near(line, school.lng, school.lat, SCHOOL_ZONE_METERS)) continue;
    const center: LngLat = [school.lng, school.lat];
    // 시설에서 300m 안에 드는 경로 구간을 10m 간격으로 찾는다. 벗어났다 다시 들어오면 구간을 나눈다.
    let from: number | null = null;
    let to = 0;
    const close = () => {
      if (from !== null && to - from >= 20) zones.push({from, to, name: school.name});
      from = null;
    };
    for (let s = 0; s <= line.total; s += 10) {
      const here = nearestSample(line, s);
      if (distance(here, center) > SCHOOL_ZONE_METERS) {
        close();
        continue;
      }
      if (from === null) from = s;
      to = s;
    }
    close();
  }
  zones.sort((a, b) => a.from - b.from);
  return {...real, bumps, zones};
}

function nearestSample(line: Line, meters: number): LngLat {
  let lo = 0;
  let hi = line.points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (line.cum[mid] <= meters) lo = mid;
    else hi = mid;
  }
  const a = line.points[lo];
  const b = line.points[hi];
  const span = line.cum[hi] - line.cum[lo];
  const t = span > 0 ? Math.min(1, Math.max(0, (meters - line.cum[lo]) / span)) : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** 목적지에서 reach 미터 안의 주차장. 가까운 순서. */
export function parkingNear(
  data: OpenData,
  destination: LngLat,
  reach = 500,
): (OpenData['parking'][number] & {meters: number})[] {
  return data.parking
    .map(lot => ({...lot, meters: distance(destination, [lot.lng, lot.lat])}))
    .filter(lot => lot.meters <= reach)
    .sort((a, b) => a.meters - b.meters);
}

// ───────────────────────── 공공 API 자료 얹기 ─────────────────────────

/**
 * 경로가 사고 다발 지점의 범위(반지름)를 지나가야 그 길이 지나는 지점으로 본다. 범위가 넓어도 한가운데가
 * 경로에서 이 거리 안이어야 한다 (m). scripts/fetch-public-apis.py 의 NEAR_ROUTE_M 과 같은 값이다.
 */
export const HOTSPOT_MATCH_METERS = 150;
/** 휴게소가 경로에서 이만큼 안쪽에 있어야 경로 곁의 휴게소로 본다 (m). */
export const REST_AREA_MATCH_METERS = 500;

/**
 * 경로가 지나가는 사고 다발 지점과, 경로 곁의 커피 매장이 있는 휴게소를 찾아 붙인다.
 * 우리나라는 오른쪽으로 다니므로 들를 수 있는 휴게소는 진행 방향 오른쪽에 있다. 왼쪽(맞은편 방향)의 휴게소는 뺀다.
 */
export function withPublicApiData(real: RealRoute, data: Pick<PublicData, 'hotspots' | 'restAreas'>): RealRoute {
  const line = real.line;
  const hotspots: RealHotspot[] = [];
  for (const spot of data.hotspots) {
    const reach = Math.min(spot.radiusM, HOTSPOT_MATCH_METERS);
    if (!near(line, spot.lng, spot.lat, reach)) continue;
    const found = nearestOnLine(line, [spot.lng, spot.lat]);
    if (found.offset > reach) continue;
    // 같은 지점이 해마다 따로 적힌 자료가 있다. 같은 종류가 30m 안에 있으면 하나로 본다.
    if (hotspots.some(other => other.kind === spot.kind && Math.abs(other.at - found.meters) < 30)) continue;
    // 경로가 원을 가로지르는 구간의 절반. 경로가 곧다고 보고 어림한다.
    const half = Math.sqrt(Math.max(0, spot.radiusM ** 2 - found.offset ** 2));
    hotspots.push({
      at: found.meters,
      from: Math.max(0, found.meters - half),
      to: Math.min(line.total, found.meters + half),
      kind: spot.kind,
      name: spot.name,
      center: [spot.lng, spot.lat],
      radiusM: spot.radiusM,
    });
  }
  hotspots.sort((a, b) => a.at - b.at);

  const restAreas: RealRestArea[] = [];
  for (const area of data.restAreas) {
    if (area.coffee.length === 0 || !near(line, area.lng, area.lat, REST_AREA_MATCH_METERS)) continue;
    const point: LngLat = [area.lng, area.lat];
    const found = nearestOnLine(line, point);
    if (found.offset > REST_AREA_MATCH_METERS) continue;
    // 가장 가까운 자리가 경로의 끝이면 출발지 뒤나 목적지 너머의 휴게소다.
    if (found.offset > 60 && (found.meters < 1 || found.meters > line.total - 1)) continue;
    // 맞은편 방향의 휴게소는 들를 수 없다. 길 한가운데에 찍힌 자료는 어느 쪽인지 모르므로 둔다.
    if (found.offset > 40) {
      const side = turnBetween(headingAt(line, found.meters), bearing(nearestSample(line, found.meters), point));
      if (side < 0) continue;
    }
    if (restAreas.some(other => other.name === area.name && Math.abs(other.at - found.meters) < 300)) continue;
    restAreas.push({at: found.meters, name: area.name, coffee: area.coffee});
  }
  restAreas.sort((a, b) => a.at - b.at);
  return {...real, hotspots, restAreas};
}

// ───────────────────────── 주행 모형의 길로 바꾸기 ─────────────────────────

const stepNameAfter = (steps: RealStep[], at: number): string => {
  // 굽이를 돌아 들어서는 길의 이름. 굽이 앞뒤 60m 안에서 시작하는 안내 지점을 찾는다.
  let best: RealStep | null = null;
  for (const step of steps) {
    if (!step.name || Math.abs(step.at - at) > 60) continue;
    if (!best || Math.abs(step.at - at) < Math.abs(best.at - at)) best = step;
  }
  return best?.name ?? '';
};

/** 굽이 하나를 화면에 적을 말로. "좌회전 · 창업로", "오른쪽 굽은 길". */
export function turnLabel(angleDeg: number, roadName: string): string {
  const side = angleDeg > 0 ? '오른쪽' : '왼쪽';
  // 55도 넘게 꺾여야 회전으로 부른다. 그보다 완만하면 굽은 길이다 (내비도 굽은 길은 회전 안내를 하지 않는다).
  const word = Math.abs(angleDeg) >= 150 ? '유턴' : Math.abs(angleDeg) >= 55 ? (angleDeg > 0 ? '우회전' : '좌회전') : `${side} 굽은 길`;
  return roadName ? `${word} · ${roadName}` : word;
}

/**
 * 실제 경로에서 주행 모형의 길을 만든다.
 * 회전은 경로의 모양에서 찾고, 방지턱은 공공데이터에서 찾은 것을 쓴다. 정체는 내비나 시뮬레이터가 따로 넣는다.
 * scale은 길의 거리를 다른 기준(내비가 알려준 전체 거리)에 맞출 때 쓰는 배율, offset은 그 기준에서의 출발 거리다.
 */
export function routeOf(
  real: RealRoute,
  options: {jams?: {from: number; to: number; level: JamLevel; road?: string}[]; scale?: number; offset?: number} = {},
): Route {
  const scale = options.scale ?? 1;
  const offset = options.offset ?? 0;
  const place = (meters: number) => offset + meters * scale;
  const turns: RouteTurn[] = bendsOf(real.line).map(bend => ({
    at: place(bend.at),
    direction: bend.angleDeg > 0 ? 'right' : 'left',
    angleDeg: Math.abs(bend.angleDeg),
    radius: bend.radius,
    label: turnLabel(bend.angleDeg, stepNameAfter(real.steps, bend.at)),
  }));
  return {
    totalMeters: place(real.line.total),
    turns,
    bumps: real.bumps.map(bump => place(bump.at)),
    grades: [],
    jams: options.jams ?? [],
  };
}
