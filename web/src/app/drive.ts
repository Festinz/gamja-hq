/**
 * 주행 엔진. 주행 화면의 지도와 커피 컵에 "지금"을 대어 준다.
 *
 * 세 가지 출처가 같은 모양의 값을 만든다.
 * - sim  : 브라우저 시뮬레이터. 가상의 길을 가상 운전자가 몬다.
 * - navi : 실제 차량. 내비(NaviHelper)가 준 회전, 남은 거리, 정체, 방지턱으로 길을 만들고
 *          남은 거리의 변화로 속도를 잡는다. 가속도 센서가 있으면 컵이 받는 힘은 센서 값을 쓴다.
 * - test : 실제 차량에서의 시험 주행. 길은 내비 값 그대로이고 위치만 가상 운전자가 움직인다.
 *          에뮬레이터는 차를 실제로 움직이지 못해서 둔 것이다. 화면에 "시험 주행"이라고 적는다.
 *
 * 코어(hq)는 이 값을 모른다. 방지턱을 넘었다, 커피가 넘쳤다 같은 사건만 코어에 들어간다.
 */
import {useSyncExternalStore} from 'react';
import {G, fillCup, stepCup, type CupInput, type CupSpec, type CupState} from '../core/cup';
import {
  NO_FORCES,
  buildGeometry,
  demoRoute,
  jamAt,
  jamRoadAt,
  poseAt,
  safeBumpSpeed,
  stepDrive,
  type DriveForces,
  type DriveState,
  type DriveStyle,
  type Geometry,
  type JamLevel,
  type Pose,
  type Route,
  type RouteTurn,
} from '../core/drive';
import {headingAt, nearestOnLine, pointAt, type LngLat} from '../core/geo';
import {isDrivingLocked} from '../core/hq';
import {HOTSPOT_WARNING, isHotspotActive, restAreaLine, type HotspotKind} from '../core/publicdata';
import {routeOf, type RealHotspot, type RealRoute} from '../core/realroute';
import type {NaviSnapshot} from './navi';
import {icyNow} from './publicdata';
import {speakingSeconds} from './speechQueue';
import {getState} from './store';

export type DriveSource = 'sim' | 'navi' | 'test';

/** 차가 길 위를 나아가는 빠르기를 어디서 얻었는가. */
export type SpeedFrom =
  /** 가상 운전자 (시뮬레이터, 시험 주행). */
  | 'driver'
  /** 내비가 알려준 위치의 변화. */
  | 'navi'
  /** 차량 속도 신호 (Android Automotive PERF_VEHICLE_SPEED). 계기판과 같은 값이다. */
  | 'vehicle';

/** 실제 경로와, 그 경로를 주행 엔진의 거리에 맞추는 값. */
export interface RealAttach {
  route: RealRoute;
  /** 실제 경로의 출발점이 주행 엔진의 거리로 몇 m인가. */
  offset: number;
  /** 실제 경로의 1m가 주행 엔진의 거리로 몇 m인가. 내비가 알려준 거리와의 작은 차이를 맞춘다. */
  scale: number;
}

/** 실제 지도 위의 자리. */
export interface DriveGeo extends RealAttach {
  /** 실제 경로의 출발점부터 달린 거리 (m). */
  meters: number;
  at: LngLat;
  /** 진행 방향 (도). 북쪽이 0, 시계 방향이 +. */
  bearing: number;
}

/** 주행 엔진의 거리를 실제 경로 위의 거리로 바꾼다. */
export function alongReal(real: RealAttach, meters: number): number {
  return Math.min(real.route.line.total, Math.max(0, (meters - real.offset) / real.scale));
}

/** 주행 화면이 한 번 그릴 때 읽는 값. */
export interface DriveFrame {
  source: DriveSource;
  route: Route;
  geometry: Geometry;
  /** 출발지부터 달린 거리 (m). */
  meters: number;
  /** 속도 (m/s). */
  speed: number;
  /** 속도와 위치를 어디서 얻었는가. 화면에 적는다. */
  speedFrom: SpeedFrom;
  pose: Pose;
  /** 길의 실제 모양을 알 때만 있다. 있으면 주행 화면이 실제 지도를 그린다. */
  geo: DriveGeo | null;
  forces: DriveForces;
  /** 커피 운송작전 중일 때만 있다. */
  cup: CupState | null;
  /** 컵이 받는 힘이 차량 가속도 센서에서 온 값인가. 아니면 길과 속도로 계산한 값이다. */
  usesSensor: boolean;
  /** 내비가 길을 안내하고 있는가. 없으면 지도를 그리지 않는다. */
  hasGuidance: boolean;
  destination: string;
  roadName: string;
  /** 화면에 적는 남은 거리 (m)와 시간 (초). */
  remainMeters: number;
  remainSeconds: number;
  jam: JamLevel | null;
  /** 감자가 방금 한 말. 몇 초 동안만 있다. */
  note: string | null;
  /** 이 값을 만든 시각 (performance.now). 그림의 흔들림에 쓴다. */
  at: number;
}

