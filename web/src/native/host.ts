/**
 * 네이티브 호스트와의 다리.
 *
 * Android 앱(android/)이 이 웹앱을 WebView에 띄우면 `window.PleosHost`가 생긴다.
 * 네이티브는 Pleos SDK 이벤트를 받아 `window.gamjaHq.receive(json)`으로 넘기고,
 * 웹은 `window.PleosHost.speak(text)`로 TextToSpeech SDK에 말을 맡긴다.
 * 커피를 말로 물을 때는 `window.PleosHost.listen()`으로 SpeechToText SDK에 듣기를 맡기고,
 * 들은 말은 `{type: 'stt', ...}` 메시지로 받는다 (app/cupQuestion.ts).
 * 브라우저에서 열면 `window.PleosHost`가 없으므로 시뮬레이터가 신호원이 된다.
 */
import {useSyncExternalStore} from 'react';
import type {LngLat} from '../core/geo';
import {phaseOf, type VehicleSignal} from '../core/hq';
import {HOTSPOT_LABEL} from '../core/publicdata';
import {
  feedMotion,
  feedVehicleSpeed,
  getDrive,
  isDeadReckoning,
  refreshRealDrive,
  stopDrive,
  syncNavi,
  type DriveHandlers,
} from '../app/drive';
import {setNavi, type NaviSnapshot} from '../app/navi';
import {ensureRealRoute} from '../app/realroute';
import {logSdkEvent, type SdkEvent} from '../app/sdkLog';
import {applyVehicleSignal} from '../app/signals';
import {dispatch, getState} from '../app/store';
import {setRealTime} from '../sim/clock';
import {readHostSpeech, type HostSpeech} from './hostSpeech';

export type {HostSpeech} from './hostSpeech';

interface PleosHost {
  /** 웹이 메시지를 받을 준비가 됐다고 알린다. */
  ready(): void;
  /** 한 문장을 차량 스피커로 말한다. 하던 말이 있으면 끝난 뒤에 말한다. */
  speak(text: string): void;
  /** 안전 경고. 기다리는 보통 말보다 먼저 말한다. 예전 APK 에는 없다. */
  speakFirst?(text: string): void;
  /** 기다리는 말을 버리고 하던 말을 멈춘다. 주차했거나 음성 안내를 껐을 때. 예전 APK 에는 없다. */
  stopSpeaking?(): void;
  /**
   * 주차한 채(기어 P)에서만 하는 보통 말 (커피 묻기의 질문). 네이티브가 기어 P 를 확인했을 때만 말하고,
   * 말하기 전이나 말하는 중에 P 를 벗어나면 버리거나 멈춘다. 예전 APK 에는 없다.
   */
  speakWhileParked?(text: string): void;
  /** 한 문장을 거둔다. 기다리던 그 말을 버리고, 하는 중이면 멈추고 다음 말로 넘어간다. 예전 APK 에는 없다. */
  unspeak?(text: string): void;
  /** 내비의 경로 옵션을 '편안한 길'로 바꿔 달라고 청한다. */
  preferComfortRoute(): void;
  /** SpeechToText SDK로 한 번 듣는다. 결과는 {type: 'stt'} 메시지로 온다. 예전 APK 에는 없다. */
  listen?(): void;
  /** 듣기를 멈춘다. 예전 APK 에는 없다. */
  stopListening?(): void;
}

declare global {
  interface Window {
    PleosHost?: PleosHost;
    gamjaHq?: {receive(json: string): void};
  }
}

