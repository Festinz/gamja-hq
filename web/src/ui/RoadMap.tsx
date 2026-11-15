/**
 * 주행 지도. 차는 화면 아래쪽에 서 있고 길이 차 쪽으로 흘러온다 (진행 방향이 위).
 *
 * 내비는 지도 그림을 주지 않는다. "몇 m 앞에서 우회전", "몇 m 앞에 과속방지턱", "여기부터 정체" 같은 값만 준다.
 * 그 값으로 길의 모양을 만들어(core/drive.ts) 약도로 그린다. 길가의 건물과 골목은 장식이고,
 * 길의 굽이, 방지턱, 정체 구간, 도착지의 거리는 받은 값 그대로다.
 */
import {memo, useMemo, type ReactElement} from 'react';
import type {DriveFrame} from '../app/drive';
import {formatDistance} from '../app/navi';
import {piecesOf, poseAt, type Geometry, type Pose, type Route} from '../core/drive';
import type {Breed} from '../core/hq';
import {POTATO_SKINS} from './Potato';

const W = 800;
const H = 700;
/** 차가 서 있는 자리 (그림 좌표). */
const CAR = {x: 400, y: 520};
/** 1m가 그림에서 몇 칸인가. */
const SCALE = 3.2;
/** 길가 장식을 이만큼씩 묶어 다시 그린다 (m). */
const CHUNK = 160;
const ROAD = 18;
const STREET = 9;
const CELL = 96;

const mix = (percent: number, color = 'var(--color-text-primary)') =>
  `color-mix(in srgb, ${color} ${percent}%, var(--color-background-card))`;

const COLOR = {
  ground: mix(5),
  block: mix(12),
  park: mix(24, 'var(--color-success)'),
  tree: mix(46, 'var(--color-success)'),
  street: mix(19),
  road: mix(32),
  roadEdge: mix(44),
  lane: mix(72),
  glass: 'color-mix(in srgb, var(--color-background-card) 82%, transparent)',
};

const DEG = 180 / Math.PI;
const n1 = (value: number) => value.toFixed(1);

/** 길을 따라 from에서 to까지의 선. */
function pathBetween(geometry: Geometry, from: number, to: number, stride = 4): string {
  let d = '';
  for (let s = from; ; s = Math.min(to, s + stride)) {
    const p = poseAt(geometry, s);
    d += `${d ? 'L' : 'M'}${n1(p.x)} ${n1(p.y)}`;
    if (s >= to) break;
  }
  return d;
}

const at = (pose: Pose) => `translate(${n1(pose.x)} ${n1(pose.y)}) rotate(${n1(pose.heading * DEG)})`;

/** 같은 자리에는 늘 같은 건물이 서도록 거리에서 뽑는 값 (0~1). */
const seed = (n: number) => {
  const x = Math.sin(n * 127.1 + 31.7) * 43758.5453;
  return x - Math.floor(x);
};

