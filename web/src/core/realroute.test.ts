import {describe, expect, it} from 'vitest';
import openData from '../data/opendata.json';
import pangyo from '../data/pangyo-route.json';
import publicApi from '../data/publicapi.json';
import {buildGeometry, type RouteTurn} from './drive';
import {headingAt, pointAt, type LngLat} from './geo';
import {EMPTY_PUBLIC_DATA, readPublicData, type Hotspot, type RestArea} from './publicdata';
import {
  fromBundled,
  fromOsrm,
  fromTmap,
  parkingNear,
  routeOf,
  turnLabel,
  withOpenData,
  withPublicApiData,
  type OpenData,
} from './realroute';

/** 시흥동(판교 제2테크노밸리) → 삼평동. 2026-11-15에 OSRM 공개 서버에서 받아 앱에 넣어 둔 경로다. */
const real = fromBundled(pangyo);
const EMPTY: OpenData = {bumps: [], schoolZones: [], parking: []};

const nearestTurn = (turns: RouteTurn[], at: number) =>
  turns.reduce((best, turn) => (Math.abs(turn.at - at) < Math.abs(best.at - at) ? turn : best));

/** 경로에서 옆으로 meters 만큼 떨어진 점 (동쪽으로 민다). */
const beside = (at: number, meters: number): LngLat => {
  const [lng, lat] = pointAt(real.line, at).at;
  return [lng + meters / (111_195 * Math.cos((lat * Math.PI) / 180)), lat];
};

describe('앱에 넣어 둔 실제 경로', () => {
  it('전체 길이는 3km쯤이다', () => {
    expect(real.line.total).toBeGreaterThan(2900);
    expect(real.line.total).toBeLessThan(3050);
  });

  it('참고: 경로의 모양에서 찾은 굽이', () => {
    const lines = routeOf(real).turns.map(
      turn => `${Math.round(turn.at)}m ${turn.direction} ${Math.round(turn.angleDeg)}도 r${Math.round(turn.radius)}m ${turn.label}`,
    );
    console.log(lines.join('\n'));
    expect(lines.length).toBeGreaterThan(3);
  });
});

describe('실제 경로를 주행 모형의 길로', () => {
  const route = routeOf(real);

  it('창업로로 들어서는 좌회전을 110m 근처에서 찾는다', () => {
    const turn = nearestTurn(route.turns, 112);
    expect(Math.abs(turn.at - 112)).toBeLessThan(30);
    expect(turn.direction).toBe('left');
    expect(turn.label).toContain('창업로');
  });

  it('대왕판교로로 들어서는 우회전을 500m 근처에서 찾는다', () => {
    const turn = nearestTurn(route.turns, 501);
    expect(Math.abs(turn.at - 501)).toBeLessThan(30);
    expect(turn.direction).toBe('right');
    expect(turn.label).toContain('대왕판교로');
  });

  it('판교로와 동판교로로 들어서는 좌회전을 찾는다', () => {
    const first = nearestTurn(route.turns, 1666);
    expect(Math.abs(first.at - 1666)).toBeLessThan(30);
    expect(first.direction).toBe('left');
    expect(first.label).toContain('판교로');
    const second = nearestTurn(route.turns, 2703);
    expect(Math.abs(second.at - 2703)).toBeLessThan(30);
    expect(second.direction).toBe('left');
  });

  it('회전은 출발지에서 가까운 순서이고 반지름과 각도가 쓸 수 있는 값이다', () => {
    for (let i = 1; i < route.turns.length; i++) expect(route.turns[i].at).toBeGreaterThan(route.turns[i - 1].at);
    for (const turn of route.turns) {
      expect(turn.radius).toBeGreaterThanOrEqual(11);
      expect(turn.radius).toBeLessThanOrEqual(150);
      expect(turn.angleDeg).toBeGreaterThanOrEqual(25);
      expect(turn.angleDeg).toBeLessThanOrEqual(200);
    }
  });

  it('이 길로 주행 모형의 도형을 만들 수 있고 전체 길이가 같다', () => {
    const geometry = buildGeometry(route);
    expect(geometry.total).toBeCloseTo(real.line.total, 3);
    for (const piece of geometry.pieces) expect(piece.s1).toBeGreaterThan(piece.s0);
  });

  it('내비의 전체 거리에 맞춰 배율과 출발 거리를 줄 수 있다', () => {
    const scaled = routeOf(real, {scale: 3100 / real.line.total, offset: 200});
    expect(scaled.totalMeters).toBeCloseTo(3300, 3);
    const turn = nearestTurn(scaled.turns, 200 + (112 * 3100) / real.line.total);
    expect(turn.direction).toBe('left');
  });
});

