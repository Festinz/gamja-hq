import {describe, expect, it} from 'vitest';
import {
  bearing,
  bendsOf,
  distance,
  headingAt,
  lineOf,
  nearestOnLine,
  pointAt,
  sliceLine,
  turnBetween,
  type LngLat,
} from './geo';

/** 판교역 근처. 위도 1도는 약 111.2km, 이 위도에서 경도 1도는 약 88.3km다. */
const ORIGIN: LngLat = [127.1112, 37.3947];
const north = (meters: number, from: LngLat = ORIGIN): LngLat => [from[0], from[1] + meters / 111_195];
const east = (meters: number, from: LngLat = ORIGIN): LngLat => [
  from[0] + meters / (111_195 * Math.cos((from[1] * Math.PI) / 180)),
  from[1],
];

describe('거리와 방향', () => {
  it('북쪽으로 100m 간 점까지의 거리는 100m다', () => {
    expect(distance(ORIGIN, north(100))).toBeCloseTo(100, 1);
  });

  it('동쪽으로 250m 간 점까지의 거리는 250m다', () => {
    expect(distance(ORIGIN, east(250))).toBeCloseTo(250, 0);
  });

  it('방향은 북쪽이 0, 동쪽이 90, 남쪽이 180, 서쪽이 270이다', () => {
    expect(bearing(ORIGIN, north(100))).toBeCloseTo(0, 1);
    expect(bearing(ORIGIN, east(100))).toBeCloseTo(90, 1);
    expect(bearing(ORIGIN, north(-100))).toBeCloseTo(180, 1);
    expect(bearing(ORIGIN, east(-100))).toBeCloseTo(270, 1);
  });

  it('꺾인 각도는 오른쪽이 +, 왼쪽이 −이고 360도를 넘나들어도 맞다', () => {
    expect(turnBetween(0, 90)).toBe(90);
    expect(turnBetween(90, 0)).toBe(-90);
    expect(turnBetween(350, 10)).toBe(20);
    expect(turnBetween(10, 350)).toBe(-20);
  });
});

describe('경로', () => {
  // 북쪽으로 200m 간 뒤 오른쪽(동쪽)으로 300m.
  const corner = north(200);
  const line = lineOf([ORIGIN, corner, east(300, corner)]);

  it('전체 길이는 구간 길이의 합이다', () => {
    expect(line.total).toBeCloseTo(500, 0);
    expect(line.cum[1]).toBeCloseTo(200, 0);
  });

  it('겹친 점은 뺀다', () => {
    expect(lineOf([ORIGIN, ORIGIN, corner]).points).toHaveLength(2);
  });

  it('출발지부터 100m 간 곳은 북쪽으로 100m 간 점이다', () => {
    const {at, bearing: heading} = pointAt(line, 100);
    expect(distance(at, north(100))).toBeLessThan(0.5);
    expect(heading).toBeCloseTo(0, 0);
  });

  it('모퉁이를 지난 350m 지점은 동쪽을 본다', () => {
    const {at, bearing: heading} = pointAt(line, 350);
    expect(distance(at, east(150, corner))).toBeLessThan(0.5);
    expect(heading).toBeCloseTo(90, 0);
  });

  it('범위를 벗어난 거리는 양 끝에 붙인다', () => {
    expect(distance(pointAt(line, -50).at, ORIGIN)).toBeLessThan(0.01);
    expect(distance(pointAt(line, 9999).at, east(300, corner))).toBeLessThan(0.01);
  });

  it('모퉁이 한가운데에서는 방향이 튀지 않고 그 사이를 본다', () => {
    const heading = headingAt(line, 200, 14);
    expect(heading).toBeGreaterThan(30);
    expect(heading).toBeLessThan(60);
  });

  it('길에서 8m 떨어진 점은 그 옆의 길 위 자리로 잡힌다', () => {
    const beside = east(8, north(120));
    const found = nearestOnLine(line, beside);
    expect(found.meters).toBeCloseTo(120, 0);
    expect(found.offset).toBeCloseTo(8, 0);
  });

  it('길의 끝을 지난 점은 끝에 붙고, 떨어진 거리가 그대로 나온다', () => {
    const past = east(340, corner);
    const found = nearestOnLine(line, past);
    expect(found.meters).toBeCloseTo(500, 0);
    expect(found.offset).toBeCloseTo(40, 0);
  });

  it('조각은 양 끝 점을 포함하고 사이의 꺾인 점을 지난다', () => {
    const piece = sliceLine(line, 150, 260);
    expect(piece).toHaveLength(3);
    expect(distance(piece[0], north(150))).toBeLessThan(0.5);
    expect(distance(piece[1], corner)).toBeLessThan(0.01);
    expect(distance(piece[2], east(60, corner))).toBeLessThan(0.5);
  });
});

