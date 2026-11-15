/**
 * 내비 안내 상태.
 *
 * 실제 차량에서는 네이티브 호스트가 NaviHelper SDK에서 받은 값을 그대로 넣는다
 * (다음 회전, 남은 거리와 시간, 경로 위 교통 흐름, 앞쪽 과속방지턱).
 * 브라우저에서는 시뮬레이터가 시나리오에 맞춘 가상 값을 넣는다.
 * 코어는 이 값을 모른다. 주행 화면이 읽어서 그릴 뿐이다.
 */
import {useSyncExternalStore} from 'react';

export type Turn = 'straight' | 'left' | 'right' | 'uturn' | 'other';
export type TrafficLevel = 'fast' | 'moderate' | 'slow' | 'heavy' | 'unknown';

export interface NaviSnapshot {
  /** 실제 내비에서 온 값인가. false면 시뮬레이터가 만든 가상 값이다. */
  isReal: boolean;
  destination: string;
  /** 안내를 시작할 때의 전체 거리 (m). */
  totalMeters: number;
  remainMeters: number;
  remainSeconds: number;
  next: {turn: Turn; meters: number; description: string} | null;
  /** 경로 위 교통 흐름. start와 end는 경로 전체에 대한 비율(0~1)이다. */
  traffic: {start: number; end: number; level: TrafficLevel}[];
  /** 앞쪽 과속방지턱까지 남은 거리 (m). */
  bumpsAheadMeters: number[];
  /** 앞으로 만날 회전들. 거리는 지금 자리에서 잰 값 (m). 없으면 next 하나만 쓴다. */
  turns?: {turn: Turn; meters: number; description: string}[];
  /** 앞쪽 정체 구간. from과 to는 지금 자리에서 잰 거리 (m). 없으면 traffic의 비율을 쓴다. */
  jamsAhead?: {from: number; to: number; level: TrafficLevel; road?: string}[];
  /**
   * 지금 위치와 목적지의 좌표. 실제 지도를 그리고 길의 모양을 받아 오는 데만 쓴다.
   * 운행 기록과 작전일지에는 넣지 않는다.
   */
  position?: {lat: number; lng: number; heading?: number} | null;
  destinationPoint?: {lat: number; lng: number} | null;
}

let snapshot: NaviSnapshot | null = null;
const listeners = new Set<() => void>();

/** 내비 안내 상태를 바꾼다. 안내가 없으면 null. */
export function setNavi(next: NaviSnapshot | null) {
  snapshot = next;
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getNavi(): NaviSnapshot | null {
  return snapshot;
}

export function useNavi(): NaviSnapshot | null {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** 지금까지 온 비율 (0~1). */
export function progressOf(navi: NaviSnapshot): number {
  if (navi.totalMeters <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - navi.remainMeters / navi.totalMeters));
}

/** "11.9km", "380m" */
export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(meters >= 10_000 ? 0 : 1)}km`;
  return `${Math.max(0, Math.round(meters / 10) * 10)}m`;
}

/** "20분", "1시간 5분" */
export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes}분`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)}시간` : `${Math.floor(minutes / 60)}시간 ${rest}분`;
}
