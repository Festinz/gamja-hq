/**
 * 실제 지도. 차는 화면 아래쪽에 있고 진행 방향이 위인, 내비처럼 기울인 3D 지도다.
 *
 * 지도 그림은 OpenStreetMap 벡터 타일(OpenFreeMap), 길의 모양은 경로 탐색에서 받은 실제 경로,
 * 과속방지턱과 어린이 보호구역은 공공데이터포털 자료, 사고 다발 지점은 한국도로교통공단 자료다.
 * 정체 구간은 내비(또는 시뮬레이터)가 알려준 값이다.
 * 지도를 불러오지 못하면(통신 없음, WebGL 없음) fallback으로 받은 약도를 그대로 보여준다.
 * 주행 중에 누를 수 있는 것은 없다. 지도는 손으로 움직일 수 없고 차의 위치만 따라간다.
 */
import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {Map as MapLibreMap, setWorkerUrl, type GeoJSONSource} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import {alongReal, type DriveFrame} from '../app/drive';
import {formatDistance} from '../app/navi';
import {icyNow} from '../app/publicdata';
import {PROVIDER_LABEL} from '../app/realroute';
import {pointAt, sliceLine, type LngLat} from '../core/geo';
import type {Breed} from '../core/hq';
import {HOTSPOT_LABEL, isHotspotActive, type HotspotKind} from '../core/publicdata';
import {POTATO_SKINS} from './Potato';

// 지도 라이브러리가 타일을 풀 때 쓰는 작업자 파일. 묶음 도구가 경로를 바꾸므로 직접 알려준다.
// 작업자는 따로 떨어진 곳에서 이 파일을 불러오므로 주소를 끝까지 적어 준다.
setWorkerUrl(new URL(workerUrl, window.location.href).href);

const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';
const ZOOM = 17.9;
const PITCH = 58;
/** 차가 서 있는 자리. 지도 높이에 대한 비율이다. */
const CAR_AT = 0.76;
/** 지도가 이 시간 안에 뜨지 않으면 약도로 돌아간다 (ms). */
const LOAD_TIMEOUT = 9000;

const ACCENT = '#00AAD2';
const DONE = '#3A4658';
const WARNING = '#F5B83D';
const ERROR = '#E5484D';
/** 사고 다발 지점. 경고색 대신 차분한 색으로 땅 위에 옅게 칠한다. */
const HOTSPOT: Record<HotspotKind, string> = {child: '#E89AC0', ice: '#9CC3FF'};
/** 지점의 범위에 들어서기 이 거리 앞부터 칩을 띄운다 (m). */
const HOTSPOT_CHIP_METERS = 150;

type Feature = {type: 'Feature'; properties: Record<string, string | number>; geometry: unknown};
const collection = (features: Feature[]) => ({type: 'FeatureCollection' as const, features});
const lineFeature = (points: readonly LngLat[], properties: Feature['properties'] = {}): Feature => ({
  type: 'Feature',
  properties,
  geometry: {type: 'LineString', coordinates: points},
});
const pointFeature = (point: LngLat, properties: Feature['properties'] = {}): Feature => ({
  type: 'Feature',
  properties,
  geometry: {type: 'Point', coordinates: point},
});

/** 땅 위에 그리는 원. 사고 다발 지점의 범위다. */
function circleFeature(center: LngLat, radiusMeters: number, properties: Feature['properties']): Feature {
  const ring: LngLat[] = [];
  const perLat = 111_195;
  const perLng = 111_195 * Math.cos((center[1] * Math.PI) / 180);
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * 2 * Math.PI;
    ring.push([center[0] + (Math.sin(a) * radiusMeters) / perLng, center[1] + (Math.cos(a) * radiusMeters) / perLat]);
  }
  return {type: 'Feature', properties, geometry: {type: 'Polygon', coordinates: [ring]}};
}

/** 길을 가로지르는 짧은 선. 방지턱 표시다. */
function across(center: LngLat, bearingDeg: number, halfMeters: number): LngLat[] {
  const a = ((bearingDeg + 90) * Math.PI) / 180;
  const dLat = (Math.cos(a) * halfMeters) / 111_195;
  const dLng = (Math.sin(a) * halfMeters) / (111_195 * Math.cos((center[1] * Math.PI) / 180));
  return [
    [center[0] - dLng, center[1] - dLat],
    [center[0] + dLng, center[1] + dLat],
  ];
}