/** 길과 길가. 차가 CHUNK를 넘어갈 때만 다시 그린다. */
const World = memo(function World({
  geometry,
  from,
  to,
}: {
  geometry: Geometry;
  from: number;
  to: number;
}) {
  const streets: string[] = [];
  const lots: ReactElement[] = [];
  const pieces = piecesOf(geometry);

  pieces.forEach((piece, index) => {
    if (piece.s1 < from || piece.s0 > to) return;
    if (piece.k !== 0) {
      // 크게 꺾는 곳은 교차로다. 돌기 전의 길은 곧게 이어지고, 돈 뒤의 길은 뒤쪽으로도 뻗어 있다.
      if (Math.abs(piece.k) * (piece.s1 - piece.s0) < 1.2) return;
      const a = poseAt(geometry, piece.s0);
      const b = poseAt(geometry, piece.s1);
      streets.push(
        `M${n1(a.x)} ${n1(a.y)}L${n1(a.x + Math.sin(a.heading) * 220)} ${n1(a.y - Math.cos(a.heading) * 220)}`,
        `M${n1(b.x)} ${n1(b.y)}L${n1(b.x - Math.sin(b.heading) * 220)} ${n1(b.y + Math.cos(b.heading) * 220)}`,
      );
      return;
    }
    const start = Math.max(piece.s0 + (index > 0 ? 34 : -80), from);
    const end = Math.min(piece.s1 - (index < pieces.length - 1 ? 34 : -60), to);
    for (let cell = Math.floor(start / CELL); cell * CELL < end; cell++) {
      const edge = cell * CELL;
      if (edge > start + 6 && edge < end - 6) {
        const p = poseAt(geometry, edge);
        const dx = Math.cos(p.heading) * 190;
        const dy = Math.sin(p.heading) * 190;
        streets.push(`M${n1(p.x - dx)} ${n1(p.y - dy)}L${n1(p.x + dx)} ${n1(p.y + dy)}`);
      }
      const a = Math.max(start, edge + 9);
      const b = Math.min(end, edge + CELL - 9);
      if (b - a < 16) continue;
      const count = Math.max(1, Math.round((b - a) / 30));
      const length = (b - a) / count - 5;
      for (let i = 0; i < count; i++) {
        const pose = at(poseAt(geometry, a + i * (length + 5)));
        for (const side of [-1, 1]) {
          const key = cell * 13 + i * 5 + side;
          const depth = 18 + 16 * seed(key);
          const x = side > 0 ? ROAD / 2 + 4.5 : -ROAD / 2 - 4.5 - depth;
          if (seed(key + 0.37) < 0.17) {
            lots.push(
              <g key={`${key}p`} transform={pose}>
                <rect x={x} y={-length} width={depth} height={length} rx="6" fill={COLOR.park} />
                <circle cx={x + depth * 0.35} cy={-length * 0.3} r="4.2" fill={COLOR.tree} />
                <circle cx={x + depth * 0.68} cy={-length * 0.68} r="5" fill={COLOR.tree} />
              </g>,
            );
            continue;
          }
          const back = 14 + 14 * seed(key + 0.71);
          lots.push(
            <g key={`${key}b`} transform={pose} fill={COLOR.block}>
              <rect x={x} y={-length} width={depth} height={length} rx="2.5" />
              {seed(key + 0.11) > 0.3 && (
                <rect
                  x={side > 0 ? x + depth + 5 : x - 5 - back}
                  y={-length}
                  width={back}
                  height={length * (0.55 + 0.45 * seed(key + 0.53))}
                  rx="2.5"
                />
              )}
            </g>,
          );
        }
      }
    }
  });

  const road = pathBetween(geometry, Math.max(-80, from), Math.min(geometry.total + 60, to));
  const line = {fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const};
  return (
    <g>
      {streets.map((d, i) => (
        <path key={i} d={d} stroke={COLOR.street} strokeWidth={STREET} {...line} />
      ))}
      {lots}
      <path d={road} stroke={COLOR.roadEdge} strokeWidth={ROAD + 1.8} {...line} />
      <path d={road} stroke={COLOR.road} strokeWidth={ROAD} {...line} />
      <path d={road} stroke={COLOR.lane} strokeWidth="0.45" strokeDasharray="5 7" fill="none" />
    </g>
  );
});

/** 위에서 본 작은 차. 지붕 위로 감자가 보인다. 머리가 위쪽이다. */
function Car({breed, color, size = 1}: {breed: Breed; color: string; size?: number}) {
  const skin = POTATO_SKINS[breed];
  return (
    <g transform={`scale(${size})`}>
      <rect x="-23" y="-40" width="46" height="80" rx="19" fill={color} stroke="var(--color-background-card)" strokeWidth="3.5" />
      <path d="M-16 -21 Q0 -30 16 -21 L13.5 -8 Q0 -12.5 -13.5 -8 Z" fill="var(--color-background-card)" opacity="0.72" />
      <rect x="-13" y="22" width="26" height="8" rx="4" fill="var(--color-background-card)" opacity="0.6" />
      <ellipse cx="0" cy="6" rx="11.5" ry="10.5" fill={skin.base} stroke={skin.line} strokeWidth="2.2" />
      <circle cx="-4" cy="3.5" r="1.7" fill="#2A2623" />
      <circle cx="4" cy="3.5" r="1.7" fill="#2A2623" />
      <path d="M0 -4.5 q3.5 -7 8 -4.5" stroke="#5E9C4C" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </g>
  );
}

const chipWidth = (text: string) => 30 + text.length * 20;

