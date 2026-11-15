/**
 * SDK 이벤트 로그.
 * 차량 신호가 어느 Pleos SDK에서 왔는지(시뮬레이션이면 어디서 올 것인지)를 최근 40건까지 둔다.
 */
import {useSyncExternalStore} from 'react';

export interface SdkEvent {
  at: number;
  sdk:
    | 'Vehicle SDK'
    | 'NaviHelper SDK'
    | 'FusedLocation SDK'
    | 'TextToSpeech SDK'
    | 'SpeechToText SDK'
    | '지도·공공데이터'
    | '교류 서버';
  name: string;
  detail: string;
}

let log: SdkEvent[] = [];
const listeners = new Set<() => void>();

export function logSdkEvent(event: Omit<SdkEvent, 'at'>, at: number = Date.now()) {
  log = [{...event, at}, ...log].slice(0, 40);
  listeners.forEach(listener => listener());
}

export function clearSdkLog() {
  log = [];
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSdkLog(): SdkEvent[] {
  return useSyncExternalStore(subscribe, () => log);
}
