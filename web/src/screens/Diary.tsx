import {useState} from 'react';
import {AlertDialog} from '@astryxdesign/core/AlertDialog';
import {AspectRatio} from '@astryxdesign/core/AspectRatio';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Heading} from '@astryxdesign/core/Heading';
import {Icon} from '@astryxdesign/core/Icon';
import {Item} from '@astryxdesign/core/Item';
import {List} from '@astryxdesign/core/List';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {BookOpenIcon} from '@heroicons/react/24/outline';
import type {DiaryEntry} from '../core/hq';
import {dispatch, useHq} from '../app/store';
import {formatDate, routeLabel} from '../ui/format';
import {DiaryScene} from '../ui/DiaryScene';
import {Page} from '../ui/Page';

export function Diary() {
  const hq = useHq();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = hq.diary.find(entry => entry.id === openId);

  if (open) return <Entry entry={open} onBack={() => setOpenId(null)} />;

  return (
    <Page
      title="감자 작전일지"
      description="차는 막혀도, 감자들의 이야기는 계속된다.">
      {hq.diary.length === 0 ? (
        <Card padding={6}>
          <EmptyState
            icon={<Icon icon={BookOpenIcon} size="lg" />}
            title="아직 작전일지가 없습니다"
            description="운행을 마치고 주차하면 감자가 그날의 그림일기 초안을 씁니다. 저장한 일지가 여기에 쌓입니다."
          />
        </Card>
      ) : (
        <Card padding={2}>
          <List hasDividers>
            {hq.diary.map(entry => (
              <Item
                key={entry.id}
                label={entry.title}
                description={`${formatDate(entry.date)} · ${routeLabel(entry.from, entry.to)}`}
                startContent={
                  <DiaryScene
                    scene={entry.scene ?? FALLBACK_SCENE}
                    breed={hq.potato?.breed ?? 'sumi'}
                    width="9rem"
                  />
                }
                endContent={<Icon icon="chevronRight" size="sm" color="secondary" />}
                onClick={() => setOpenId(entry.id)}
              />
            ))}
          </List>
        </Card>
      )}
    </Page>
  );
}

/** 그림 장면을 싣기 전에 저장한 일기는 낮 풍경으로 그린다. */
const FALLBACK_SCENE = {hour: 13, coffee: false, squad: 0};

function Entry({entry, onBack}: {entry: DiaryEntry; onBack: () => void}) {
  const [isConfirming, setConfirming] = useState(false);
  const breed = useHq().potato?.breed ?? 'sumi';

  return (
    <Page
      title={entry.title}
      description={`${formatDate(entry.date)} · ${routeLabel(entry.from, entry.to)}`}
      actions={<Button label="목록으로" variant="secondary" onClick={onBack} />}>
      <Card padding={6}>
        <VStack gap={4}>
          <DiaryScene scene={entry.scene ?? FALLBACK_SCENE} breed={breed} />
          {entry.body.split('\n\n').map((paragraph, i) => (
            <Text key={i} type="body" size="lg" as="p">
              {paragraph}
            </Text>
          ))}
          {entry.memo && (
            <VStack gap={1}>
              <Text type="label" color="secondary">
                내 메모
              </Text>
              <Heading level={3}>“{entry.memo}”</Heading>
            </VStack>
          )}
          {entry.photo && (
            <AspectRatio ratio={16 / 9}>
              <img src={entry.photo} alt={`${entry.title} 사진`} />
            </AspectRatio>
          )}
        </VStack>
      </Card>
      <HStack>
        <Button
          label="이 일지 지우기"
          variant="destructive"
          onClick={() => setConfirming(true)}
        />
      </HStack>
      <AlertDialog
        isOpen={isConfirming}
        onOpenChange={setConfirming}
        title="이 일지를 지울까요?"
        description="지운 일지는 되돌릴 수 없고, 추억 회상에도 나오지 않습니다."
        actionLabel="지우기"
        cancelLabel="그대로 두기"
        onAction={() => {
          dispatch({type: 'delete-entry', id: entry.id});
          setConfirming(false);
          onBack();
        }}
      />
    </Page>
  );
}
