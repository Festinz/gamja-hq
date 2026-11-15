import type {ReactNode} from 'react';
import {Heading} from '@astryxdesign/core/Heading';
import {Layout, LayoutContent} from '@astryxdesign/core/Layout';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';

/** 모든 화면이 쓰는 틀. 제목, 설명, 오른쪽 행동, 본문. */
export function Page({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Layout
      height="fill"
      contentWidth="60rem"
      content={
        <LayoutContent padding={6}>
          <VStack gap={5}>
            <HStack gap={3} hAlign="between" vAlign="end" wrap="wrap">
              <VStack gap={1}>
                <Heading level={1}>{title}</Heading>
                {description && (
                  <Text type="body" color="secondary">
                    {description}
                  </Text>
                )}
              </VStack>
              {actions}
            </HStack>
            {children}
          </VStack>
        </LayoutContent>
      }
    />
  );
}

/** "시뮬레이션" 표시. 가상 데이터가 보이는 곳마다 붙인다. */
export function SimulationNote({children}: {children: string}) {
  return (
    <Text type="supporting" color="secondary">
      시뮬레이션 · {children}
    </Text>
  );
}
