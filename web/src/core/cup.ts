/**
 * 컵 속 커피의 움직임.
 *
 * 커피 운송작전에서 주행 화면의 컵 그림과 "넘칠까" 판단이 이 모형에서 나온다.
 * 순수 함수다. 차의 가속도와 기울기를 넣으면 다음 순간의 수면을 돌려준다.
 *
 * 모형
 * - 수면은 유효 중력에 수직이다. 옆으로 a 만큼 가속하면 수면이 atan(a/g) 만큼 기운다.
 * - 수면은 바로 따라가지 않고 출렁인다. 원통 컵의 1차 슬로싱 모드
 *   ω² = (g·ξ/R)·tanh(ξ·h/R), ξ = 1.841 을 고유 진동수로 하는 감쇠 진동자로 계산한다.
 * - 방지턱 꼭대기에서는 차체가 아래로 가속해 유효 중력이 줄어든다. 같은 가속에도 수면이 더 크게 기울고,
 *   유효 중력이 0 아래로 내려가면 커피가 컵에서 떠오른다.
 * - 수면의 가장 높은 곳이 컵 가장자리를 넘으면, 넘은 깊이에 따라 둑(위어) 유량 공식만큼 흘러나간다.
 * - 뚜껑을 닫았으면 가장자리를 넘은 커피가 마시는 구멍으로만 샌다. 열린 컵의 LID_LEAK 배로 본다.
 *
 * 컵은 원통 하나(CupSpec)로 다룬다. 아래가 좁은 실제 컵은 core/cupSpec.ts 가 같은 원통으로 어림한다.
 * 고른 컵이 없으면 기본 컵(DEFAULT_CUP, 뚜껑 없는 그란데 크기 원통에 420ml)이다.
 * 가정: 평평한 수면, 컵은 차체에 고정. 얼음은 수면 높이에만 넣고 출렁임을 줄이는 효과는 넣지 않았다.
 */

export const G = 9.81;

/**
 * 컵 모형이 쓰는 컵 하나. 반지름과 높이는 같은 원통으로 어림한 값이다 (core/cupSpec.ts).
 * 수치는 실측이 아니라 어림이다. 화면에 "어림"이라고 적는다.
 */
export interface CupSpec {
  /** 화면과 작전일지에 쓰는 이름. 예: "스타벅스 벤티 아이스(뚜껑 닫음)". */
  label: string;
  /** 가장자리까지 가득 채웠을 때의 양 (ml). */
  capacityMl: number;
  /** 출발할 때 수면까지 찬 양 (ml). 가게가 말하는 음료의 양이고, 아이스 음료는 얼음을 포함한다. */
  fillMl: number;
  /** 원통의 안쪽 반지름 (m). 실제 컵의 가장자리 반지름이다. */
  radius: number;
  /** 원통의 높이 (m). 바닥에서 가장자리까지. */
  height: number;
  /** 뚜껑을 닫았는가. */
  lid: boolean;
  /** 얼음이 든 음료인가. */
  ice: boolean;
  /** 사용자가 고른 것. 컵을 다시 고를 때 처음 값으로 쓴다. 기본 컵에는 없다. */
  pick?: CupPick;
}

/** 사용자가 고른 컵. 브랜드와 사이즈는 컵 목록(cups.json)의 id다. */
export interface CupPick {
  brandId: string | null;
  sizeId: string | null;
  /** 브랜드 사이즈가 아니라 용량을 바로 말했을 때 (ml). */
  volumeMl: number | null;
  temp: 'hot' | 'ice';
  lid: boolean;
}

/** 기본 컵의 안쪽 반지름과 높이 (m). 그란데(473ml) 크기다. */
export const CUP = {radius: 0.039, height: 0.1} as const;
/** 기본 컵을 가장자리까지 가득 채웠을 때의 양 (ml). */
export const CUP_BRIM_ML = Math.PI * CUP.radius ** 2 * CUP.height * 1e6;
/** 기본 컵에 출발할 때 담겨 있는 커피 (ml). 가장자리에서 1.2cm 아래. */
export const COFFEE_START_ML = 420;

/** 고른 컵이 없을 때의 컵. 뚜껑 없는 원통이다. 예전 판의 모든 계산이 이 컵이다. */
export const DEFAULT_CUP: CupSpec = {
  label: '기본 컵',
  capacityMl: CUP_BRIM_ML,
  fillMl: COFFEE_START_ML,
  radius: CUP.radius,
  height: CUP.height,
  lid: false,
  ice: false,
};