export interface DriveHandlers {
  onBump?(): void;
  onSpill?(ml: number): void;
  /** 정체 구간에 들어서거나(level) 벗어났다(null). road는 그 구간의 길 이름으로, 모르면 빈 문자열이다. */
  onJam?(level: JamLevel | null, road: string): void;
  onArrive?(): void;
  /** 감자가 알리는 사고 다발 지점 하나를 지났다. 결빙 지점은 추울 때만 센다. */
  onHotspot?(kind: HotspotKind): void;
}

export interface DriveOptions {
  source: DriveSource;
  route: Route;
  /** driver는 가상 운전자가 몰고, measured는 내비가 알려준 위치를 따른다. */
  control: 'driver' | 'measured';
  coffee: boolean;
  /** 운행에 실은 컵. 없으면 기본 컵(뚜껑 없는 420ml). 넘침과 넘치지 않는 속도를 이 컵으로 계산한다. */
  cup?: CupSpec | null;
  destination: string;
  roadName?: string;
  hasGuidance?: boolean;
  startMeters?: number;
  /** 화면에 적을 남은 거리와 시간. 없으면 길에서 계산한다. */
  remain?: (meters: number, total: number) => {meters: number; seconds: number};
  /** 길의 실제 모양. 있으면 실제 지도 위에 그린다. */
  real?: RealAttach | null;
  handlers?: DriveHandlers;
}

interface Run extends Required<Omit<DriveOptions, 'remain' | 'coffee' | 'cup' | 'startMeters' | 'real'>> {
  remain: DriveOptions['remain'];
  real: RealAttach | null;
  geometry: Geometry;
  state: DriveState;
  forces: DriveForces;
  cup: CupState | null;
  usesSensor: boolean;
  jam: JamLevel | null;
  arrived: boolean;
  warnedBump: number | null;
  pendingSpill: number;
  /**
   * 이미 센 방지턱의 자리 (m). 위치를 내비에 맞추다 같은 방지턱을 다시 지나도 두 번 세지 않는다.
   * 내비가 다시 알려 줄 때마다 방지턱 자리가 몇 m씩 흔들리므로, 15m 안의 것은 같은 방지턱으로 본다.
   */
  countedBumps: number[];
  /**
   * 미리 알린 사고 다발 지점과 지나간 것으로 센 지점. 내비가 경로를 다시 짜서 실제 경로를 새로 받아도
   * 같은 지점을 두 번 알리거나 세지 않게 종류와 이름으로 적는다.
   */
  warnedHotspots: Set<string>;
  passedHotspots: Set<string>;
  /** 커피 매장이 있는 휴게소를 알렸는가. 한 운행에 한 번만 말한다. */
  saidRestArea: boolean;
  spillReportedAt: number;
  spillSaidAt: number;
  /** 화면에 잠깐 띄우는 감자의 말. urgent 는 안전 경고로, 떠 있는 동안 보통 말이 덮지 않는다. */
  note: {text: string; until: number; urgent: boolean} | null;
}

const TICK_MS = 33;
const NOTE_MS = 4500;
/** 내비가 회전 반지름을 주지 않아 교차로 회전은 이 값으로 그린다 (m). */
export const NAVI_TURN_RADIUS = 24;
const EMPTY_ROUTE: Route = {totalMeters: 1000, turns: [], bumps: [], grades: [], jams: []};

let run: Run | null = null;
let frame: DriveFrame | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let last = 0;
let habit: DriveStyle = 'normal';
let speaker: (text: string, urgent: boolean) => void = () => {};
const listeners = new Set<() => void>();

// ───────────────────────── 구독 ─────────────────────────

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(at: number) {
  if (!run) frame = null;
  else {
    const total = run.route.totalMeters;
    const left = Math.max(0, total - run.state.meters);
    const remain = run.remain?.(run.state.meters, total) ?? {meters: left, seconds: left / 7};
    frame = {
      source: run.source,
      route: run.route,
      geometry: run.geometry,
      meters: run.state.meters,
      speed: run.state.speed,
      speedFrom: speedFromOf(run, at),
      pose: poseAt(run.geometry, run.state.meters),
      geo: geoOf(run.real, run.state.meters),
      forces: run.forces,
      cup: run.cup,
      usesSensor: run.usesSensor,
      hasGuidance: run.hasGuidance,
      destination: run.destination,
      roadName: run.roadName,
      remainMeters: remain.meters,
      remainSeconds: remain.seconds,
      jam: run.jam,
      note: run.note && run.note.until > at ? run.note.text : null,
      at,
    };
  }
  listeners.forEach(listener => listener());
}

function speedFromOf(r: Run, at: number): SpeedFrom {
  if (r.control === 'driver') return 'driver';
  return vehicleSpeedAt(at) !== null ? 'vehicle' : 'navi';
}

function geoOf(real: RealAttach | null, meters: number): DriveGeo | null {
  if (!real) return null;
  const along = alongReal(real, meters);
  return {
    ...real,
    meters: along,
    at: pointAt(real.route.line, along).at,
    bearing: headingAt(real.route.line, along, 18),
  };
}

/** 주행 중이면 지금의 값, 아니면 null. 1초에 30번쯤 바뀐다. */
export function useDrive(): DriveFrame | null {
  return useSyncExternalStore(subscribe, () => frame);
}

export function getDrive(): DriveFrame | null {
  return frame;
}

