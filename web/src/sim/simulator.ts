/**
 * 차량 신호원(VehicleSignalSource)의 시뮬레이션 구현.
 *
 * 실제 차량에서는 네이티브 호스트(src/native/host.ts)가 Pleos SDK 이벤트를 신호로 바꿔 보낸다.
 * 여기서는 버튼이 그 신호를 대신 보내고, 출발하면 가상의 차가 가상의 길을 달린다 (src/app/drive.ts).
 * 길 위의 정체 구간에 들어서면 정체 신호가, 도착지에 닿으면 주차 신호가 저절로 나간다.
 * 신호마다 시뮬레이션 시계를 시나리오에 맞게 돌려서, 2분짜리 시연이 50분짜리 퇴근길처럼 기록된다.
 */
import {useSyncExternalStore} from 'react';
import {
  SCENARIOS,
  allowedSignals,
  isDrivingLocked,
  phaseOf,
  type DEMO_SCENARIOS,
  type VehicleSignal,
} from '../core/hq';
import {demoRoute} from '../core/drive';
import {HOTSPOT_LABEL, type HotspotKind} from '../core/publicdata';
import {routeOf} from '../core/realroute';
import {
  getDrive,
  holdJam,
  isTestDriving,
  placeBump,
  releaseJam,
  say,
  startDrive,
  startTestDrive as beginTestDrive,
  stopDrive,
  refreshRealDrive,
  type DriveHandlers,
} from '../app/drive';
import {getNavi, setNavi} from '../app/navi';
import {demoRealRoute, roadsideSummary} from '../app/realroute';
import {clearSdkLog, logSdkEvent, type SdkEvent} from '../app/sdkLog';
import {applyVehicleSignal, resetRelay} from '../app/signals';
import {dispatch, getState} from '../app/store';
import {advanceMinutes, now, setNow} from './clock';

export type DemoScenarioId = (typeof DEMO_SCENARIOS)[number];
type Scenario = (typeof SCENARIOS)[DemoScenarioId];

/** 신호를 보내기 전에 시계를 얼마나 돌릴지 (분). */
const MINUTES_BEFORE: Record<Exclude<VehicleSignal, 'board'>, number> = {
  depart: 2,
  'congestion-start': 13,
  'congestion-end': 18,
  park: 19,
};

/** 시나리오가 흉내 내는 실제 거리 (km)와 길의 생김새. 화면의 남은 거리는 이 거리에 맞춰 적는다. */
const TRIP: Record<DemoScenarioId, {km: number; variant: 0 | 1 | 2; pace: number}> = {
  // 실제 경로 3.1km를 그대로 달린다. 시계는 11분쯤 걸린 것으로 돌린다.
  'pangyo-commute': {km: 3.1, variant: 0, pace: 0.22},
  'commute-home': {km: 14.2, variant: 0, pace: 1},
  'commute-work': {km: 14.2, variant: 1, pace: 1},
  'weekend-trip': {km: 212, variant: 2, pace: 3.4},
};

/** 실제 차량에서 이 신호를 보낼 Pleos SDK와 API. 시뮬레이터가 대신 로그에 남긴다. */
const SDK_EVENTS: Record<VehicleSignal, (s: Scenario) => Omit<SdkEvent, 'at'>[]> = {
  board: () => [
    {sdk: 'Vehicle SDK', name: 'Gear.getCurrentGearSelectionState', detail: 'GEAR_PARK, 앱 시작'},
  ],
  depart: s => [
    {sdk: 'Vehicle SDK', name: 'GearSelectionListener.onSelected', detail: 'GEAR_PARK → GEAR_DRIVE'},
    {sdk: 'NaviHelper SDK', name: 'onRouteStarted', detail: `${s.to} 안내 시작`},
  ],
  'congestion-start': s => [
    {sdk: 'NaviHelper SDK', name: 'onRouteStateInfo', detail: `${s.road} 정체 (SLOW 이상)`},
  ],
  'congestion-end': () => [
    {sdk: 'NaviHelper SDK', name: 'onRouteStateInfo', detail: '정체 해소'},
  ],
  park: s => [
    {sdk: 'NaviHelper SDK', name: 'onDestinationArrived', detail: `${s.to} 도착`},
    {sdk: 'Vehicle SDK', name: 'GearSelectionListener.onSelected', detail: 'GEAR_DRIVE → GEAR_PARK'},
  ],
};

