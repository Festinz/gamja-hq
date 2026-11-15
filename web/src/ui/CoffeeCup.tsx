/**
 * 커피 컵 그림. 컵 모형(core/cup.ts)이 계산한 수면을 그대로 그린다.
 *
 * 컵을 운전석에서 조금 내려다본 모습이다. 수면은 좌우 기울기와 앞뒤 기울기를 가진 평면이고,
 * 컵 벽을 따라 한 바퀴 돌며 그 높이를 찍어 그린다. 오른쪽으로 돌면 왼쪽 벽을 타고,
 * 브레이크를 밟으면 앞쪽(그림에서 먼 쪽)이 올라가고, 방지턱에서 떠오르면 수면 전체가 솟는다.
 * 컵의 비율은 운행에 고른 컵(같은 부피의 원통으로 어림한 것)을 따른다. 뚜껑을 닫았으면 투명한 뚜껑 테두리를,
 * 아이스 음료면 수면을 따라 떠 있는 얼음을 그린다. 얼음도 수면의 실제 높이를 따라서만 움직인다.
 */
import {fillHeight, marginMm, type CupState} from '../core/cup';

const W = 220;
const H = 280;
const CX = 110;
/** 컵이 들어갈 수 있는 가장 큰 반폭과 높이 (그림 단위). */
const MAX_RX = 70;
const MAX_TALL = 200;
/** 내려다보는 각도 때문에 원이 눌려 보이는 비율. */
const SQUASH = 0.26;
const BOTTOM = 246;
const STEPS = 28;
/** 얼음이 떠 있는 자리 (수면 위의 각도와 가운데에서의 거리 비율). */
const ICE = [
  {phi: 2.2, r: 0.45, size: 15},
  {phi: 4.1, r: 0.35, size: 13},
  {phi: 0.6, r: 0.5, size: 14},
];