const SOURCE_NOTE: Record<DriveFrame['source'], string> = {
  sim: '시뮬레이션 · 위치와 정체는 가상',
  navi: 'Pleos 내비의 위치',
  test: '시험 주행 · 위치만 가상',
};

/** 화면 오른쪽 아래에 적는 출처. 차량 속도로 위치를 어림하면 그렇게 적는다. */
const sourceNote = (frame: DriveFrame, showsMates: boolean) =>
  (frame.source === 'navi' && frame.speedFrom === 'vehicle'
    ? '속도는 차량 신호 · 길은 Pleos 내비'
    : SOURCE_NOTE[frame.source]) + (showsMates && frame.source !== 'sim' ? ' · 다른 감자는 가상' : '');

/**
 * 지도 그리기 호출. 스타일을 다시 불러오는 중(WebGL 복구 등)에는 던지므로 삼키고 false를 돌려준다.
 * 화면 전체가 멈추지 않게 한다. (isStyleLoaded()는 타일을 받는 동안에도 false라 기준으로 쓰지 않는다.)
 */
function safely(draw: () => void): boolean {
  try {
    draw();
    return true;
  } catch (error) {
    console.warn('[지도]', error);
    return false;
  }
}

/** 그리기가 실패했으면 지도가 한숨 돌린 뒤(idle) 다시 한 번 그린다. */
function drawOrRetry(map: MapLibreMap, draw: () => void) {
  if (!safely(draw)) map.once('idle', () => safely(draw));
}

/** 불러오지 못한 지도를 다시 시도하기까지 (ms). */
const RETRY_MS = 30_000;

/** 같은 정체 구간의 감자들이 서 있는 자리. 내 차 앞뒤로 한 줄. */
const MATE_OFFSETS = [22, 40, -22, 58, -40, 76];

