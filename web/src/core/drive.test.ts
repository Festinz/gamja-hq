import {describe, expect, it} from 'vitest';
import {
  COFFEE_START_ML,
  G,
  STILL,
  marginMm,
  newCup,
  sloshHz,
  spillLimitDeg,
  stepCup,
  tiltDeg,
  type CupInput,
  type CupState,
} from './cup';
import {
  BUMP,
  HABITS,
  PARKED,
  buildGeometry,
  bumpMotion,
  demoRoute,
  jamAt,
  poseAt,
  predictBump,
  safeBumpSpeed,
  safeTurnSpeed,
  stepDrive,
  type DriveStyle,
  type Route,
} from './drive';

const hold = (cup: CupState, input: CupInput, seconds: number, dt = 0.02) => {
  for (let t = 0; t < seconds; t += dt) cup = stepCup(cup, input, dt);
  return cup;
};

describe('컵 속 커피', () => {
  it('가만히 있으면 수면이 평평하고 넘치지 않는다', () => {
    const cup = hold(newCup(), STILL, 3);
    expect(tiltDeg(cup)).toBe(0);
    expect(cup.spilledMl).toBe(0);
    expect(cup.volumeMl).toBe(COFFEE_START_ML);
  });

  it('옆으로 가속하면 수면이 atan(a/g)만큼 기운다', () => {
    const cup = hold(newCup(), {...STILL, accelLat: 2}, 6);
    expect(tiltDeg(cup)).toBeCloseTo((Math.atan(2 / G) * 180) / Math.PI, 1);
  });

  it('오른쪽으로 돌면 커피가 왼쪽 벽을 탄다', () => {
    expect(hold(newCup(), {...STILL, accelLat: 2}, 6).lat).toBeLessThan(0);
    expect(hold(newCup(), {...STILL, accelLat: -2}, 6).lat).toBeGreaterThan(0);
  });

  it('브레이크를 밟으면 앞으로, 오르막에서는 뒤로 쏠린다', () => {
    expect(hold(newCup(), {...STILL, accelLong: -2}, 6).long).toBeGreaterThan(0);
    expect(hold(newCup(), {...STILL, pitch: 0.06}, 6).long).toBeCloseTo(-Math.tan(0.06), 3);
  });

  it('갑자기 가속하면 수면이 목표를 지나쳐 출렁인다', () => {
    let cup = newCup(300);
    let peak = 0;
    for (let t = 0; t < 1; t += 0.004) {
      cup = stepCup(cup, {...STILL, accelLat: 1.5}, 0.004);
      peak = Math.max(peak, Math.abs(cup.lat));
    }
    expect(peak).toBeGreaterThan((1.5 / G) * 1.3);
  });

  it('한계 기울기를 넘으면 넘치고, 넘친 만큼 줄어든다', () => {
    const cup = hold(newCup(), {...STILL, accelLat: 4.5}, 5);
    expect(cup.spilledMl).toBeGreaterThan(20);
    expect(cup.volumeMl + cup.spilledMl).toBeCloseTo(COFFEE_START_ML, 6);
    // 넘치고 나면 수면이 가장자리에 걸친다.
    expect(Math.abs(marginMm(cup))).toBeLessThan(1);
  });

  it('커피가 많을수록 한계 기울기가 작다', () => {
    expect(spillLimitDeg(newCup(440))).toBeLessThan(spillLimitDeg(newCup(300)));
    expect(spillLimitDeg(newCup())).toBeGreaterThan(15);
    expect(spillLimitDeg(newCup())).toBeLessThan(20);
  });

  it('수면은 1초에 서너 번 출렁인다', () => {
    expect(sloshHz(COFFEE_START_ML)).toBeGreaterThan(3);
    expect(sloshHz(COFFEE_START_ML)).toBeLessThan(4);
  });

  it('유효 중력이 0 아래로 내려가면 커피가 떠올랐다가 내려앉는다', () => {
    const lifted = hold(newCup(300), {...STILL, accelVert: -14}, 0.1, 0.004);
    expect(lifted.heave).toBeGreaterThan(0.005);
    const settled = hold(lifted, STILL, 1, 0.004);
    expect(settled.heave).toBe(0);
  });
});