describe('공공데이터 얹기', () => {
  it('길 위에 놓인 과속방지턱은 그 자리의 거리와 규격으로 붙는다', () => {
    const [lng, lat] = beside(800, 3);
    const found = withOpenData(real, {
      ...EMPTY,
      bumps: [{lat, lng, heightCm: 10, lengthCm: 360, kind: '원호형'}],
    });
    expect(found.bumps).toHaveLength(1);
    expect(found.bumps[0].at).toBeGreaterThan(790);
    expect(found.bumps[0].at).toBeLessThan(810);
    expect(found.bumps[0].height).toBeCloseTo(0.1, 6);
    expect(found.bumps[0].length).toBeCloseTo(3.6, 6);
    expect(routeOf(found).bumps[0]).toBeCloseTo(found.bumps[0].at, 6);
  });

  it('길에서 40m 떨어진 방지턱은 다른 길의 것으로 보고 붙이지 않는다', () => {
    const [lng, lat] = beside(800, 40);
    const found = withOpenData(real, {...EMPTY, bumps: [{lat, lng, heightCm: 10, lengthCm: 360, kind: ''}]});
    expect(found.bumps).toHaveLength(0);
  });

  it('차로마다 따로 적힌 같은 방지턱은 하나로 센다', () => {
    const a = beside(1300, 2);
    const b = beside(1304, -3);
    const found = withOpenData(real, {
      ...EMPTY,
      bumps: [
        {lat: a[1], lng: a[0], heightCm: 10, lengthCm: 360, kind: ''},
        {lat: b[1], lng: b[0], heightCm: 10, lengthCm: 360, kind: ''},
      ],
    });
    expect(found.bumps).toHaveLength(1);
  });

  it('도로에 페인트로 그린 가상형 방지턱은 물리 계산에 넣지 않는다', () => {
    const [lng, lat] = beside(900, 1);
    const found = withOpenData(real, {...EMPTY, bumps: [{lat, lng, heightCm: null, lengthCm: null, kind: '가상형'}]});
    expect(found.bumps).toHaveLength(0);
  });

  it('규격이 비어 있거나 0인 방지턱은 규격을 모르는 것으로 둔다', () => {
    const [lng, lat] = beside(600, 0);
    const found = withOpenData(real, {...EMPTY, bumps: [{lat, lng, heightCm: 0, lengthCm: null, kind: ''}]});
    expect(found.bumps[0].height).toBeNull();
    expect(found.bumps[0].length).toBeNull();
  });

  it('학교에서 300m 안의 길은 어린이 보호구역으로 잡힌다', () => {
    const [lng, lat] = beside(1500, 60);
    const found = withOpenData(real, {...EMPTY, schoolZones: [{lat, lng, name: '시험초등학교'}]});
    expect(found.zones).toHaveLength(1);
    expect(found.zones[0].name).toBe('시험초등학교');
    expect(found.zones[0].from).toBeLessThan(1500);
    expect(found.zones[0].to).toBeGreaterThan(1500);
    expect(found.zones[0].to - found.zones[0].from).toBeGreaterThan(300);
    expect(found.zones[0].to - found.zones[0].from).toBeLessThan(700);
  });

  it('길에서 2km 떨어진 학교는 붙지 않는다', () => {
    const [lng, lat] = beside(1500, 2000);
    expect(withOpenData(real, {...EMPTY, schoolZones: [{lat, lng, name: '먼 학교'}]}).zones).toHaveLength(0);
  });

  it('목적지에서 가까운 주차장을 가까운 순서로 고른다', () => {
    const end = pointAt(real.line, real.line.total).at;
    const lot = (name: string, meters: number) => ({
      lat: end[1] + meters / 111_195,
      lng: end[0],
      name,
      feeType: '유료',
      baseMinutes: 30,
      baseFee: 1000,
      unitMinutes: 10,
      unitFee: 500,
    });
    const found = parkingNear({...EMPTY, parking: [lot('먼 곳', 900), lot('둘째', 300), lot('첫째', 120)]}, end);
    expect(found.map(p => p.name)).toEqual(['첫째', '둘째']);
    expect(found[0].meters).toBeCloseTo(120, 0);
  });
});