/** 자동 시연 중 화면 위에 띄우는 장면 자막. 시연 영상에서 지금 무슨 신호가 들어갔는지 알려준다. */
const CAPTIONS: Record<VehicleSignal, string> = {
  board: '① 탑승 · 기어 P에서 앱이 켜집니다 (Vehicle SDK)',
  depart: '② 출발 · 기어 D, 화면이 잠기고 내비 값으로 그린 지도 위를 달립니다',
  'congestion-start': '③ 정체 진입 · 같은 구간의 감자들과 익명으로 묶입니다 (NaviHelper SDK)',
  'congestion-end': '④ 정체 해소 · 운전자가 누른 것은 없습니다',
  park: '⑤ 주차 · 기어 P, 도착 화면과 작전일지 초안이 열립니다',
};

let scenario: DemoScenarioId = 'pangyo-commute';

/** 실제 경로 위에 놓는 가상의 정체 구간. 대왕판교로에 들어선 뒤다. 다른 감자와 마찬가지로 시뮬레이션이다. */
const REAL_ROUTE_JAMS = [
  {from: 640, to: 780, level: 'heavy' as const, road: '대왕판교로'},
  {from: 780, to: 880, level: 'slow' as const, road: '대왕판교로'},
];
let caption: string | null = null;
let isAutoRunning = false;
let timers: ReturnType<typeof setTimeout>[] = [];
/** 시험 주행 중 가상의 차가 정체 구간에 들어서 있다. */
let isTestJam = false;
/** 가상 운행의 도착 예정 시각 (시뮬레이션 시계). */
let arrivalAt = 0;
let version = 0;
const listeners = new Set<() => void>();
function notify() {
  version += 1;
  listeners.forEach(listener => listener());
}

const later = (ms: number, run: () => void) => {
  timers.push(setTimeout(run, ms));
};

/** 감자가 알린 사고 다발 지점을 지났다. 지점은 실제 공공 API 자료이고, 지나간 차만 가상이다. */
function passHotspot(kind: HotspotKind) {
  dispatch({type: 'hotspot', at: now(), kind});
  logSdkEvent(
    {sdk: '지도·공공데이터', name: '사고 다발 지점 통과', detail: `${HOTSPOT_LABEL[kind]} (도로교통공단 자료, 위치는 가상)`},
    now(),
  );
}

/** 가상의 차가 길 위에서 만드는 사건을 신호와 코어 사건으로 바꾼다. */
const simHandlers: DriveHandlers = {
  onBump() {
    dispatch({type: 'bump', at: now()});
    logSdkEvent(
      {sdk: 'NaviHelper SDK', name: 'onCautionPointInfo', detail: 'SPEED_BUMP 통과 (가상)'},
      now(),
    );
  },
  onHotspot: passHotspot,
  onSpill(ml) {
    dispatch({type: 'spill', at: now(), ml});
  },
  onJam(level) {
    sendSignal(level ? 'congestion-start' : 'congestion-end');
  },
  onArrive() {
    later(1500, () => sendSignal('park'));
  },
};

export function sendSignal(signal: VehicleSignal) {
  if (!allowedSignals(getState()).includes(signal)) return;
  const s = SCENARIOS[scenario];
  const trip = TRIP[scenario];

  if (signal === 'board') {
    const start = new Date(now());
    start.setHours(s.startHour, s.startMinute, 0, 0);
    // 오늘 그 시각이 이미 지났으면 시계를 되돌리지 않고 다음 날로 넘어간다.
    if (start.getTime() <= now()) start.setDate(start.getDate() + 1);
    setNow(start.getTime());
  } else {
    advanceMinutes(Math.round(MINUTES_BEFORE[signal] * (signal === 'depart' ? 1 : trip.pace)));
  }

  // 주차하면 엔진부터 멈춘다. 아직 넣지 못한 넘침이 주행 중인 운행에 들어가야 한다.
  if (signal === 'park') stopDrive();
  const after = applyVehicleSignal(signal, now(), {scenario, road: s.road});
  SDK_EVENTS[signal](s).forEach(event => logSdkEvent(event, now()));

  switch (signal) {
    case 'depart': {
      const minutes =
        (MINUTES_BEFORE['congestion-start'] + MINUTES_BEFORE['congestion-end'] + MINUTES_BEFORE.park) *
        trip.pace;
      arrivalAt = now() + minutes * 60_000;
      beginSimDrive(Boolean(after.trip?.coffee), 0);
      break;
    }
    case 'congestion-start':
      holdJam();
      break;
    case 'congestion-end':
      releaseJam();
      break;
  }

  if (isAutoRunning) {
    caption = CAPTIONS[signal];
    if (signal === 'park') isAutoRunning = false;
    notify();
  }
}

