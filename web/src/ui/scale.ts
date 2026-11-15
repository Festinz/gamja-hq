/**
 * 차량 화면 규격에 맞춘 크기 배율.
 *
 * Pleos Connect 에뮬레이터(2560×1440, 160dpi)에서 앱 창은 가로 약 1,700dp다. 브라우저 기본
 * 글자 크기(16px)로는 운전석에서 읽을 수 없으므로, 창 폭에 비례해 기준 글자 크기를 키운다.
 * Astryx의 간격과 글자 크기는 rem 단위라서 기준 글자 크기 하나로 화면 전체가 함께 커진다.
 *
 * 폭 992px 이하(휴대폰, 좁은 창)에서는 16px 그대로다.
 */
import {useSyncExternalStore} from 'react';

const BASE_PX = 16;
const MAX_PX = 30;
/** 창 폭을 이 값으로 나눈 것이 기준 글자 크기다. 1,700px 창에서 약 27px. */
const WIDTH_PER_PX = 62;

function rootFontSize(width: number): number {
  return Math.min(MAX_PX, Math.max(BASE_PX, width / WIDTH_PER_PX));
}

let scale = 1;
const listeners = new Set<() => void>();

function update() {
  const px = rootFontSize(window.innerWidth);
  document.documentElement.style.fontSize = `${px}px`;
  const next = px / BASE_PX;
  if (next !== scale) {
    scale = next;
    listeners.forEach(listener => listener());
  }
}

/** 앱이 뜰 때 한 번 부른다. 창 크기가 바뀌면 다시 맞춘다. */
export function applyUiScale() {
  update();
  window.addEventListener('resize', update);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 지금 배율. 픽셀로 크기를 받는 그림(감자)이 화면과 함께 커지도록 곱해 쓴다. */
export function useUiScale(): number {
  return useSyncExternalStore(subscribe, () => scale);
}