export function RealMap({
  frame,
  breed,
  squadSize,
  bumpHint,
  fallback,
}: {
  frame: DriveFrame;
  breed: Breed;
  squadSize: number;
  bumpHint?: string;
  /** 지도를 불러오는 동안과 불러오지 못했을 때 대신 그릴 약도. */
  fallback: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  /** 지도를 몇 번째로 만드는가. 불러오지 못하면 30초 뒤에 하나 올려 다시 만든다. */
  const [attempt, setAttempt] = useState(0);
  const geo = frame.geo!;
  const line = geo.route.line;
  const first = useRef({at: geo.at, bearing: geo.bearing});

  // 지도를 한 번 만든다.
  useEffect(() => {
    if (!host.current) return;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: host.current,
        style: STYLE_URL,
        center: [first.current.at[0], first.current.at[1]],
        zoom: ZOOM,
        pitch: PITCH,
        maxPitch: 70,
        bearing: first.current.bearing,
        interactive: false,
        attributionControl: false,
        fadeDuration: 0,
      });
    } catch {
      setState('failed');
      return;
    }
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as {gamjaMap?: MapLibreMap}).gamjaMap = map;
    const timer = setTimeout(() => setState(s => (s === 'loading' ? 'failed' : s)), LOAD_TIMEOUT);
    map.on('load', () => {
      // 우리 표시는 도로 그림 위, 길 이름 아래에 둔다.
      const firstSymbol = map.getStyle().layers.find(layer => layer.type === 'symbol' && layer.id.includes('name') && !layer.id.includes('water'))?.id;
      // 이름은 한글로 적는다.
      for (const layer of map.getStyle().layers) {
        if (layer.type !== 'symbol' || !layer.layout || !('text-field' in layer.layout)) continue;
        if (layer.id.includes('motorway')) continue;
        map.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name:ko'], ['get', 'name']]);
      }
      // 어두운 바탕에서 길이 읽히도록 길을 밝힌다.
      const tone: Record<string, string> = {
        background: '#10151F',
        highway_path: '#2B3342',
        highway_minor: '#3A4354',
        highway_major_casing: '#232A36',
        highway_major_inner: '#4A556A',
        highway_major_subtle: '#4A556A',
        highway_motorway_casing: '#232A36',
        highway_motorway_inner: '#59667F',
        highway_motorway_subtle: '#59667F',
        building: '#1B2230',
        landuse_park: '#16261F',
        landcover_wood: '#16261F',
        water: '#0D2233',
      };
      for (const [id, color] of Object.entries(tone)) {
        const layer = map.getLayer(id);
        if (!layer) continue;
        map.setPaintProperty(id, layer.type === 'background' ? 'background-color' : layer.type === 'fill' ? 'fill-color' : 'line-color', color);
      }
      // 건물을 세운다.
      map.addLayer(
        {
          id: 'gamja-buildings',
          type: 'fill-extrusion',
          source: 'openmaptiles',
          'source-layer': 'building',
          minzoom: 14,
          paint: {
            'fill-extrusion-color': '#273042',
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': 0.82,
          },
        },
        firstSymbol,
      );
      const empty = collection([]);
      for (const id of ['route', 'route-done', 'route-ahead', 'jams', 'zones', 'hotspots', 'bumps', 'marks', 'mates'])
        map.addSource(id, {type: 'geojson', data: empty});
      const round = {'line-cap': 'round', 'line-join': 'round'} as const;
      // 사고 다발 지점은 길 아래 땅에 옅게 칠하고 가는 점선으로 테를 두른다.
      map.addLayer({id: 'hotspots', type: 'fill', source: 'hotspots', paint: {'fill-color': ['match', ['get', 'kind'], 'ice', HOTSPOT.ice, HOTSPOT.child], 'fill-opacity': 0.2}}, firstSymbol);
      map.addLayer({id: 'hotspots-edge', type: 'line', source: 'hotspots', paint: {'line-color': ['match', ['get', 'kind'], 'ice', HOTSPOT.ice, HOTSPOT.child], 'line-width': 3, 'line-opacity': 0.8, 'line-dasharray': [2, 2]}}, firstSymbol);
      map.addLayer({id: 'zones', type: 'line', source: 'zones', layout: round, paint: {'line-color': WARNING, 'line-width': 44, 'line-opacity': 0.22}}, firstSymbol);
      map.addLayer({id: 'route-casing', type: 'line', source: 'route', layout: round, paint: {'line-color': '#0B1220', 'line-width': 24}}, firstSymbol);
      // 지나온 길은 어둡게, 남은 길은 밝게. 두 선으로 나눠 그린다 (색 그러데이션은 타일을 받는 동안 늦게 그려진다).
      map.addLayer({id: 'route-done', type: 'line', source: 'route-done', layout: round, paint: {'line-color': DONE, 'line-width': 15}}, firstSymbol);
      map.addLayer({id: 'route-ahead', type: 'line', source: 'route-ahead', layout: round, paint: {'line-color': ACCENT, 'line-width': 15}}, firstSymbol);
      map.addLayer({id: 'jams', type: 'line', source: 'jams', layout: {'line-join': 'round'}, paint: {'line-color': ['match', ['get', 'level'], 'heavy', ERROR, WARNING], 'line-width': 15}}, firstSymbol);
      map.addLayer({id: 'bumps-edge', type: 'line', source: 'bumps', paint: {'line-color': '#0B1220', 'line-width': 22}}, firstSymbol);
      map.addLayer({id: 'bumps', type: 'line', source: 'bumps', paint: {'line-color': WARNING, 'line-width': 16, 'line-dasharray': [0.35, 0.3]}}, firstSymbol);
      map.addLayer({id: 'mates', type: 'circle', source: 'mates', paint: {'circle-radius': 11, 'circle-color': '#C9A66B', 'circle-stroke-color': '#0B1220', 'circle-stroke-width': 3, 'circle-pitch-alignment': 'map'}});
      map.addLayer({id: 'marks', type: 'circle', source: 'marks', paint: {'circle-radius': 9, 'circle-color': '#0B1220', 'circle-stroke-color': ACCENT, 'circle-stroke-width': 4}});
      clearTimeout(timer);
      setState('ready');
    });
    // 타일이나 그림 하나를 못 받은 것은 넘어간다. 지도가 끝내 뜨지 않으면 위의 시간 제한이 약도로 돌린다.
    map.on('error', event => console.warn('[지도]', event.error?.message ?? event));
    return () => {
      clearTimeout(timer);
      mapRef.current = null;
      map.remove();
    };
  }, [attempt]);

  // 불러오지 못했으면 약도를 보여주다가 30초 뒤에 다시 만든다 (통신이 돌아왔을 수 있다).
  useEffect(() => {
    if (state !== 'failed') return;
    const timer = setTimeout(() => {
      setState('loading');
      setAttempt(n => n + 1);
    }, RETRY_MS);
    return () => clearTimeout(timer);
  }, [state]);

  // 알려야 하는 사고 다발 지점. 결빙 지점은 추울 때만 보인다 (주행 엔진이 알리는 기준과 같다).
  // 추운지는 주행 중에도 바뀔 수 있으므로 길과 함께 다시 본다 (icyNow는 1분에 한 번만 계산한다).
  const icy = geo.route.hotspots.some(spot => spot.kind === 'ice') && icyNow();
  const hotspots = useMemo(
    () => geo.route.hotspots.filter(spot => isHotspotActive(spot.kind, icy)),
    [geo.route, icy],
  );

  // 길 위에 얹는 것. 길이 바뀔 때만 다시 만든다.
  const route = frame.route;
  const layers = useMemo(() => {
    const on = (meters: number) => alongReal(geo, meters);
    return {
      route: collection([lineFeature(line.points)]),
      // 처음에는 길 전체가 남은 길이다. 차가 나아가면 아래에서 둘로 나눈다.
      'route-ahead': collection([lineFeature(line.points)]),
      jams: collection(route.jams.map(jam => lineFeature(sliceLine(line, on(jam.from), on(jam.to)), {level: jam.level}))),
      zones: collection(geo.route.zones.map(zone => lineFeature(sliceLine(line, zone.from, zone.to)))),
      hotspots: collection(hotspots.map(spot => circleFeature(spot.center, spot.radiusM, {kind: spot.kind}))),
      bumps: collection(
        route.bumps.map(at => {
          const here = pointAt(line, on(at));
          return lineFeature(across(here.at, here.bearing, 5.5));
        }),
      ),
      marks: collection([pointFeature(pointAt(line, line.total).at)]),
    };
    // geo.route, geo.offset, geo.scale이 같으면 같은 길이다.
  }, [route, geo.route, geo.offset, geo.scale, line, hotspots]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || state !== 'ready') return;
    drawOrRetry(map, () => {
      for (const id of ['route', 'route-ahead', 'jams', 'zones', 'hotspots', 'bumps', 'marks'] as const)
        (map.getSource(id) as GeoJSONSource | undefined)?.setData(layers[id] as never);
    });
  }, [layers, state]);

  // 차를 따라간다. 카메라는 매 프레임, 지나온 길 색은 0.2%씩, 다른 감자 자리는 5m씩 움직일 때만 다시 보낸다.
  const progress = line.total > 0 ? Math.min(0.999, Math.max(0.001, geo.meters / line.total)) : 0.001;
  const progressStep = Math.round(progress * 500) / 500;
  const mates = frame.jam ? Math.min(squadSize, MATE_OFFSETS.length) : 0;
  const mateStep = mates > 0 ? Math.round(geo.meters / 5) : -1;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || state !== 'ready') return;
    const height = map.getContainer().clientHeight;
    safely(() =>
      map.jumpTo({
        center: [geo.at[0], geo.at[1]],
        bearing: geo.bearing,
        padding: {top: height * (2 * CAR_AT - 1), bottom: 0, left: 0, right: 0},
      }),
    );
  }, [geo.at, geo.bearing, state]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || state !== 'ready') return;
    const at = progressStep * line.total;
    drawOrRetry(map, () => {
      (map.getSource('route-done') as GeoJSONSource | undefined)?.setData(
        collection(at > 1 ? [lineFeature(sliceLine(line, 0, at))] : []) as never,
      );
      (map.getSource('route-ahead') as GeoJSONSource | undefined)?.setData(
        collection([lineFeature(sliceLine(line, at, line.total))]) as never,
      );
    });
  }, [progressStep, line, state]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || state !== 'ready') return;
    const at = mateStep * 5;
    drawOrRetry(map, () =>
      (map.getSource('mates') as GeoJSONSource | undefined)?.setData(
        collection(
          MATE_OFFSETS.slice(0, mates)
            .map(offset => at + offset)
            .filter(s => s > 0 && s < line.total)
            .map(s => pointFeature(pointAt(line, s).at)),
        ) as never,
      ),
    );
  }, [mateStep, mates, line, state]);

  const kph = Math.round(frame.speed * 3.6);
  const nextBump = route.bumps.find(at => at > frame.meters - 1 && at - frame.meters < 160);
  // 지점의 범위에 들어서기 150m 앞부터 범위를 벗어날 때까지 칩을 띄운다. 거리는 범위에 들어서는 자리까지다.
  const hotspot = hotspots.find(spot => spot.from - geo.meters <= HOTSPOT_CHIP_METERS && geo.meters <= spot.to);
  const zone = geo.route.zones.find(z => geo.meters >= z.from && geo.meters <= z.to);
  // 지도 위 가운데 칩은 하나만 띄운다. 방지턱, 사고 다발 지점, 어린이 보호구역 순서다.
  const notice =
    nextBump !== undefined
      ? {
          text: `과속방지턱 ${formatDistance(Math.max(0, nextBump - frame.meters))}${bumpHint ? ` · ${bumpHint}` : ''}`,
          color: WARNING,
        }
      : hotspot
        ? {
            text: `${HOTSPOT_LABEL[hotspot.kind]}${
              hotspot.from - geo.meters > 5 ? ` · ${formatDistance(hotspot.from - geo.meters)}` : ''
            }`,
            color: HOTSPOT[hotspot.kind],
          }
        : zone
          ? {text: `어린이 보호구역 · ${zone.name}`, color: WARNING}
          : null;
  const skin = POTATO_SKINS[breed];
  const chip = {
    position: 'absolute' as const,
    padding: '0.3rem 0.8rem',
    borderRadius: '999px',
    background: 'color-mix(in srgb, var(--color-background-card) 88%, transparent)',
    color: 'var(--color-text-primary)',
    fontWeight: 600,
    whiteSpace: 'nowrap' as const,
  };

  return (
    <div
      role="img"
      aria-label={`실제 지도 위의 주행. 시속 ${kph}km, 도착지까지 ${formatDistance(frame.remainMeters)}`}
      style={{position: 'relative', height: 'calc(100vh - 13rem)', minHeight: '16rem', borderRadius: '0.75rem', overflow: 'hidden'}}>
      <div ref={host} style={{position: 'absolute', inset: 0, visibility: state === 'ready' ? 'visible' : 'hidden'}} />
      {state !== 'ready' && <div style={{position: 'absolute', inset: 0}}>{fallback}</div>}
      {state === 'ready' && (
        <>
          {/* 내 차. 방지턱 위에서는 살짝 들린다. */}
          <svg
            viewBox="-40 -56 80 112"
            style={{position: 'absolute', left: '50%', top: `${CAR_AT * 100}%`, width: '4.6rem', transform: `translate(-50%, -50%) scale(${frame.forces.onBump ? 1.07 : 1})`}}>
            <ellipse cx="0" cy="8" rx="30" ry="44" fill="#000" opacity="0.28" />
            <rect x="-23" y="-40" width="46" height="80" rx="19" fill={ACCENT} stroke="#0B1220" strokeWidth="3.5" />
            <path d="M-16 -21 Q0 -30 16 -21 L13.5 -8 Q0 -12.5 -13.5 -8 Z" fill="#0B1220" opacity="0.72" />
            <rect x="-13" y="22" width="26" height="8" rx="4" fill="#0B1220" opacity="0.6" />
            <ellipse cx="0" cy="6" rx="11.5" ry="10.5" fill={skin.base} stroke={skin.line} strokeWidth="2.2" />
            <circle cx="-4" cy="3.5" r="1.7" fill="#2A2623" />
            <circle cx="4" cy="3.5" r="1.7" fill="#2A2623" />
          </svg>
          {notice && (
            <span style={{...chip, left: '50%', top: '0.8rem', transform: 'translateX(-50%)', border: `2px solid ${notice.color}`, fontSize: '1rem'}}>
              {notice.text}
            </span>
          )}
          <span style={{...chip, left: '0.7rem', bottom: '0.7rem', fontSize: '1.05rem'}}>{kph}km/h</span>
          {/* 출처. 속도 칩과 겹치지 않게 오른쪽 아래에 두 줄로 적는다. */}
          <span
            style={{
              ...chip,
              right: '0.7rem',
              bottom: '0.7rem',
              maxWidth: '58%',
              whiteSpace: 'normal',
              textAlign: 'right',
              lineHeight: 1.35,
              borderRadius: '0.6rem',
              fontWeight: 400,
              fontSize: '0.68rem',
              color: 'var(--color-text-secondary)',
            }}>
            {sourceNote(frame, mates > 0)} · {PROVIDER_LABEL[geo.route.provider]}
            <br />
            지도 © OpenStreetMap 기여자 · OpenMapTiles · OpenFreeMap
          </span>
        </>
      )}
    </div>
  );
}