/** 네이티브가 보내는 메시지. android/…/WebBridge.kt와 짝을 이룬다. */
type HostMessage =
  | {type: 'signal'; signal: VehicleSignal; road?: string}
  | {type: 'trip-info'; from?: string; to?: string; road?: string}
  | {type: 'bump'}
  /** 내비 안내 상태. active가 false면 안내가 없다. */
  | ({type: 'navi'; active: true} & Omit<NaviSnapshot, 'isReal'>)
  | {type: 'navi'; active: false}
  /** 차량(헤드유닛) 가속도 센서 값. 기기 좌표계의 m/s². */
  | {type: 'motion'; x: number; y: number; z: number}
  /** 차량 속도 (Android Automotive PERF_VEHICLE_SPEED). m/s. */
  | {type: 'speed'; mps: number}
  /** stt, sttServer, parked 는 SpeechToText SDK 를 넣은 APK 부터 온다. 예전 APK 에서는 없다. */
  | {
      type: 'status';
      vehicle: boolean;
      navi: boolean;
      tts: boolean;
      serverVoice?: boolean;
      stt?: boolean;
      sttServer?: boolean;
      parked?: boolean;
    }
  | {type: 'sdk-event'; sdk: SdkEvent['sdk']; name: string; detail: string}
  /** SpeechToText SDK 가 들은 것. listen() 뒤에만 온다. 모양은 native/hostSpeech.ts. */
  | ({type: 'stt'} & HostSpeech);

export interface HostStatus {
  /** Android 앱 안에서 돌고 있다. */
  isNative: boolean;
  /** Vehicle SDK 연결 여부. 기어 변화를 받는다. */
  vehicle: boolean;
  /** NaviHelper SDK 연결 여부. 목적지, 도착, 정체를 받는다. */
  navi: boolean;
  /** TextToSpeech SDK 연결 여부. */
  tts: boolean;
  /** Pleos 서버 음성에 연결됐는가. false 면 차량 내장 엔진으로 말한다. */
  serverVoice: boolean;
  /** SpeechToText SDK 연결 여부. 커피를 말로 물을 때 쓴다. */
  stt: boolean;
  /** SpeechToText 가 Pleos 서버 인식에 등록됐는가. false 면 차량 내장 엔진(ON_DEVICE)으로 듣는다. */
  sttServer: boolean;
  /**
   * Vehicle SDK 가 기어 P 를 읽었다. 기어를 아직 모르거나 P 가 아니면 false. 기어가 바뀔 때마다 다시 온다.
   * 커피 묻기는 Android 앱에서 이 값이 true 일 때만 묻고 듣는다 (isParkConfirmed).
   */
  parked: boolean;
}

const host = typeof window !== 'undefined' ? window.PleosHost : undefined;

/**
 * 내비가 마지막으로 알려준 차의 위치. 출발과 주차 신호에 실어, 날씨와 해 지는 시각을
 * 앱에 넣어 둔 자료의 지역 안에서만 붙이게 한다. 이 기기의 메모리에만 두고 저장하지 않는다.
 * 주차한 차는 움직이지 않으므로, 다음 출발 때도 이 위치가 출발지다.
 */
let lastPosition: LngLat | null = null;

let status: HostStatus = {
  isNative: host !== undefined,
  vehicle: false,
  navi: false,
  tts: false,
  serverVoice: false,
  stt: false,
  sttServer: false,
  parked: false,
};
const listeners = new Set<() => void>();
const speechListeners = new Set<(speech: HostSpeech) => void>();

/** 실제 차량 신호를 받고 있는가. 기어 신호가 있어야 출발과 주차를 안다. */
export function hasRealSignals(s: HostStatus = status): boolean {
  return s.isNative && s.vehicle;
}

/**
 * 차가 주차한 채(기어 P)라고 확인됐는가. 커피 묻기가 묻고 듣기 전에 본다 (app/cupQuestion.ts).
 * - Android 앱: Vehicle SDK 가 기어 P 를 읽었을 때만 true. 웹의 운행 단계가 대기·탑승이어도, 기어를 아직 모르거나
 *   Vehicle SDK 가 없으면 차가 움직이는 중일 수 있어 false 다.
 * - 브라우저: 시뮬레이터가 차량 신호원이라 웹의 운행 단계가 곧 기어다. 늘 true.
 */
export function isParkConfirmed(s: HostStatus = status): boolean {
  return !s.isNative || (s.vehicle && s.parked);
}

export function getHostStatus(): HostStatus {
  return status;
}

