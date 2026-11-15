/**
 * 차량 신호가 코어로 들어가는 한 길.
 * 시뮬레이터와 실제 차량(네이티브 호스트)이 모두 이 함수로 신호를 넣는다.
 * 신호에 따라 교류 중계(지금은 가상 감자 부대)를 움직이는 일도 여기서 한다.
 */
import type {LngLat} from '../core/geo';
import {clock, type HqState, type ScenarioId, type VehicleSignal} from '../core/hq';
import {WEATHER_TEXT, isNearArea} from '../core/publicdata';
import {createSimulatedRelay} from '../sim/relay';
import {now} from '../sim/clock';
import {PUBLIC_DATA, sunFor, weatherNear} from './publicdata';
import {logSdkEvent} from './sdkLog';
import {dispatch} from './store';

const relay = createSimulatedRelay(event => {
  if (event.type === 'squad-matched')
    logSdkEvent(
      {sdk: '교류 서버', name: '같은 길 감자 묶기', detail: `익명 ${event.squadSize}마리 (가상)`},
      event.at,
    );
  if (event.type === 'sticker-received')
    logSdkEvent(
      {sdk: '교류 서버', name: '스티커 수신', detail: `${event.from} (가상)`},
      event.at,
    );
  return dispatch(event);
}, now);

export interface SignalDetail {
  /** 탑승 신호의 시나리오. 실제 차량은 'drive'. */
  scenario?: ScenarioId;
  /** 정체 진입 신호가 실어오는 도로 이름. */
  road?: string;
  /**
   * 신호가 났을 때 차의 자리. 날씨와 해 지는 시각은 앱에 넣어 둔 자료의 지역 안일 때만 붙인다.
   * 실제 차량은 내비가 마지막으로 알려준 위치를 넣고, 모르면 null을 넣는다 (그러면 붙이지 않는다).
   * 시뮬레이터는 넣지 않는다. 시연 경로가 자료의 지역(성남 판교 일대) 안이다.
   */
  where?: LngLat | null;
}

/** 날씨는 예보 격자(5km) 둘레까지만 같은 값으로 본다 (m). */
export const WEATHER_AREA_METERS = 10_000;
/** 해 뜨고 지는 시각은 이 안에서 몇 분 차이라 더 넓게 본다 (m). */
export const SUN_AREA_METERS = 50_000;

/** 차가 자료의 지역에서 reach 미터 안인가. 시뮬레이터(where 없음)는 늘 안이다. */
function inDataArea(where: LngLat | null | undefined, reach: number): boolean {
  return where === undefined || isNearArea(where, PUBLIC_DATA.area, reach);
}

/** "11월 15일 17시 발표". 발표 시각을 모르면 빈 문자열. */
function issuedText(): string {
  const issuedAt = PUBLIC_DATA.weather?.issuedAt;
  if (issuedAt === null || issuedAt === undefined) return '';
  const d = new Date(issuedAt);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${d.getHours()}시 발표, `;
}

/** 차량 신호 하나를 코어에 넣는다. 허용되지 않는 순서의 신호는 코어가 무시한다. */
export function applyVehicleSignal(
  signal: VehicleSignal,
  at: number,
  detail: SignalDetail = {},
): HqState {
  let after: HqState;
  switch (signal) {
    case 'board':
      after = dispatch({
        type: 'signal',
        signal,
        at,
        scenario: detail.scenario ?? 'drive',
      });
      break;
    case 'depart': {
      // 출발 시각의 날씨를 앱에 넣어 둔 단기예보에서 찾아 함께 넣는다.
      // 예보가 그 시각을 덮지 못하거나, 차가 예보 지역 밖이거나 어디인지 모르면 넣지 않는다.
      const weather = inDataArea(detail.where, WEATHER_AREA_METERS) ? weatherNear(at) : null;
      after = dispatch({type: 'signal', signal, at, weather});
      if (weather && after.trip?.weather === weather)
        logSdkEvent(
          {
            sdk: '지도·공공데이터',
            name: '기상청 단기예보',
            detail: `출발 ${clock(at)} · 예보 ${WEATHER_TEXT[weather.condition]}${
              weather.tempC === null ? '' : ` · ${weather.tempC}°C`
            } (${issuedText()}빌드 때 받은 예보)`,
          },
          at,
        );
      break;
    }
    case 'congestion-start':
      after = dispatch({type: 'signal', signal, at, road: detail.road});
      relay.enterCongestion(after);
      break;
    case 'park': {
      // 주차한 날의 해 뜨고 지는 시각을 함께 넣는다. 그림일기의 하늘과 일지의 한 줄에 쓴다.
      // 차가 자료의 지역에서 멀거나 어디인지 모르면 넣지 않는다 (그림은 주차 시각으로 하늘을 어림한다).
      const sun = inDataArea(detail.where, SUN_AREA_METERS) ? sunFor(at) : null;
      after = dispatch({type: 'signal', signal, at, sun});
      relay.park();
      if (sun && after.trip?.sun === sun)
        logSdkEvent(
          {
            sdk: '지도·공공데이터',
            name: '한국천문연구원 출몰시각',
            detail: `해 지는 시각 ${clock(sun.sunset)} (${PUBLIC_DATA.area?.name ?? '성남'} 기준)`,
          },
          at,
        );
      break;
    }
    default:
      after = dispatch({type: 'signal', signal, at});
  }
  return after;
}

/** 전체 삭제 때 예약된 가상 사건을 지운다. */
export function resetRelay() {
  relay.clear();
}
