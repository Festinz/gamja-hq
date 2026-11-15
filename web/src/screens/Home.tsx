import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Grid} from '@astryxdesign/core/Grid';
import {Heading} from '@astryxdesign/core/Heading';
import {Item} from '@astryxdesign/core/Item';
import {List} from '@astryxdesign/core/List';
import {HStack, StackItem, VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {
  BREEDS,
  SCENARIOS,
  canAskAboutCup,
  chosenCup,
  clock,
  josa,
  potatoLine,
  recallsAt,
  streakAt,
} from '../core/hq';
import {armCoffee} from '../app/cupQuestion';
import {useHq} from '../app/store';
import {useNow} from '../sim/clock';
import type {View} from '../App';
import {CupPicker} from '../ui/CupPicker';
import {daysTogether, formatDateTime, routeLabel} from '../ui/format';
import {Page} from '../ui/Page';
import {Potato} from '../ui/Potato';
import {RecallCard} from '../ui/RecallCard';

/** 한눈에 읽는 숫자 하나. 테두리 없이 조용히 놓는다. */
function Figure({label, value, hint}: {label: string; value: string; hint: string}) {
  return (
    <VStack gap={1}>
      <Text type="supporting" color="secondary">
        {label}
      </Text>
      <Heading level={2}>{value}</Heading>
      <Text type="supporting" color="secondary">
        {hint}
      </Text>
    </VStack>
  );
}

/** 홈. 감자의 한마디, 오늘의 운행, 쌓인 기록을 한 화면에서 읽는다. */
export function Home({
  onOpenSimulator,
  onNavigate,
  isRealVehicle,
}: {
  /** 실제 차량 신호를 받고 있다. 시뮬레이터로 가는 버튼을 감춘다. */
  isRealVehicle: boolean;
  onOpenSimulator: () => void;
  onNavigate: (view: View) => void;
}) {
  const hq = useHq();
  const at = useNow();
  const potato = hq.potato!;
  const line = potatoLine(hq, at);
  const recalls = recallsAt(hq, at);
  const streak = streakAt(hq, at);
  const trip = hq.trip;
  const coffee = trip?.coffee ?? hq.mission.coffee;

  return (
    <Page
      title="오늘의 드라이브"
      description={`${formatDateTime(at)} · ${potato.name}${josa(potato.name, '과', '와')} 함께한 지 ${daysTogether(potato.metAt, at)}일째`}>
      <Card padding={6}>
        <HStack gap={6} vAlign="center" wrap="wrap">
          <Potato
            breed={potato.breed}
            accessory={potato.accessory}
            mood={line.mood}
            name={potato.name}
            size={170}
          />
          <StackItem size="fill">
            <VStack gap={3}>
              <Text type="supporting" color="secondary">
                {potato.name} · {BREEDS[potato.breed]}
              </Text>
              <Heading level={1} textWrap="balance">
                {line.text}
              </Heading>
              <HStack gap={2} wrap="wrap">
                {!isRealVehicle && (
                  <Button
                    label={trip ? '시뮬레이터에서 출발' : '시뮬레이터에서 탑승'}
                    variant="primary"
                    size="lg"
                    onClick={onOpenSimulator}
                  />
                )}
                {!coffee && (
                  <Button
                    label="커피 운송작전 켜기"
                    variant="secondary"
                    size="lg"
                    onClick={armCoffee}
                  />
                )}
              </HStack>
            </VStack>
          </StackItem>
        </HStack>
      </Card>

      {/* 커피 운송작전을 켜면 감자가 실은 커피를 묻는다. 주차한 채(기어 P)일 때만 나온다. */}
      {canAskAboutCup(hq) && (
        <Card padding={5}>
          <CupPicker />
        </Card>
      )}

      {recalls.map(recall => (
        <RecallCard key={recall.key} recall={recall} potatoName={potato.name} />
      ))}

      <Card padding={5}>
        <Grid columns={{minWidth: 140, max: 4}} gap={5}>
          <Figure
            label="지금"
            value={trip ? '탑승' : '대기'}
            hint={
              trip
                ? routeLabel(trip.from, trip.to)
                : isRealVehicle
                  ? '기어를 D로 옮기면 출발'
                  : '차에 타면 시작'
            }
          />
          <Figure
            label="연속 탑승"
            value={`${streak}일`}
            hint={streak > 0 ? '내일도 타면 이어집니다' : '오늘 운행을 마치면 1일'}
          />
          <Figure
            label="함께한 운행"
            value={`${hq.stats.trips}회`}
            hint={`정체에서 보낸 시간 ${hq.stats.congestionMinutes}분`}
          />
          <Figure
            label="길에서 만난 감자"
            value={`${hq.stats.squadMates}마리`}
            hint={`받은 스티커 ${hq.stats.stickersReceived}장`}
          />
        </Grid>
      </Card>

      <Grid columns={{minWidth: 320, max: 2}} gap={4} align="start">
        <Card padding={5}>
          <VStack gap={3}>
            <Heading level={3}>오늘의 운행</Heading>
            {trip ? (
              <List hasDividers density="compact">
                <Item label="운행" endContent={<Text>{SCENARIOS[trip.scenario].label}</Text>} />
                <Item label="경로" endContent={<Text>{routeLabel(trip.from, trip.to)}</Text>} />
                <Item label="탑승" endContent={<Text>{clock(trip.boardedAt)}</Text>} />
                <Item
                  label="커피 운송작전"
                  endContent={<Text>{coffee ? (chosenCup(hq)?.label ?? '켜짐 · 기본 컵') : '꺼짐'}</Text>}
                />
              </List>
            ) : (
              <Text type="body" color="secondary">
                {isRealVehicle
                  ? '대기 중입니다. 기어를 D로 옮기면 운행이 시작되고 화면이 잠깁니다.'
                  : '대기 중입니다. 실제 차량에서는 기어를 D로 옮기면 시작되고, 여기서는 시뮬레이터가 차량 신호를 대신 보냅니다.'}
                {coffee ? ' 다음 운행은 커피 운송작전입니다.' : ''}
              </Text>
            )}
            {trip && (
              <Text type="supporting" color="secondary">
                출발하면 화면이 잠기고 감자가 음성으로만 안내합니다.
              </Text>
            )}
          </VStack>
        </Card>

        <Card padding={5}>
          <VStack gap={3}>
            <Heading level={3}>쌓인 기록</Heading>
            <List hasDividers density="compact">
              <Item label="작전일지" endContent={<Text>{`${hq.diary.length}편`}</Text>} />
              <Item label="타임캡슐" endContent={<Text>{`${hq.capsules.length}개`}</Text>} />
            </List>
            <HStack>
              <Button label="작전일지 보기" variant="secondary" onClick={() => onNavigate('diary')} />
            </HStack>
          </VStack>
        </Card>
      </Grid>
    </Page>
  );
}
