/**
 * 실제 경로 받아 오기.
 *
 * 내비(NaviHelper)가 알려준 지금 위치와 목적지의 좌표로 경로 탐색 서비스에서 길의 모양을 받아 온다.
 * TMAP 키가 있으면 TMAP 자동차 경로안내를, 없으면 OpenStreetMap 경로 탐색(OSRM 공개 서버)을 쓴다.
 * 받아 온 길에 공공데이터의 과속방지턱과 어린이 보호구역, 앱에 넣어 둔 공공 API 자료의 사고 다발 지점과
 * 휴게소를 얹어 주행 엔진에 붙인다.
 *
 * 좌표는 이 요청과 지도 그리기에만 쓰고 저장하지 않는다. 작전일지에는 동네 이름만 남는다.
 */
import {useSyncExternalStore} from 'react';
import {distance, type LngLat} from '../core/geo';
import {
  fromBundled,
  fromOsrm,
  fromTmap,
  withOpenData,
  withPublicApiData,
  type OpenData,
  type RealRoute,
  type RouteProvider,
} from '../core/realroute';
import openData from '../data/opendata.json';
import pangyo from '../data/pangyo-route.json';
import {attachRealRoute, naviTraveled} from './drive';
import type {NaviSnapshot} from './navi';
import {PUBLIC_DATA} from './publicdata';
import {logSdkEvent} from './sdkLog';

/** 공공데이터포털 표준데이터에서 추린 과속방지턱, 어린이 보호구역, 주차장. */
export const OPEN_DATA = openData as unknown as OpenData & {
  sources: {name: string; provider: string; url: string; retrieved: string}[];
};

const TMAP_KEY: string = import.meta.env.VITE_TMAP_APP_KEY ?? '';
const TIMEOUT_MS = 7000;

export interface RealRouteStatus {
  state: 'idle' | 'loading' | 'ready' | 'mismatch' | 'failed';
  provider: RouteProvider | null;
  /** 경로 위에서 찾은 공공데이터 과속방지턱의 수. */
  bumps: number;
  zones: number;
}

const IDLE: RealRouteStatus = {state: 'idle', provider: null, bumps: 0, zones: 0};
let status = IDLE;
const listeners = new Set<() => void>();

function setStatus(next: RealRouteStatus) {
  status = next;
  listeners.forEach(listener => listener());
}

export function useRealRouteStatus(): RealRouteStatus {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => status,
  );
}

/** 어느 서비스의 경로인지 화면에 적을 말. */
export const PROVIDER_LABEL: Record<RouteProvider, string> = {
  tmap: 'TMAP 경로',
  osrm: 'OpenStreetMap 경로',
  bundled: '앱에 넣어 둔 경로',
};

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {...init, signal: abort.signal});
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function viaTmap(from: LngLat, to: LngLat): Promise<RealRoute | null> {
  if (!TMAP_KEY) return null;
  return fromTmap(
    await getJson('https://apis.openapi.sk.com/tmap/routes?version=1&format=json', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Accept: 'application/json', appKey: TMAP_KEY},
      body: JSON.stringify({
        startX: String(from[0]),
        startY: String(from[1]),
        endX: String(to[0]),
        endY: String(to[1]),
        reqCoordType: 'WGS84GEO',
        resCoordType: 'WGS84GEO',
        searchOption: '0',
      }),
    }),
  );
}

async function viaOsrm(from: LngLat, to: LngLat): Promise<RealRoute | null> {
  const pair = `${from[0]},${from[1]};${to[0]},${to[1]}`;
  return fromOsrm(
    await getJson(
      `https://router.project-osrm.org/route/v1/driving/${pair}?overview=full&geometries=geojson&steps=true`,
    ),
  );
}

/** 공공데이터(과속방지턱, 어린이 보호구역)와 공공 API 자료(사고 다발 지점, 휴게소)를 길에 얹는다. */
function withRoadside(real: RealRoute): RealRoute {
  return withPublicApiData(withOpenData(real, OPEN_DATA), PUBLIC_DATA);
}

