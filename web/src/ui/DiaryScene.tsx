/**
 * 그림일기의 그림. 작전일지 맨 위에 붙는다.
 *
 * 그날 주차한 시각의 하늘 아래, 감자가 작은 차를 타고 달리는 장면이다.
 * 해 뜨고 지는 시각(한국천문연구원)을 알면 그것으로 낮, 해 질 녘, 밤을 고르고, 모르면 주차한 시각으로 어림한다.
 * 커피를 실은 날에는 컵이, 다른 감자를 만난 날에는 뒤따르는 차가 함께 그려진다.
 * 기록에 없는 것은 그리지 않는다.
 */
import type {Breed, DiaryScene as Scene} from '../core/hq';
import {POTATO_SKINS} from './Potato';

const SKY = {
  morning: {top: '#BFE4F7', bottom: '#F6F1DC', orb: '#FFD86B', hill: '#9CCB8B', far: '#B9DBA9'},
  day: {top: '#9FD3F2', bottom: '#E6F4FB', orb: '#FFE28A', hill: '#8FC57E', far: '#AED79F'},
  evening: {top: '#F7B98E', bottom: '#FBE3C4', orb: '#FF8F6B', hill: '#8DB486', far: '#A9C59F'},
  night: {top: '#27375F', bottom: '#4B5B8C', orb: '#F5F0D0', hill: '#3F5F58', far: '#4E7068'},
};

function skyOf(scene: Scene): keyof typeof SKY {
  const hour = scene.hour;
  switch (scene.sky) {
    case 'night':
      return 'night';
    case 'sunset':
      return 'evening';
    case 'day':
      return hour < 10 ? 'morning' : 'day';
  }
  if (hour >= 5 && hour < 10) return 'morning';
  if (hour >= 10 && hour < 17) return 'day';
  if (hour >= 17 && hour < 20) return 'evening';
  return 'night';
}

/** 옆에서 본 작은 차. 창문으로 감자 얼굴이 보인다. */
function SideCar({x, breed, body, faded}: {x: number; breed: Breed; body: string; faded?: boolean}) {
  const skin = POTATO_SKINS[breed];
  return (
    <g transform={`translate(${x} 0)`} opacity={faded ? 0.75 : 1}>
      <path
        d="M4 150 C4 132 18 128 30 126 C38 106 54 98 80 98 C106 98 120 108 128 126 C144 128 154 134 154 150 L154 158 C154 163 150 166 145 166 L13 166 C8 166 4 163 4 158 Z"
        fill={body}
        stroke="#1F2A44"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path d="M44 126 C50 112 60 107 80 107 C98 107 108 113 114 126 Z" fill="#EAF6FC" stroke="#1F2A44" strokeWidth="3.5" strokeLinejoin="round" />
      <ellipse cx="80" cy="121" rx="15" ry="13" fill={skin.base} stroke={skin.line} strokeWidth="3" />
      <circle cx="75" cy="120" r="2.3" fill="#3A2E28" />
      <circle cx="86" cy="120" r="2.3" fill="#3A2E28" />
      <path d="M77 126 Q80.5 129 84 126" fill="none" stroke="#3A2E28" strokeWidth="2" strokeLinecap="round" />
      <ellipse cx="70" cy="125" rx="3.4" ry="2.2" fill="#F28B9B" opacity="0.7" />
      <ellipse cx="91" cy="125" rx="3.4" ry="2.2" fill="#F28B9B" opacity="0.7" />
      <circle cx="42" cy="166" r="15" fill="#2B2F3A" stroke="#1F2A44" strokeWidth="3" />
      <circle cx="42" cy="166" r="6" fill="#C9CED8" />
      <circle cx="118" cy="166" r="15" fill="#2B2F3A" stroke="#1F2A44" strokeWidth="3" />
      <circle cx="118" cy="166" r="6" fill="#C9CED8" />
      <circle cx="148" cy="143" r="4.5" fill="#FFF1A8" />
    </g>
  );
}

/**
 * 차 위에 얹은 커피 컵. 컵을 고르지 않은 예전 일지는 뚜껑 덮은 종이컵이다.
 * 아이스는 얼음이 비치는 투명한 컵(뚜껑을 닫았으면 빨대), 뚜껑 없는 핫은 커피 수면이 보이는 종이컵이다.
 */