/** 가상의 차를 길 위에 세우고 달리게 한다. */
function beginSimDrive(coffee: boolean, startMeters: number) {
  const s = SCENARIOS[scenario];
  const trip = TRIP[scenario];
  // 실제 지역 시나리오는 앱에 넣어 둔 실제 경로와 공공데이터의 방지턱 위를 달린다.
  const real = scenario === 'pangyo-commute' ? demoRealRoute() : null;
  startDrive({
    source: 'sim',
    route: real
      ? routeOf(real, {jams: REAL_ROUTE_JAMS})
      : demoRoute(trip.variant, {first: `${s.road.split(' ')[0]} 방면`, last: `${s.to} 방면`}),
    control: 'driver',
    coffee,
    // 커피 운송작전에 고른 컵. 고르지 않았으면 기본 컵이다.
    cup: getState().trip?.cup ?? null,
    destination: s.to,
    roadName: s.road,
    startMeters,
    real: real ? {route: real, offset: 0, scale: 1} : null,
    // 가상의 길은 880m가 시나리오의 실제 거리를 대신하고, 실제 경로는 남은 거리를 그대로 적는다.
    remain: (meters, total) => ({
      meters: real ? total - meters : trip.km * 1000 * (1 - meters / total),
      seconds: Math.max(60, (arrivalAt - now()) / 1000),
    }),
    handlers: simHandlers,
  });
  if (real && startMeters === 0)
    logSdkEvent(
      {
        sdk: '지도·공공데이터',
        name: '앱에 넣어 둔 경로',
        detail: `${s.from} → ${s.to} ${Math.round(real.line.total)}m, ${roadsideSummary(real)}`,
      },
      now(),
    );
}

/**
 * 주행 중에 화면을 새로 고쳤으면 가상의 차를 다시 세운다.
 * 정체 중이었으면 정체 구간 안에서, 아니면 출발지에서 시작한다.
 */
export function resumeDrive() {
  const trip = getState().trip;
  if (!trip || !isDrivingLocked(getState()) || getDrive() || trip.scenario === 'drive') return;
  scenario = trip.scenario;
  arrivalAt = now() + 20 * 60_000;
  beginSimDrive(trip.coffee, trip.phase !== 'congested' ? 0 : scenario === 'pangyo-commute' ? 660 : 478);
  notify();
}

/**
 * 정체 신호를 시험 값으로 넣는다.
 *
 * 실제 차량(에뮬레이터)에 연결돼 있어도 쓸 수 있다. Pleos Connect 에뮬레이터의 Virtual Console은
 * 기어는 바꿀 수 있지만 내비 경로 위 정체는 만들지 못하기 때문이다.
 * 로그에는 실제 SDK 이벤트가 아니라 시험 값이라고 남긴다.
 */
export function sendTestCongestion(signal: 'congestion-start' | 'congestion-end', road = '') {
  if (!allowedSignals(getState()).includes(signal)) return;
  // 길 이름은 내비가 알려준 정체 구간의 것을 쓴다. 모르면 비워 둔다.
  applyVehicleSignal(signal, now(), {
    road: road || getState().trip?.road || getNavi()?.jamsAhead?.find(jam => jam.road)?.road || '',
  });
  if (signal === 'congestion-start') holdJam();
  else releaseJam();
  logSdkEvent(
    {
      sdk: 'NaviHelper SDK',
      name: '시험 값',
      detail: signal === 'congestion-start' ? '정체 진입 (직접 넣음)' : '정체 해소 (직접 넣음)',
    },
    now(),
  );
}

