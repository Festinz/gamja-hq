import {useState} from 'react';
import {AspectRatio} from '@astryxdesign/core/AspectRatio';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {FileInput} from '@astryxdesign/core/FileInput';
import {Heading} from '@astryxdesign/core/Heading';
import {Icon} from '@astryxdesign/core/Icon';
import {Item} from '@astryxdesign/core/Item';
import {List} from '@astryxdesign/core/List';
import {RadioList, RadioListItem} from '@astryxdesign/core/RadioList';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {
  STICKERS,
  debriefOf,
  josa,
  potatoLine,
  recallsAt,
  type StickerId,
} from '../core/hq';
import {didLastSaveFail, dispatch, useHq} from '../app/store';
import {now, useNow} from '../sim/clock';
import {formatDate, routeLabel, shrinkPhoto} from '../ui/format';
import {DiaryScene} from '../ui/DiaryScene';
import {Page, SimulationNote} from '../ui/Page';
import {Potato} from '../ui/Potato';
import {RecallCard} from '../ui/RecallCard';

/** 주차 후 결과. 받은 스티커, 답례, 회상, 일기 초안이 여기 모인다. */
export function DebriefScreen() {
  const hq = useHq();
  const at = useNow();
  const debrief = debriefOf(hq)!;
  const potato = hq.potato!;
  const line = potatoLine(hq, at);
  const recalls = recallsAt(hq, at);
  const draft = hq.draft;

  const [thanks, setThanks] = useState<StickerId | null>(null);
  const [capsule, setCapsule] = useState('');
  const [capsuleSaved, setCapsuleSaved] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const attachPhoto = async (files: File | File[] | null) => {
    const file = Array.isArray(files) ? files[0] : files;
    if (!file) return;
    try {
      dispatch({type: 'edit-draft', photo: await shrinkPhoto(file)});
      setPhotoError(
        didLastSaveFail()
          ? '사진이 너무 커서 이 기기에 저장하지 못했습니다. 더 작은 사진을 골라주세요.'
          : null,
      );
    } catch {
      setPhotoError('이 사진은 읽을 수 없습니다. 다른 사진을 골라주세요.');
    }
  };

  const saveCapsule = () => {
    dispatch({type: 'add-capsule', at: now(), text: capsule});
    setCapsule('');
    setCapsuleSaved(true);
  };

  return (
    <Page
      title="도착"
      description={`${routeLabel(debrief.from, debrief.to)} · ${debrief.tripMinutes}분 운행`}>
      <Card padding={5}>
        <HStack gap={5} vAlign="center" wrap="wrap">
          <Potato
            breed={potato.breed}
            accessory={potato.accessory}
            mood={line.mood}
            name={potato.name}
            size={128}
          />
          <VStack gap={2}>
            <Heading level={2}>{line.text}</Heading>
            {debrief.kind === 'operation' ? (
              <Text type="large">
                오늘 {potato.name}
                {josa(potato.name, '은', '는')} 다른 감자 {debrief.squadSize}마리와 함께{' '}
                {debrief.operationName}
                {josa(debrief.operationName ?? '작전', '을', '를')} 완료했습니다.
              </Text>
            ) : debrief.congestionMinutes > 0 ? (
              <Text type="large">
                {debrief.congestionMinutes}분의 정체를 {potato.name}
                {josa(potato.name, '과', '와')} 둘이서 버텼습니다.
              </Text>
            ) : (
              <Text type="large">막힘 없이 도착했습니다.</Text>
            )}
            <Text type="body" color="secondary">
              운행 {debrief.tripMinutes}분
              {debrief.congestionMinutes > 0 ? ` · 정체 ${debrief.congestionMinutes}분` : ''}
              {debrief.bumps > 0 ? ` · 지나온 과속방지턱 ${debrief.bumps}개` : ''}
              {debrief.hotspots > 0 ? ` · 살펴 지난 사고 다발 지점 ${debrief.hotspots}곳` : ''}
            </Text>
            {debrief.coffee && (
              <Text type="large">
                커피 운송작전 ·{' '}
                {debrief.cup ? `${debrief.cup} 가운데 ` : ''}
                {debrief.spilledMl < 1
                  ? '한 방울도 흘리지 않았습니다. 작전 성공!'
                  : `${Math.round(debrief.spilledMl)}ml를 흘리고 ${debrief.coffeeLeftPercent}%를 지켜냈습니다.`}
              </Text>
            )}
          </VStack>
        </HStack>
      </Card>

      {recalls.map(recall => (
        <RecallCard key={recall.key} recall={recall} potatoName={potato.name} />
      ))}

      {debrief.kind === 'operation' && (
        <Card padding={5}>
          <VStack gap={4}>
            <VStack gap={1}>
              <Heading level={2}>도착한 스티커</Heading>
              <SimulationNote>이 스티커는 가상 감자가 보낸 것입니다.</SimulationNote>
            </VStack>
            {debrief.stickers.length > 0 ? (
              <List hasDividers>
                {debrief.stickers.map((s, i) => (
                  <Item
                    key={i}
                    startContent={<Icon icon="success" color="accent" />}
                    label={STICKERS[s.sticker]}
                    description={`${s.from}가 보냄`}
                  />
                ))}
              </List>
            ) : (
              <Text type="body" color="secondary">
                {hq.consent.receiveStickers
                  ? '이번에는 도착한 스티커가 없습니다.'
                  : '스티커 수신을 꺼두었습니다. 설정에서 다시 켤 수 있습니다.'}
              </Text>
            )}

            <VStack gap={3}>
              <Heading level={3}>같은 길의 감자들에게 답례하기</Heading>
              {debrief.thanksSent ? (
                <Banner
                  status="success"
                  title="답례를 보냈습니다"
                  description={`“${STICKERS[debrief.thanksSent]}”`}
                />
              ) : (
                <>
                  <RadioList
                    label="답례로 보낼 스티커"
                    isLabelHidden
                    value={thanks ?? ''}
                    onChange={value => setThanks(value as StickerId)}>
                    {(Object.keys(STICKERS) as StickerId[]).map(id => (
                      <RadioListItem key={id} value={id} label={STICKERS[id]} />
                    ))}
                  </RadioList>
                  <HStack>
                    <Button
                      label="답례 보내기"
                      variant="secondary"
                      isDisabled={!thanks}
                      onClick={() => thanks && dispatch({type: 'send-thanks', sticker: thanks})}
                    />
                  </HStack>
                </>
              )}
            </VStack>
          </VStack>
        </Card>
      )}

      {debrief.to && (
      <Card padding={5}>
        <VStack gap={3}>
          <Heading level={2}>이곳에 타임캡슐 남기기</Heading>
          <Text type="body" color="secondary">
            {debrief.to}에 한 문장을 남겨두면, 다시 이곳에 주차했을 때 감자가 꺼내 보여줍니다.
          </Text>
          <HStack gap={2} vAlign="end" wrap="wrap">
            <TextInput
              label="이 장소에서 기억하고 싶은 한 문장"
              value={capsule}
              onChange={value => {
                setCapsule(value);
                setCapsuleSaved(false);
              }}
              onEnter={capsule.trim() ? saveCapsule : undefined}
              placeholder="예: 여기서 첫 월급 턱을 냈다"
              width="26rem"
            />
            <Button
              label="남기기"
              variant="secondary"
              isDisabled={!capsule.trim()}
              onClick={saveCapsule}
            />
          </HStack>
          {capsuleSaved && (
            <Text type="supporting" color="secondary">
              남겼습니다. 다음에 {debrief.to}에 주차하면 다시 만납니다.
            </Text>
          )}
        </VStack>
      </Card>
      )}

      {draft ? (
        <Card padding={5}>
          <VStack gap={4}>
            <VStack gap={1}>
              <Text type="label" color="accent">
                {potato.name}
                {josa(potato.name, '이', '가')} 쓴 초안
              </Text>
              <Heading level={2}>{draft.title}</Heading>
              <Text type="supporting" color="secondary">
                {formatDate(draft.date)}
              </Text>
            </VStack>
            {draft.scene && <DiaryScene scene={draft.scene} breed={potato.breed} />}
            <VStack gap={3}>
              {draft.body.split('\n\n').map((paragraph, i) => (
                <Text key={i} type="body" size="lg" as="p">
                  {paragraph}
                </Text>
              ))}
            </VStack>
            <TextInput
              label="한 줄 메모"
              isOptional
              value={draft.memo}
              onChange={memo => dispatch({type: 'edit-draft', memo})}
              placeholder="오늘을 한 줄로 남긴다면"
            />
            {draft.photo ? (
              <VStack gap={2}>
                <AspectRatio ratio={16 / 9}>
                  <img src={draft.photo} alt="일기에 붙인 사진" />
                </AspectRatio>
                <HStack>
                  <Button
                    label="사진 빼기"
                    variant="ghost"
                    onClick={() => dispatch({type: 'edit-draft', photo: null})}
                  />
                </HStack>
              </VStack>
            ) : (
              <FileInput
                label="사진 한 장"
                isOptional
                accept="image/*"
                value={null}
                onChange={attachPhoto}
                status={photoError ? {type: 'error', message: photoError} : undefined}
              />
            )}
            <HStack gap={2} wrap="wrap">
              <Button
                label="작전일지 저장하고 마치기"
                variant="primary"
                size="lg"
                onClick={() => dispatch({type: 'finish-trip', at: now(), save: true})}
              />
              <Button
                label="저장하지 않고 마치기"
                variant="secondary"
                size="lg"
                onClick={() => dispatch({type: 'finish-trip', at: now(), save: false})}
              />
            </HStack>
          </VStack>
        </Card>
      ) : (
        <Card padding={5}>
          <VStack gap={3}>
            <Heading level={2}>감자 작전일지</Heading>
            <Text type="body" color="secondary">
              운행 기록 사용에 동의하지 않아 일지 초안을 쓰지 않았습니다. 설정에서 바꿀 수 있습니다.
            </Text>
            <HStack>
              <Button
                label="마치기"
                variant="primary"
                size="lg"
                onClick={() => dispatch({type: 'finish-trip', at: now(), save: false})}
              />
            </HStack>
          </VStack>
        </Card>
      )}
    </Page>
  );
}
