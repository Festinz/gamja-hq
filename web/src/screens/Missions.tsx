import {useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Heading} from '@astryxdesign/core/Heading';
import {Item} from '@astryxdesign/core/Item';
import {List} from '@astryxdesign/core/List';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Switch} from '@astryxdesign/core/Switch';
import {Text} from '@astryxdesign/core/Text';
import {canAskAboutCup, clock, phaseOf} from '../core/hq';
import {nearestCoffeeStops, restAreaName} from '../core/publicdata';
import {CUP_CATALOG, armCoffee, disarmCoffee} from '../app/cupQuestion';
import {formatDistance, useNavi} from '../app/navi';
import {PUBLIC_DATA} from '../app/publicdata';
import {DEMO_START} from '../app/realroute';
import {dispatch, useHq} from '../app/store';
import {now, useNow} from '../sim/clock';
import {CupPicker} from '../ui/CupPicker';
import {Page} from '../ui/Page';

const REMINDER_MINUTES = ['30', '60', '90', '120'];

/**
 * 커피 매장이 있는 가까운 휴게소 세 곳 (한국도로공사 휴게소 정보).
 * 지금 위치는 내비가 알려줄 때만 알고, 모르면 시연 출발지(시흥동)에서 잰다. 자료가 없으면 보이지 않는다.
 */
function CoffeeStops() {
  const position = useNavi()?.position;
  const origin = position ? '지금 위치' : '시연 출발지(시흥동)';
  const stops = nearestCoffeeStops(PUBLIC_DATA.restAreas, position ? [position.lng, position.lat] : DEMO_START);
  if (stops.length === 0) return null;
  return (
    <VStack gap={2}>
      <VStack gap={0.5}>
        <Heading level={3}>가까운 휴게소의 커피 매장</Heading>
        <Text type="supporting" color="secondary">
          한국도로공사 휴게소 정보 · {origin}에서 잰 직선거리
        </Text>
      </VStack>
      <List hasDividers density="compact">
        {stops.map(stop => (
          <Item
            key={`${stop.name}-${stop.lng}-${stop.lat}`}
            label={restAreaName(stop.name)}
            description={[stop.route, stop.direction, stop.coffee.join(', ')].filter(Boolean).join(' · ')}
            endContent={<Text type="label">{formatDistance(stop.meters)}</Text>}
          />
        ))}
      </List>
    </VStack>
  );
}

