/**
 * 길과 차의 움직임.
 *
 * 주행 화면의 지도와 커피 컵이 이 모형에서 나온다. 순수 함수다.
 * - 길(Route)은 출발지부터의 거리(m)로 적은 회전, 과속방지턱, 오르막, 정체 구간이다.
 *   내비는 지도 그림을 주지 않고 "몇 m 앞에서 좌회전" 같은 값만 주므로, 그 값으로 길의 모양을 만든다.
 * - 차가 길 위의 한 점을 어떤 속도로 지나는지 알면 컵이 받는 힘이 정해진다.
 *   회전에서는 v²/r 의 옆 가속, 방지턱에서는 위아래 가속과 앞뒤 흔들림, 오르막에서는 기울기.
 * - 실제 차량에서는 내비가 준 위치 변화로 속도를 잡고, 시뮬레이터에서는 가상 운전자가 속도를 정한다.
 */
import {G, STILL, marginMm, stepCup, type CupInput, type CupState} from './cup';

export type TurnDirection = 'left' | 'right';
export type JamLevel = 'slow' | 'heavy';

export interface RouteTurn {
  /** 회전 한가운데까지의 거리 (m). */
  at: number;
  direction: TurnDirection;
  angleDeg: number;
  /** 회전 반지름 (m). */
  radius: number;
  label: string;
}

export interface Route {
  totalMeters: number;
  turns: RouteTurn[];
  /** 과속방지턱 한가운데까지의 거리 (m). */
  bumps: number[];
  /** 오르막(+)과 내리막(−). percent는 100m에 몇 m 오르는가. */
  grades: {from: number; to: number; percent: number}[];
  /** 정체 구간. road는 그 구간의 길 이름으로, 내비가 알려줄 때만 있다. */
  jams: {from: number; to: number; level: JamLevel; road?: string}[];
}

// ───────────────────────── 길의 모양 ─────────────────────────

interface Piece {
  s0: number;
  s1: number;
  x0: number;
  y0: number;
  h0: number;
  /** 곡률 (1/m). 오른쪽으로 굽으면 +, 곧으면 0. */
  k: number;
}

export interface Geometry {
  pieces: Piece[];
  total: number;
}

