import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import pangyo from '../data/pangyo-route.json';
import type {Route} from '../core/drive';
import {pointAt} from '../core/geo';
import {fromBundled, routeOf, type RealRoute} from '../core/realroute';
import {
  alongReal,
  attachRealRoute,
  feedVehicleSpeed,
  getDrive,
  getNaviReal,
  isDeadReckoning,
  say,
  setSpeaker,
  startDrive,
  stopDrive,
  syncNavi,
} from './drive';
import type {NaviSnapshot} from './navi';

/** 2km 길. 300~600m가 내비가 막힌다고 한 구간이다. */
const ROUTE: Route = {
  totalMeters: 2000,
  turns: [],
  bumps: [],
  grades: [],
  jams: [{from: 300, to: 600, level: 'heavy', road: '시험로'}],
};

const navi = (remainMeters: number): NaviSnapshot => ({
  isReal: true,
  destination: '시험 도착지',
  totalMeters: 2000,
  remainMeters,
  remainSeconds: 600,
  next: null,
  traffic: [],
  bumpsAheadMeters: [],
  jamsAhead: [{from: 300 - (2000 - remainMeters), to: 600 - (2000 - remainMeters), level: 'heavy', road: '시험로'}],
});

/** 차량 속도 mps를 1초에 10번 넣으며 seconds초 보낸다. */
function drive(seconds: number, mps: number) {
  for (let i = 0; i < seconds * 10; i++) {
    feedVehicleSpeed(mps);
    vi.advanceTimersByTime(100);
  }
}

const meters = () => getDrive()?.meters ?? NaN;

describe('실제 차량: 차량 속도로 길 위를 나아가기', () => {
  const onJam = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers({toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance']});
    onJam.mockReset();
    syncNavi(navi(2000));
    startDrive({
      source: 'navi',
      route: ROUTE,
      control: 'measured',
      coffee: false,
      destination: '시험 도착지',
      hasGuidance: true,
      handlers: {onJam},
    });
  });

  afterEach(() => {
    stopDrive();
    syncNavi(null);
    vi.useRealTimers();
  });

  it('차량 속도 10m/s로 10초 가면 100m쯤 나아가고, 속도의 출처를 차량으로 적는다', () => {
    drive(10, 10);
    expect(meters()).toBeGreaterThan(97);
    expect(meters()).toBeLessThan(103);
    expect(getDrive()?.speedFrom).toBe('vehicle');
    expect(getDrive()?.speed).toBeCloseTo(10, 6);
  });

  it('내비의 위치가 그대로이면 내비가 다시 알려줘도 처음 자리로 돌아가지 않는다', () => {
    drive(10, 10);
    syncNavi(navi(2000));
    drive(1, 10);
    expect(meters()).toBeGreaterThan(105);
  });

  it('내비의 위치가 움직이면 그 위치로 맞춘다', () => {
    drive(10, 10);
    syncNavi(navi(1850));
    vi.advanceTimersByTime(40);
    expect(meters()).toBeGreaterThan(149);
    expect(meters()).toBeLessThan(152);
  });

  it('내비가 7초 넘게 그대로이고 차량 속도가 오면 위치를 어림하는 중이다', () => {
    drive(3, 10);
    expect(isDeadReckoning()).toBe(false);
    drive(5, 10);
    expect(isDeadReckoning()).toBe(true);
  });

  it('차량 속도가 끊기면 내비가 알려준 속도로 돌아간다 (내비가 서 있으면 멈춘다)', () => {
    drive(5, 10);
    const at = meters();
    vi.advanceTimersByTime(3000);
    expect(getDrive()?.speedFrom).toBe('navi');
    expect(meters()).toBeLessThan(at + 16);
    vi.advanceTimersByTime(3000);
    expect(meters() - at).toBeLessThan(16);
  });

  it('막힌다고 한 구간이라도 빠르게 지나가면 정체로 보지 않는다', () => {
    drive(35, 10);
    expect(meters()).toBeGreaterThan(340);
    expect(onJam).not.toHaveBeenCalled();
  });

  it('막힌다고 한 구간에서 2.5초 넘게 시속 15km보다 느리면 정체로 보고, 4초 넘게 빨라지면 풀린다', () => {
    drive(32, 10);
    drive(2, 2);
    expect(onJam).not.toHaveBeenCalled();
    drive(1.5, 2);
    expect(onJam).toHaveBeenCalledTimes(1);
    expect(onJam).toHaveBeenLastCalledWith('heavy', '시험로');
    drive(3, 10);
    expect(onJam).toHaveBeenCalledTimes(1);
    drive(1.5, 10);
    expect(onJam).toHaveBeenCalledTimes(2);
    // 아직 그 구간 안에서 풀렸으므로 길 이름은 그 구간의 것이다.
    expect(onJam).toHaveBeenLastCalledWith(null, '시험로');
  });
});