/**
 * 과속방지턱 하나를 시험 값으로 넣는다. 주행 중에만 받는다.
 * 실제 차량에서는 NaviHelper 의 주의 지점 정보(SPEED_BUMP)에서 온다.
 */
export function sendTestBump() {
  if (!isDrivingLocked(getState())) return;
  // 가상의 차가 달리는 중이면 70m 앞 길 위에 방지턱을 놓는다. 넘을 때 수가 세어지고 컵이 반응한다.
  if (placeBump()) {
    logSdkEvent({sdk: 'NaviHelper SDK', name: '시험 값', detail: '과속방지턱을 70m 앞에 놓음'}, now());
    return;
  }
  dispatch({type: 'bump', at: now()});
  logSdkEvent({sdk: 'NaviHelper SDK', name: '시험 값', detail: '과속방지턱 통과 (직접 넣음)'}, now());
}

/** 실제 차량에서 커피가 넘쳤을 때. 넘친 양만 코어에 넣는다. 방지턱과 정체는 내비가 직접 알려준다. */
export const realHandlers: DriveHandlers = {
  onSpill(ml) {
    dispatch({type: 'spill', at: now(), ml});
  },
};

/**
 * 시험 주행. 실제 차량(에뮬레이터)에서 기어가 D일 때, 내비가 준 길 위를 가상의 차로 달려 본다.
 * 에뮬레이터의 차는 제자리에 서 있어서 지도와 컵이 움직이는 모습을 볼 수 없기 때문이다.
 */
export function startTestDrive() {
  if (!isDrivingLocked(getState())) return;
  beginTestDrive({
    onBump() {
      dispatch({type: 'bump', at: now()});
      logSdkEvent({sdk: 'NaviHelper SDK', name: '시험 값', detail: '과속방지턱 통과 (시험 주행)'}, now());
    },
    onSpill: realHandlers.onSpill,
    onHotspot: passHotspot,
    onJam(level, road) {
      isTestJam = level !== null;
      sendTestCongestion(level ? 'congestion-start' : 'congestion-end', road);
    },
    onArrive() {
      say('목적지 부근입니다. 시험 주행을 마칩니다.');
      later(4000, stopTestDrive);
    },
  });
  logSdkEvent({sdk: 'NaviHelper SDK', name: '시험 값', detail: '시험 주행 시작 (위치만 가상)'}, now());
  notify();
}

/** 시험 주행을 멈추고 내비가 알려주는 실제 위치로 돌아간다. */
export function stopTestDrive() {
  // 가상의 차가 들어선 정체는 시험 주행과 함께 끝난다.
  if (isTestJam) sendTestCongestion('congestion-end');
  isTestJam = false;
  stopDrive();
  refreshRealDrive(realHandlers);
  notify();
}

export function chooseScenario(next: DemoScenarioId) {
  if (phaseOf(getState()) !== 'idle') return;
  scenario = next;
  notify();
}

/** 탑승하고 출발한다. 그 뒤로는 가상의 차가 길을 달리며 정체와 주차 신호를 스스로 낸다. 전체 약 2분. */
export function startAutoDemo() {
  if (isAutoRunning || phaseOf(getState()) !== 'idle') return;
  isAutoRunning = true;
  sendSignal('board');
  later(4000, () => sendSignal('depart'));
  notify();
}

export function stopAutoDemo() {
  timers.forEach(clearTimeout);
  timers = [];
  isAutoRunning = false;
  caption = null;
  notify();
}

/** 가상 차량의 기어. 속도는 주행 화면의 지도에 나온다. */
export function virtualCluster(phase: ReturnType<typeof phaseOf>): string {
  return phase === 'driving' || phase === 'congested' ? '기어 D' : '기어 P';
}

/** 전체 삭제 때 예약된 가상 사건과 로그를 모두 지운다. */
export function resetSimulator() {
  stopAutoDemo();
  stopDrive();
  resetRelay();
  clearSdkLog();
  setNavi(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSimulator() {
  useSyncExternalStore(subscribe, () => version);
  return {scenario, caption, isAutoDemoRunning: isAutoRunning, isTestDriving: isTestDriving()};
}