/**
 * 뚜껑을 닫은 컵에서 새는 양은 열린 컵에서 넘치는 양의 이만큼이다 (어림, 실험값이 아니다).
 * 근거: 뚜껑의 마시는 구멍(폭 약 1.2cm)이 이 모형의 둑 폭(컵 반지름, 약 4cm)에서 차지하는 몫 약 0.3에,
 * 둘레 약 26cm 가운데 그 구멍이 수면이 솟는 쪽(둑 폭 + 구멍 폭, 약 5cm)에 놓일 몫 약 0.2를 곱했다.
 * 빨대를 꽂은 아이스 컵의 뚜껑도 같게 본다.
 */
export const LID_LEAK = 0.05;

/** 원통 1차 슬로싱 모드의 근. J1'(ξ) = 0. */
const SLOSH_ROOT = 1.8412;
/** 수면 출렁임의 감쇠비. */
const DAMPING = 0.1;
const MAX_TAN = Math.tan((55 * Math.PI) / 180);
/** 유효 중력이 이보다 작으면 수면 기울기 계산에는 이 값을 쓴다. 그 아래는 떠오름으로 다룬다. */
const MIN_GRAVITY = 0.15 * G;
/** 둑 유량 Q = (2/3)·Cd·b·√(2g)·e^1.5 의 앞 계수. Cd = 0.6. */
const WEIR = (2 / 3) * 0.6 * Math.sqrt(2 * G);
const SUBSTEP = 0.004;

export interface CupState {
  /** 이 컵. 반지름, 높이, 뚜껑이 계산에 들어간다. */
  spec: CupSpec;
  volumeMl: number;
  /** 좌우 수면 기울기의 탄젠트. 오른쪽이 높으면 +. */
  lat: number;
  latRate: number;
  /** 앞뒤 수면 기울기의 탄젠트. 차 앞쪽이 높으면 +. */
  long: number;
  longRate: number;
  /** 유효 중력이 0 아래로 내려가 커피가 떠오른 높이 (m). */
  heave: number;
  heaveRate: number;
  /** 지금까지 넘쳐 흐른 양 (ml). 뚜껑을 닫았으면 마시는 구멍으로 샌 양이다. */
  spilledMl: number;
}

/** 컵이 차에서 받는 힘. 가속도는 m/s², 기울기는 rad. */
export interface CupInput {
  /** 좌우 가속도. 오른쪽으로 돌 때 +. */
  accelLat: number;
  /** 앞뒤 가속도. 가속하면 +, 브레이크를 밟으면 −. */
  accelLong: number;
  /** 위아래 가속도. 위쪽이 +. 방지턱 꼭대기에서는 −. */
  accelVert: number;
  /** 차 앞이 들린 각도. 오르막과 방지턱 진입에서 +. */
  pitch: number;
  /** 차 오른쪽이 내려간 각도. */
  roll: number;
}

export const STILL: CupInput = {accelLat: 0, accelLong: 0, accelVert: 0, pitch: 0, roll: 0};

/** volumeMl 만큼 담긴 컵. 컵을 주지 않으면 기본 컵이다. */
export function newCup(volumeMl: number = COFFEE_START_ML, spec: CupSpec = DEFAULT_CUP): CupState {
  return {
    spec,
    volumeMl,
    lat: 0,
    latRate: 0,
    long: 0,
    longRate: 0,
    heave: 0,
    heaveRate: 0,
    spilledMl: 0,
  };
}

/** 출발할 때의 컵. 고른 컵의 수면까지 찬 양으로 시작한다. */
export function fillCup(spec: CupSpec = DEFAULT_CUP): CupState {
  return newCup(spec.fillMl, spec);
}

const areaOf = (spec: CupSpec) => Math.PI * spec.radius ** 2;

/** 컵 바닥에서 수면까지의 높이 (m). */
export function fillHeight(volumeMl: number, spec: CupSpec = DEFAULT_CUP): number {
  return (volumeMl * 1e-6) / areaOf(spec);
}

/** 수면이 한 번 출렁이는 빠르기 (Hz). */
export function sloshHz(volumeMl: number, gravity: number = G, spec: CupSpec = DEFAULT_CUP): number {
  const k = SLOSH_ROOT / spec.radius;
  return Math.sqrt(gravity * k * Math.tanh(k * fillHeight(volumeMl, spec))) / (2 * Math.PI);
}

const clampTan = (value: number) => Math.min(MAX_TAN, Math.max(-MAX_TAN, value));