/** 감자의 말을 차량 스피커로 내보낼 함수를 건다. 앱이 뜰 때 한 번 부른다. */
export function setSpeaker(next: (text: string, urgent: boolean) => void) {
  speaker = next;
}

/**
 * 감자가 주행 중에 한마디 한다. 화면에 잠깐 뜨고 음성으로도 나간다.
 * urgent 는 방지턱 같은 안전 경고로, 기다리는 다른 말보다 먼저 나간다.
 * 화면에 떠 있는 안전 경고는 보통 말이 덮지 않는다 (음성은 차례를 기다려 나간다).
 */
export function say(text: string, urgent = false) {
  if (run) {
    const at = performance.now();
    const showingWarning = run.note !== null && run.note.urgent && run.note.until > at;
    if (urgent || !showingWarning) run.note = {text, until: at + NOTE_MS, urgent};
  }
  speaker(text, urgent);
}

// ───────────────────────── 운전 습관 (가상 운전자) ─────────────────────────

const habitListeners = new Set<() => void>();

export function setHabit(next: DriveStyle) {
  habit = next;
  habitListeners.forEach(listener => listener());
}

export function useHabit(): DriveStyle {
  return useSyncExternalStore(
    listener => {
      habitListeners.add(listener);
      return () => habitListeners.delete(listener);
    },
    () => habit,
  );
}

// ───────────────────────── 시작과 끝 ─────────────────────────

export function startDrive(options: DriveOptions) {
  const geometry = buildGeometry(options.route);
  const state: DriveState = {meters: options.startMeters ?? 0, speed: 0, accel: 0};
  run = {
    source: options.source,
    route: options.route,
    control: options.control,
    destination: options.destination,
    roadName: options.roadName ?? '',
    hasGuidance: options.hasGuidance ?? true,
    handlers: options.handlers ?? {},
    remain: options.remain,
    real: options.real ?? null,
    geometry,
    state,
    forces: NO_FORCES,
    // 시험 주행으로 넘어갈 때는 컵에 든 양을 이어받는다. 처음이면 운행에 실은 컵을 채워 시작한다.
    cup: options.coffee ? (run?.cup ?? fillCup(options.cup ?? undefined)) : null,
    usesSensor: false,
    jam: jamAt(options.route, state.meters),
    arrived: false,
    warnedBump: null,
    pendingSpill: 0,
    countedBumps: [],
    warnedHotspots: new Set(),
    passedHotspots: new Set(),
    saidRestArea: false,
    spillReportedAt: 0,
    spillSaidAt: 0,
    note: null,
  };
  last = performance.now();
  if (timer === null) timer = setInterval(tick, TICK_MS);
  publish(last);
}

export function stopDrive() {
  if (timer !== null) clearInterval(timer);
  timer = null;
  if (run?.cup && run.pendingSpill > 0) run.handlers.onSpill?.(run.pendingSpill);
  run = null;
  publish(performance.now());
}

function setRoute(route: Route) {
  if (!run) return;
  run.route = route;
  run.geometry = buildGeometry(route);
}

/**
 * 가상 운전자가 몰고 있을 때, 지금 자리에서 ahead 미터 앞에 과속방지턱을 놓는다.
 * 놓았으면 true. 실제 위치를 따르는 중이면 놓지 않는다.
 */
export function placeBump(ahead = 70): boolean {
  if (!run || run.control !== 'driver') return false;
  const at = run.state.meters + ahead;
  if (at >= run.route.totalMeters - 5) return false;
  setRoute({...run.route, bumps: [...run.route.bumps, at].sort((a, b) => a - b)});
  return true;
}

/** 지금 자리에서 길이 막힌다. 시뮬레이터의 "정체 진입" 버튼이 쓴다. */
export function holdJam() {
  if (!run || jamAt(run.route, run.state.meters)) return;
  const at = run.state.meters;
  setRoute({...run.route, jams: [...run.route.jams, {from: at, to: at + 500, level: 'heavy'}]});
  run.jam = 'heavy';
}

/** 지금 자리의 정체가 풀린다. */
export function releaseJam() {
  if (!run) return;
  const at = run.state.meters;
  setRoute({...run.route, jams: run.route.jams.filter(jam => jam.to <= at || jam.from > at + 80)});
  run.jam = null;
}

// ───────────────────────── 한 걸음 ─────────────────────────

/** 이 거리 안의 방지턱은 같은 방지턱으로 본다 (m). */
const SAME_BUMP_METERS = 15;

/** from에서 to 사이(to 포함)에 있는, 아직 세지 않은 방지턱을 센다. */
function countBumpsBetween(r: Run, from: number, to: number) {
  for (const bump of r.route.bumps) {
    if (from < bump && bump <= to && !r.countedBumps.some(seen => Math.abs(seen - bump) < SAME_BUMP_METERS)) {
      r.countedBumps.push(bump);
      r.handlers.onBump?.();
    }
  }
}

/** 사고 다발 지점의 범위에 들어서기 이 거리 앞에서 알린다 (m). 빠르게 달리면 5초 앞에서 알린다. */
const HOTSPOT_WARN_METERS = 100;
/** 커피 매장이 있는 휴게소가 이 거리 안으로 들어오면 알린다 (m). 고속도로에서 1~2분 앞이다. */
const REST_AREA_SAY_METERS = 3000;

