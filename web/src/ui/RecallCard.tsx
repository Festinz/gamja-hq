import {AspectRatio} from '@astryxdesign/core/AspectRatio';
import {Card} from '@astryxdesign/core/Card';
import {Heading} from '@astryxdesign/core/Heading';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Icon} from '@astryxdesign/core/Icon';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {dateKey, josa, type Recall} from '../core/hq';
import {dispatch} from '../app/store';
import {formatDate} from './format';

function describe(recall: Recall, potatoName: string) {
  switch (recall.kind) {
    case 'anniversary':
      return {
        eyebrow: `${recall.years}년 전 오늘`,
        title: recall.entry.title,
        body: recall.entry.body.split('\n\n')[0],
        photo: recall.entry.photo,
        memo: recall.entry.memo,
      };
    case 'first-met':
      return {
        eyebrow: `만난 지 ${recall.years}년`,
        title: `오늘은 ${potatoName}${josa(potatoName, '을', '를')} 처음 만난 날`,
        body: `${recall.years}년 전 오늘, 처음으로 같이 차에 탔어. 그동안 고마웠어.`,
        photo: null,
        memo: '',
      };
    case 'revisit':
      return {
        eyebrow: `다시 온 ${recall.area}`,
        title: `여기 기억나? ${formatDate(recall.entry.date)}에도 왔었어.`,
        body: recall.entry.body.split('\n\n')[0],
        photo: recall.entry.photo,
        memo: recall.entry.memo,
      };
    case 'capsule':
      return {
        eyebrow: `${recall.area}에 남긴 타임캡슐`,
        title: recall.text,
        body: `${formatDate(dateKey(recall.createdAt))}에 이곳에 남긴 한 문장이야.`,
        photo: null,
        memo: '',
      };
  }
}

/** 추억 회상 카드. 닫으면 같은 날 다시 나오지 않는다. */
export function RecallCard({recall, potatoName}: {recall: Recall; potatoName: string}) {
  const {eyebrow, title, body, photo, memo} = describe(recall, potatoName);
  return (
    <Card padding={4} variant="muted">
      <VStack gap={2}>
        <HStack gap={2} hAlign="between" vAlign="center">
          <HStack gap={2} vAlign="center">
            <Icon icon="clock" size="sm" color="accent" />
            <Text type="label" color="accent">
              {eyebrow}
            </Text>
          </HStack>
          <IconButton
            icon={<Icon icon="close" size="sm" />}
            label="회상 닫기"
            variant="ghost"
            size="sm"
            onClick={() => dispatch({type: 'dismiss-recall', key: recall.key})}
          />
        </HStack>
        <Heading level={3}>{title}</Heading>
        <Text type="body" color="secondary" maxLines={3}>
          {body}
        </Text>
        {memo && <Text type="body">“{memo}”</Text>}
        {photo && (
          <AspectRatio ratio={16 / 9}>
            <img src={photo} alt={`${title} 사진`} />
          </AspectRatio>
        )}
      </VStack>
    </Card>
  );
}
