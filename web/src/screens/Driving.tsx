import {useMemo} from 'react';
import * as stylex from '@stylexjs/stylex';
import {Card} from '@astryxdesign/core/Card';
import {Grid} from '@astryxdesign/core/Grid';
import {Heading} from '@astryxdesign/core/Heading';
import {Icon} from '@astryxdesign/core/Icon';
import {HStack, StackItem, VStack} from '@astryxdesign/core/Stack';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Text} from '@astryxdesign/core/Text';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ArrowUturnLeftIcon,
} from '@heroicons/react/24/outline';
import {
  G,
  cupStatus,
  leftPercent,
  spillLimitDeg,
  tiltDeg,
  type CupState,
  type CupStatus,
} from '../core/cup';
import {advisedBumpKph} from '../core/cupSpec';
import {safeBumpSpeed, safeTurnSpeed, type RouteTurn} from '../core/drive';
import {clock, potatoLine} from '../core/hq';
import {useDrive, type DriveFrame} from '../app/drive';
import {formatDistance, formatDuration, type NaviSnapshot} from '../app/navi';
import {useHq} from '../app/store';
import {useNow} from '../sim/clock';
import {CoffeeCup} from '../ui/CoffeeCup';
import {Potato} from '../ui/Potato';
import {RealMap} from '../ui/RealMap';
import {RoadMap} from '../ui/RoadMap';
import {RouteStrip} from '../ui/RouteStrip';
import {useUiScale} from '../ui/scale';

// 지도가 넓고 안내 카드가 좁은 두 칸.
const styles = stylex.create({
  split: {gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)'},
});

const arcHalf = (turn: RouteTurn) => (turn.radius * turn.angleDeg * Math.PI) / 360;

function turnIcon(turn: RouteTurn) {
  if (turn.angleDeg >= 150) return ArrowUturnLeftIcon;
  return turn.direction === 'right' ? ArrowRightIcon : ArrowLeftIcon;
}

/** 경로 띠가 읽는 모양으로 바꾼다. 띠는 길 전체에서 지금 어디쯤인지를 보여준다. */
function stripOf(frame: DriveFrame): NaviSnapshot {
  const total = frame.route.totalMeters;
  return {
    isReal: frame.source === 'navi',
    destination: frame.destination,
    totalMeters: total,
    remainMeters: total - frame.meters,
    remainSeconds: frame.remainSeconds,
    next: null,
    traffic: frame.route.jams.map(jam => ({start: jam.from / total, end: jam.to / total, level: jam.level})),
    bumpsAheadMeters: frame.route.bumps.filter(at => at > frame.meters).map(at => at - frame.meters),
  };
}

/** 경로 띠 아래의 한 줄 요약. 앞쪽에서 가장 가까운 정체와 방지턱만 말한다. */
function aheadSummary(frame: DriveFrame): string {
  const parts: string[] = [];
  if (frame.jam) parts.push('지금 막히는 구간');
  else {
    const jam = frame.route.jams.find(j => j.from > frame.meters);
    if (jam) parts.push(`막히는 구간까지 ${formatDistance(jam.from - frame.meters)}`);
  }
  const bump = frame.route.bumps.find(at => at > frame.meters);
  if (bump !== undefined) parts.push(`과속방지턱 ${formatDistance(bump - frame.meters)} 앞`);
  return parts.length > 0 ? parts.join(' · ') : '앞쪽 흐름 원활';
}

const STATUS: Record<CupStatus, {label: string; variant: 'success' | 'warning' | 'error'}> = {
  calm: {label: '안전', variant: 'success'},
  sloshing: {label: '찰랑찰랑', variant: 'warning'},
  spilling: {label: '넘치는 중', variant: 'error'},
};

/** 지금 컵을 기울이는 것. 가장 큰 원인 하나만 말한다. */
function cause(frame: DriveFrame): string {
  const f = frame.forces;
  const g = (value: number) => `${(Math.abs(value) / G).toFixed(2)}g`;
  if (f.onBump) return `방지턱 위 · 위아래 ${g(f.accelVert)}`;
  if (Math.abs(f.accelLat) > 0.5)
    return `${f.accelLat > 0 ? '오른쪽' : '왼쪽'}으로 도는 중 · 옆으로 ${g(f.accelLat)}`;
  if (Math.abs(f.accelLong) > 0.5) return `${f.accelLong > 0 ? '가속' : '감속'} 중 · 앞뒤 ${g(f.accelLong)}`;
  if (Math.abs(f.gradePercent) >= 1)
    return `${f.gradePercent > 0 ? '오르막' : '내리막'} ${Math.abs(Math.round(f.gradePercent))}%`;
  return '평지 · 흔들림 없음';
}