const hotspotKey = (spot: RealHotspot) => `${spot.kind}:${spot.name}`;

/** 실제 경로 위의 거리를 주행 엔진의 거리로. */
const engineMeters = (real: RealAttach, meters: number) => real.offset + meters * real.scale;

/** 지금 알려야 하는 사고 다발 지점. 결빙 지점이 있을 때만 날씨를 본다. */
function activeHotspots(real: RealAttach): RealHotspot[] {
  const spots = real.route.hotspots;
  if (spots.length === 0) return spots;
  const icy = spots.some(spot => spot.kind === 'ice') && icyNow();
  return spots.filter(spot => isHotspotActive(spot.kind, icy));
}

/**
 * from에서 to 사이(to 포함)에서 한가운데를 지난, 감자가 미리 알린 사고 다발 지점을 센다.
 * 운행에 남는 수는 "알리고 지나간 수"다. 알리지 못하고 지나친 지점(내비의 위치가 건너뛴 때)은 세지 않는다.
 */
function countHotspotsBetween(r: Run, from: number, to: number) {
  if (!r.real || to <= from) return;
  for (const spot of activeHotspots(r.real)) {
    const at = engineMeters(r.real, spot.at);
    const key = hotspotKey(spot);
    if (from < at && at <= to && r.warnedHotspots.has(key) && !r.passedHotspots.has(key)) {
      r.passedHotspots.add(key);
      r.handlers.onHotspot?.(spot.kind);
    }
  }
}

/** 커피 운송작전의 방지턱 경고를 하는 거리 (m). 45m 앞, 빠르게 달리면 5초 앞이다. */
const bumpWarnReach = (speed: number) => Math.max(45, speed * 5);

/** 바로 앞의 방지턱 (주행 엔진의 거리). 없으면 undefined. */
const nextBumpOf = (r: Run) => r.route.bumps.find(bump => bump > r.state.meters + 2);

/**
 * 커피 운송작전의 방지턱 경고가 seconds 초 안에 나와야 하는가.
 * 그 사이에 다른 안전 경고를 시작하면 방지턱 경고가 그 말이 끝날 때까지 기다리다 방지턱을 지나 버린다.
 */
function bumpWarningSoon(r: Run, seconds: number): boolean {
  if (!r.cup) return false;
  const bump = nextBumpOf(r);
  if (bump === undefined || bump === r.warnedBump) return false;
  return bump - r.state.meters < bumpWarnReach(r.state.speed) + r.state.speed * seconds;
}

/** 방지턱이 가까워지면 미리 알린다. 지금 속도로 넘으면 넘칠지 계산해서 말을 고른다. */
function warnBump(r: Run, cup: CupState) {
  const bump = nextBumpOf(r);
  if (bump === undefined || bump === r.warnedBump || bump - r.state.meters >= bumpWarnReach(r.state.speed)) return;
  r.warnedBump = bump;
  say(
    r.state.speed > safeBumpSpeedOf(cup)
      ? '사령관님! 전방에 방지턱입니다. 속도를 줄여 주십시오!'
      : '사령관님! 전방에 방지턱입니다. 살살 넘겠습니다.',
    true,
  );
}

/**
 * 길가의 공공 API 자료를 살핀다.
 * 사고 다발 지점은 경로가 그 범위에 들어서기 100m(빠르면 5초) 앞에서 안전 경고로 한 번 알리고, 한가운데를 지나면 센다.
 * 커피 운송작전에서 방지턱 경고가 곧 나와야 하면 방지턱 경고를 먼저 보내고 이 경고는 그 뒤에 한다.
 * 커피 매장이 있는 휴게소는 3km 앞에서 한 번 알린다 (안전 경고가 아니다).
 */
function watchRoadside(r: Run, from: number) {
  const real = r.real;
  if (!real) return;
  const here = r.state.meters;
  const reach = Math.max(HOTSPOT_WARN_METERS, r.state.speed * 5);
  for (const spot of activeHotspots(real)) {
    const key = hotspotKey(spot);
    if (r.warnedHotspots.has(key)) continue;
    // 한가운데를 지났으면 늦었다. 범위 안에 있어도 한가운데 앞이면 알린다.
    if (engineMeters(real, spot.at) <= here || engineMeters(real, spot.from) - here > reach) continue;
    const line = HOTSPOT_WARNING[spot.kind];
    if (bumpWarningSoon(r, speakingSeconds(line))) continue;
    r.warnedHotspots.add(key);
    say(line, true);
  }
  countHotspotsBetween(r, from, here);
  if (!r.saidRestArea) {
    const next = real.route.restAreas.find(area => engineMeters(real, area.at) > here);
    if (next && engineMeters(real, next.at) - here <= REST_AREA_SAY_METERS) {
      r.saidRestArea = true;
      say(restAreaLine(next.name, r.cup !== null));
    }
  }
}

/** 실제 차량에서 이보다 느리면 막힌 것으로 본다 (m/s, 시속 15km). */
const JAM_SLOW = 4.2;
/** 막힌 구간에서 이보다 빠르게 한동안 달리면 풀린 것으로 본다 (m/s, 시속 25km). */
const JAM_CLEAR = 7;
let slowSince = 0;
let fastSince = 0;

