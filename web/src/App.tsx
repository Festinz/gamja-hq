import {useEffect, useRef, useState} from 'react';
import * as stylex from '@stylexjs/stylex';
import {AppShell} from '@astryxdesign/core/AppShell';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Heading} from '@astryxdesign/core/Heading';
import {
  SideNav,
  SideNavItem,
  SideNavSection,
} from '@astryxdesign/core/SideNav';
import {Section} from '@astryxdesign/core/Section';
import {HStack, StackItem, VStack} from '@astryxdesign/core/Stack';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Text} from '@astryxdesign/core/Text';
import {
  BookOpenIcon,
  ClipboardDocumentCheckIcon,
  Cog6ToothIcon,
  CpuChipIcon,
  HomeIcon,
} from '@heroicons/react/24/outline';
import {isDrivingLocked, parkingReminderDue, phaseOf, potatoLine} from './core/hq';
import {setSpeaker} from './app/drive';
import {dispatch, getState, useHq} from './app/store';
import {now, useNow} from './sim/clock';
import {hush, speak} from './sim/voice';
import {resumeDrive, useSimulator, virtualCluster} from './sim/simulator';
import {hasRealSignals, requestComfortRoute, useHostStatus} from './native/host';
import {formatDateTime} from './ui/format';
import {Onboarding} from './screens/Onboarding';
import {Home} from './screens/Home';
import {Driving} from './screens/Driving';
import {DebriefScreen} from './screens/Debrief';
import {Diary} from './screens/Diary';
import {Missions} from './screens/Missions';
import {Settings} from './screens/Settings';
import {Integration} from './screens/Integration';
import {SimulatorDrawer} from './screens/SimulatorDrawer';

// 주행 중 감자가 하는 말(방지턱 미리 알림, 커피 넘침)도 음성 안내를 켰을 때만 소리로 낸다.
setSpeaker((text, urgent) => {
  if (getState().prefs.voice) speak(text, urgent);
});

// 한글은 단어 중간에서 줄이 바뀌지 않게 한다.
const styles = stylex.create({
  app: {wordBreak: 'keep-all'},
});

export type View = 'home' | 'diary' | 'missions' | 'integration' | 'settings';

const NAV: {view: View; label: string; icon: typeof HomeIcon}[] = [
  {view: 'home', label: '홈', icon: HomeIcon},
  {view: 'diary', label: '작전일지', icon: BookOpenIcon},
  {view: 'missions', label: '도우미', icon: ClipboardDocumentCheckIcon},
  {view: 'integration', label: 'Pleos 연동', icon: CpuChipIcon},
  {view: 'settings', label: '설정', icon: Cog6ToothIcon},
];