/** 내비가 알려 준 대로만 움직이는 실제 차량 (차량 속도 신호 없음). 방지턱은 300m에 하나. */
describe('실제 차량: 내비 위치를 따라갈 때 방지턱 세기', () => {
  const onBump = vi.fn();
  const at = (traveled: number): NaviSnapshot => ({
    isReal: true,
    destination: '시험 도착지',
    totalMeters: 2000,
    remainMeters: 2000 - traveled,
    remainSeconds: 600,
    next: null,
    traffic: [],
    bumpsAheadMeters: traveled < 300 ? [300 - traveled] : [],
  });

  beforeEach(() => {
    vi.useFakeTimers({toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance']});
    onBump.mockReset();
    syncNavi(at(0));
    startDrive({
      source: 'navi',
      route: {...ROUTE, jams: [], bumps: [300]},
      control: 'measured',
      coffee: false,
      destination: '시험 도착지',
      handlers: {onBump},
    });
  });

  afterEach(() => {
    stopDrive();
    syncNavi(null);
    vi.useRealTimers();
  });

  it('내비가 조금 뒤로 고쳐 알려 줘서 같은 방지턱을 다시 지나도 한 번만 센다', () => {
    for (const traveled of [50, 100, 150, 200, 250, 310, 295, 340, 390]) {
      vi.advanceTimersByTime(5000);
      syncNavi(at(traveled));
    }
    vi.advanceTimersByTime(2000);
    expect(onBump).toHaveBeenCalledTimes(1);
  });

  it('내비의 위치가 방지턱을 건너뛰어 앞으로 가도 지나온 것으로 센다', () => {
    vi.advanceTimersByTime(5000);
    syncNavi(at(250));
    vi.advanceTimersByTime(200);
    syncNavi(at(420));
    vi.advanceTimersByTime(100);
    expect(onBump).toHaveBeenCalledTimes(1);
  });
});

describe('받아 온 실제 경로를 주행 엔진의 거리에 맞추기', () => {
  const real = fromBundled(pangyo);
  const snapshot = (traveled: number, position: [number, number] | null): NaviSnapshot => ({
    isReal: true,
    destination: '삼평동',
    totalMeters: 2900,
    remainMeters: 2900 - traveled,
    remainSeconds: 600,
    next: null,
    traffic: [],
    bumpsAheadMeters: [],
    position: position ? {lng: position[0], lat: position[1]} : null,
  });

  beforeEach(() => {
    vi.useFakeTimers({toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance']});
  });

  afterEach(() => {
    syncNavi(null);
    vi.useRealTimers();
  });

  it('지금 위치가 길 위의 520m 지점이고 내비가 500m 왔다고 하면, 500m를 길 위의 520m에 맞춘다', () => {
    const here = pointAt(real.line, 520).at;
    syncNavi(snapshot(500, [here[0], here[1]]));
    expect(attachRealRoute(real)).toBe(true);
    const attach = getNaviReal()!;
    expect(alongReal(attach, 500)).toBeGreaterThan(517);
    expect(alongReal(attach, 500)).toBeLessThan(523);
    // 남은 거리도 맞는다: 엔진의 2900m는 길의 끝이다.
    expect(alongReal(attach, 2900)).toBeCloseTo(real.line.total, 0);
  });

  it('지금 위치를 모르면 요청할 때 달린 거리를 길의 출발점으로 본다', () => {
    syncNavi(snapshot(0, null));
    vi.advanceTimersByTime(3000);
    syncNavi(snapshot(40, null));
    expect(attachRealRoute(real, 0)).toBe(true);
    expect(alongReal(getNaviReal()!, 0)).toBeCloseTo(0, 3);
  });

  it('지금 위치가 받아 온 길에서 200m 떨어져 있으면 다른 길로 보고 쓰지 않는다', () => {
    const here = pointAt(real.line, 520).at;
    syncNavi(snapshot(500, [here[0], here[1] + 200 / 111_195]));
    expect(attachRealRoute(real)).toBe(false);
    expect(getNaviReal()).toBeNull();
  });

  it('내비가 경로를 다시 짜서 전체 거리가 바뀌면 붙여 둔 실제 경로를 뗀다', () => {
    const here = pointAt(real.line, 0).at;
    syncNavi(snapshot(0, [here[0], here[1]]));
    expect(attachRealRoute(real)).toBe(true);
    syncNavi({...snapshot(0, [here[0], here[1]]), totalMeters: 3600, remainMeters: 3600});
    expect(getNaviReal()).toBeNull();
  });
});

/**
 * 시흥동 → 삼평동 실제 경로에, 400m에 보행 어린이 사고 다발 지점(반지름 100m, 경로가 300~500m에서 지난다)과
 * 2,000m에 커피 매장이 있는 휴게소를 얹는다.
 */
function roadside(): RealRoute {
  const base = fromBundled(pangyo);
  return {
    ...base,
    hotspots: [{at: 400, from: 300, to: 500, kind: 'child', name: '시험 지점', center: pointAt(base.line, 400).at, radiusM: 100}],
    restAreas: [{at: 2000, name: '시험', coffee: ['스타벅스']}],
  };
}

const HOTSPOT_LINE = '사령관님! 어린이 교통사고가 잦은 곳입니다. 살펴 가겠습니다.';

describe('길가의 공공 API 자료: 사고 다발 지점과 휴게소', () => {
  const said: [string, boolean][] = [];
  const onHotspot = vi.fn();
  const warnings = () => said.filter(([text]) => text.includes('어린이'));

  beforeEach(() => {
    vi.useFakeTimers({toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance']});
    said.length = 0;
    onHotspot.mockReset();
    setSpeaker((text, urgent) => said.push([text, urgent]));
    const real = roadside();
    startDrive({
      source: 'sim',
      route: routeOf(real),
      control: 'driver',
      coffee: false,
      destination: '삼평동',
      real: {route: real, offset: 0, scale: 1},
      handlers: {onHotspot},
    });
  });

  afterEach(() => {
    stopDrive();
    setSpeaker(() => {});
    vi.useRealTimers();
  });

  /** 가상 운전자가 meters를 넘을 때까지 달린다. */
  const driveTo = (meters: number) => {
    for (let i = 0; i < 6000 && (getDrive()?.meters ?? 0) < meters; i++) vi.advanceTimersByTime(100);
    expect(getDrive()?.meters).toBeGreaterThanOrEqual(meters);
  };

  it('사고 다발 지점은 범위에 들어서기 100m쯤 앞에서 안전 경고로 한 번 알리고, 한가운데를 지나면 한 번 센다', () => {
    driveTo(150);
    expect(warnings()).toHaveLength(0);
    // 범위는 300m에서 시작한다. 한가운데(400m)가 아니라 범위에 들어서기 앞에서 알린다.
    driveTo(205);
    expect(warnings()).toEqual([[HOTSPOT_LINE, true]]);
    driveTo(395);
    expect(onHotspot).not.toHaveBeenCalled();
    driveTo(405);
    expect(onHotspot).toHaveBeenCalledTimes(1);
    expect(onHotspot).toHaveBeenCalledWith('child');
    driveTo(700);
    expect(warnings()).toHaveLength(1);
    expect(onHotspot).toHaveBeenCalledTimes(1);
  });

  it('커피 매장이 있는 휴게소는 3km 앞에서 한 번, 안전 경고가 아닌 보통 말로 알린다', () => {
    // 휴게소가 2,000m에 있어 출발하자마자 3km 안이다.
    vi.advanceTimersByTime(100);
    expect(said).toContainEqual(['다음 시험휴게소에 커피 매장이 있어.', false]);
    driveTo(1200);
    expect(said.filter(([text]) => text.includes('휴게소'))).toHaveLength(1);
  });
});

describe('길가의 공공 API 자료: 실제 차량에서 내비 위치가 건너뛸 때', () => {
  const onHotspot = vi.fn();
  const said: [string, boolean][] = [];
  const warnings = () => said.filter(([text]) => text.includes('어린이'));
  const navi = (traveled: number): NaviSnapshot => ({
    isReal: true,
    destination: '삼평동',
    totalMeters: 2900,
    remainMeters: 2900 - traveled,
    remainSeconds: 600,
    next: null,
    traffic: [],
    bumpsAheadMeters: [],
    position: null,
  });

  beforeEach(() => {
    vi.useFakeTimers({toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance']});
    onHotspot.mockReset();
    said.length = 0;
    setSpeaker((text, urgent) => said.push([text, urgent]));
    syncNavi(navi(0));
    startDrive({
      source: 'navi',
      route: {...ROUTE, totalMeters: 2900, jams: []},
      control: 'measured',
      coffee: false,
      destination: '삼평동',
      handlers: {onHotspot},
    });
    expect(attachRealRoute(roadside(), 0)).toBe(true);
  });

  afterEach(() => {
    stopDrive();
    syncNavi(null);
    vi.useRealTimers();
  });

  it('미리 알린 지점을 내비의 위치가 건너뛰어 앞으로 가도 지나온 것으로 한 번 센다', () => {
    vi.advanceTimersByTime(5000);
    syncNavi(navi(250));
    vi.advanceTimersByTime(100);
    // 250m에서 범위(300m~)가 코앞이라 이미 알렸다.
    expect(warnings()).toEqual([[HOTSPOT_LINE, true]]);
    expect(onHotspot).not.toHaveBeenCalled();
    syncNavi(navi(700));
    vi.advanceTimersByTime(100);
    syncNavi(navi(650));
    vi.advanceTimersByTime(3000);
    expect(onHotspot).toHaveBeenCalledTimes(1);
    expect(onHotspot).toHaveBeenCalledWith('child');
  });

  it('알리기 전에 내비의 위치가 지점을 건너뛰면 알리지 않았으므로 세지 않는다', () => {
    vi.advanceTimersByTime(5000);
    syncNavi(navi(700));
    vi.advanceTimersByTime(3000);
    expect(warnings()).toEqual([]);
    expect(onHotspot).not.toHaveBeenCalled();
  });
});

describe('길가의 공공 API 자료: 커피 운송작전의 방지턱 경고와 겹칠 때', () => {
  const said: [string, boolean][] = [];

  beforeEach(() => {
    vi.useFakeTimers({toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance']});
    said.length = 0;
    setSpeaker((text, urgent) => said.push([text, urgent]));
  });

  afterEach(() => {
    stopDrive();
    setSpeaker(() => {});
    vi.useRealTimers();
  });

  /** 차량 속도 10m/s로 meters를 넘을 때까지 달린다. */
  const cruiseTo = (meters: number) => {
    for (let i = 0; i < 2000 && (getDrive()?.meters ?? 0) < meters; i++) {
      feedVehicleSpeed(10);
      vi.advanceTimersByTime(100);
    }
    expect(getDrive()?.meters).toBeGreaterThanOrEqual(meters);
  };

  it('방지턱 경고가 곧 나와야 하면 사고 다발 지점 경고는 방지턱 경고 뒤에 한다', () => {
    // 사고 다발 지점 범위는 300m부터, 방지턱은 그 앞 260m에 있다.
    const real = roadside();
    startDrive({
      source: 'navi',
      route: {...routeOf(real), bumps: [260]},
      control: 'measured',
      coffee: true,
      destination: '삼평동',
      real: {route: real, offset: 0, scale: 1},
    });
    cruiseTo(320);
    const order = said.map(([text]) => (text.includes('방지턱') ? 'bump' : text.includes('어린이') ? 'hotspot' : 'other'));
    expect(order.filter(kind => kind !== 'other')).toEqual(['bump', 'hotspot']);
    expect(said.filter(([text]) => text.includes('방지턱') || text.includes('어린이')).every(([, urgent]) => urgent)).toBe(true);
  });
});

describe('주행 화면에 띄우는 감자의 말', () => {
  beforeEach(() => {
    vi.useFakeTimers({toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance']});
    setSpeaker(() => {});
    startDrive({source: 'sim', route: {...ROUTE, jams: []}, control: 'driver', coffee: false, destination: '시험 도착지'});
  });

  afterEach(() => {
    stopDrive();
    vi.useRealTimers();
  });

  it('떠 있는 안전 경고는 보통 말이 덮지 않고, 경고가 사라진 뒤의 보통 말은 뜬다', () => {
    say('사령관님! 전방에 방지턱입니다. 속도를 줄여 주십시오!', true);
    say('앗! 커피가 넘쳤습니다. 조금만 살살 가 주십시오!');
    vi.advanceTimersByTime(100);
    expect(getDrive()?.note).toBe('사령관님! 전방에 방지턱입니다. 속도를 줄여 주십시오!');
    // 안전 경고는 안전 경고가 덮는다.
    say(HOTSPOT_LINE, true);
    vi.advanceTimersByTime(100);
    expect(getDrive()?.note).toBe(HOTSPOT_LINE);
    vi.advanceTimersByTime(5000);
    say('다음 시험휴게소에 커피 매장이 있어.');
    vi.advanceTimersByTime(100);
    expect(getDrive()?.note).toBe('다음 시험휴게소에 커피 매장이 있어.');
  });
});