describe('앱에 넣어 둔 공공데이터', () => {
  const found = withOpenData(real, openData as unknown as OpenData);

  it('시연 경로 위에는 성남시가 공개한 과속방지턱이 3개 있다', () => {
    expect(found.bumps).toHaveLength(3);
    for (const bump of found.bumps) {
      expect(bump.at).toBeGreaterThan(0);
      expect(bump.at).toBeLessThan(real.line.total);
    }
  });

  it('시연 경로는 어린이 보호구역 두 곳을 지난다', () => {
    expect(found.zones.map(zone => zone.name).sort()).toEqual(['삼평어린이집', '성남송현초등학교']);
  });

  it('참고: 경로 위의 방지턱과 보호구역', () => {
    console.log('BUMPS', JSON.stringify(found.bumps.map(b => [Math.round(b.at), b.height, b.length])));
    console.log('ZONES', JSON.stringify(found.zones.map(z => [Math.round(z.from), Math.round(z.to), z.name])));
  });
});

describe('공공 API 자료 얹기', () => {
  /** 경로의 진행 방향 오른쪽(+1)이나 왼쪽(−1)으로 meters 만큼 떨어진 점. */
  const aside = (at: number, meters: number, side: 1 | -1): LngLat => {
    const [lng, lat] = pointAt(real.line, at).at;
    const a = ((headingAt(real.line, at) + 90 * side) * Math.PI) / 180;
    return [
      lng + (Math.sin(a) * meters) / (111_195 * Math.cos((lat * Math.PI) / 180)),
      lat + (Math.cos(a) * meters) / 111_195,
    ];
  };
  const spot = (kind: Hotspot['kind'], [lng, lat]: LngLat, name = '시험 지점', radiusM = 100): Hotspot => ({
    kind,
    name,
    lng,
    lat,
    radiusM,
    accidents: 3,
    casualties: 4,
    year: '2024',
    source: '시험',
  });
  const restArea = ([lng, lat]: LngLat, coffee = ['스타벅스'], name = '시험휴게소'): RestArea => ({
    name,
    route: '시험선',
    direction: null,
    lng,
    lat,
    coffee,
  });

  it('받아 온 경로에는 아직 사고 다발 지점과 휴게소가 없다', () => {
    expect(real.hotspots).toEqual([]);
    expect(real.restAreas).toEqual([]);
    const empty = withPublicApiData(real, EMPTY_PUBLIC_DATA);
    expect(empty.hotspots).toEqual([]);
    expect(empty.restAreas).toEqual([]);
  });

  it('경로가 범위(반지름)를 지나는 사고 다발 지점은 가장 가까운 자리에 붙고, 범위에 들어서고 벗어나는 자리를 안다', () => {
    const found = withPublicApiData(real, {hotspots: [spot('child', aside(2200, 80, -1))], restAreas: []});
    expect(found.hotspots).toHaveLength(1);
    const [hotspot] = found.hotspots;
    expect(hotspot).toMatchObject({kind: 'child', name: '시험 지점', radiusM: 100});
    expect(Math.abs(hotspot.at - 2200)).toBeLessThan(15);
    // 한가운데가 경로에서 80m 떨어진 반지름 100m의 원을 경로는 앞뒤 60m씩 지난다.
    expect(Math.abs(hotspot.at - hotspot.from - 60)).toBeLessThan(5);
    expect(Math.abs(hotspot.to - hotspot.at - 60)).toBeLessThan(5);
  });

  it('범위가 경로에 닿지 않거나, 범위가 넓어도 한가운데가 경로에서 150m 넘게 떨어지면 붙지 않는다', () => {
    const near = (offset: number, radius: number) =>
      withPublicApiData(real, {hotspots: [spot('child', aside(2200, offset, 1), '시험 지점', radius)], restAreas: []}).hotspots;
    expect(near(130, 100)).toHaveLength(0);
    expect(near(140, 160)).toHaveLength(1);
    expect(near(200, 300)).toHaveLength(0);
    expect(near(300, 100)).toHaveLength(0);
  });

  it('범위가 경로의 처음이나 끝을 넘으면 경로 안에서 자른다', () => {
    const [first] = withPublicApiData(real, {hotspots: [spot('child', pointAt(real.line, 30).at)], restAreas: []}).hotspots;
    expect(first.from).toBe(0);
    expect(first.to).toBeGreaterThan(first.at);
  });

  it('같은 자리의 같은 종류 지점은 하나로 보고, 종류가 다르면 따로 둔다', () => {
    const here = beside(900, 20);
    const found = withPublicApiData(real, {
      hotspots: [spot('ice', here, '2023년'), spot('ice', here, '2024년'), spot('child', here), spot('child', beside(400, 10))],
      restAreas: [],
    });
    expect(found.hotspots).toHaveLength(3);
    expect(found.hotspots.filter(h => h.kind === 'ice')).toHaveLength(1);
    // 출발지에서 가까운 순서다. 400m의 어린이 지점이 먼저 온다.
    expect(Math.abs(found.hotspots[0].at - 400)).toBeLessThan(15);
    for (let i = 1; i < found.hotspots.length; i++) expect(found.hotspots[i].at).toBeGreaterThanOrEqual(found.hotspots[i - 1].at);
  });

  it('진행 방향 오른쪽 500m 안의, 커피 매장이 있는 휴게소만 붙는다', () => {
    const right = withPublicApiData(real, {hotspots: [], restAreas: [restArea(aside(2200, 200, 1))]});
    expect(right.restAreas).toHaveLength(1);
    expect(Math.abs(right.restAreas[0].at - 2200)).toBeLessThan(40);
    expect(right.restAreas[0].coffee).toEqual(['스타벅스']);
    // 맞은편 방향(왼쪽)의 휴게소는 들를 수 없다.
    expect(withPublicApiData(real, {hotspots: [], restAreas: [restArea(aside(2200, 200, -1))]}).restAreas).toHaveLength(0);
    expect(withPublicApiData(real, {hotspots: [], restAreas: [restArea(aside(2200, 200, 1), [])]}).restAreas).toHaveLength(0);
    expect(withPublicApiData(real, {hotspots: [], restAreas: [restArea(aside(2200, 900, 1))]}).restAreas).toHaveLength(0);
  });

  it('길 한가운데에 찍힌 휴게소는 어느 쪽인지 모르므로 둔다', () => {
    const found = withPublicApiData(real, {hotspots: [], restAreas: [restArea(aside(2200, 10, -1))]});
    expect(found.restAreas).toHaveLength(1);
  });

  it('참고: 시연 경로 위의 공공 API 자료', () => {
    const data = readPublicData(publicApi as unknown);
    const found = withPublicApiData(real, data);
    console.log(
      'PUBLIC API',
      JSON.stringify({
        fetchedAt: data.fetchedAt,
        hotspots: data.hotspots.length,
        onRoute: found.hotspots.map(h => [Math.round(h.at), h.kind, h.name]),
        restAreas: data.restAreas.length,
        restOnRoute: found.restAreas.length,
      }),
    );
    for (const h of found.hotspots) expect(h.at).toBeLessThanOrEqual(real.line.total);
  });
});