/**
 * 실제 차량에서 주행 엔진이 알려주는 사건.
 * - 넘침: 컵 모형이 계산한다.
 * - 방지턱: 길 위의 방지턱(내비의 주의 지점 + 공공데이터)을 넘을 때 센다. 내비가 보내는 'bump'는 주행 엔진이 돌 때는 세지 않는다.
 * - 사고 다발 지점: 실제 경로 위의 지점(한국도로교통공단 자료)을 감자가 알리고 지나갈 때 센다.
 * - 정체: 내비가 알려준 정체 구간에 차가 들어섰을 때. 내비의 위치가 멈춰 있고 차량 속도로 위치를 어림할 때만 쓴다.
 *   내비가 움직이는 실제 주행에서는 네이티브의 정체 판정(CongestionDetector)이 신호를 보낸다.
 */
const driveHandlers: DriveHandlers = {
  onSpill(ml) {
    dispatch({type: 'spill', at: Date.now(), ml});
  },
  onBump() {
    dispatch({type: 'bump', at: Date.now()});
    logSdkEvent({sdk: '지도·공공데이터', name: '과속방지턱 통과', detail: '길 위의 방지턱을 넘음'});
  },
  onHotspot(kind) {
    dispatch({type: 'hotspot', at: Date.now(), kind});
    logSdkEvent({sdk: '지도·공공데이터', name: '사고 다발 지점 통과', detail: `${HOTSPOT_LABEL[kind]} (도로교통공단 자료)`});
  },
  onJam(level, road) {
    if (!isDeadReckoning()) return;
    const signal = level ? 'congestion-start' : 'congestion-end';
    applyVehicleSignal(signal, Date.now(), {road: road || undefined});
    logSdkEvent({
      sdk: 'NaviHelper SDK',
      name: 'onRouteStateInfo',
      detail: level ? `${road || '경로 위'} 정체 구간에 들어섬 (차량 속도로 어림한 위치)` : '정체 구간을 벗어남',
    });
  },
};

function receiveSignal(signal: VehicleSignal, road?: string) {
  const at = Date.now();
  // 주차하면 엔진부터 멈춘다. 아직 넣지 못한 넘침이 주행 중인 운행에 들어가야 한다.
  if (signal === 'park') stopDrive();
  // 작전 결과를 닫지 않고 다시 출발하면, 지난 운행의 일지를 저장하고 새 운행을 시작한다.
  if ((signal === 'board' || signal === 'depart') && phaseOf(getState()) === 'parked')
    dispatch({type: 'finish-trip', at, save: true});
  // 대기 중에 기어가 바로 D로 가면 탑승을 건너뛴 것이다. 탑승부터 넣는다.
  if (signal === 'depart' && phaseOf(getState()) === 'idle') applyVehicleSignal('board', at);
  applyVehicleSignal(signal, at, {road, where: lastPosition});
  refreshRealDrive(driveHandlers);
}

function receive(json: string) {
  let message: HostMessage;
  try {
    message = JSON.parse(json) as HostMessage;
  } catch {
    return;
  }
  switch (message.type) {
    case 'signal':
      receiveSignal(message.signal, message.road);
      break;
    case 'trip-info':
      dispatch({type: 'trip-info', from: message.from, to: message.to, road: message.road});
      break;
    case 'bump':
      // 주행 엔진이 돌고 있으면 길 위의 방지턱을 넘을 때 센다. 두 번 세지 않는다.
      if (getDrive() === null) dispatch({type: 'bump', at: Date.now()});
      break;
    case 'navi':
      if (message.active) {
        const {type: _type, active: _active, ...rest} = message;
        if (rest.position) lastPosition = [rest.position.lng, rest.position.lat];
        setNavi({...rest, isReal: true});
        syncNavi({...rest, isReal: true});
        ensureRealRoute({...rest, isReal: true});
      } else {
        setNavi(null);
        syncNavi(null);
        ensureRealRoute(null);
      }
      break;
    case 'motion':
      feedMotion(message.x, message.y, message.z);
      break;
    case 'speed':
      feedVehicleSpeed(message.mps);
      break;
    case 'status':
      status = {
        isNative: true,
        vehicle: message.vehicle,
        navi: message.navi,
        tts: message.tts,
        serverVoice: message.serverVoice ?? false,
        stt: message.stt ?? false,
        sttServer: message.sttServer ?? false,
        parked: message.parked ?? false,
      };
      setRealTime(hasRealSignals(status));
      listeners.forEach(listener => listener());
      break;
    case 'sdk-event':
      logSdkEvent({sdk: message.sdk, name: message.name, detail: message.detail});
      break;
    case 'stt': {
      // SDK 이벤트 로그는 네이티브가 'sdk-event'로 따로 남긴다. 들은 문장은 로그에 남기지 않는다.
      const speech = readHostSpeech(message as unknown as Record<string, unknown>);
      if (speech) speechListeners.forEach(listener => listener(speech));
      break;
    }
  }
}