export function CoffeeCup({
  cup,
  at,
  width,
}: {
  cup: CupState;
  /** 지금 시각 (ms). 넘치는 방울을 떨어뜨리는 데 쓴다. */
  at: number;
  width: number | string;
}) {
  const spec = cup.spec;
  // 넓은 컵은 폭에, 높은 컵은 높이에 맞춘다.
  const pxPerM = Math.min(MAX_RX / spec.radius, MAX_TALL / spec.height);
  const RX = spec.radius * pxPerM;
  const RY = RX * SQUASH;
  const TALL = spec.height * pxPerM;
  const TOP = BOTTOM - TALL;

  const level = (fillHeight(cup.volumeMl, spec) + cup.heave) * pxPerM;
  const heightAt = (phi: number, reach = 1) =>
    Math.min(TALL, Math.max(3, level + RX * reach * (cup.lat * Math.cos(phi) + cup.long * Math.sin(phi))));
  const point = (phi: number) =>
    `${(CX + RX * Math.cos(phi)).toFixed(1)} ${(BOTTOM - heightAt(phi) - RY * Math.sin(phi)).toFixed(1)}`;

  let surface = '';
  for (let i = 0; i < STEPS; i++) surface += `${i ? 'L' : 'M'}${point((2 * Math.PI * i) / STEPS)}`;
  surface += 'Z';
  // 옆에서 보이는 몸통. 수면의 가까운 쪽 반, 오른쪽 벽, 바닥의 가까운 쪽 반, 왼쪽 벽.
  let body = '';
  for (let i = 0; i <= STEPS / 2; i++)
    body += `${i ? 'L' : 'M'}${point(Math.PI + (2 * Math.PI * i) / STEPS)}`;
  body += `L${CX + RX} ${BOTTOM}A${RX} ${RY} 0 0 1 ${CX - RX} ${BOTTOM}Z`;

  const isSpilling = marginMm(cup) <= 0;
  // 넘치는 쪽. 수면이 가장 높은 방향이다.
  const peak = Math.atan2(cup.long, cup.lat);
  const rim = {x: CX + RX * Math.cos(peak), y: TOP - RY * Math.sin(peak)};
  const outward = Math.cos(peak) >= 0 ? 1 : -1;
  const glass = 'var(--color-text-secondary)';
  const label = `${spec.ice ? '얼음이 든 ' : ''}${spec.lid ? '뚜껑을 닫은 ' : ''}컵`;

  return (
    <svg
      role="img"
      aria-label={isSpilling ? `커피가 넘치고 있는 ${label}` : `커피가 담긴 ${label}`}
      viewBox={`0 0 ${W} ${H}`}
      width={width}>
      <ellipse cx={CX} cy={BOTTOM + 14} rx={RX * 0.92} ry="9" fill="var(--color-text-primary)" opacity="0.12" />
      {/* 컵 안쪽 */}
      <path
        d={`M${CX - RX} ${TOP}L${CX - RX} ${BOTTOM}A${RX} ${RY} 0 0 0 ${CX + RX} ${BOTTOM}L${CX + RX} ${TOP}A${RX} ${RY} 0 0 0 ${CX - RX} ${TOP}Z`}
        fill="color-mix(in srgb, var(--color-text-primary) 7%, transparent)"
      />
      <path d={body} fill={spec.ice ? '#5A3826' : '#4B2E20'} />
      <path d={surface} fill="#8A5B3A" stroke="#C39A6B" strokeWidth="2" strokeLinejoin="round" />
      {/* 얼음. 수면의 그 자리 높이에 떠 있다. */}
      {spec.ice &&
        ICE.map((cube, i) => {
          const x = CX + RX * cube.r * Math.cos(cube.phi);
          const y = BOTTOM - heightAt(cube.phi, cube.r) - RY * cube.r * Math.sin(cube.phi);
          return (
            <rect
              key={i}
              x={x - cube.size / 2}
              y={y - cube.size * 0.6}
              width={cube.size}
              height={cube.size * 0.8}
              rx="3"
              fill="#EAF6FC"
              stroke="#BFD9E6"
              strokeWidth="1.5"
              opacity="0.9"
            />
          );
        })}
      {/* 컵 */}
      <path d={`M${CX - RX + 13} ${TOP + 26}L${CX - RX + 13} ${BOTTOM - 20}`} stroke="#FFFFFF" strokeWidth="7" strokeLinecap="round" opacity="0.22" />
      <path
        d={`M${CX - RX} ${TOP}L${CX - RX} ${BOTTOM}A${RX} ${RY} 0 0 0 ${CX + RX} ${BOTTOM}L${CX + RX} ${TOP}`}
        fill="none"
        stroke={glass}
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <ellipse
        cx={CX}
        cy={TOP}
        rx={RX}
        ry={RY}
        fill="none"
        stroke={isSpilling ? 'var(--color-error)' : glass}
        strokeWidth={isSpilling ? 5 : 3.5}
      />
      {/* 뚜껑. 수면이 보이게 테두리만 그리고, 마시는 구멍을 앞쪽에 둔다. */}
      {spec.lid && (
        <g>
          <ellipse cx={CX} cy={TOP - 4} rx={RX + 4} ry={RY + 2} fill="none" stroke={glass} strokeWidth="2.5" strokeDasharray="7 5" />
          <rect x={CX - 9} y={TOP + RY - 6} width="18" height="5" rx="2.5" fill={glass} opacity="0.8" />
        </g>
      )}
      {isSpilling &&
        [0, 1, 2].map(i => {
          const p = (at / 620 + i / 3) % 1;
          return (
            <circle
              key={i}
              cx={rim.x + outward * (5 + 15 * p)}
              cy={rim.y + 6 + 74 * p * p}
              r={(spec.lid ? 3.5 : 5.5) - 2.5 * p}
              fill="#6B4026"
            />
          );
        })}
    </svg>
  );
}