describe('굽이 찾기', () => {
  const corner = north(200);

  it('직각으로 꺾인 우회전 하나를 찾는다', () => {
    const bends = bendsOf(lineOf([ORIGIN, corner, east(300, corner)]));
    expect(bends).toHaveLength(1);
    expect(bends[0].at).toBeGreaterThan(185);
    expect(bends[0].at).toBeLessThan(215);
    expect(bends[0].angleDeg).toBeGreaterThan(80);
    expect(bends[0].angleDeg).toBeLessThan(100);
  });

  it('좌회전은 각도가 −이고, 교차로 좌회전의 반지름은 18m 아래로 내려가지 않는다', () => {
    const bends = bendsOf(lineOf([ORIGIN, corner, east(-300, corner)]));
    expect(bends).toHaveLength(1);
    expect(bends[0].angleDeg).toBeLessThan(-80);
    expect(bends[0].radius).toBeGreaterThanOrEqual(18);
  });

  it('곧은 길에는 굽이가 없다', () => {
    expect(bendsOf(lineOf([ORIGIN, north(150), north(400)]))).toHaveLength(0);
  });

  it('반지름 60m의 완만한 굽은 길은 반지름이 그 근처로 나온다', () => {
    // 북쪽을 보다가 오른쪽으로 90도 도는 원호. 중심은 출발점 동쪽 60m.
    const center = east(60);
    const arc: LngLat[] = [north(-100)];
    for (let deg = 0; deg <= 90; deg += 5) {
      const a = (deg * Math.PI) / 180;
      arc.push(north(60 * Math.sin(a), east(-60 * Math.cos(a), center)));
    }
    arc.push(east(100, arc[arc.length - 1]));
    const bends = bendsOf(lineOf(arc));
    expect(bends).toHaveLength(1);
    expect(bends[0].angleDeg).toBeGreaterThan(75);
    expect(bends[0].radius).toBeGreaterThan(45);
    expect(bends[0].radius).toBeLessThan(80);
  });

  it('굽은 길의 꼭짓점이 듬성듬성하고 반대쪽으로 살짝 흔들려도 한 굽이로 본다', () => {
    // 오른쪽으로 60도 도는 길을 15m 간격의 점 몇 개로 그리고, 중간에 반대쪽으로 0.5도 흔들리게 한다.
    const pts: LngLat[] = [north(-120)];
    let at: LngLat = ORIGIN;
    let heading = 0;
    for (const turn of [0, 12, 12, -0.5, 12, 12, 12.5, 0, 0]) {
      heading += turn;
      const rad = (heading * Math.PI) / 180;
      at = north(15 * Math.cos(rad), east(15 * Math.sin(rad), at));
      pts.push(at);
    }
    pts.push(north(150 * Math.cos((heading * Math.PI) / 180), east(150 * Math.sin((heading * Math.PI) / 180), at)));
    const bends = bendsOf(lineOf([north(-120), ORIGIN, ...pts.slice(1)]));
    expect(bends).toHaveLength(1);
    expect(bends[0].angleDeg).toBeGreaterThan(50);
  });

  it('10도쯤 살짝 휜 길은 굽이로 치지 않는다', () => {
    const slight = lineOf([ORIGIN, north(200), east(35, north(400))]);
    expect(bendsOf(slight)).toHaveLength(0);
  });
});