/** 커피 운송작전의 컵. 수면의 기울기와 남은 양, 넘치지 않는 속도를 보여준다. */
function CoffeePanel({frame, cup, nextTurn}: {frame: DriveFrame; cup: CupState; nextTurn: RouteTurn | null}) {
  const scale = useUiScale();
  const cupNow = cupStatus(cup);
  // 뚜껑을 닫았으면 가장자리에 닿아도 마시는 구멍으로 조금 새는 것이다.
  const status = cupNow === 'spilling' && cup.spec.lid ? {...STATUS.spilling, label: '뚜껑 틈으로 새는 중'} : STATUS[cupNow];
  const spilled = Math.round(cup.spilledMl);
  // 안전 속도는 컵이나 컵에 든 양이 달라질 때만 다시 계산한다.
  const volumeStep = Math.round(cup.volumeMl / 5);
  // 시속 30km보다 빠른 방지턱 속도는 권하지 않는다(advisedBumpKph).
  const bumpKph = useMemo(
    () => advisedBumpKph(Math.floor(safeBumpSpeed({...cup, volumeMl: volumeStep * 5}) * 3.6 + 1e-9)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [volumeStep, cup.spec],
  );
  const bump = frame.route.bumps.find(at => at > frame.meters);
  const advice =
    bump !== undefined && bump - frame.meters < 250
      ? `방지턱 ${formatDistance(bump - frame.meters)} 앞 · ${bumpKph}km/h 아래로`
      : nextTurn && nextTurn.at - frame.meters < 250
        ? `회전 ${formatDistance(Math.max(0, nextTurn.at - frame.meters))} 앞 · ${Math.floor(
            safeTurnSpeed(cup, nextTurn.radius) * 3.6,
          )}km/h 아래로`
        : `방지턱은 ${bumpKph}km/h 아래로`;

  return (
    <HStack gap={4} vAlign="center">
      <CoffeeCup cup={cup} at={frame.at} width={Math.round(138 * scale)} />
      <StackItem size="fill">
        <VStack gap={1.5}>
          <HStack gap={2} vAlign="center">
            <StatusDot variant={status.variant} label={status.label} />
            <Text type="label">커피 운송작전 · {status.label}</Text>
          </HStack>
          <Heading level={1}>{leftPercent(cup.volumeMl, cup.spilledMl)}% 남음</Heading>
          <Text type="large">
            {Math.round(cup.volumeMl)}ml{spilled >= 1 ? ` · ${spilled}ml 흘림` : ''}
          </Text>
          <Text type="body" maxLines={1}>
            기울기 {Math.round(tiltDeg(cup))}° · 넘치는 한계 {Math.round(spillLimitDeg(cup))}°
          </Text>
          <Text type="body" color="secondary" maxLines={1}>
            {cause(frame)}
          </Text>
          <Text type="body" maxLines={1}>
            {advice}
          </Text>
          <Text type="supporting" color="secondary" maxLines={2}>
            {cup.spec.pick ? `${cup.spec.label} · 어림` : '뚜껑 없는 기본 컵'} ·{' '}
            {frame.usesSensor ? '차량 가속도 센서로 계산' : '길과 속도로 계산'}
          </Text>
        </VStack>
      </StackItem>
    </HStack>
  );
}

/**
 * 주행 잠금 화면. 내비가 길을 안내하고 있으면 지도 위를 달리는 차, 다음 회전, 도착 예정을 보여주고
 * 커피 운송작전 중이면 컵을, 아니면 경로 전체의 띠를 둔다. 맨 아래에는 감자와 한 줄 문장이 있다.
 * 누를 수 있는 것이 없고, 다른 감자의 이름이나 정확한 위치도 보이지 않는다.
 * 지도와 컵은 차의 실제 상태를 따라 움직이는 계기이고, 그 밖에 꾸밈으로 움직이는 것은 없다.
 */
export function Driving() {
  const hq = useHq();
  const at = useNow();
  const frame = useDrive();
  const potato = hq.potato!;
  const line = potatoLine(hq, at);
  const operation = hq.trip?.phase === 'congested' ? hq.trip.operation : null;
  const hasMap = frame !== null && frame.hasGuidance;
  const nextTurn = frame?.route.turns.find(turn => turn.at + arcHalf(turn) > frame.meters) ?? null;
  const bumpKph = useBumpKph(frame?.cup ?? null);

  const companion = (
    <Card padding={4}>
      <HStack gap={4} vAlign="center">
        <Potato
          breed={potato.breed}
          accessory={potato.accessory}
          mood={line.mood}
          name={potato.name}
          size={hasMap ? 84 : 200}
        />
        <StackItem size="fill">
          <VStack gap={1.5}>
            <Heading level={1} type={hasMap ? undefined : 'display-2'} textWrap="balance">
              {frame?.note ?? line.text}
            </Heading>
            <HStack gap={3} vAlign="center" wrap="wrap">
              {operation && (
                <HStack gap={2} vAlign="center">
                  <StatusDot variant="accent" label="같은 길의 감자들과 함께하는 중" />
                  <Text type="large">{operation.name} 중</Text>
                </HStack>
              )}
              <Text type="body" color="secondary" maxLines={1}>
                주행 중에는 화면을 조작할 수 없습니다. 결과는 주차한 뒤에 확인하세요.
              </Text>
            </HStack>
          </VStack>
        </StackItem>
      </HStack>
    </Card>
  );

  // 길의 실제 모양을 알면 실제 지도를, 모르면(또는 지도를 불러오지 못하면) 내비 값으로 그린 약도를 보여준다.
  const schematic = frame && (
    <RoadMap
      frame={frame}
      breed={potato.breed}
      squadSize={operation?.squadSize ?? 0}
      bumpHint={bumpKph === null ? undefined : `${bumpKph}km/h 아래로`}
    />
  );

  if (!frame || !hasMap)
    return (
      <VStack gap={4} padding={6} height="100%" vAlign="center">
        {frame?.cup && (
          <Card padding={5}>
            <CoffeePanel frame={frame} cup={frame.cup} nextTurn={null} />
          </Card>
        )}
        {companion}
      </VStack>
    );

  return (
    <VStack gap={3} padding={4} height="100%">
      <Grid columns={2} gap={3} xstyle={styles.split}>
        <Card padding={2}>
          {frame.geo ? (
            <RealMap
              frame={frame}
              breed={potato.breed}
              squadSize={operation?.squadSize ?? 0}
              bumpHint={bumpKph === null ? undefined : `${bumpKph}km/h 아래로`}
              fallback={schematic}
            />
          ) : (
            schematic
          )}
        </Card>
        <VStack gap={3}>
          <Card padding={4}>
            {nextTurn ? (
              <HStack gap={4} vAlign="center">
                <Icon icon={turnIcon(nextTurn)} size="lg" color="accent" />
                <VStack gap={0.5}>
                  <Heading level={1}>{formatDistance(Math.max(0, nextTurn.at - frame.meters))}</Heading>
                  <Text type="large" color="secondary" maxLines={1}>
                    {nextTurn.label}
                  </Text>
                </VStack>
              </HStack>
            ) : (
              <HStack gap={4} vAlign="center">
                <Icon icon={ArrowUpIcon} size="lg" color="accent" />
                <VStack gap={0.5}>
                  <Heading level={1}>{formatDistance(frame.route.totalMeters - frame.meters)}</Heading>
                  <Text type="large" color="secondary" maxLines={1}>
                    도착지까지 직진
                  </Text>
                </VStack>
              </HStack>
            )}
          </Card>
          <Card padding={4}>
            <VStack gap={0.5}>
              <Heading level={1}>{clock(at + frame.remainSeconds * 1000)} 도착</Heading>
              <Text type="large" color="secondary" maxLines={1}>
                {formatDistance(frame.remainMeters)} · {formatDuration(frame.remainSeconds)} 남음
                {frame.destination ? ` · ${frame.destination}` : ''}
              </Text>
            </VStack>
          </Card>
          <Card padding={4}>
            {frame.cup ? (
              <CoffeePanel frame={frame} cup={frame.cup} nextTurn={nextTurn} />
            ) : (
              <VStack gap={2}>
                <RouteStrip navi={stripOf(frame)} squadSize={operation?.squadSize ?? 0} />
                <Text type="large">{aheadSummary(frame)}</Text>
                <Text type="supporting" color="secondary">
                  경로 전체에서 지금 위치, 막히는 구간, 과속방지턱
                </Text>
              </VStack>
            )}
          </Card>
        </VStack>
      </Grid>
      {companion}
    </VStack>
  );
}

/** 지금 컵(운행에 고른 컵)으로 방지턱을 넘을 때의 안전 속도 (km/h). 커피 운송작전이 아니면 null. */
function useBumpKph(cup: CupState | null): number | null {
  const volumeStep = cup ? Math.round(cup.volumeMl / 5) : null;
  return useMemo(
    () =>
      cup && volumeStep !== null ? Math.floor(safeBumpSpeed({...cup, volumeMl: volumeStep * 5}) * 3.6 + 1e-9) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [volumeStep, cup?.spec],
  );
}