function SceneCup({iced, lid}: {iced: boolean; lid: boolean}) {
  if (iced)
    return (
      <g transform="translate(318 56)">
        {lid && <path d="M24 6 L30 -14" stroke="#2F6DB5" strokeWidth="4" strokeLinecap="round" />}
        <path d="M0 10 L4 44 C4 47 7 49 10 49 L26 49 C29 49 32 47 32 44 L36 10 Z" fill="#EAF6FC" stroke="#1F2A44" strokeWidth="3.5" strokeLinejoin="round" />
        <path d="M3 22 L33 22 L32 44 C32 46 30 47 28 47 L8 47 C6 47 4 46 4 44 Z" fill="#8A5B3A" opacity="0.85" />
        <rect x="7" y="16" width="10" height="9" rx="2.5" fill="#FFFFFF" stroke="#BFD9E6" strokeWidth="1.5" />
        <rect x="19" y="18" width="10" height="9" rx="2.5" fill="#FFFFFF" stroke="#BFD9E6" strokeWidth="1.5" />
        <rect x="12" y="27" width="9" height="8" rx="2.5" fill="#FFFFFF" stroke="#BFD9E6" strokeWidth="1.5" opacity="0.9" />
        {lid && <rect x="-3" y="6" width="42" height="6" rx="3" fill="#EAF6FC" stroke="#1F2A44" strokeWidth="3" />}
      </g>
    );
  return (
    <g transform="translate(318 62)">
      <path d="M0 10 L4 38 C4 41 7 43 10 43 L26 43 C29 43 32 41 32 38 L36 10 Z" fill="#FFFFFF" stroke="#1F2A44" strokeWidth="3.5" strokeLinejoin="round" />
      {lid ? (
        <rect x="-3" y="4" width="42" height="9" rx="4.5" fill="#8A5B3A" stroke="#1F2A44" strokeWidth="3" />
      ) : (
        <ellipse cx="18" cy="11" rx="16" ry="3.5" fill="#8A5B3A" stroke="#1F2A44" strokeWidth="2.5" />
      )}
      <path d="M5 22 L31 22 L30 31 L6 31 Z" fill="#C89B6D" />
      <path d="M12 -4 q-5 -8 0 -14 M24 -4 q-5 -8 0 -14" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" opacity="0.85" />
    </g>
  );
}

export function DiaryScene({scene, breed, width = '100%'}: {scene: Scene; breed: Breed; width?: number | string}) {
  const skyName = skyOf(scene);
  const sky = SKY[skyName];
  const isNight = skyName === 'night';
  // 같은 화면에 그림이 여럿 있어도 하늘이 같으면 같은 그러데이션이다.
  const id = `sky-${skyName}`;
  return (
    <svg
      role="img"
      aria-label={`그림일기. ${scene.coffee ? (scene.iced ? '아이스 커피를 싣고 ' : '커피를 싣고 ') : ''}${
        scene.squad > 0 ? `감자 ${scene.squad}마리와 함께 ` : ''
      }달리는 감자`}
      viewBox="0 0 640 210"
      width={width}
      style={{display: 'block', borderRadius: '0.75rem'}}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sky.top} />
          <stop offset="1" stopColor={sky.bottom} />
        </linearGradient>
      </defs>
      <rect width="640" height="210" fill={`url(#${id})`} />
      <circle cx="70" cy="52" r="26" fill={sky.orb} />
      {isNight ? (
        <g fill="#F5F0D0">
          <circle cx="82" cy="44" r="22" fill={sky.top} />
          <circle cx="160" cy="40" r="2.5" />
          <circle cx="210" cy="70" r="2" />
          <circle cx="330" cy="34" r="2.5" />
          <circle cx="430" cy="78" r="2" />
        </g>
      ) : (
        <g fill="#FFFFFF" opacity="0.85">
          <ellipse cx="210" cy="50" rx="44" ry="15" />
          <ellipse cx="240" cy="40" rx="28" ry="13" />
          <ellipse cx="420" cy="62" rx="36" ry="12" />
        </g>
      )}
      <ellipse cx="160" cy="176" rx="250" ry="62" fill={sky.far} />
      <ellipse cx="520" cy="184" rx="240" ry="58" fill={sky.hill} />
      <rect y="160" width="640" height="50" fill="#5B6270" />
      <path d="M0 186 L640 186" stroke="#F4F1E6" strokeWidth="4" strokeDasharray="34 26" />

      {scene.squad > 0 && <SideCar x={60} breed="sumi" body="#B9C2D1" faded />}
      {scene.squad > 2 && <SideCar x={452} breed="hong" body="#D7C2A8" faded />}
      <SideCar x={252} breed={breed} body="#2F6DB5" />

      {scene.coffee && <SceneCup iced={scene.iced === true} lid={scene.lid !== false} />}

      {/* 무사 귀환 도장 */}
      <g transform="translate(580 58) rotate(-12)" fill="none" stroke="#D2463C" opacity="0.9">
        <circle r="38" strokeWidth="4" />
        <circle r="31" strokeWidth="1.5" />
        <text y="-4" textAnchor="middle" fontSize="17" fontWeight="700" fill="#D2463C" stroke="none">
          무사
        </text>
        <text y="17" textAnchor="middle" fontSize="17" fontWeight="700" fill="#D2463C" stroke="none">
          귀환
        </text>
      </g>
    </svg>
  );
}
