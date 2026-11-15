import {Button} from '@astryxdesign/core/Button';
import {Divider} from '@astryxdesign/core/Divider';
import {Drawer, DrawerHeader} from '@astryxdesign/core/Drawer';
import {Heading} from '@astryxdesign/core/Heading';
import {Layout, LayoutContent} from '@astryxdesign/core/Layout';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import {Grid} from '@astryxdesign/core/Grid';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {
  DEMO_SCENARIOS,
  SCENARIOS,
  allowedSignals,
  phaseOf,
  type TripPhase,
  type VehicleSignal,
} from '../core/hq';
import {setHabit, useHabit} from '../app/drive';
import {useHq} from '../app/store';
import type {DriveStyle} from '../core/drive';
import {advanceCalendar, resetClock, useNow} from '../sim/clock';
import {
  chooseScenario,
  sendSignal,
  sendTestBump,
  sendTestCongestion,
  startAutoDemo,
  startTestDrive,
  stopAutoDemo,
  stopTestDrive,
  useSimulator,
  type DemoScenarioId,
} from '../sim/simulator';
import {formatDateTime} from '../ui/format';

const SIGNALS: {signal: VehicleSignal; label: string}[] = [
  {signal: 'board', label: '탑승'},
  {signal: 'depart', label: '출발'},
  {signal: 'congestion-start', label: '정체 진입'},
  {signal: 'congestion-end', label: '정체 해소'},
  {signal: 'park', label: '주차'},
];

const PHASE_LABEL: Record<TripPhase, string> = {
  idle: '대기',
  boarded: '탑승',
  driving: '주행',
  congested: '정체',
  parked: '주차',
};

const HABITS: {value: DriveStyle; label: string}[] = [
  {value: 'gentle', label: '부드럽게'},
  {value: 'normal', label: '보통'},
  {value: 'rough', label: '거칠게'},
];

/** 가상 운전자의 운전 습관. 거칠게 몰면 방지턱과 회전에서 커피가 넘친다. */
function HabitControl() {
  const habit = useHabit();
  return (
    <VStack gap={2}>
      <SegmentedControl
        label="운전 습관"
        layout="fill"
        value={habit}
        onChange={value => setHabit(value as DriveStyle)}>
        {HABITS.map(({value, label}) => (
          <SegmentedControlItem key={value} value={value} label={label} />
        ))}
      </SegmentedControl>
      <Text type="supporting" color="secondary">
        가상 운전자가 방지턱과 회전을 얼마나 빨리 지나는지 정합니다. 커피 운송작전에서 거칠게 몰면 커피가 넘칩니다. 주행 중에도 바꿀 수 있습니다.
      </Text>
    </VStack>
  );
}

/**
 * 시뮬레이터. 실제 차량과 내비가 보낼 신호를 대신 보낸다.
 * 앱 본체가 아니라 차량 쪽이므로, 주행 잠금 중에도 열 수 있다.
 */
