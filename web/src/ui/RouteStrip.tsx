/**
 * 경로 띠. 출발지에서 목적지까지를 한 줄로 펴서 그린다.
 *
 * 내비가 주는 것은 지도 그림이 아니라 "경로 전체에서 몇 %부터 몇 %까지가 막힌다"는 비율이다.
 * 그래서 지도 대신 띠로 그린다. 띠 위에 지금 위치, 막히는 구간, 앞쪽 과속방지턱,
 * 같은 구간에 서 있는 감자들을 놓는다. 움직이는 요소는 없다.
 */
import {progressOf, type NaviSnapshot, type TrafficLevel} from '../app/navi';

const LEVEL_FILL: Record<TrafficLevel, string> = {
  fast: 'var(--color-success)',
  moderate: 'var(--color-warning)',
  slow: 'var(--color-warning)',
  heavy: 'var(--color-error)',
  unknown: 'var(--color-border-emphasized)',
};

const W = 1000;
const H = 96;
const LEFT = 24;
const RIGHT = W - 24;
const TRACK_Y = 56;
const TRACK_H = 14;

const xAt = (ratio: number) => LEFT + (RIGHT - LEFT) * Math.min(1, Math.max(0, ratio));

export function RouteStrip({
  navi,
  squadSize,
}: {
  navi: NaviSnapshot;
  /** 지금 같은 정체 구간에 서 있는 감자 수. 0이면 그리지 않는다. */
  squadSize: number;
}) {
  const progress = progressOf(navi);
  const me = xAt(progress);
  const bumps = navi.bumpsAheadMeters
    .map(meters => progress + meters / Math.max(1, navi.totalMeters))
    .filter(ratio => ratio <= 1);
  // 같은 구간의 감자들은 내 위치 앞뒤로 흩어 놓는다. 정확한 위치는 아무도 모른다.
  const mates = Array.from({length: Math.min(squadSize, 8)}, (_, i) => {
    const offset = (i % 2 === 0 ? 1 : -1) * (18 + Math.floor(i / 2) * 22);
    return Math.min(RIGHT, Math.max(LEFT, me + offset));
  });

  return (
    <svg
      role="img"
      aria-label={`경로 ${Math.round(progress * 100)}% 지점`}
      viewBox={`0 0 ${W} ${H}`}
      width="100%">
      {/* 전체 경로 */}
      <rect x={LEFT} y={TRACK_Y} width={RIGHT - LEFT} height={TRACK_H} rx={TRACK_H / 2} fill="var(--color-border-emphasized)" />
      {/* 교통 흐름 */}
      {navi.traffic.map((segment, i) => (
        <rect
          key={i}
          x={xAt(segment.start)}
          y={TRACK_Y}
          width={Math.max(4, xAt(segment.end) - xAt(segment.start))}
          height={TRACK_H}
          rx={TRACK_H / 2}
          fill={LEVEL_FILL[segment.level]}
        />
      ))}
      {/* 지나온 길 */}
      <rect x={LEFT} y={TRACK_Y} width={Math.max(0, me - LEFT)} height={TRACK_H} rx={TRACK_H / 2} fill="var(--color-accent)" opacity="0.55" />

      {/* 과속방지턱 */}
      {bumps.map((ratio, i) => (
        <path
          key={i}
          d={`M${xAt(ratio) - 12} ${TRACK_Y - 4} Q${xAt(ratio)} ${TRACK_Y - 22} ${xAt(ratio) + 12} ${TRACK_Y - 4} Z`}
          fill="var(--color-text-secondary)"
        />
      ))}

      {/* 같은 구간의 감자들 */}
      {mates.map((x, i) => (
        <ellipse key={i} cx={x} cy={TRACK_Y + TRACK_H + 14} rx="8" ry="9" fill="var(--color-text-secondary)" opacity="0.7" />
      ))}

      {/* 목적지 */}
      <circle cx={RIGHT} cy={TRACK_Y + TRACK_H / 2} r="13" fill="var(--color-background-card)" stroke="var(--color-text-primary)" strokeWidth="5" />

      {/* 내 위치 */}
      <circle cx={me} cy={TRACK_Y + TRACK_H / 2} r="17" fill="var(--color-accent)" stroke="var(--color-background-card)" strokeWidth="5" />
      <path d={`M${me - 9} ${TRACK_Y - 20} L${me + 9} ${TRACK_Y - 20} L${me} ${TRACK_Y - 8} Z`} fill="var(--color-accent)" />
    </svg>
  );
}