/** 도우미. 감자가 챙겨주는 선택형 기능이다. 핵심 흐름과 따로 둔다. */
export function Missions() {
  const hq = useHq();
  const at = useNow();
  const phase = phaseOf(hq);
  const coffee = hq.trip?.coffee ?? hq.mission.coffee;
  const canChange = phase === 'idle' || phase === 'boarded';
  const [minutes, setMinutes] = useState('60');
  const parking = hq.mission.parking;

  return (
    <Page title="도우미" description="감자가 챙겨주는 선택형 기능입니다.">
      <Card padding={5}>
        <VStack gap={4}>
          <VStack gap={1}>
            <Heading level={2}>커피 운송작전</Heading>
            <Text type="body" color="secondary">
              음료나 케이크를 싣고 갈 때 켭니다. 주행 화면에 컵이 나타나고, 길의 굽이와 경사, 과속방지턱에서 커피가 얼마나 기울고 넘칠지 계산해 보여줍니다.
            </Text>
          </VStack>
          <Switch
            label="커피 운송작전"
            description={
              canChange
                ? phase === 'boarded'
                  ? '이번 운행에 적용됩니다.'
                  : '다음 운행에 적용됩니다.'
                : '운행을 마친 뒤에 바꿀 수 있습니다.'
            }
            value={coffee}
            isDisabled={!canChange}
            onChange={value => (value ? armCoffee() : disarmCoffee())}
            labelSpacing="spread"
          />
          {canAskAboutCup(hq) && <CupPicker />}
          <List hasDividers density="compact">
            <Item
              label="실은 커피 묻기"
              description="주차한 채(기어 P)로 켜면 감자가 오늘 실은 커피의 브랜드와 사이즈를 말로 묻고 듣습니다. 들은 것은 확인을 눌러야 쓰고, 주행 중에는 묻지도 듣지도 않습니다."
            />
            <Item
              label="편안한 길 요청"
              description="출발할 때 내비의 경로 옵션을 '편안한 길'로 바꿉니다."
            />
            <Item
              label="컵 속 커피 계산"
              description="옆으로 가속하면 수면이 atan(가속도÷중력)만큼 기울고, 1초에 세 번쯤 출렁입니다. 방지턱 위에서는 차체가 아래로 가속해 더 크게 기울고, 가장자리를 넘은 만큼 흘러나갑니다. 뚜껑을 닫았으면 마시는 구멍으로 새는 만큼만 셉니다."
            />
            <Item
              label="넘치지 않는 속도"
              description="고른 컵과 지금 든 양으로 방지턱(길이 3.6m, 높이 10cm)과 다음 회전을 넘을 수 있는 속도를 미리 계산해 알려줍니다."
            />
            <Item
              label="운송 결과"
              description="도착하면 실은 컵, 넘은 방지턱 수, 흘린 양, 지켜낸 비율을 결과와 작전일지에 적습니다."
            />
          </List>
          <Text type="supporting" color="secondary">
            고른 컵은 가게가 말하는 용량을 담은 전형적인 컵을 같은 부피의 원통으로 어림한 모형입니다. 음료는 가장자리 1cm 아래까지 찬다고 보고, 닫은 뚜껑은 넘칠 양의 5%만 샌다고 봅니다. 모두 어림이라 실제 컵과 다를 수 있습니다. 고르지 않으면 뚜껑 없는 원통 컵(420ml)으로 계산합니다. 방지턱 정보는 내비가 목적지를 안내하는 중에만 오고, '편안한 길'이 방지턱을 피하는지는 내비에 달려 있습니다.
          </Text>
          {CUP_CATALOG.source && (
            <Text type="supporting" color="secondary">
              컵 용량 출처: {CUP_CATALOG.source}
            </Text>
          )}
          <CoffeeStops />
        </VStack>
      </Card>

      <Card padding={5}>
        <VStack gap={4}>
          <VStack gap={1}>
            <Heading level={2}>주차비 돌려줘</Heading>
            <Text type="body" color="secondary">
              주차 할인 등록은 차로 돌아온 뒤가 아니라 매장을 떠나기 전에 떠올라야 합니다. 볼일이 끝날 즈음으로 알림을 걸어두세요.
            </Text>
          </VStack>
          {parking ? (
            <HStack gap={3} vAlign="center" wrap="wrap">
              <Text type="body">
                {at >= parking.dueAt
                  ? '알림 시간이 되었습니다. 할인 등록을 확인하세요.'
                  : `${clock(parking.dueAt)}에 알려드립니다.`}
              </Text>
              <Button
                label={at >= parking.dueAt ? '등록 완료' : '알림 취소'}
                variant="secondary"
                onClick={() => dispatch({type: 'complete-parking-reminder'})}
              />
            </HStack>
          ) : (
            <VStack gap={3}>
              <SegmentedControl
                label="알림까지 남은 시간"
                value={minutes}
                onChange={setMinutes}>
                {REMINDER_MINUTES.map(m => (
                  <SegmentedControlItem key={m} value={m} label={`${m}분 뒤`} />
                ))}
              </SegmentedControl>
              <HStack>
                <Button
                  label="알림 걸기"
                  variant="primary"
                  onClick={() =>
                    dispatch({
                      type: 'set-parking-reminder',
                      at: now(),
                      minutes: Number(minutes),
                    })
                  }
                />
              </HStack>
            </VStack>
          )}
          <Text type="supporting" color="secondary">
            차량 위치만으로 계산 시점을 알 수는 없어서, 알림 시간은 직접 정합니다. 알림은 이 화면이 열려 있을 때 표시됩니다.
          </Text>
        </VStack>
      </Card>
    </Page>
  );
}