describe('길의 모양', () => {
  const route: Route = {
    totalMeters: 300,
    turns: [{at: 100, direction: 'right', angleDeg: 90, radius: 20, label: '우회전'}],
    bumps: [],
    grades: [],
    jams: [{from: 200, to: 240, level: 'heavy'}],
  };

  it('처음에는 위쪽으로 곧게 간다', () => {
    const pose = poseAt(buildGeometry(route), 50);
    expect(pose.x).toBeCloseTo(0, 6);
    expect(pose.y).toBeCloseTo(-50, 6);
    expect(pose.heading).toBe(0);
  });

  it('오른쪽 90도 회전을 지나면 오른쪽을 향한다', () => {
    const pose = poseAt(buildGeometry(route), 200);
    expect(pose.heading).toBeCloseTo(Math.PI / 2, 6);
    expect(pose.x).toBeGreaterThan(50);
  });

  it('왼쪽 회전은 왼쪽으로 간다', () => {
    const left: Route = {...route, turns: [{...route.turns[0], direction: 'left'}]};
    const pose = poseAt(buildGeometry(left), 200);
    expect(pose.heading).toBeCloseTo(-Math.PI / 2, 6);
    expect(pose.x).toBeLessThan(-50);
  });

  it('정체 구간 안에서만 정체다', () => {
    expect(jamAt(route, 199)).toBeNull();
    expect(jamAt(route, 220)).toBe('heavy');
    expect(jamAt(route, 240)).toBeNull();
  });
});

describe('과속방지턱', () => {
  it('턱 위에서는 차체가 아래로, 올라탈 때는 위로 가속한다', () => {
    expect(bumpMotion(8, 0).accelVert).toBeLessThan(0);
    expect(bumpMotion(8, -BUMP.length / 2 - 0.6).accelVert).toBeGreaterThan(0);
    expect(bumpMotion(8, 5).accelVert).toBe(0);
  });

  it('지나고 나면 위아래 속도가 남지 않는다', () => {
    const speed = 8;
    const dt = 0.0005;
    let velocity = 0;
    for (let u = -4; u < 4; u += speed * dt) velocity += bumpMotion(speed, u).accelVert * dt;
    expect(Math.abs(velocity)).toBeLessThan(0.02);
  });

  it('빨리 넘을수록 차체가 더 크게 뜬다', () => {
    expect(Math.abs(bumpMotion(11, 0).accelVert)).toBeGreaterThan(Math.abs(bumpMotion(5, 0).accelVert));
    // 시속 40km면 턱 위에서 1g를 넘게 아래로 가속해 컵 속 커피가 뜬다.
    expect(Math.abs(bumpMotion(40 / 3.6, 0).accelVert)).toBeGreaterThan(G);
    expect(Math.abs(bumpMotion(20 / 3.6, 0).accelVert)).toBeLessThan(0.5 * G);
  });

  it('천천히 넘으면 넘치지 않고 빨리 넘으면 넘친다', () => {
    expect(predictBump(newCup(), 15 / 3.6).spillMl).toBe(0);
    expect(predictBump(newCup(), 50 / 3.6).spillMl).toBeGreaterThan(1);
  });

  it('안전 속도는 커피가 적을수록 높다', () => {
    const full = safeBumpSpeed(newCup()) * 3.6;
    const half = safeBumpSpeed(newCup(250)) * 3.6;
    expect(full).toBeGreaterThanOrEqual(15);
    expect(full).toBeLessThanOrEqual(40);
    expect(half).toBeGreaterThanOrEqual(full);
  });

  it('회전 안전 속도는 반지름이 클수록 높다', () => {
    expect(safeTurnSpeed(newCup(), 60)).toBeGreaterThan(safeTurnSpeed(newCup(), 25));
    expect(safeTurnSpeed(newCup(), 25) * 3.6).toBeGreaterThan(15);
    expect(safeTurnSpeed(newCup(), 25) * 3.6).toBeLessThan(40);
  });
});