/**
 * 지금 정체 중인가.
 * 시뮬레이터와 시험 주행은 길 위의 정체 구간에 들어서면 정체다 (가상 운전자가 알아서 느려진다).
 * 실제 차량은 내비가 막힌다고 한 구간에서 차가 실제로 2.5초 넘게 느리게 갈 때만 정체로 보고,
 * 그 구간을 벗어나거나 4초 넘게 시속 25km를 넘으면 풀린 것으로 본다.
 */
function jamFor(r: Run, segment: JamLevel | null, at: number): JamLevel | null {
  if (r.source !== 'navi') return segment;
  if (!segment) {
    slowSince = 0;
    fastSince = 0;
    return null;
  }
  if (r.jam) {
    if (r.state.speed > JAM_CLEAR) {
      fastSince ||= at;
      if (at - fastSince > 4000) return null;
    } else fastSince = 0;
    return segment;
  }
  if (r.state.speed < JAM_SLOW) {
    slowSince ||= at;
    if (at - slowSince > 2500) return segment;
  } else slowSince = 0;
  return null;
}

let safeSpeedFor: {spec: CupSpec; volume: number; speed: number} | null = null;

/** 이 컵(모양, 뚜껑, 든 양)으로 방지턱을 넘을 때의 안전 속도. 컵이나 든 양이 달라질 때만 다시 계산한다. */
function safeBumpSpeedOf(cup: CupState): number {
  const volume = Math.round(cup.volumeMl / 5);
  if (safeSpeedFor?.volume !== volume || safeSpeedFor.spec !== cup.spec)
    safeSpeedFor = {spec: cup.spec, volume, speed: safeBumpSpeed(cup)};
  return safeSpeedFor.speed;
}

function tick() {
  if (!run) return;
  const at = performance.now();
  let dt = Math.min(0.5, (at - last) / 1000);
  last = at;
  const r = run;
  const start = r.state.meters;

  while (dt > 1e-4) {
    const h = Math.min(0.02, dt);
    dt -= h;
    const from = r.state.meters;
    const out = stepDrive(
      r.route,
      r.geometry,
      r.state,
      h,
      r.control === 'driver' ? habit : {speed: vehicleSpeedAt(at) ?? measuredSpeed(at)},
    );
    r.state = out.state;
    const sensed = r.source === 'navi' ? trustedSensedForces(out.forces, at) : null;
    r.usesSensor = sensed !== null;
    r.forces = sensed ? {...out.forces, ...sensed} : out.forces;
    if (out.bumpsCrossed > 0) countBumpsBetween(r, from, r.state.meters);
    if (r.cup) {
      const before = r.cup.spilledMl;
      r.cup = stepCup(r.cup, r.forces, h);
      r.pendingSpill += r.cup.spilledMl - before;
    }
  }

  const jam = jamFor(r, jamAt(r.route, r.state.meters), at);
  if (jam !== r.jam) {
    const wasJammed = r.jam !== null;
    r.jam = jam;
    if (wasJammed !== (jam !== null)) r.handlers.onJam?.(jam, jamRoadAt(r.route, r.state.meters));
  }

  // 방지턱 경고는 몇 초 앞에서만 쓸모가 있으므로 길가의 다른 말보다 먼저 줄에 세운다.
  if (r.cup) warnBump(r, r.cup);
  watchRoadside(r, start);

  if (r.cup && r.pendingSpill >= 0.5 && at - r.spillReportedAt > 700) {
    r.handlers.onSpill?.(r.pendingSpill);
    r.pendingSpill = 0;
    r.spillReportedAt = at;
    if (at - r.spillSaidAt > 9000) {
      r.spillSaidAt = at;
      say('앗! 커피가 넘쳤습니다. 조금만 살살 가 주십시오!');
    }
  }

  if (!r.arrived && r.control === 'driver' && r.state.meters >= r.route.totalMeters) {
    r.arrived = true;
    r.handlers.onArrive?.();
  }
  if (run) publish(at);
}

// ───────────────────────── 실제 차량: 내비 값으로 길 만들기 ─────────────────────────

interface NaviBase {
  route: Route;
  /** 안내를 시작한 뒤 달린 거리 (m). */
  traveled: number;
  /** 달린 거리가 마지막으로 바뀐 시각. */
  movedAt: number;
  speed: number;
  destination: string;
  remainSeconds: number;
  syncedAt: number;
}

let naviBase: NaviBase | null = null;
/** 마지막으로 받은 내비 안내 상태. 실제 경로가 나중에 도착하면 이 값으로 길을 다시 만든다. */
let lastNavi: NaviSnapshot | null = null;
/** 내비가 안내하는 길의 실제 모양. 경로 탐색에서 받아 오고, 내비의 남은 거리와 맞을 때만 쓴다. */
let naviReal: RealAttach | null = null;
/** 실제 모양을 붙일 때의 내비 전체 거리. 내비가 경로를 다시 짜면 바뀐다. */
let naviRealTotal = 0;

// ───────────────────────── 실제 차량: 차량 속도 ─────────────────────────

/** 마지막으로 받은 차량 속도 (m/s)와 그 시각. */
let vehicleSpeed: {mps: number; at: number} | null = null;
/** 이 시간 넘게 차량 속도가 오지 않으면 끊긴 것으로 본다 (ms). */
const VEHICLE_SPEED_FRESH_MS = 1500;