/** 지도 위에 얹는 이름표. 그림 밖으로 나가지 않게 왼쪽으로 당긴다. */
function Chip({x, y, text, tone}: {x: number; y: number; text: string; tone?: string}) {
  const width = chipWidth(text);
  return (
    <g transform={`translate(${n1(Math.max(10, Math.min(W - width - 10, x)))} ${n1(y)})`}>
      <rect
        x="0"
        y="-23"
        width={width}
        height="46"
        rx="23"
        fill="var(--color-background-card)"
        stroke={tone ?? 'var(--color-border-emphasized)'}
        strokeWidth="2.5"
      />
      <text x={width / 2} y="8" textAnchor="middle" fontSize="23" fontWeight="600" fill="var(--color-text-primary)">
        {text}
      </text>
    </g>
  );
}

const SOURCE_LABEL: Record<DriveFrame['source'], string> = {
  sim: '시뮬레이션 · 가상 경로',
  navi: 'Pleos 내비 값으로 그린 약도',
  test: '시험 주행 · 위치만 가상',
};

const sourceLabel = (frame: DriveFrame) =>
  frame.source === 'navi' && frame.speedFrom === 'vehicle' ? '차량 속도로 그린 약도' : SOURCE_LABEL[frame.source];

/** 같은 정체 구간의 감자들이 서 있는 자리. 내 차 앞뒤로 한 줄. 정확한 위치는 아무도 모른다. */
const MATE_OFFSETS = [25, 45, -25, 65, -45, 85];