/** 지도 위의 자리. x는 오른쪽, y는 아래쪽이 + (화면 좌표). heading은 위쪽이 0, 시계 방향이 + (rad). */
export interface Pose {
  x: number;
  y: number;
  heading: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

function poseOn(piece: Piece, s: number): Pose {
  const d = s - piece.s0;
  if (piece.k === 0)
    return {
      x: piece.x0 + Math.sin(piece.h0) * d,
      y: piece.y0 - Math.cos(piece.h0) * d,
      heading: piece.h0,
    };
  const heading = piece.h0 + piece.k * d;
  return {
    x: piece.x0 + (Math.cos(piece.h0) - Math.cos(heading)) / piece.k,
    y: piece.y0 + (Math.sin(piece.h0) - Math.sin(heading)) / piece.k,
    heading,
  };
}

/** 길을 곧은 조각과 둥근 조각으로 잇는다. 출발점은 (0, 0), 처음 방향은 위쪽이다. */
export function buildGeometry(route: Route): Geometry {
  const pieces: Piece[] = [];
  let s = 0;
  let at: Pose = {x: 0, y: 0, heading: 0};
  const push = (s1: number, k: number) => {
    if (s1 <= s) return;
    const piece: Piece = {s0: s, s1, x0: at.x, y0: at.y, h0: at.heading, k};
    pieces.push(piece);
    at = poseOn(piece, s1);
    s = s1;
  };
  for (const turn of [...route.turns].sort((a, b) => a.at - b.at)) {
    const length = turn.radius * rad(turn.angleDeg);
    const start = Math.max(s, turn.at - length / 2);
    push(start, 0);
    push(start + length, (turn.direction === 'right' ? 1 : -1) / turn.radius);
  }
  push(Math.max(route.totalMeters, s + 1), 0);
  return {pieces, total: route.totalMeters};
}

/** 출발지부터 s 미터 간 곳. 길 앞뒤로 벗어난 거리는 곧게 이어서 계산한다. */
export function poseAt(geometry: Geometry, s: number): Pose {
  const pieces = geometry.pieces;
  let piece = pieces[pieces.length - 1];
  for (const p of pieces) {
    if (s < p.s1) {
      piece = p;
      break;
    }
  }
  return poseOn(piece, s);
}

/** 길의 곧은 조각과 둥근 조각. 지도를 그릴 때 쓴다. */
export function piecesOf(geometry: Geometry): readonly Piece[] {
  return geometry.pieces;
}

/** 그 자리의 곡률. 실제 길처럼 회전의 처음과 끝 30%에서 서서히 굽는다. */
function curvatureAt(geometry: Geometry, s: number): number {
  for (const p of geometry.pieces) {
    if (s < p.s0) break;
    if (s >= p.s1 || p.k === 0) continue;
    const ramp = 0.3 * (p.s1 - p.s0);
    return p.k * Math.min(1, (s - p.s0) / ramp, (p.s1 - s) / ramp);
  }
  return 0;
}

const GRADE_RAMP = 15;

function gradeAt(route: Route, s: number): number {
  for (const g of route.grades) {
    if (s <= g.from || s >= g.to) continue;
    return g.percent * Math.min(1, (s - g.from) / GRADE_RAMP, (g.to - s) / GRADE_RAMP);
  }
  return 0;
}

export function jamAt(route: Route, s: number): JamLevel | null {
  for (const jam of route.jams) if (s >= jam.from && s < jam.to) return jam.level;
  return null;
}

/** 그 자리가 정체 구간이면 그 길의 이름. 모르면 빈 문자열. */
export function jamRoadAt(route: Route, s: number): string {
  for (const jam of route.jams) if (s >= jam.from && s < jam.to) return jam.road ?? '';
  return '';
}

// ───────────────────────── 과속방지턱 ─────────────────────────

/** 국내 원호형 과속방지턱의 표준 규격. 길이 3.6m, 높이 10cm. */
export const BUMP = {length: 3.6, height: 0.1} as const;
/** 방지턱에 올라타고 내려설 때 차체가 눌리는 구간 (m). */
const BUMP_LEAD = 1.2;
const BUMP_SPAN = BUMP.length / 2 + BUMP_LEAD;
/** 차체가 위아래로 흔들리는 고유 진동수 (Hz)와 감쇠비. */
const BODY_HZ = 1.3;
const BODY_DAMPING = 0.5;
/** 방지턱의 경사가 차체의 앞뒤 기울기로 전해지는 비율. */
const BUMP_PITCH_SHARE = 0.6;

/**
 * 방지턱의 높낮이가 차체로 전해지는 배율.
 * 서스펜션의 전달률 식을 쓰되, 한 번 지나가는 충격이라 공진이 다 자라지 않으므로 1.25배에서 자른다.
 */
export function transmissibility(speed: number): number {
  const r = speed / (2 * BUMP.length) / BODY_HZ;
  const d = 2 * BODY_DAMPING * r;
  return Math.min(1.25, Math.sqrt((1 + d * d) / ((1 - r * r) ** 2 + d * d)));
}

/**
 * 방지턱 한가운데에서 u 미터 떨어진 곳을 speed 로 지날 때 차체의 위아래 가속도와 앞뒤 기울기.
 * 턱 위에서는 차체가 아래로 가속하고(몸이 뜨는 느낌), 올라타고 내려설 때는 위로 눌린다.
 */
export function bumpMotion(speed: number, u: number): {accelVert: number; pitch: number} {
  const half = BUMP.length / 2;
  const w = Math.PI / BUMP.length;
  const t = transmissibility(speed);
  if (Math.abs(u) <= half) {
    const phase = w * (u + half);
    return {
      accelVert: -t * BUMP.height * (w * speed) ** 2 * Math.sin(phase),
      pitch: BUMP_PITCH_SHARE * Math.atan(BUMP.height * w) * Math.sin(2 * phase),
    };
  }
  const outside = Math.abs(u) - half;
  if (outside >= BUMP_LEAD) return {accelVert: 0, pitch: 0};
  // 턱 위에서 잃은 수직 속도를 앞뒤 눌림 구간에서 절반씩 돌려받는다.
  const peak = (t * BUMP.height * w * speed ** 2 * Math.PI) / (2 * BUMP_LEAD);
  return {accelVert: peak * Math.sin((Math.PI * (BUMP_LEAD - outside)) / BUMP_LEAD), pitch: 0};
}

// ───────────────────────── 차의 움직임 ─────────────────────────

/** 가상 운전자의 운전 습관. */
export type DriveStyle = 'gentle' | 'normal' | 'rough';

interface Habit {
  /** 막힘 없는 길의 속도 (m/s). */
  cruise: number;
  /** 회전에서 견디는 옆 가속 (m/s²). */
  lateral: number;
  accel: number;
  brake: number;
  /** 방지턱을 넘는 속도 (m/s). */
  bump: number;
}

export const HABITS: Record<DriveStyle, Habit> = {
  gentle: {cruise: 11.1, lateral: 1.1, accel: 1.0, brake: 1.3, bump: 4.2},
  normal: {cruise: 13.9, lateral: 2.0, accel: 1.6, brake: 2.2, bump: 6.1},
  rough: {cruise: 16.7, lateral: 3.2, accel: 2.4, brake: 3.2, bump: 9.4},
};

const JAM_SPEED: Record<JamLevel, number> = {heavy: 2.2, slow: 6};
/** 방지턱 이만큼 앞에서 감속을 끝낸다 (m). 턱 위에서 브레이크를 밟고 있으면 커피가 쏠린다. */
const BUMP_SETTLE = 6;
/** 페달을 밟고 차가 반응하기까지의 늦음 (초). */
const PEDAL_LAG = 0.4;
/** 옆 가속 1g에 차체가 바깥으로 기우는 각도 (rad). */
const ROLL_PER_G = 0.08;
/** 앞뒤 가속 1g에 차 앞이 들리는 각도 (rad). 브레이크를 밟으면 앞이 숙는다. */
const SQUAT_PER_G = 0.035;

export interface DriveState {
  /** 출발지부터 달린 거리 (m). */
  meters: number;
  /** 속도 (m/s). */
  speed: number;
  /** 앞뒤 가속도 (m/s²). */
  accel: number;
}

export const PARKED: DriveState = {meters: 0, speed: 0, accel: 0};

export interface DriveForces extends CupInput {
  /** 길의 경사 (%). 오르막이 +. */
  gradePercent: number;
  /** 길의 곡률 (1/m). 오른쪽으로 굽으면 +. */
  curvature: number;
  /** 방지턱 위에 있다. */
  onBump: boolean;
}

export const NO_FORCES: DriveForces = {...STILL, gradePercent: 0, curvature: 0, onBump: false};

/** 가상 운전자가 지금 낼 수 있는 속도. 앞의 회전, 방지턱, 정체, 도착지를 보고 미리 줄인다. */
function speedLimit(route: Route, geometry: Geometry, meters: number, habit: Habit): number {
  let limit = habit.cruise;
  const allow = (target: number, distance: number) => {
    const reach = Math.sqrt(target * target + 1.6 * habit.brake * Math.max(0, distance));
    if (reach < limit) limit = reach;
  };
  for (const p of geometry.pieces)
    if (p.k !== 0 && meters < p.s1) allow(Math.sqrt(habit.lateral / Math.abs(p.k)), p.s0 - meters);
  for (const at of route.bumps)
    if (meters < at + BUMP_SPAN) allow(habit.bump, at - BUMP_SPAN - BUMP_SETTLE - meters);
  for (const jam of route.jams)
    if (meters < jam.to) allow(JAM_SPEED[jam.level], jam.from - meters);
  allow(0, route.totalMeters - meters);
  return limit;
}

/** 지금 자리와 속도에서 차와 컵이 받는 힘. */
export function forcesAt(route: Route, geometry: Geometry, state: DriveState): DriveForces {
  const curvature = curvatureAt(geometry, state.meters);
  const accelLat = state.speed * state.speed * curvature;
  let accelVert = 0;
  let bumpPitch = 0;
  let onBump = false;
  for (const at of route.bumps) {
    const u = state.meters - at;
    if (Math.abs(u) >= BUMP_SPAN) continue;
    const motion = bumpMotion(state.speed, u);
    accelVert += motion.accelVert;
    bumpPitch += motion.pitch;
    if (Math.abs(u) <= BUMP.length / 2) onBump = true;
  }
  const gradePercent = gradeAt(route, state.meters);
  return {
    accelLat,
    accelLong: state.accel,
    accelVert,
    pitch: Math.atan(gradePercent / 100) + bumpPitch + (SQUAT_PER_G * state.accel) / G,
    roll: (-ROLL_PER_G * accelLat) / G,
    gradePercent,
    curvature,
    onBump,
  };
}

/**
 * dt 초 뒤의 차.
 * control이 운전 습관이면 가상 운전자가 몰고, {speed}면 밖에서 잰 속도를 그대로 따른다.
 */
export function stepDrive(
  route: Route,
  geometry: Geometry,
  state: DriveState,
  dt: number,
  control: DriveStyle | {speed: number},
): {state: DriveState; forces: DriveForces; bumpsCrossed: number} {
  let {meters, speed, accel} = state;
  const before = meters;
  const lag = Math.min(1, dt / PEDAL_LAG);

  if (typeof control === 'string') {
    const habit = HABITS[control];
    const limit = speedLimit(route, geometry, meters, habit);
    const wanted = Math.min(habit.accel, Math.max(-habit.brake, (limit - speed) / 0.6));
    accel += (wanted - accel) * lag;
    speed = Math.max(0, speed + accel * dt);
  } else {
    const wanted = Math.min(4, Math.max(-6, (control.speed - speed) / Math.max(dt, 0.02)));
    accel += (wanted - accel) * lag;
    speed = Math.max(0, control.speed);
  }

  meters = Math.min(route.totalMeters, meters + speed * dt);
  if (route.totalMeters - meters < 0.3) {
    meters = route.totalMeters;
    speed = 0;
    accel = 0;
  }
  const next = {meters, speed, accel};
  return {
    state: next,
    forces: forcesAt(route, geometry, next),
    bumpsCrossed: route.bumps.filter(at => before < at && at <= meters).length,
  };
}

// ───────────────────────── 미리 계산 ─────────────────────────

/** 방지턱을 넘을 때 운전자가 살짝 가감속한다고 본 값 (m/s²). */
const NUDGE = 0.8;

/**
 * 지금 컵에 든 양으로 방지턱을 speed 로 넘으면 얼마나 넘치는가. 가장 높이 솟은 깊이(mm)도 돌려준다.
 * 컵의 모양과 뚜껑은 cup.spec 을 따른다 (운행에 고른 컵).
 */
export function predictBump(cup: CupState, speed: number): {spillMl: number; peakOverMm: number} {
  let c: CupState = {...cup, lat: 0, latRate: 0, long: 0, longRate: 0, heave: 0, heaveRate: 0, spilledMl: 0};
  const dt = 0.004;
  let peak = -Infinity;
  for (let u = -BUMP_SPAN; u < BUMP_SPAN; u += Math.max(speed, 0.5) * dt) {
    const motion = bumpMotion(speed, u);
    c = stepCup(c, {...STILL, accelLong: NUDGE, accelVert: motion.accelVert, pitch: motion.pitch}, dt);
    peak = Math.max(peak, -marginMm(c));
  }
  for (let t = 0; t < 0.6; t += dt) {
    c = stepCup(c, STILL, dt);
    peak = Math.max(peak, -marginMm(c));
  }
  return {spillMl: c.spilledMl, peakOverMm: peak};
}

/** 이 속도 아래로 방지턱을 넘으면 넘치지 않는다 (m/s). 시속 1km 단위로 찾는다. */
export function safeBumpSpeed(cup: CupState): number {
  let safe = 0;
  for (let kph = 5; kph <= 60; kph += 1) {
    if (predictBump(cup, kph / 3.6).spillMl > 0.05) break;
    safe = kph / 3.6;
  }
  return safe;
}

/**
 * 이 속도 아래로 반지름 radius 의 회전을 돌면 수면이 가장자리에 닿지 않는다 (m/s). 출렁임 여유 15%를 둔다.
 * 뚜껑은 넣지 않는다. 오래 기울어 있으면 뚜껑이 있어도 마시는 구멍으로 새기 때문이다.
 */
export function safeTurnSpeed(cup: CupState, radius: number): number {
  const still: CupState = {...cup, lat: 0, long: 0, heave: 0};
  const tanLimit = Math.max(0, marginMm(still) / 1000 / cup.spec.radius);
  return Math.sqrt((G * tanLimit * radius) / (1.15 * (1 + ROLL_PER_G)));
}

// ───────────────────────── 시연용 길 ─────────────────────────

/**
 * 시뮬레이터와 시험 주행이 쓰는 가상의 길. 880m 안에 방지턱 둘, 회전 둘, 오르막과 내리막, 정체 구간이 있다.
 * variant에 따라 좌우가 뒤집히거나 굽이가 늘어난다.
 */
export function demoRoute(variant: 0 | 1 | 2, labels: {first: string; last: string}): Route {
  const [a, b]: TurnDirection[] = variant === 1 ? ['left', 'right'] : ['right', 'left'];
  const word = (d: TurnDirection) => (d === 'right' ? '우회전' : '좌회전');
  const route: Route = {
    totalMeters: 880,
    turns: [
      {at: 235, direction: a, angleDeg: 90, radius: 26, label: `${word(a)} · ${labels.first}`},
      {at: 735, direction: b, angleDeg: 90, radius: 24, label: `${word(b)} · ${labels.last}`},
    ],
    bumps: [115, 620],
    grades: [
      {from: 300, to: 430, percent: 6},
      {from: 765, to: 845, percent: -5},
    ],
    jams: [
      {from: 470, to: 515, level: 'heavy'},
      {from: 515, to: 548, level: 'slow'},
    ],
  };
  if (variant === 2) {
    // 나들이 길. 완만한 굽이가 하나 더 있고 오르막이 길다.
    route.turns.splice(1, 0, {at: 380, direction: 'left', angleDeg: 45, radius: 60, label: '왼쪽 굽은 길'});
    route.turns[2] = {...route.turns[2], direction: 'right', label: `우회전 · ${labels.last}`};
    route.grades[0] = {from: 290, to: 455, percent: 7};
  }
  return route;
}
