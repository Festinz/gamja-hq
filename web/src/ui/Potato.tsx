/**
 * 감자 캐릭터 그림.
 * 앱에서 손으로 그린 그림이다. 품종, 소품, 기분에 따라 달라진다.
 *
 * 동글동글한 몸에 얼굴을 아래쪽으로 낮게 두고, 짧은 팔다리와 볼터치를 붙였다.
 * 기획서의 "웃기고 하찮은 감자"를 따르되 선과 색은 부드럽게 쓴다. 직접 그린 고유한 캐릭터다.
 * 주행 중 기분(focus, stuck)에서는 움직이지 않는다.
 */
import {useSyncExternalStore} from 'react';
import {ACCESSORIES, BREEDS, type Accessory, type Breed, type Mood} from '../core/hq';
import {useUiScale} from './scale';

/** 품종별 색. 지도 위의 작은 차와 일기 그림도 같은 색을 쓴다. */
export const POTATO_SKINS: Record<
  Breed,
  {light: string; base: string; shade: string; line: string; speck: string}
> = {
  sumi: {light: '#FBEBC4', base: '#F2D69C', shade: '#E2BD7C', line: '#8C6A3A', speck: '#C79F62'},
  hong: {light: '#FBD9CD', base: '#F4B8A6', shade: '#E59A86', line: '#9B5747', speck: '#D08672'},
  purple: {light: '#E6DAF6', base: '#CDBBEA', shade: '#B39CDB', line: '#6A5094', speck: '#9C84C8'},
};

/** 눈과 입에 쓰는 색. 밝은 테마와 어두운 테마 모두에서 감자 위에 얹힌다. */
const INK = '#3A2E28';
const NAVY = '#002C5F';
const BLUSH = '#F28B9B';
const LEAF = '#8CC87A';
const STEM = '#4F8F45';

const MOOD_LABEL: Record<Mood, string> = {
  hello: '반가운',
  sleepy: '졸린',
  ready: '신난',
  focus: '얌전한',
  stuck: '진땀 흘리는',
  proud: '뿌듯한',
};

const reducedMotion =
  typeof window !== 'undefined' && 'matchMedia' in window
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    onChange => {
      reducedMotion?.addEventListener('change', onChange);
      return () => reducedMotion?.removeEventListener('change', onChange);
    },
    () => reducedMotion?.matches ?? false,
  );
}

export interface PotatoProps {
  breed: Breed;
  accessory: Accessory;
  mood: Mood;
  /** 그림의 너비 (기준 글자 크기 16px일 때의 px). 화면 배율에 따라 함께 커진다. */
  size?: number;
  name?: string;
}

/** 팔 하나. 기분에 따라 올리거나 내린다. */
const ARMS: Record<Mood, {left: [number, number, number]; right: [number, number, number]}> = {
  hello: {left: [42, 156, 18], right: [204, 118, -38]},
  sleepy: {left: [44, 162, 12], right: [198, 162, -12]},
  ready: {left: [38, 134, 34], right: [204, 134, -34]},
  focus: {left: [44, 158, 14], right: [198, 158, -14]},
  stuck: {left: [42, 150, 24], right: [200, 150, -24]},
  proud: {left: [40, 112, 42], right: [204, 112, -42]},
};

export function Potato({breed, accessory, mood, size = 200, name}: PotatoProps) {
  const c = POTATO_SKINS[breed];
  const width = Math.round(size * useUiScale());
  const prefersReducedMotion = usePrefersReducedMotion();
  const breathes = !prefersReducedMotion && (mood === 'hello' || mood === 'ready');
  const label = `${MOOD_LABEL[mood]} ${name ?? BREEDS[breed]}${
    accessory === 'none' ? '' : `, ${ACCESSORIES[accessory]}`
  }`;
  const outline = {stroke: c.line, strokeWidth: 5, strokeLinejoin: 'round' as const};
  const arms = ARMS[mood];

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 240 250"
      width={width}
      height={(width * 250) / 240}>
      <ellipse cx="121" cy="238" rx="64" ry="7" fill={INK} opacity="0.13" />
      <g>
        {breathes && (
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0 0; 0 -4; 0 0"
            dur="3.2s"
            repeatCount="indefinite"
          />
        )}

        {/* 발 */}
        <ellipse cx="92" cy="226" rx="17" ry="10" fill={c.shade} {...outline} />
        <ellipse cx="150" cy="227" rx="17" ry="10" fill={c.shade} {...outline} />
        {/* 팔 */}
        {[arms.left, arms.right].map(([x, y, turn], i) => (
          <ellipse
            key={i}
            cx={x}
            cy={y}
            rx="10.5"
            ry="16"
            transform={`rotate(${turn} ${x} ${y})`}
            fill={c.base}
            {...outline}
          />
        ))}

        {/* 몸통 */}
        <path
          d="M118 44 C80 42 46 68 40 118 C34 172 66 222 122 224 C178 226 208 176 202 122 C197 72 158 46 118 44 Z"
          fill={c.base}
          {...outline}
        />
        <path
          d="M52 150 C58 196 86 216 122 217 C160 218 190 192 196 150 C186 186 158 204 122 204 C88 204 62 184 52 150 Z"
          fill={c.shade}
          opacity="0.55"
        />
        <ellipse cx="88" cy="84" rx="24" ry="13" transform="rotate(-28 88 84)" fill={c.light} opacity="0.9" />

        {/* 씨눈 */}
        <ellipse cx="62" cy="188" rx="4.2" ry="2.6" fill={c.speck} />
        <ellipse cx="180" cy="98" rx="4.2" ry="2.6" fill={c.speck} />
        <ellipse cx="166" cy="198" rx="3.4" ry="2.2" fill={c.speck} />

        {/* 볼터치 */}
        <ellipse cx="70" cy="160" rx="13" ry="8" fill={BLUSH} opacity="0.55" />
        <ellipse cx="172" cy="160" rx="13" ry="8" fill={BLUSH} opacity="0.55" />

        <Face mood={mood} />
        <Extras accessory={accessory} />

        {mood === 'stuck' && (
          <path
            d="M190 78 C198 92 199 100 191 104 C183 100 184 92 190 78 Z"
            fill="#BFE3F7"
            stroke="#6FA9CC"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
        )}
        {mood === 'proud' && (
          <g fill="#FFD25E" stroke="#D79A1E" strokeWidth="2" strokeLinejoin="round">
            <path d="M34 62 L38 73 L49 77 L38 81 L34 92 L30 81 L19 77 L30 73 Z" />
            <path d="M210 44 L213 52 L221 55 L213 58 L210 66 L207 58 L199 55 L207 52 Z" />
          </g>
        )}
        {mood === 'sleepy' && (
          <g fill={INK} opacity="0.55" fontWeight="700">
            <text x="188" y="78" fontSize="24">
              z
            </text>
            <text x="206" y="56" fontSize="17">
              z
            </text>
          </g>
        )}
      </g>
    </svg>
  );
}

