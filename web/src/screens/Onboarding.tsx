import {useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Center} from '@astryxdesign/core/Center';
import {Grid} from '@astryxdesign/core/Grid';
import {Heading} from '@astryxdesign/core/Heading';
import {Layout, LayoutContent} from '@astryxdesign/core/Layout';
import {VStack} from '@astryxdesign/core/Stack';
import {Switch} from '@astryxdesign/core/Switch';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import type {Accessory, Breed} from '../core/hq';
import {dispatch} from '../app/store';
import {now} from '../sim/clock';
import {Potato} from '../ui/Potato';
import {PotatoLook} from '../ui/PotatoLook';

export function Onboarding() {
  const [name, setName] = useState('');
  const [breed, setBreed] = useState<Breed>('sumi');
  const [accessory, setAccessory] = useState<Accessory>('none');
  const [tripLog, setTripLog] = useState(true);
  const [exchange, setExchange] = useState(true);
  const trimmed = name.trim();

  const start = () =>
    dispatch({
      type: 'onboard',
      at: now(),
      name: trimmed,
      breed,
      accessory,
      consent: {tripLog, exchange},
    });

  return (
    <Layout
      height="fill"
      contentWidth="60rem"
      content={
        <LayoutContent padding={6}>
          <VStack gap={5}>
            <VStack gap={1}>
              <Heading level={1}>감자 작전본부</Heading>
              <Text type="large" color="secondary">
                매일 같은 길도, 함께 타면 이야기가 된다.
              </Text>
            </VStack>
            <Grid columns={{minWidth: 300, max: 2}} gap={5}>
              <Card padding={6}>
                <Center height="100%">
                  <VStack gap={3} hAlign="center">
                    <Potato
                      breed={breed}
                      accessory={accessory}
                      mood={trimmed ? 'ready' : 'hello'}
                      name={trimmed || undefined}
                      size={200}
                    />
                    <Heading level={2} justify="center">
                      {trimmed || '이름 없는 감자'}
                    </Heading>
                    <Text type="body" color="secondary" justify="center">
                      차에 사는 작은 동승자. 이름을 지어주면 함께 달립니다.
                    </Text>
                  </VStack>
                </Center>
              </Card>
              <Card padding={6}>
                <VStack gap={5}>
                  <TextInput
                    label="감자 이름"
                    value={name}
                    onChange={setName}
                    onEnter={trimmed ? start : undefined}
                    placeholder="예: 감돌이"
                    isRequired
                    hasAutoFocus
                  />
                  <PotatoLook
                    breed={breed}
                    accessory={accessory}
                    onBreedChange={setBreed}
                    onAccessoryChange={setAccessory}
                  />
                  <VStack gap={3}>
                    <Switch
                      label="운행 기록으로 작전일지 쓰기"
                      description="출발·도착 시각과 지역 이름만 씁니다. 좌표와 경로는 남기지 않습니다."
                      value={tripLog}
                      onChange={setTripLog}
                      labelSpacing="spread"
                    />
                    <Switch
                      label="정체 구간 감자 교류 참여"
                      description="같은 정체 구간의 감자들과 익명으로 묶입니다. 차량번호와 위치는 공개되지 않습니다."
                      value={exchange}
                      onChange={setExchange}
                      labelSpacing="spread"
                    />
                    <Text type="supporting" color="secondary">
                      둘 다 꺼도 감자와 함께할 수 있고, 설정에서 언제든 바꿀 수 있습니다.
                    </Text>
                  </VStack>
                  <Button
                    label="시작하기"
                    variant="primary"
                    size="lg"
                    width="100%"
                    isDisabled={!trimmed}
                    onClick={start}
                  />
                </VStack>
              </Card>
            </Grid>
          </VStack>
        </LayoutContent>
      }
    />
  );
}
