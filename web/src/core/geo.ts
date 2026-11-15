/**
 * 지도 위의 거리와 방향.
 *
 * 실제 경로의 모양(경도·위도의 꺾은선)에서 "출발지부터 몇 m 간 곳"의 좌표와 진행 방향을 얻고,
 * 과속방지턱 같은 점이 그 경로의 어디쯤에 있는지 찾는다. 순수 함수다.
 * 수 km 안쪽의 짧은 경로만 다루므로, 점 가까이에서는 평면으로 펴서 계산한다.
 */

/** [경도, 위도]. GeoJSON과 같은 순서다. */
export type LngLat = readonly [lng: number, lat: number];

const EARTH_RADIUS = 6_371_008.8;
const RAD = Math.PI / 180;

/** 두 점 사이의 거리 (m). */
export function distance(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLng = (b[0] - a[0]) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** a에서 b를 보는 방향 (도). 북쪽이 0, 시계 방향이 +. */
export function bearing(a: LngLat, b: LngLat): number {
  const lat1 = a[1] * RAD;
  const lat2 = b[1] * RAD;
  const dLng = (b[0] - a[0]) * RAD;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** from 방향에서 to 방향으로 꺾인 각도 (도). −180 ~ 180. 오른쪽으로 꺾이면 +. */
export function turnBetween(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/** 경로의 모양. */
export interface Line {
  points: LngLat[];
  /** 각 점까지 달린 거리 (m). */
  cum: number[];
  total: number;
}

/** 점의 열로 경로를 만든다. 겹친 점은 뺀다. */
export function lineOf(points: readonly LngLat[]): Line {
  const kept: LngLat[] = [];
  const cum: number[] = [];
  let total = 0;
  for (const point of points) {
    const previous = kept[kept.length - 1];
    if (previous) {
      const step = distance(previous, point);
      if (step < 0.05) continue;
      total += step;
    }
    kept.push(point);
    cum.push(total);
  }
  return {points: kept, cum, total};
}

/** 출발지부터 meters 간 곳의 좌표와 그 구간의 방향. 범위를 벗어나면 양 끝에 붙인다. */
export function pointAt(line: Line, meters: number): {at: LngLat; bearing: number} {
  const n = line.points.length;
  if (n === 0) return {at: [0, 0], bearing: 0};
  if (n === 1) return {at: line.points[0], bearing: 0};
  const m = Math.min(line.total, Math.max(0, meters));
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (line.cum[mid] <= m) lo = mid;
    else hi = mid;
  }
  const a = line.points[lo];
  const b = line.points[hi];
  const span = line.cum[hi] - line.cum[lo];
  const t = span > 0 ? (m - line.cum[lo]) / span : 0;
  return {at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], bearing: bearing(a, b)};
}

/** 진행 방향 (도). 꺾이는 점에서 방향이 튀지 않게 앞뒤 span 미터를 이은 방향을 쓴다. */
export function headingAt(line: Line, meters: number, span = 14): number {
  const a = pointAt(line, meters - span / 2).at;
  const b = pointAt(line, meters + span / 2).at;
  return distance(a, b) < 0.5 ? pointAt(line, meters).bearing : bearing(a, b);
}

/** 점 p에서 가장 가까운 경로 위의 자리. offset은 경로에서 떨어진 거리 (m). */
export function nearestOnLine(line: Line, p: LngLat): {meters: number; offset: number} {
  const k = Math.cos(p[1] * RAD);
  const flat = (q: LngLat): [number, number] => [
    (q[0] - p[0]) * RAD * EARTH_RADIUS * k,
    (q[1] - p[1]) * RAD * EARTH_RADIUS,
  ];
  let best = {meters: 0, offset: Infinity};
  for (let i = 0; i + 1 < line.points.length; i++) {
    const [ax, ay] = flat(line.points[i]);
    const [bx, by] = flat(line.points[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const length2 = dx * dx + dy * dy;
    const t = length2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / length2)) : 0;
    const offset = Math.hypot(ax + dx * t, ay + dy * t);
    if (offset < best.offset) best = {meters: line.cum[i] + Math.sqrt(length2) * t, offset};
  }
  if (line.points.length === 1) best = {meters: 0, offset: distance(line.points[0], p)};
  return best;
}

/** from부터 to까지의 경로 조각. 지도에 지나온 길과 남은 길을 따로 그릴 때 쓴다. */
export function sliceLine(line: Line, from: number, to: number): LngLat[] {
  const a = Math.min(line.total, Math.max(0, from));
  const b = Math.min(line.total, Math.max(a, to));
  const out: LngLat[] = [pointAt(line, a).at];
  for (let i = 0; i < line.points.length; i++) if (line.cum[i] > a && line.cum[i] < b) out.push(line.points[i]);
  out.push(pointAt(line, b).at);
  return out;
}

/** 경로에서 뚜렷하게 꺾이는 곳. */
export interface Bend {
  /** 굽이 한가운데까지의 거리 (m). */
  at: number;
  /** 꺾인 각도 (도). 오른쪽이 +. */
  angleDeg: number;
  /** 굽이의 길이로 어림한 반지름 (m). */
  radius: number;
}

const BEND_STEP = 5;

/**
 * 경로를 5m씩 걸으며 방향이 꾸준히 바뀌는 구간을 굽이로 묶는다.
 * 지도 데이터의 교차로는 한 점에서 꺾이므로 반지름이 실제보다 작게 나온다. 아래쪽 한계를 둔다.
 */
export function bendsOf(line: Line, minAngle = 25): Bend[] {
  if (line.total < BEND_STEP * 3) return [];
  const steps = Math.floor(line.total / BEND_STEP);
  const headings: number[] = [];
  for (let i = 0; i <= steps; i++) headings.push(headingAt(line, i * BEND_STEP, 10));
  const bends: Bend[] = [];
  let i = 0;
  while (i < steps) {
    const first = turnBetween(headings[i], headings[i + 1]);
    if (Math.abs(first) < 1.2) {
      i += 1;
      continue;
    }
    const sign = Math.sign(first);
    let j = i;
    let angle = 0;
    let weight = 0;
    let moment = 0;
    let quiet = 0;
    while (j < steps) {
      const turn = turnBetween(headings[j], headings[j + 1]);
      // 반대쪽으로 뚜렷하게 꺾이면 다른 굽이다. 작은 흔들림이나 25m까지 곧은 것은 같은 굽이로 본다
      // (지도 데이터의 굽은 길은 꼭짓점이 15m쯤 떨어져 있어, 꼭짓점 사이가 곧게 나온다).
      if (Math.sign(turn) === -sign && Math.abs(turn) >= 1.2) break;
      if (Math.sign(turn) !== sign || Math.abs(turn) < 1.2) {
        quiet += 1;
        if (quiet > 5) break;
      } else {
        quiet = 0;
        angle += turn;
        weight += Math.abs(turn);
        moment += Math.abs(turn) * (j + 0.5) * BEND_STEP;
      }
      j += 1;
    }
    const length = Math.max(BEND_STEP, (j - quiet - i) * BEND_STEP);
    if (Math.abs(angle) >= minAngle) {
      const floor = angle < 0 ? 18 : 11;
      bends.push({
        at: moment / weight,
        angleDeg: angle,
        radius: Math.min(150, Math.max(floor, length / (Math.abs(angle) * RAD))),
      });
    }
    i = Math.max(j, i + 1);
  }
  return bends;
}