/** 차량 속도 신호 하나 (m/s). 네이티브 호스트가 1초에 10번쯤 넣는다. */
export function feedVehicleSpeed(mps: number) {
  if (!Number.isFinite(mps)) return;
  vehicleSpeed = {mps: Math.max(0, mps), at: performance.now()};
}

function vehicleSpeedAt(at: number): number | null {
  return vehicleSpeed && at - vehicleSpeed.at < VEHICLE_SPEED_FRESH_MS ? vehicleSpeed.mps : null;
}

/**
 * 지금 차의 위치를 차량 속도로 어림하고 있는가.
 * 차량 속도는 오는데 내비가 알려준 위치가 한동안 그대로일 때다 (에뮬레이터, 또는 내비 갱신 사이).
 */
export function isDeadReckoning(): boolean {
  const at = performance.now();
  return (
    run !== null &&
    run.source === 'navi' &&
    vehicleSpeedAt(at) !== null &&
    (naviBase === null || at - naviBase.movedAt > NAVI_STILL_MS)
  );
}

/** 내비가 알려준 위치가 이만큼 그대로면 서 있는 것으로 본다 (ms). */
const NAVI_STILL_MS = 7000;
/** 차량 속도로 어림한 자리가 내비보다 이만큼 안쪽으로 앞서 있으면 뒤로 돌리지 않는다 (m). */
const BACKSTEP_LIMIT = 80;

/** 내비가 알려준, 안내를 시작한 뒤 달린 거리 (m). 안내가 없으면 null. */
export function naviTraveled(): number | null {
  return naviBase ? naviBase.traveled : null;
}

function measuredSpeed(at: number): number {
  // 7초 넘게 위치가 그대로면 서 있는 것으로 본다.
  return naviBase && at - naviBase.movedAt < NAVI_STILL_MS ? naviBase.speed : 0;
}

const arcHalf = (turn: RouteTurn) => (turn.radius * turn.angleDeg * Math.PI) / 360;

/** 내비가 준 값으로 길을 만든다. 이미 지났거나 돌고 있는 회전과 지나온 방지턱은 그대로 둔다. */
function routeFromNavi(navi: NaviSnapshot, total: number, traveled: number, previous?: Route): Route {
  const turns = (previous?.turns ?? []).filter(turn => turn.at - arcHalf(turn) < traveled + 10);
  for (const item of navi.turns ?? (navi.next ? [navi.next] : [])) {
    if (item.turn !== 'left' && item.turn !== 'right' && item.turn !== 'uturn') continue;
    const at = traveled + item.meters;
    if (at >= total - 5 || turns.some(turn => Math.abs(turn.at - at) < 45)) continue;
    turns.push({
      at,
      direction: item.turn === 'right' ? 'right' : 'left',
      angleDeg: item.turn === 'uturn' ? 180 : 90,
      radius: item.turn === 'uturn' ? 9 : NAVI_TURN_RADIUS,
      label: item.description,
    });
  }
  const isJam = (level: string): level is JamLevel => level === 'slow' || level === 'heavy';
  const jams = navi.jamsAhead?.length
    ? navi.jamsAhead.flatMap(jam =>
        isJam(jam.level)
          ? [{from: traveled + jam.from, to: traveled + jam.to, level: jam.level, road: jam.road}]
          : [],
      )
    : navi.traffic.flatMap(t =>
        isJam(t.level) ? [{from: t.start * total, to: t.end * total, level: t.level}] : [],
      );
  const base: Route = {
    totalMeters: total,
    turns: turns.sort((a, b) => a.at - b.at),
    bumps: [
      ...(previous?.bumps ?? []).filter(at => at < traveled - 3),
      ...navi.bumpsAheadMeters.map(meters => traveled + meters),
    ].filter(at => at < total),
    grades: [],
    jams,
  };
  return naviReal ? withReal(base, naviReal, navi, traveled) : base;
}

/**
 * 길의 실제 모양을 알면 회전의 자리와 굽은 정도는 그 모양에서, 방지턱은 공공데이터에서 가져온다.
 * 회전의 이름은 내비가 알려준 "○○ 방면"이 있으면 그것을 쓴다. 정체는 내비 값 그대로다.
 */
function withReal(base: Route, attach: RealAttach, navi: NaviSnapshot, traveled: number): Route {
  const real = routeOf(attach.route, {scale: attach.scale, offset: attach.offset});
  const turns = real.turns.map(turn => ({...turn}));
  const named = new Set<number>();
  for (const item of navi.turns ?? (navi.next ? [navi.next] : [])) {
    if ((item.turn !== 'left' && item.turn !== 'right') || !item.description) continue;
    let best = -1;
    let gap = 220;
    turns.forEach((turn, index) => {
      if (named.has(index) || turn.direction !== item.turn || turn.angleDeg < 60) return;
      const d = Math.abs(turn.at - (traveled + item.meters));
      if (d < gap) {
        gap = d;
        best = index;
      }
    });
    if (best >= 0) {
      named.add(best);
      turns[best].label = item.description;
    }
  }
  const bumps = [
    ...real.bumps,
    ...base.bumps.filter(at => !real.bumps.some(other => Math.abs(other - at) < 30)),
  ];
  return {...base, turns, bumps: bumps.sort((a, b) => a - b)};
}

