import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import {VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {ACCESSORIES, BREEDS, type Accessory, type Breed} from '../core/hq';

/** 감자의 품종과 소품을 고르는 두 줄짜리 선택기. */
export function PotatoLook({
  breed,
  accessory,
  onBreedChange,
  onAccessoryChange,
}: {
  breed: Breed;
  accessory: Accessory;
  onBreedChange: (breed: Breed) => void;
  onAccessoryChange: (accessory: Accessory) => void;
}) {
  return (
    <VStack gap={4}>
      <VStack gap={2}>
        <Text type="label">품종</Text>
        <SegmentedControl
          label="품종"
          layout="fill"
          value={breed}
          onChange={value => onBreedChange(value as Breed)}>
          {Object.entries(BREEDS).map(([value, label]) => (
            <SegmentedControlItem key={value} value={value} label={label} />
          ))}
        </SegmentedControl>
      </VStack>
      <VStack gap={2}>
        <Text type="label">소품</Text>
        <SegmentedControl
          label="소품"
          layout="fill"
          value={accessory}
          onChange={value => onAccessoryChange(value as Accessory)}>
          {Object.entries(ACCESSORIES).map(([value, label]) => (
            <SegmentedControlItem key={value} value={value} label={label} />
          ))}
        </SegmentedControl>
      </VStack>
    </VStack>
  );
}