/** 앱에 넣어 둔 실제 경로(시흥동 → 판교역)와 공공데이터. 시뮬레이터가 쓰고, 통신이 안 될 때의 대신으로도 쓴다. */
export function demoRealRoute(): RealRoute {
  return withRoadside(fromBundled(pangyo));
}

/** 앱에 넣어 둔 실제 경로의 출발지 (시흥동). 지금 위치를 모를 때 가까운 휴게소를 이 자리에서 잰다. */
export const DEMO_START: LngLat = [pangyo.coordinates[0][0], pangyo.coordinates[0][1]];

/** 로그에 적는 길 위의 공공데이터. "공공데이터 과속방지턱 3개, 사고 다발 지점 1곳". */
export function roadsideSummary(real: RealRoute): string {
  const parts = [`공공데이터 과속방지턱 ${real.bumps.length}개`];
  if (real.hotspots.length > 0) parts.push(`사고 다발 지점 ${real.hotspots.length}곳`);
  if (real.restAreas.length > 0) parts.push(`커피 매장 휴게소 ${real.restAreas.length}곳`);
  return parts.join(', ');
}

/** 통신이 안 될 때, 출발지와 목적지가 넣어 둔 경로의 양 끝과 가까우면 그 경로를 쓴다. */
function bundledFor(from: LngLat, to: LngLat): RealRoute | null {
  const points = pangyo.coordinates;
  const start = points[0] as [number, number];
  const end = points[points.length - 1] as [number, number];
  return distance(from, start) < 200 && distance(to, end) < 300 ? fromBundled(pangyo) : null;
}

async function load(from: LngLat, to: LngLat): Promise<RealRoute | null> {
  const real = (await viaTmap(from, to)) ?? (await viaOsrm(from, to)) ?? bundledFor(from, to);
  return real ? withRoadside(real) : null;
}

let wanted = '';
/** 받아 오지 못한 목적지와 그 시각. 30초가 지나면 다시 시도한다. */
let failed: {key: string; at: number} | null = null;
const RETRY_MS = 30_000;

/**
 * 내비 안내 상태가 올 때마다 부른다. 지금 위치와 목적지를 알면 길의 실제 모양을 한 번 받아 주행 엔진에 붙인다.
 * 안내가 끝나면 지운다.
 */
export function ensureRealRoute(navi: NaviSnapshot | null) {
  if (!navi) {
    wanted = '';
    if (status.state !== 'idle') setStatus(IDLE);
    return;
  }
  const from = navi.position;
  const to = navi.destinationPoint;
  if (!from || !to) return;
  // 목적지와 내비의 전체 거리로 구분한다. 내비가 경로를 다시 짜면 전체 거리가 바뀌어 새로 받는다.
  const key = `${to.lat.toFixed(4)},${to.lng.toFixed(4)},${Math.round(navi.totalMeters / 50)}`;
  if (key === wanted && !(failed?.key === key && Date.now() - failed.at > RETRY_MS)) return;
  if (key !== wanted) attachRealRoute(null);
  wanted = key;
  failed = null;
  const requestedAt = naviTraveled() ?? undefined;
  setStatus({...IDLE, state: 'loading'});
  void load([from.lng, from.lat], [to.lng, to.lat]).then(real => {
    // 그 사이에 목적지가 바뀌었거나 안내가 끝났으면 버린다.
    if (wanted !== key) return;
    if (!real) {
      failed = {key, at: Date.now()};
      setStatus({...IDLE, state: 'failed'});
      return;
    }
    const attached = attachRealRoute(real, requestedAt);
    setStatus({
      state: attached ? 'ready' : 'mismatch',
      provider: real.provider,
      bumps: real.bumps.length,
      zones: real.zones.length,
    });
    logSdkEvent({
      sdk: '지도·공공데이터',
      name: PROVIDER_LABEL[real.provider],
      detail: attached
        ? `길의 모양 ${Math.round(real.line.total)}m, ${roadsideSummary(real)}`
        : `내비의 남은 거리와 달라 쓰지 않음 (${Math.round(real.line.total)}m)`,
    });
  });
}