describe('경로 탐색 결과 읽기', () => {
  it('OSRM 응답에서 길의 모양과 안내 지점을 읽는다', () => {
    const read = fromOsrm({
      routes: [
        {
          geometry: {coordinates: [[127.1, 37.4], [127.1, 37.401], [127.101, 37.401]]},
          legs: [{steps: [{distance: 111, name: '가길'}, {distance: 88, name: '나길'}]}],
        },
      ],
    });
    expect(read?.provider).toBe('osrm');
    expect(read?.line.points).toHaveLength(3);
    expect(read?.steps).toEqual([{at: 0, name: '가길'}, {at: 111, name: '나길'}]);
  });

  it('형식이 다른 응답은 null이다', () => {
    expect(fromOsrm(null)).toBeNull();
    expect(fromOsrm({code: 'NoRoute', routes: []})).toBeNull();
    expect(fromOsrm({routes: [{geometry: {coordinates: [[127.1, 37.4]]}}]})).toBeNull();
    expect(fromTmap({features: 'x'})).toBeNull();
  });

  it('TMAP 응답의 선을 이어 길의 모양을 만든다', () => {
    const read = fromTmap({
      features: [
        {geometry: {type: 'Point', coordinates: [127.1, 37.4]}, properties: {description: '출발'}},
        {geometry: {type: 'LineString', coordinates: [[127.1, 37.4], [127.1, 37.401]]}, properties: {name: '가길', distance: 111}},
        {geometry: {type: 'Point', coordinates: [127.1, 37.401]}, properties: {description: '우회전'}},
        {geometry: {type: 'LineString', coordinates: [[127.1, 37.401], [127.101, 37.401]]}, properties: {name: '나길', distance: 88}},
      ],
    });
    expect(read?.provider).toBe('tmap');
    expect(read?.line.points).toHaveLength(3);
    expect(read?.steps).toEqual([{at: 0, name: '가길'}, {at: 111, name: '나길'}]);
  });
});

describe('굽이에 붙이는 말', () => {
  it('크게 꺾이면 회전, 살짝 휘면 굽은 길, 돌아서면 유턴이다', () => {
    expect(turnLabel(-90, '창업로')).toBe('좌회전 · 창업로');
    expect(turnLabel(88, '')).toBe('우회전');
    expect(turnLabel(-30, '')).toBe('왼쪽 굽은 길');
    expect(turnLabel(45, '창업로')).toBe('오른쪽 굽은 길 · 창업로');
    expect(turnLabel(170, '')).toBe('유턴');
  });
});