export function SimulatorDrawer({
  isOpen,
  onOpenChange,
  isRealVehicle,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** 실제 차량 신호를 받고 있다. 이때는 차량이 주지 못하는 정체만 시험 값으로 넣을 수 있다. */
  isRealVehicle: boolean;
}) {
  const hq = useHq();
  const at = useNow();
  const {scenario, isAutoDemoRunning, isTestDriving} = useSimulator();
  const phase = phaseOf(hq);
  const isMoving = phase === 'driving' || phase === 'congested';
  const allowed = allowedSignals(hq);
  const hasPotato = hq.potato !== null;

  if (isRealVehicle)
    return (
      <Drawer
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        label="시험 값"
        purpose="info"
        hasScrim={false}
        width="24rem">
        <Layout
          header={
            <DrawerHeader
              title="시험 값"
              subtitle="차량이 주지 못하는 신호를 직접 넣습니다"
              onOpenChange={onOpenChange}
            />
          }
          content={
            <LayoutContent>
              <VStack gap={4}>
                <Text type="body" color="secondary">
                  기어는 차량에서 실제로 받습니다. 내비 경로 위의 정체는 에뮬레이터에서 만들 수 없어 여기서 넣습니다.
                </Text>
                <Text type="supporting" color="secondary">
                  운행 단계 · {PHASE_LABEL[phase]}
                </Text>
                <Grid columns={2} gap={2}>
                  <Button
                    label="정체 진입"
                    variant={allowed.includes('congestion-start') ? 'primary' : 'secondary'}
                    isDisabled={!allowed.includes('congestion-start')}
                    onClick={() => sendTestCongestion('congestion-start')}
                    width="100%"
                  />
                  <Button
                    label="정체 해소"
                    variant={allowed.includes('congestion-end') ? 'primary' : 'secondary'}
                    isDisabled={!allowed.includes('congestion-end')}
                    onClick={() => sendTestCongestion('congestion-end')}
                    width="100%"
                  />
                </Grid>
                <Button
                  label={isTestDriving ? '과속방지턱 놓기 (70m 앞)' : '과속방지턱 통과'}
                  variant="secondary"
                  isDisabled={phase !== 'driving' && phase !== 'congested'}
                  onClick={sendTestBump}
                  width="100%"
                />
                <Text type="supporting" color="secondary">
                  주행 중(기어 D)에만 켜집니다. Pleos 연동 화면의 로그에 "시험 값"으로 남습니다.
                </Text>
                <Divider />
                <Heading level={4}>시험 주행</Heading>
                <Text type="body" color="secondary">
                  에뮬레이터의 차는 제자리에 서 있습니다. 내비가 준 길 위를 가상의 차로 달려, 지도와 커피 컵이 움직이는 모습을 봅니다. 길은 내비 값 그대로이고 위치만 가상입니다.
                </Text>
                {isTestDriving ? (
                  <Button label="시험 주행 멈추기" variant="secondary" onClick={stopTestDrive} width="100%" />
                ) : (
                  <Button
                    label="시험 주행 시작"
                    variant="primary"
                    isDisabled={!isMoving}
                    onClick={startTestDrive}
                    width="100%"
                  />
                )}
                <HabitControl />
              </VStack>
            </LayoutContent>
          }
        />
      </Drawer>
    );

  return (
    <Drawer
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      label="시뮬레이터"
      purpose="info"
      hasScrim={false}
      width="24rem">
      <Layout
        header={
          <DrawerHeader
            title="시뮬레이터"
            subtitle="차량과 내비가 보낼 신호를 대신 보냅니다"
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent>
            <VStack gap={5}>
              <VStack gap={1}>
                <Text type="label" color="secondary">
                  시뮬레이션 시각
                </Text>
                <Heading level={3}>{formatDateTime(at)}</Heading>
                <Text type="supporting" color="secondary">
                  운행 단계 · {PHASE_LABEL[phase]}
                </Text>
              </VStack>

              {!hasPotato && (
                <Text type="body" color="secondary">
                  감자를 먼저 만나야 차량 신호를 보낼 수 있습니다.
                </Text>
              )}

              <VStack gap={2}>
                <Heading level={4}>시나리오</Heading>
                <SegmentedControl
                  label="시나리오"
                  layout="fill"
                  value={scenario}
                  onChange={value => chooseScenario(value as DemoScenarioId)}
                  isDisabled={phase !== 'idle' || isAutoDemoRunning}
                  disabledMessage="운행 중에는 시나리오를 바꿀 수 없습니다">
                  {DEMO_SCENARIOS.map(id => (
                    <SegmentedControlItem key={id} value={id} label={SCENARIOS[id].label} />
                  ))}
                </SegmentedControl>
                <Text type="supporting" color="secondary">
                  {SCENARIOS[scenario].from} → {SCENARIOS[scenario].to} · 정체 구간{' '}
                  {SCENARIOS[scenario].road}
                </Text>
              </VStack>

              <VStack gap={2}>
                <Heading level={4}>차량 신호</Heading>
                <Grid columns={2} gap={2}>
                  {SIGNALS.map(({signal, label}) => (
                    <Button
                      key={signal}
                      label={label}
                      variant={allowed.includes(signal) ? 'primary' : 'secondary'}
                      isDisabled={!allowed.includes(signal) || isAutoDemoRunning}
                      onClick={() => sendSignal(signal)}
                      width="100%"
                    />
                  ))}
                </Grid>
                <Button
                  label="과속방지턱 놓기 (70m 앞)"
                  variant="secondary"
                  isDisabled={(phase !== 'driving' && phase !== 'congested') || isAutoDemoRunning}
                  onClick={sendTestBump}
                  width="100%"
                />
                <Text type="supporting" color="secondary">
                  지금 보낼 수 있는 신호만 켜집니다. 출발하면 가상의 차가 길을 달리고, 길 위의 정체 구간과 도착지에 닿으면 정체와 주차 신호가 저절로 나갑니다.
                </Text>
              </VStack>

              <VStack gap={2}>
                <Heading level={4}>운전 습관</Heading>
                <HabitControl />
              </VStack>

              <VStack gap={2}>
                <Heading level={4}>자동 시연</Heading>
                {isAutoDemoRunning ? (
                  <Button label="시연 멈추기" variant="secondary" onClick={stopAutoDemo} />
                ) : (
                  <Button
                    label="탑승부터 주차까지 자동 재생"
                    variant="secondary"
                    isDisabled={!hasPotato || phase !== 'idle'}
                    onClick={startAutoDemo}
                  />
                )}
                <Text type="supporting" color="secondary">
                  탑승하고 출발한 뒤 도착까지 저절로 달립니다. 판교 출근길(실제 지도)은 약 5분, 다른 길은 약 2분 걸립니다. 주차한 뒤에는 직접 결과를 확인하세요.
                </Text>
              </VStack>

              <Divider />

              <VStack gap={2}>
                <Heading level={4}>날짜 돌리기</Heading>
                <HStack gap={2} wrap="wrap">
                  <Button label="하루 뒤" variant="secondary" size="sm" isDisabled={phase !== 'idle'} onClick={() => advanceCalendar('day')} />
                  <Button label="한 달 뒤" variant="secondary" size="sm" isDisabled={phase !== 'idle'} onClick={() => advanceCalendar('month')} />
                  <Button label="일 년 뒤" variant="secondary" size="sm" isDisabled={phase !== 'idle'} onClick={() => advanceCalendar('year')} />
                  <Button label="실제 시각으로" variant="ghost" size="sm" isDisabled={phase !== 'idle'} onClick={resetClock} />
                </HStack>
                <Text type="supporting" color="secondary">
                  추억 회상을 시연할 때 씁니다. 일지를 저장한 뒤 일 년 뒤로 돌리면 홈에 회상이 뜹니다.
                </Text>
              </VStack>
            </VStack>
          </LayoutContent>
        }
      />
    </Drawer>
  );
}