describe('가상 운전', () => {
  const route = demoRoute(0, {first: '큰길', last: '도착지'});
  const geometry = buildGeometry(route);

  const drive = (style: DriveStyle) => {
    let state = PARKED;
    let cup = newCup();
    let seconds = 0;
    let maxLat = 0;
    let slowestInJam = Infinity;
    let bumps = 0;
    const bumpSpeeds: number[] = [];
    const spillsAt: string[] = [];
    const dt = 0.02;
    while (state.meters < route.totalMeters && seconds < 600) {
      const out = stepDrive(route, geometry, state, dt, style);
      state = out.state;
      const before = cup.spilledMl;
      cup = stepCup(cup, out.forces, dt);
      if (cup.spilledMl > before) {
        const where = `${Math.round(state.meters / 10) * 10}m`;
        if (spillsAt[spillsAt.length - 1] !== where) spillsAt.push(where);
      }
      maxLat = Math.max(maxLat, Math.abs(out.forces.accelLat));
      if (jamAt(route, state.meters) === 'heavy') slowestInJam = Math.min(slowestInJam, state.speed);
      if (out.bumpsCrossed > 0) {
        bumps += out.bumpsCrossed;
        bumpSpeeds.push(state.speed);
      }
      seconds += dt;
    }
    return {state, cup, seconds, maxLat, slowestInJam, bumps, bumpSpeeds, spillsAt};
  };

  it('끝까지 가서 선다', () => {
    const result = drive('normal');
    expect(result.state.meters).toBe(route.totalMeters);
    expect(result.state.speed).toBe(0);
    expect(result.seconds).toBeGreaterThan(60);
    expect(result.seconds).toBeLessThan(200);
  });

  it('방지턱을 둘 넘고, 넘을 때는 습관에 맞게 속도를 줄인다', () => {
    const result = drive('normal');
    expect(result.bumps).toBe(2);
    for (const speed of result.bumpSpeeds) expect(speed).toBeLessThan(HABITS.normal.bump * 1.15);
  });

  it('회전에서 견딜 만큼만 옆으로 쏠린다', () => {
    expect(drive('gentle').maxLat).toBeLessThan(HABITS.gentle.lateral * 1.2);
    expect(drive('rough').maxLat).toBeGreaterThan(HABITS.normal.lateral);
  });

  it('정체 구간에서는 기어간다', () => {
    expect(drive('normal').slowestInJam).toBeLessThan(3);
  });

  it('부드럽게 몰면 커피를 한 방울도 흘리지 않는다', () => {
    expect(drive('gentle').cup.spilledMl).toBe(0);
  });

  it('보통으로 몰아도 흘리지 않지만, 거칠게 몰면 넘친다', () => {
    expect(drive('normal').cup.spilledMl).toBeLessThan(0.5);
    expect(drive('rough').cup.spilledMl).toBeGreaterThan(3);
  });

  it('참고: 습관별 결과', () => {
    for (const style of ['gentle', 'normal', 'rough'] as const) {
      const r = drive(style);
      console.log(
        `${style}: ${r.seconds.toFixed(0)}s, 옆가속 ${r.maxLat.toFixed(2)}, 방지턱 ${r.bumpSpeeds
          .map(v => (v * 3.6).toFixed(0))
          .join('/')}km/h, 흘림 ${r.cup.spilledMl.toFixed(1)}ml @ ${r.spillsAt.join(',')}`,
      );
    }
    console.log(
      `안전 속도: 방지턱 ${(safeBumpSpeed(newCup()) * 3.6).toFixed(0)}km/h, 회전(25m) ${(
        safeTurnSpeed(newCup(), 25) * 3.6
      ).toFixed(0)}km/h, 한계 ${spillLimitDeg(newCup()).toFixed(1)}도, 출렁임 ${sloshHz(COFFEE_START_ML).toFixed(2)}Hz`,
    );
  });
});
