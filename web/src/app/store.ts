/**
 * 작전본부 코어를 브라우저에 올리는 저장소.
 * 코어 상태를 로컬 저장소에 통째로 넣고, 바뀔 때마다 구독자에게 알린다.
 */
import {useSyncExternalStore} from 'react';
import {hydrate, step, type HqEvent, type HqState} from '../core/hq';

const STORAGE_KEY = 'gamja-hq:state';

function load(): HqState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return hydrate(raw ? JSON.parse(raw) : null);
  } catch {
    return hydrate(null);
  }
}

let state = load();
let saveFailed = false;
const listeners = new Set<() => void>();

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    saveFailed = false;
  } catch {
    // 사진이 커서 저장소 용량을 넘으면 여기로 온다.
    saveFailed = true;
  }
}

export function getState(): HqState {
  return state;
}

/** 사건을 코어에 넣고 새 상태를 돌려준다. */
export function dispatch(event: HqEvent): HqState {
  const next = step(state, event);
  if (next !== state) {
    state = next;
    save();
    listeners.forEach(listener => listener());
  }
  return state;
}

export function didLastSaveFail(): boolean {
  return saveFailed;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React 밖에서 상태가 바뀔 때마다 알림을 받는다. 그만 받으려면 돌려준 함수를 부른다. */
export const subscribeHq: (listener: () => void) => () => void = subscribe;

export function useHq(): HqState {
  return useSyncExternalStore(subscribe, getState);
}