/** 앱이 뜰 때 한 번 부른다. 네이티브가 메시지를 보낼 입구를 열고 준비됐다고 알린다. */
export function connectHost() {
  window.gamjaHq = {receive};
  host?.ready();
}

/** 커피 운송작전으로 출발할 때 부른다. 네이티브 호스트가 내비에 편안한 길을 청한다. */
export function requestComfortRoute() {
  host?.preferComfortRoute();
}

/**
 * 네이티브 호스트가 있으면 차량 스피커로 말하고 true를 돌려준다.
 * 네이티브가 말을 줄 세운다(SpeechQueue.kt). urgent 는 안전 경고다. whileParked 는 주차한 채(기어 P)에서만
 * 하는 말로, 네이티브가 기어 P 를 확인했을 때만 말하고 P 를 벗어나면 버리거나 멈춘다 (커피 묻기의 질문).
 */
export function speakOnHost(text: string, urgent = false, whileParked = false): boolean {
  if (!host || !status.tts) return false;
  if (urgent && host.speakFirst) host.speakFirst(text);
  else if (whileParked && host.speakWhileParked) host.speakWhileParked(text);
  else host.speak(text);
  return true;
}

/** 네이티브 호스트가 말하던 것을 멈추고 기다리는 말을 버린다. 호스트가 없으면 false. */
export function hushOnHost(): boolean {
  if (!host?.stopSpeaking) return false;
  host.stopSpeaking();
  return true;
}

/** 네이티브 호스트에 한 문장을 거두게 한다 (기다리면 버리고, 하는 중이면 멈춘다). 호스트가 없으면 false. */
export function unspeakOnHost(text: string): boolean {
  if (!host?.unspeak) return false;
  host.unspeak(text);
  return true;
}

/**
 * 네이티브 호스트가 SpeechToText SDK로 들을 수 있는가. 예전 APK 이거나 SDK에 연결하지 못했으면 false.
 * 네이티브는 기어 P 를 확인해야 듣는다(ListenFlow.kt). Vehicle SDK 가 없거나 기어 P 를 확인하지 못했으면 false.
 */
export function canListenOnHost(): boolean {
  return Boolean(host?.listen) && status.stt && isParkConfirmed(status);
}

/**
 * 네이티브 호스트에 한 번 들어 달라고 한다. 들은 것은 onHostSpeech 로 온다. 들을 수 없으면 false.
 * 주행 중에는 부르지 않는다 (app/cupQuestion.ts 가 확인한다).
 */
export function listenOnHost(): boolean {
  if (!canListenOnHost()) return false;
  host!.listen!();
  return true;
}

/** 네이티브 호스트의 듣기를 멈춘다. */
export function stopListeningOnHost() {
  host?.stopListening?.();
}

/** 네이티브 호스트가 들은 것을 받는다. 그만 받으려면 돌려준 함수를 부른다. */
export function onHostSpeech(listener: (speech: HostSpeech) => void): () => void {
  speechListeners.add(listener);
  return () => speechListeners.delete(listener);
}

/** 네이티브 호스트의 상태(HostStatus)가 바뀔 때 알린다. 그만 받으려면 돌려준 함수를 부른다. */
export function subscribeHostStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useHostStatus(): HostStatus {
  return useSyncExternalStore(subscribeHostStatus, getHostStatus);
}
