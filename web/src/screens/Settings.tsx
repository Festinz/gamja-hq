import {useState} from 'react';
import {AlertDialog} from '@astryxdesign/core/AlertDialog';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Switch} from '@astryxdesign/core/Switch';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {dateKey, type Consent} from '../core/hq';
import {dispatch, useHq} from '../app/store';
import {resetClock} from '../sim/clock';
import {useHostStatus} from '../native/host';
import {speak, useBrowserVoiceName} from '../sim/voice';
import {resetSimulator} from '../sim/simulator';
import {formatDate} from '../ui/format';
import {Page} from '../ui/Page';
import {Potato} from '../ui/Potato';
import {PotatoLook} from '../ui/PotatoLook';

export function Settings() {
  const hq = useHq();
  const potato = hq.potato!;
  const [name, setName] = useState(potato.name);
  const [breed, setBreed] = useState(potato.breed);
  const [accessory, setAccessory] = useState(potato.accessory);
  const [isConfirming, setConfirming] = useState(false);
  const host = useHostStatus();
  const browserVoice = useBrowserVoiceName();
  const voiceSource = host.tts
    ? host.serverVoice
      ? 'Pleos 서버 음성으로 말합니다.'
      : 'Pleos 차량 내장 음성으로 말합니다.'
    : browserVoice
      ? `이 브라우저의 "${browserVoice}" 음성으로 말합니다.`
      : '이 브라우저에는 한국어 음성이 없어 소리가 나지 않습니다.';

  const trimmed = name.trim();
  const isChanged =
    trimmed !== potato.name || breed !== potato.breed || accessory !== potato.accessory;

  const consent = (key: keyof Consent) => (value: boolean) =>
    dispatch({type: 'set-consent', key, value});

  return (
    <Page title="설정" description="감자와 기록은 이 기기에만 저장됩니다.">
      <Card padding={5}>
        <VStack gap={4}>
          <Heading level={2}>내 감자</Heading>
          <HStack gap={5} vAlign="center" wrap="wrap">
            <Potato breed={breed} accessory={accessory} mood="hello" name={trimmed} size={150} />
            <VStack gap={4} maxWidth="32rem" width="100%">
              <TextInput label="감자 이름" value={name} onChange={setName} isRequired />
              <PotatoLook
                breed={breed}
                accessory={accessory}
                onBreedChange={setBreed}
                onAccessoryChange={setAccessory}
              />
              <Text type="supporting" color="secondary">
                {formatDate(dateKey(potato.metAt))}에 처음 만났습니다.
              </Text>
            </VStack>
          </HStack>
          <HStack>
            <Button
              label="감자 저장"
              variant="primary"
              isDisabled={!trimmed || !isChanged}
              onClick={() =>
                dispatch({type: 'update-potato', name: trimmed, breed, accessory})
              }
            />
          </HStack>
        </VStack>
      </Card>

      <Card padding={5}>
        <VStack gap={4}>
          <VStack gap={1}>
            <Heading level={2}>동의와 안내</Heading>
            <Text type="body" color="secondary">
              바꾼 내용은 다음 운행부터 적용됩니다.
            </Text>
          </VStack>
          <Switch
            label="운행 기록으로 작전일지 쓰기"
            description="출발·도착 시각과 지역 이름, 그때의 날씨와 해 지는 시각만 씁니다. 좌표와 경로는 남기지 않습니다. 날씨와 해 지는 시각은 앱에 넣어 둔 공공데이터에서 찾고 위치를 보내지 않습니다. 주행 중 지도를 그릴 때는 지금 위치와 목적지를 경로 서비스(TMAP 또는 OpenStreetMap)에 보냅니다."
            value={hq.consent.tripLog}
            onChange={consent('tripLog')}
            labelSpacing="spread"
          />
          <Switch
            label="정체 구간 감자 교류 참여"
            description="같은 정체 구간의 감자들과 익명으로 묶입니다. 차량번호와 위치는 공개되지 않습니다."
            value={hq.consent.exchange}
            onChange={consent('exchange')}
            labelSpacing="spread"
          />
          <Switch
            label="주행 중 감자 음성 안내"
            description="주행 중에는 화면 대신 한 문장 음성으로 알립니다. 실제 차량에서는 Pleos TextToSpeech SDK가 말합니다."
            value={hq.prefs.voice}
            onChange={value => dispatch({type: 'set-pref', key: 'voice', value})}
            labelSpacing="spread"
          />
          <HStack gap={3} vAlign="center" wrap="wrap">
            <Button
              label="음성 미리 듣기"
              variant="secondary"
              onClick={() => speak('잘 도착했어. 오늘도 수고했어.')}
            />
            <Text type="supporting" color="secondary">
              {voiceSource}
            </Text>
          </HStack>
          <Switch
            label="다른 감자의 스티커 받기"
            description="끄면 같은 길의 감자들과는 묶이지만 스티커는 도착하지 않습니다."
            value={hq.consent.receiveStickers}
            onChange={consent('receiveStickers')}
            labelSpacing="spread"
          />
        </VStack>
      </Card>

      <Card padding={5}>
        <VStack gap={3}>
          <Heading level={2}>내 기록</Heading>
          <Text type="body" color="secondary">
            작전일지 {hq.diary.length}편과 타임캡슐 {hq.capsules.length}개가 이 기기에만 저장되어 있습니다.
          </Text>
          <HStack>
            <Button
              label="전체 삭제하고 처음으로"
              variant="destructive"
              onClick={() => setConfirming(true)}
            />
          </HStack>
        </VStack>
      </Card>

      <AlertDialog
        isOpen={isConfirming}
        onOpenChange={setConfirming}
        title="감자와 모든 기록을 지울까요?"
        description="감자, 작전일지, 타임캡슐, 동의 내용이 모두 사라지고 되돌릴 수 없습니다."
        actionLabel="모두 지우기"
        cancelLabel="그대로 두기"
        onAction={() => {
          resetSimulator();
          resetClock();
          dispatch({type: 'reset-all'});
          setConfirming(false);
        }}
      />
    </Page>
  );
}