export default function App() {
  const hq = useHq();
  const at = useNow();
  const [view, setView] = useState<View>('home');
  const [isSimulatorOpen, setSimulatorOpen] = useState(false);

  const host = useHostStatus();
  const isRealVehicle = hasRealSignals(host);
  const sourceLabel = isRealVehicle
    ? 'Pleos 연결됨'
    : host.isNative
      ? 'Pleos 서비스 없음'
      : '시뮬레이션';
  const {caption} = useSimulator();
  const sourceDetail = isRealVehicle
    ? '기어는 실제 차량 신호, 다른 감자는 가상'
    : host.isNative
      ? '이 기기에는 Pleos 차량 서비스가 없어 시뮬레이터로 동작'
      : `가상 차량 · ${virtualCluster(phaseOf(hq))}`;

  const locked = isDrivingLocked(hq);
  // 출발하면 홈으로 돌려놓는다. 주차했을 때 어느 메뉴에 있었든 도착 화면이 먼저 보인다.
  useEffect(() => {
    if (locked) setView('home');
  }, [locked]);
  const hasNav = hq.potato !== null && !locked;

  // 브라우저에서 주행 중에 새로 고쳤으면 가상의 차를 다시 세운다.
  useEffect(() => {
    if (!host.isNative) resumeDrive();
  }, [host.isNative]);

  // 주차하면 주행 중에 기다리던 말(방지턱, 사고 다발 지점, 휴게소)을 버린다. 도착 인사보다 먼저 멈춘다.
  const wasLocked = useRef(locked);
  useEffect(() => {
    if (wasLocked.current && !locked) hush();
    wasLocked.current = locked;
  }, [locked]);
  // 음성 안내를 끄면 하던 말과 기다리던 말도 멈춘다.
  const voiceOn = hq.prefs.voice;
  useEffect(() => {
    if (!voiceOn) hush();
  }, [voiceOn]);

  // 운행 중 감자의 대사가 바뀌면 음성으로 안내한다. 주행 중에는 화면 대신 음성이 주 통로다.
  const spokenLine = hq.trip && hq.prefs.voice ? potatoLine(hq, now()).text : null;
  const lastSpoken = useRef(spokenLine);
  useEffect(() => {
    if (spokenLine && spokenLine !== lastSpoken.current) speak(spokenLine);
    lastSpoken.current = spokenLine;
  }, [spokenLine]);

  // 커피 운송작전: 출발할 때 내비에 편안한 길을 청한다. 방지턱 알림은 주행 엔진이 미리 한다.
  const isCoffeeDrive = locked && hq.trip?.coffee === true;
  useEffect(() => {
    if (isCoffeeDrive) requestComfortRoute();
  }, [isCoffeeDrive]);

  const screen = () => {
    if (!hq.potato) return <Onboarding />;
    if (locked) return <Driving />;
    switch (view) {
      case 'home':
        return phaseOf(hq) === 'parked' ? (
          <DebriefScreen />
        ) : (
          <Home
            isRealVehicle={isRealVehicle}
            onOpenSimulator={() => setSimulatorOpen(true)}
            onNavigate={setView}
          />
        );
      case 'diary':
        return <Diary />;
      case 'missions':
        return <Missions />;
      case 'integration':
        return <Integration />;
      case 'settings':
        return <Settings />;
    }
  };

  return (
    <AppShell
      xstyle={styles.app}
      height="fill"
      contentPadding={0}
      banner={
        <Section variant="muted" paddingInline={4} paddingBlock={2} dividers={['bottom']}>
          <HStack gap={3} vAlign="center">
            <StackItem size="fill">
              <HStack gap={2} vAlign="center" wrap="wrap">
                <StatusDot
                  variant={isRealVehicle ? 'success' : 'warning'}
                  label={sourceLabel}
                />
                <Text type="label">{sourceLabel}</Text>
                <Text type="supporting" color="secondary">
                  {sourceDetail} · {formatDateTime(at)}
                </Text>
                {caption && !isRealVehicle && <Text type="label">{caption}</Text>}
              </HStack>
            </StackItem>
            <StackItem size="static">
              <Button
                label={isRealVehicle ? '시험 값' : '시뮬레이터'}
                variant="secondary"
                size="sm"
                onClick={() => setSimulatorOpen(true)}
              />
            </StackItem>
          </HStack>
        </Section>
      }
      sideNav={
        hasNav ? (
          <SideNav
            header={
              <VStack gap={0.5}>
                <Heading level={4}>감자 작전본부</Heading>
                <Text type="supporting" color="secondary">
                  Pleos Connect 프로토타입
                </Text>
              </VStack>
            }>
            <SideNavSection title="메뉴" isHeaderHidden>
              {NAV.map(item => (
                <SideNavItem
                  key={item.view}
                  label={item.label}
                  icon={item.icon}
                  isSelected={view === item.view}
                  onClick={() => setView(item.view)}
                />
              ))}
            </SideNavSection>
          </SideNav>
        ) : undefined
      }>
      <VStack height="100%">
        {hasNav && parkingReminderDue(hq, at) && (
          <Banner
            status="warning"
            container="section"
            title="주차 할인 등록, 잊지 않으셨죠?"
            description="매장을 떠나기 전에 주차 할인을 등록했는지 확인하세요."
            endContent={
              <Button
                label="등록 완료"
                variant="secondary"
                size="sm"
                onClick={() => dispatch({type: 'complete-parking-reminder'})}
              />
            }
          />
        )}
        {screen()}
      </VStack>
      <SimulatorDrawer
        isOpen={isSimulatorOpen}
        onOpenChange={setSimulatorOpen}
        isRealVehicle={isRealVehicle}
      />
    </AppShell>
  );
}