/** dt 초 뒤의 컵. */
export function stepCup(cup: CupState, input: CupInput, dt: number): CupState {
  const spec = cup.spec;
  let {volumeMl, lat, latRate, long, longRate, heave, heaveRate, spilledMl} = cup;
  const steps = Math.max(1, Math.ceil(dt / SUBSTEP));
  const h = dt / steps;
  const vertical = G + input.accelVert;
  const gravity = Math.max(vertical, MIN_GRAVITY);
  const targetLat = clampTan(-input.accelLat / gravity + Math.tan(input.roll));
  const targetLong = clampTan(-input.accelLong / gravity - Math.tan(input.pitch));
  const k = SLOSH_ROOT / spec.radius;
  const leak = spec.lid ? LID_LEAK : 1;

  for (let i = 0; i < steps; i++) {
    const depth = fillHeight(volumeMl, spec);
    const w2 = gravity * k * Math.tanh(k * depth);
    const damping = 2 * DAMPING * Math.sqrt(w2);
    latRate += (w2 * (targetLat - lat) - damping * latRate) * h;
    lat += latRate * h;
    longRate += (w2 * (targetLong - long) - damping * longRate) * h;
    long += longRate * h;

    if (heave > 0 || vertical < 0) {
      heaveRate -= vertical * h;
      heave += heaveRate * h;
      if (heave <= 0) {
        heave = 0;
        heaveRate = 0;
      }
    }

    const over = depth + heave + spec.radius * Math.hypot(lat, long) - spec.height;
    if (over > 0 && volumeMl > 0) {
      const out = Math.min(volumeMl, leak * WEIR * spec.radius * over ** 1.5 * 1e6 * h);
      volumeMl -= out;
      spilledMl += out;
    }
  }
  return {spec, volumeMl, lat, latRate, long, longRate, heave, heaveRate, spilledMl};
}

const DEG = 180 / Math.PI;

/** 지금 수면이 기운 각도 (도). */
export function tiltDeg(cup: CupState): number {
  return Math.atan(Math.hypot(cup.lat, cup.long)) * DEG;
}

/** 이 각도를 넘게 기울면 가장자리에 닿는다 (도). 커피가 많을수록, 컵이 넓을수록 작다. */
export function spillLimitDeg(cup: CupState): number {
  return Math.atan((cup.spec.height - fillHeight(cup.volumeMl, cup.spec)) / cup.spec.radius) * DEG;
}

/** 수면의 가장 높은 곳에서 컵 가장자리까지 남은 높이 (mm). 0보다 작으면 넘치는 중이다. */
export function marginMm(cup: CupState): number {
  const spec = cup.spec;
  const top = fillHeight(cup.volumeMl, spec) + cup.heave + spec.radius * Math.hypot(cup.lat, cup.long);
  return (spec.height - top) * 1000;
}

export type CupStatus = 'calm' | 'sloshing' | 'spilling';

export function cupStatus(cup: CupState): CupStatus {
  const margin = marginMm(cup);
  if (margin <= 0) return 'spilling';
  return margin < 5 ? 'sloshing' : 'calm';
}

/** 처음 담은 양에서 남은 비율 (0~100). */
export function leftPercent(volumeMl: number, spilledMl: number): number {
  const start = volumeMl + spilledMl;
  return start <= 0 ? 0 : Math.round((volumeMl / start) * 100);
}

// ───────────────────────── 저장한 컵 읽기 ─────────────────────────

const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * 저장소에서 읽은 컵. 형식이 맞지 않으면 null (기본 컵으로 계산한다).
 * 반지름 1~10cm, 높이 3~30cm, 수면이 가장자리 아래에 있는 컵만 받는다.
 */
export function readCupSpec(raw: unknown): CupSpec | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const label = typeof r.label === 'string' ? r.label.trim() : '';
  if (!label || !positive(r.fillMl) || !positive(r.capacityMl) || !positive(r.radius) || !positive(r.height))
    return null;
  if (r.radius < 0.01 || r.radius > 0.1 || r.height < 0.03 || r.height > 0.3) return null;
  const spec: CupSpec = {
    label,
    capacityMl: r.capacityMl,
    fillMl: r.fillMl,
    radius: r.radius,
    height: r.height,
    lid: r.lid === true,
    ice: r.ice === true,
  };
  if (fillHeight(spec.fillMl, spec) >= spec.height) return null;
  const pick = readPick(r.pick);
  return pick ? {...spec, pick} : spec;
}

function readPick(raw: unknown): CupPick | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (p.temp !== 'hot' && p.temp !== 'ice') return null;
  const id = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  return {
    brandId: id(p.brandId),
    sizeId: id(p.sizeId),
    volumeMl: positive(p.volumeMl) ? p.volumeMl : null,
    temp: p.temp,
    lid: p.lid === true,
  };
}