function Face({mood}: {mood: Mood}) {
  const line = {
    fill: 'none',
    stroke: INK,
    strokeWidth: 4.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  const eyes = (
    <>
      <circle cx="92" cy="140" r="7.5" fill={INK} />
      <circle cx="150" cy="140" r="7.5" fill={INK} />
      <circle cx="89.5" cy="137.5" r="2.6" fill="#FFFFFF" />
      <circle cx="147.5" cy="137.5" r="2.6" fill="#FFFFFF" />
    </>
  );
  const open = {fill: '#C8605C', stroke: INK, strokeWidth: 4, strokeLinejoin: 'round' as const};

  switch (mood) {
    case 'hello':
      return (
        <>
          {eyes}
          <path d="M111 152 Q121 167 131 152 Z" {...open} />
        </>
      );
    case 'ready':
      return (
        <>
          {eyes}
          <path d="M80 123 L100 128" {...line} />
          <path d="M162 123 L142 128" {...line} />
          <path d="M109 153 Q121 164 133 153" {...line} />
        </>
      );
    case 'focus':
      return (
        <>
          {eyes}
          <path d="M113 156 Q121 160 129 156" {...line} />
        </>
      );
    case 'stuck':
      return (
        <>
          <path d="M84 133 L99 140 L84 147" {...line} />
          <path d="M158 133 L143 140 L158 147" {...line} />
          <path d="M107 159 Q114 152 121 159 T135 159" {...line} />
        </>
      );
    case 'proud':
      return (
        <>
          <path d="M83 143 Q92 130 101 143" {...line} />
          <path d="M141 143 Q150 130 159 143" {...line} />
          <path d="M108 151 Q121 172 134 151 Z" {...open} />
        </>
      );
    case 'sleepy':
      return (
        <>
          <path d="M83 139 Q92 147 101 139" {...line} />
          <path d="M141 139 Q150 147 159 139" {...line} />
          <circle cx="121" cy="157" r="4.5" {...line} />
        </>
      );
  }
}

function Extras({accessory}: {accessory: Accessory}) {
  switch (accessory) {
    case 'none':
      return null;
    case 'helmet':
      // 모자. 머리에 눌러 쓴 캡과 꼭지.
      return (
        <>
          <path
            d="M60 88 C66 52 96 38 120 38 C152 37 180 54 186 86 C146 72 100 74 60 88 Z"
            fill={NAVY}
            stroke="#001B3D"
            strokeWidth="4"
            strokeLinejoin="round"
          />
          <path d="M54 92 C100 74 148 72 194 90" fill="none" stroke={NAVY} strokeWidth="10" strokeLinecap="round" />
          <circle cx="122" cy="38" r="8" fill="#00AAD2" stroke="#001B3D" strokeWidth="3" />
        </>
      );
    case 'sprout':
      return (
        <g stroke={STEM} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round">
          <path d="M119 46 Q117 34 120 26" fill="none" />
          <path d="M120 28 C127 12 142 8 154 13 C150 28 136 36 120 28 Z" fill={LEAF} />
          <path d="M119 30 C111 16 97 13 86 18 C91 32 104 38 119 30 Z" fill={LEAF} />
        </g>
      );
    case 'glasses':
      return (
        <g fill="rgba(255,255,255,0.22)" stroke={NAVY} strokeWidth="4.5">
          <circle cx="92" cy="140" r="19" />
          <circle cx="150" cy="140" r="19" />
          <path d="M111 140 Q121 134 131 140" fill="none" strokeLinecap="round" />
        </g>
      );
  }
}