/**
 * 경로 탐색에서 받아 온 길의 실제 모양을 붙인다. 붙였으면 true.
 * 내비가 알려준 남은 거리와 15% 넘게 다르면 다른 길로 보고 쓰지 않는다.
 */
export function attachRealRoute(real: RealRoute | null, requestedAt?: number): boolean {
  naviReal = null;
  if (real && naviBase && lastNavi) {
    const total = naviBase.route.totalMeters;
    // 내비가 알려준 지금 위치가 받아 온 길 위에 있으면, 지금 달린 거리를 길 위의 그 자리에 맞춘다.
    // 지금 위치를 모르면 요청할 때 달린 거리를 길의 출발점에 맞춘다 (경로는 요청한 자리에서 시작한다).
    // 지금 위치가 길에서 60m 넘게 떨어져 있으면 다른 길로 보고 쓰지 않는다.
    const position = lastNavi.position;
    const near = position ? nearestOnLine(real.line, [position.lng, position.lat]) : null;
    if (!near || near.offset <= 60) {
      const engineAt = near ? naviBase.traveled : Math.min(requestedAt ?? naviBase.traveled, naviBase.traveled);
      const realAt = near ? Math.min(near.meters, real.line.total - 1) : 0;
      const remaining = total - engineAt;
      const realRemaining = real.line.total - realAt;
      if (remaining >= 50 && Math.abs(realRemaining - remaining) <= Math.max(250, remaining * 0.15)) {
        const scale = remaining / realRemaining;
        naviReal = {route: real, offset: engineAt - realAt * scale, scale};
        naviRealTotal = total;
      }
    }
  }
  if (lastNavi) syncNavi(lastNavi);
  return naviReal !== null;
}

/** 지금 내비가 안내하는 길의 실제 모양. 없으면 null. */
export function getNaviReal(): RealAttach | null {
  return naviReal;
}

/** 내비 안내 상태가 바뀔 때마다 부른다. 안내가 끝났으면 null. */
export function syncNavi(navi: NaviSnapshot | null) {
  const at = performance.now();
  lastNavi = navi;
  if (!navi) {
    naviBase = null;
    naviReal = null;
    if (run && run.source === 'navi') {
      run.hasGuidance = false;
      run.real = null;
    }
    return;
  }
  const total = Math.max(navi.totalMeters, navi.remainMeters, 1);
  const traveled = total - navi.remainMeters;
  const previous = naviBase;
  // 내비가 경로를 다시 짰으면(전체 거리가 바뀜) 예전 길의 실제 모양을 뗀다. 새 모양은 realroute가 다시 받아 온다.
  if (naviReal && Math.abs(total - naviRealTotal) > 50) naviReal = null;
  let speed = previous?.speed ?? 0;
  let movedAt = previous?.movedAt ?? at;
  if (previous && traveled !== previous.traveled) {
    const seconds = (at - previous.movedAt) / 1000;
    if (seconds > 0.3) speed = Math.min(45, Math.max(0, (traveled - previous.traveled) / seconds));
    movedAt = at;
  }
  naviBase = {
    route: routeFromNavi(navi, total, traveled, previous?.route),
    traveled,
    movedAt,
    speed,
    destination: navi.destination,
    remainSeconds: navi.remainSeconds,
    syncedAt: at,
  };
  if (run && run.source === 'navi') {
    setRoute(naviBase.route);
    run.real = naviReal;
    // 내비의 위치가 움직였으면 그 위치로 맞춘다. 그대로인데 차량 속도가 오고 있으면
    // 차량 속도로 어림한 위치를 그대로 둔다 (에뮬레이터의 내비는 제자리에 서 있다).
    const naviMoved = !previous || traveled !== previous.traveled;
    const speeding = vehicleSpeedAt(at) !== null;
    // 내비는 몇 초씩 늦게 알려준다. 차량 속도로 어림한 자리가 조금 앞서 있으면 뒤로 돌리지 않는다
    // (뒤로 돌리면 방금 넘은 방지턱을 다시 넘는 것처럼 계산된다).
    const slightlyBehind = speeding && traveled < run.state.meters && run.state.meters - traveled < BACKSTEP_LIMIT;
    if ((naviMoved || !speeding) && !slightlyBehind) {
      // 내비의 위치가 앞으로 건너뛰었으면 그 사이의 방지턱과 사고 다발 지점도 지나온 것으로 센다.
      if (traveled > run.state.meters) {
        countBumpsBetween(run, run.state.meters, traveled);
        countHotspotsBetween(run, run.state.meters, traveled);
      }
      run.state = {...run.state, meters: traveled};
    }
    run.hasGuidance = true;
    run.destination = navi.destination;
  }
}

const naviRemain = (meters: number, total: number) => {
  const base = naviBase;
  const elapsed = base ? (performance.now() - base.syncedAt) / 1000 : 0;
  return {
    meters: Math.max(0, total - meters),
    seconds: base ? Math.max(0, base.remainSeconds - elapsed) : 0,
  };
};