export function RoadMap({
  frame,
  breed,
  squadSize,
  bumpHint,
}: {
  frame: DriveFrame;
  breed: Breed;
  /** 지금 같은 정체 구간에 서 있는 감자 수. 0이면 그리지 않는다. */
  squadSize: number;
  /** 가장 가까운 방지턱 옆에 함께 적을 말. 커피 운송작전에서 안전 속도를 적는다. */
  bumpHint?: string;
}) {
  const {route, geometry, meters, pose} = frame;
  const chunk = Math.floor(meters / CHUNK);
  const from = chunk * CHUNK - 150;
  const to = (chunk + 1) * CHUNK + 190;
  const lineFrom = Math.max(0, from);
  const lineTo = Math.min(geometry.total, to);

  const marks = useMemo(() => marksOf(route, geometry, lineFrom, lineTo), [route, geometry, lineFrom, lineTo]);

  const world = `translate(${CAR.x} ${CAR.y}) scale(${SCALE}) rotate(${n1(-pose.heading * DEG)}) translate(${n1(-pose.x)} ${n1(-pose.y)})`;
  const cos = Math.cos(-pose.heading);
  const sin = Math.sin(-pose.heading);
  const toScreen = (p: Pose) => {
    const dx = p.x - pose.x;
    const dy = p.y - pose.y;
    return {x: CAR.x + SCALE * (dx * cos - dy * sin), y: CAR.y + SCALE * (dx * sin + dy * cos)};
  };

  const nextBump = route.bumps.find(bump => bump > meters - 1 && bump - meters < 150);
  const bumpAt = nextBump === undefined ? null : toScreen(poseAt(geometry, nextBump));
  const endAt = geometry.total - meters < 150 ? toScreen(poseAt(geometry, geometry.total)) : null;
  const mates = MATE_OFFSETS.slice(0, Math.min(squadSize, MATE_OFFSETS.length))
    .map(offset => meters + offset)
    .filter(s => s > 0 && s < geometry.total);
  const kph = Math.round(frame.speed * 3.6);
  const stroke = {fill: 'none', strokeLinejoin: 'round' as const};

  return (
    <svg
      role="img"
      aria-label={`주행 지도. 시속 ${kph}km, 도착지까지 ${formatDistance(frame.remainMeters)}`}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMax slice"
      width="100%"
      style={{display: 'block', maxHeight: 'calc(100vh - 13rem)', borderRadius: '0.75rem'}}>
      <rect width={W} height={H} fill={COLOR.ground} />
      <g transform={world}>
        <World geometry={geometry} from={from} to={to} />
        {/* 갈 길. 지나온 만큼은 지운다. */}
        {lineTo > lineFrom && (
          <path
            d={marks.line}
            stroke="var(--color-accent)"
            strokeWidth="5.5"
            strokeDasharray={`0 ${n1(Math.max(0, meters - lineFrom))} 100000`}
            {...stroke}
          />
        )}
        {/* 막히는 구간. 길 전체를 물들이고 가운데에 진한 줄을 긋는다. */}
        {marks.jams.map((jam, i) => {
          const color = jam.level === 'heavy' ? 'var(--color-error)' : 'var(--color-warning)';
          return (
            <g key={i} stroke={color} strokeLinecap="butt" {...stroke}>
              <path d={jam.d} strokeWidth={ROAD - 1} opacity="0.3" />
              <path d={jam.d} strokeWidth="6.5" />
            </g>
          );
        })}
        {/* 과속방지턱. 길을 가로지르는 노란 줄무늬. */}
        {marks.bumps.map(bump => (
          <g key={bump.s} transform={bump.at}>
            <rect x={-ROAD / 2} y="-2.6" width={ROAD} height="5.2" rx="2" fill="var(--color-warning)" stroke="var(--color-text-primary)" strokeWidth="0.6" />
            {[-6, -2, 2, 6].map(x => (
              <path key={x} d={`M${x - 1.6} 2.4L${x + 1.6} -2.4`} stroke="var(--color-text-primary)" strokeWidth="1.5" />
            ))}
          </g>
        ))}
        {marks.end && (
          <g transform={marks.end}>
            <circle r="7.5" fill="var(--color-background-card)" stroke="var(--color-accent)" strokeWidth="3" />
            <circle r="2.6" fill="var(--color-accent)" />
          </g>
        )}
        {mates.map(s => (
          <g key={s - meters} transform={at(poseAt(geometry, s))}>
            <g transform={`scale(${0.62 / SCALE})`}>
              <Car breed="sumi" color={mix(46)} />
            </g>
          </g>
        ))}
      </g>

      {bumpAt && bumpAt.y > 40 && (
        <Chip
          x={bumpAt.x + 44}
          y={Math.min(CAR.y - 70, bumpAt.y)}
          text={`방지턱 ${formatDistance(Math.max(0, nextBump! - meters))}${bumpHint ? ` · ${bumpHint}` : ''}`}
          tone="var(--color-warning)"
        />
      )}
      {endAt && endAt.y > 40 && (
        <Chip
          x={endAt.x + 36}
          y={Math.min(CAR.y - 70, endAt.y)}
          text={frame.destination ? `도착 · ${frame.destination}` : '도착'}
          tone="var(--color-accent)"
        />
      )}

      {/* 내 차. 방지턱 위에서는 살짝 들린다. */}
      <g transform={`translate(${CAR.x} ${CAR.y - (frame.forces.onBump ? 5 : 0)})`}>
        <ellipse cx="0" cy={frame.forces.onBump ? 11 : 5} rx="27" ry="42" fill="var(--color-text-primary)" opacity="0.16" />
        <Car breed={breed} color="var(--color-accent)" size={frame.forces.onBump ? 1.06 : 1} />
      </g>

      <Chip x={16} y={H - 40} text={`${kph}km/h`} />
      {/* 그림이 잘려도 보이도록 아래쪽에 둔다. */}
      <g transform={`translate(${W - 16} ${H - 59})`}>
        <rect x={-(30 + sourceLabel(frame).length * 17)} width={30 + sourceLabel(frame).length * 17} height="38" rx="19" fill={COLOR.glass} />
        <text x="-15" y="26" textAnchor="end" fontSize="19" fill="var(--color-text-secondary)">
          {sourceLabel(frame)}
        </text>
      </g>
    </svg>
  );
}

/** 길 위에 얹는 표시. 길과 구간이 바뀔 때만 다시 계산한다. */
function marksOf(route: Route, geometry: Geometry, from: number, to: number) {
  return {
    line: to > from ? pathBetween(geometry, from, to) : '',
    jams: route.jams
      .filter(jam => jam.to > from && jam.from < to)
      .map(jam => ({
        level: jam.level,
        d: pathBetween(geometry, Math.max(jam.from, from), Math.min(jam.to, to)),
      })),
    bumps: route.bumps
      .filter(s => s > from - 20 && s < to + 20)
      .map(s => ({s, at: at(poseAt(geometry, s))})),
    end: geometry.total <= to + 20 ? at(poseAt(geometry, geometry.total)) : null,
  };
}
