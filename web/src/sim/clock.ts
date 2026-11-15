/**
 * 시뮬레이션 시계.
 * 실제 시각에 오프셋을 더한 값이 앱의 "지금"이다. 시뮬레이터가 시나리오 시각으로
 * 건너뛰거나 날짜를 돌릴 때 오프셋만 바뀐다.
 */
import {useEffect, useSyncExternalStore} from 'react';

const STORAGE_KEY = 'gamja-hq:clock-offset';

function loadOffset(): number {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

let offset = loadOffset();
/** 구독자가 다시 그리도록 올리는 번호. 오프셋이 바뀌거나 시간이 흐르면 오른다. */
let tick = 0;
const listeners = new Set<() => void>();

function notify() {
  tick += 1;
  listeners.forEach(listener => listener());
}

/** 실제 차량 신호를 받는 동안에는 시계를 돌리지 않고 실제 시각을 쓴다. */
let usesRealTime = false;

export function setRealTime(value: boolean) {
  if (usesRealTime === value) return;
  usesRealTime = value;
  notify();
}

export function now(): number {
  return usesRealTime ? Date.now() : Date.now() + offset;
}

/** 시계를 주어진 시각으로 맞춘다. */
export function setNow(at: number) {
  offset = at - Date.now();
  try {
    localStorage.setItem(STORAGE_KEY, String(offset));
  } catch {
    // 저장하지 못해도 이번 세션에서는 그대로 쓴다.
  }
  notify();
}

export function advanceMinutes(minutes: number) {
  setNow(now() + minutes * 60_000);
}

export function advanceCalendar(unit: 'day' | 'month' | 'year') {
  const d = new Date(now());
  if (unit === 'day') d.setDate(d.getDate() + 1);
  if (unit === 'month') d.setMonth(d.getMonth() + 1);
  if (unit === 'year') d.setFullYear(d.getFullYear() + 1);
  setNow(d.getTime());
}

export function resetClock() {
  setNow(Date.now());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 지금 시각. 오프셋이 바뀌면 바로, 그렇지 않으면 10초마다 다시 그린다. */
export function useNow(): number {
  useSyncExternalStore(subscribe, () => tick);
  useEffect(() => {
    const id = setInterval(notify, 10_000);
    return () => clearInterval(id);
  }, []);
  return now();
}