/** 실제 차량의 기어 신호나 내비 값이 바뀐 뒤에 부른다. 주행 중이면 엔진을 돌리고 아니면 멈춘다. */
export function refreshRealDrive(handlers: DriveHandlers) {
  const state = getState();
  if (!isDrivingLocked(state)) {
    if (run && run.source !== 'sim') stopDrive();
    return;
  }
  if (run && run.source !== 'sim') return;
  startDrive({
    source: 'navi',
    route: naviBase?.route ?? EMPTY_ROUTE,
    control: 'measured',
    coffee: Boolean(state.trip?.coffee),
    cup: state.trip?.cup ?? null,
    destination: naviBase?.destination ?? '',
    hasGuidance: naviBase !== null,
    startMeters: naviBase?.traveled ?? 0,
    remain: naviRemain,
    real: naviReal,
    handlers,
  });
}

/**
 * 시험 주행을 시작한다. 길은 내비가 준 값 그대로 쓰고(안내가 없으면 시연용 길), 위치만 가상 운전자가 움직인다.
 */
export function startTestDrive(handlers: DriveHandlers) {
  const state = getState();
  if (!isDrivingLocked(state)) return;
  startDrive({
    source: 'test',
    route: naviBase?.route ?? demoRoute(0, {first: '시험 경로', last: '시험 도착지'}),
    control: 'driver',
    coffee: Boolean(state.trip?.coffee),
    cup: state.trip?.cup ?? null,
    destination: naviBase?.destination || '시험 도착지',
    startMeters: naviBase?.traveled ?? 0,
    real: naviBase ? naviReal : null,
    handlers,
  });
}

export function isTestDriving(): boolean {
  return run?.source === 'test';
}

// ───────────────────────── 실제 차량: 가속도 센서 ─────────────────────────

type Vec = [number, number, number];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec): Vec | null => {
  const n = Math.hypot(a[0], a[1], a[2]);
  return n < 1e-6 ? null : [a[0] / n, a[1] / n, a[2] / n];
};

/** 서 있는 동안 잰 "위쪽" 방향과 중력의 크기. 화면이 어떤 각도로 달려 있어도 맞게 쓰려는 것이다. */
let up: Vec | null = null;
let gravity = G;
let sensed: {forces: CupInput; at: number} | null = null;

/**
 * 차량(헤드유닛)의 가속도 센서 값 하나. 기기 좌표계의 m/s²이다.
 * 서 있는 동안에는 위쪽 방향을 배우고, 달리는 동안에는 좌우, 앞뒤, 위아래 힘으로 나눈다.
 * 화면이 운전자를 보고 있다고 가정한다. 화면의 오른쪽이 차의 오른쪽, 화면 뒤쪽이 차의 앞쪽이다.
 */
export function feedMotion(x: number, y: number, z: number) {
  const sample: Vec = [x, y, z];
  const direction = unit(sample);
  if (!direction) return;
  if (!up || !isDrivingLocked(getState())) {
    const mixed: Vec | null = up
      ? unit([up[0] + 0.2 * (direction[0] - up[0]), up[1] + 0.2 * (direction[1] - up[1]), up[2] + 0.2 * (direction[2] - up[2])])
      : direction;
    gravity = up ? gravity + 0.2 * (Math.hypot(x, y, z) - gravity) : Math.hypot(x, y, z);
    up = mixed ?? direction;
    sensed = null;
    return;
  }
  const u = up;
  const vertical = dot(sample, u);
  const flat = (a: Vec): Vec => {
    const d = dot(a, u);
    return [a[0] - d * u[0], a[1] - d * u[1], a[2] - d * u[2]];
  };
  const right = unit(flat([1, 0, 0]));
  const forward = unit(flat([0, 0, -1]));
  if (!right || !forward) return;
  const level = flat(sample);
  sensed = {
    forces: {
      accelLat: dot(level, right),
      accelLong: dot(level, forward),
      accelVert: vertical - gravity,
      pitch: 0,
      roll: 0,
    },
    at: performance.now(),
  };
}

function sensedForces(at: number): CupInput | null {
  return sensed && at - sensed.at < 1500 ? sensed.forces : null;
}

/** 차는 분명히 가감속하거나 도는데 센서가 꼼짝하지 않으면, 이 시각까지 센서 값을 쓰지 않는다. */
let sensorDistrustUntil = 0;
/** 차가 받는다고 계산한 수평 가속이 이보다 크면 "분명히 움직이는 중"으로 본다 (m/s²). */
const CLEAR_MOTION = 0.8;
/** 그런데도 센서가 잰 수평 가속이 이보다 작으면 센서가 차의 움직임을 재지 못한다고 본다 (m/s²). */
const STILL_SENSOR = 0.08;

/**
 * 믿을 수 있는 센서 값. 실제 차량에서는 센서가 차의 가감속과 회전을 그대로 잰다.
 * 에뮬레이터처럼 센서가 늘 정지 값을 내면, 길과 속도로 계산한 힘을 쓴다.
 */
function trustedSensedForces(computed: CupInput, at: number): CupInput | null {
  const value = sensedForces(at);
  if (!value) return null;
  const expected = Math.hypot(computed.accelLat, computed.accelLong);
  const measured = Math.hypot(value.accelLat, value.accelLong);
  if (expected > CLEAR_MOTION && measured < STILL_SENSOR) sensorDistrustUntil = at + 10_000;
  return at < sensorDistrustUntil ? null : value;
}
