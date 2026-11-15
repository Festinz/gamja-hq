/**
 * 오늘 실은 커피. 커피 운송작전을 켜면 홈과 도우미에 나온다.
 *
 * 감자가 말로 묻고 들은 것(app/cupQuestion.ts)을 낱말 칩으로 보여 주고, 확인을 눌러야 운행의 컵이 된다.
 * 말로 하지 못하면 브랜드, 사이즈, 핫·아이스, 뚜껑 칩을 눌러 고르고, 들을 수단이 없으면 글로 적는다.
 * 아무것도 고르지 않으면 기본 컵(뚜껑 없는 420ml)으로 계산한다.
 * 주차한 채(기어 P)일 때만 그린다. 주행 중에는 그리지 않는다. Android 앱에서 네이티브 호스트가 기어 P 를
 * 확인하지 못했으면(native/host.ts isParkConfirmed) 말로 묻기와 글로 적기는 내놓지 않고 칩으로만 고르게 한다.
 */
import {useEffect, useMemo, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {ToggleButton} from '@astryxdesign/core/ToggleButton';
import {Token} from '@astryxdesign/core/Token';
import {DEFAULT_CUP} from '../core/cup';
import {
  CUP_QUESTION,
  bumpAdvice,
  buildCupSpec,
  choiceOf,
  guessWords,
  safeBumpKph,
  sizeMl,
  type CupChoice,
  type CupField,
  type CupTemp,
} from '../core/cupSpec';
import {canAskAboutCup, chosenCup, cupWords} from '../core/hq';
import {CUP_CATALOG, canListen, cupQuestion, useCupQuestion} from '../app/cupQuestion';
import {useHq} from '../app/store';
import {isParkConfirmed, useHostStatus} from '../native/host';

const FIELD_LABEL: Record<CupField, string> = {brand: '브랜드', size: '사이즈', temp: '핫·아이스', lid: '뚜껑'};

/** 고른 컵이 없을 때의 이름. */
const DEFAULT_WORDS = `기본 컵(뚜껑 없음) ${DEFAULT_CUP.fillMl}ml`;

/**
 * 칩으로 고르는 곳. 브랜드, 사이즈, 핫·아이스, 뚜껑. 누른 칩을 다시 누르면 고르지 않은 것으로 돌아간다.
 * 고르지 않은 것은 core/cupSpec.ts buildCupSpec 이 정해 둔 값으로 채우고, 그 결과를 칩 아래에 보여 준다.
 */
function CupChips({choice, onChange}: {choice: CupChoice; onChange: (next: CupChoice) => void}) {
  const brand = CUP_CATALOG.brands.find(b => b.id === choice.brandId) ?? null;
  const temp = choice.temp ?? null;
  const setTemp = (next: CupTemp | null) => {
    // 그 온도로 팔지 않는 사이즈를 골라 두었으면 사이즈를 다시 고르게 한다.
    const size = brand?.sizes.find(s => s.id === choice.sizeId);
    const offered = !size || next === null || (next === 'ice' ? size.iceMl : size.hotMl) !== null;
    onChange({...choice, temp: next, ...(offered ? {} : {sizeId: null})});
  };
  const sizes = brand
    ? [...brand.sizes]
        .filter(size => (temp === 'ice' ? size.iceMl : temp === 'hot' ? size.hotMl : 1) !== null)
        .sort((a, b) => sizeMl(a, temp) - sizeMl(b, temp))
        // 공식 수치가 없어 어림한 용량은 "어림"이라고 적는다 (cups.json 의 approx).
        .map(size => ({id: size.id, label: `${size.name} ${sizeMl(size, temp)}ml${size.approx ? '(어림)' : ''}`}))
    : CUP_CATALOG.generic.map(g => ({id: g.id, label: `${g.label} ${g.volumeMl}ml`}));

  return (
    <VStack gap={3}>
      {CUP_CATALOG.brands.length > 0 && (
        <VStack gap={1.5}>
          <Text type="label">브랜드</Text>
          <HStack gap={2} wrap="wrap">
            <ToggleButton
              label="브랜드 없이"
              isPressed={brand === null}
              onPressedChange={() => onChange({...choice, brandId: null, sizeId: null, volumeMl: null})}
            />
            {CUP_CATALOG.brands.map(b => (
              <ToggleButton
                key={b.id}
                label={b.name}
                isPressed={brand?.id === b.id}
                onPressedChange={pressed =>
                  onChange({...choice, brandId: pressed ? b.id : null, sizeId: null, volumeMl: null})
                }
              />
            ))}
          </HStack>
        </VStack>
      )}
      <VStack gap={1.5}>
        <Text type="label">사이즈</Text>
        <HStack gap={2} wrap="wrap">
          {choice.volumeMl && !choice.sizeId ? (
            <ToggleButton
              label={`말한 용량 ${Math.round(choice.volumeMl)}ml`}
              isPressed
              onPressedChange={() => onChange({...choice, volumeMl: null})}
            />
          ) : null}
          {sizes.map(size => (
            <ToggleButton
              key={size.id}
              label={size.label}
              isPressed={choice.sizeId === size.id}
              onPressedChange={pressed => onChange({...choice, sizeId: pressed ? size.id : null, volumeMl: null})}
            />
          ))}
        </HStack>
      </VStack>
      <HStack gap={6} wrap="wrap">
        <VStack gap={1.5}>
          <Text type="label">핫·아이스</Text>
          <HStack gap={2} wrap="wrap">
            <ToggleButton label="핫" isPressed={temp === 'hot'} onPressedChange={pressed => setTemp(pressed ? 'hot' : null)} />
            <ToggleButton label="아이스" isPressed={temp === 'ice'} onPressedChange={pressed => setTemp(pressed ? 'ice' : null)} />
          </HStack>
        </VStack>
        <VStack gap={1.5}>
          <Text type="label">뚜껑</Text>
          <HStack gap={2} wrap="wrap">
            <ToggleButton
              label="뚜껑 닫음"
              isPressed={choice.lid === true}
              onPressedChange={pressed => onChange({...choice, lid: pressed ? true : null})}
            />
            <ToggleButton
              label="뚜껑 없음"
              isPressed={choice.lid === false}
              onPressedChange={pressed => onChange({...choice, lid: pressed ? false : null})}
            />
          </HStack>
        </VStack>
      </HStack>
    </VStack>
  );
}

/** 오늘 실은 커피를 묻고 고르는 곳. 커피 운송작전을 켠 채 주차해 있을 때만 그린다. */
export function CupPicker() {
  const hq = useHq();
  const question = useCupQuestion();
  // Android 앱에서는 Vehicle SDK 가 기어 P 를 읽어야 말로 묻고 듣는다. 브라우저에서는 늘 true.
  const parkConfirmed = isParkConfirmed(useHostStatus());
  const cup = chosenCup(hq);
  const [isEditing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CupChoice>(() => choiceOf(cup));
  const [typed, setTyped] = useState('');

  // 새로 들은 말이 있으면 칩을 그 말로 채운다. 말하지 않은 것은 비워 둔다.
  const guess = question.phase === 'heard' ? question.guess : null;
  useEffect(() => {
    if (guess) setDraft(guess);
  }, [guess]);

  const preview = useMemo(() => {
    const spec = buildCupSpec(draft, CUP_CATALOG);
    return {words: spec ? cupWords(spec) : DEFAULT_WORDS, advice: bumpAdvice(safeBumpKph(spec))};
  }, [draft]);
  const current = useMemo(
    () => ({words: cup ? cupWords(cup) : null, advice: bumpAdvice(safeBumpKph(cup))}),
    [cup],
  );

  // 주행 중이거나 커피 운송작전을 끄면 그리지 않는다.
  if (!canAskAboutCup(hq)) return null;

  const phase = question.phase;
  const isChoosing = isEditing || phase === 'heard' || phase === 'failed' || phase === 'typing';
  const listenable = parkConfirmed && canListen();

  const openEditor = () => {
    setDraft(choiceOf(cup));
    setEditing(true);
  };
  const confirm = () => {
    cupQuestion.confirm(draft);
    setEditing(false);
    setTyped('');
  };
  const close = () => {
    cupQuestion.stop();
    setEditing(false);
  };

  return (
    <VStack gap={4}>
      <VStack gap={1}>
        <Heading level={3}>오늘 실은 커피</Heading>
        <Text type="supporting" color="secondary">
          브랜드와 사이즈, 핫·아이스, 뚜껑에 따라 넘치지 않는 속도가 달라집니다. 컵 치수와 뚜껑의 효과는 어림입니다.
        </Text>
      </VStack>

      {(phase === 'asking' || phase === 'listening') && (
        <VStack gap={2}>
          <HStack gap={2} vAlign="center">
            <StatusDot variant="accent" label={phase === 'asking' ? '감자가 묻는 중' : '듣는 중'} />
            <Text type="label">{phase === 'asking' ? '감자가 묻는 중' : '듣는 중 · 말해 주세요'}</Text>
          </HStack>
          <Text type="large">
            {phase === 'asking' ? `“${CUP_QUESTION}”` : question.partial ? `“${question.partial}”` : '예: 스벅 톨 아이스, 뚜껑 닫았어'}
          </Text>
          <HStack gap={2} wrap="wrap">
            <Button label={phase === 'asking' ? '묻지 않기' : '그만 듣기'} variant="secondary" onClick={close} />
          </HStack>
        </VStack>
      )}

      {phase === 'heard' && question.guess && (
        <VStack gap={2}>
          <Text type="supporting" color="secondary">
            들은 말
          </Text>
          <Text type="large">“{question.transcript}”</Text>
          <HStack gap={2} wrap="wrap">
            {(Object.entries(guessWords(question.guess, CUP_CATALOG)) as [CupField, string | null][]).map(([field, word]) => (
              <Token key={field} label={word ?? `${FIELD_LABEL[field]} ?`} color={word ? 'blue' : 'gray'} />
            ))}
          </HStack>
          {question.guess.missing.length > 0 && (
            <Text type="supporting" color="secondary">
              못 알아들은 것({question.guess.missing.map(field => FIELD_LABEL[field]).join(', ')})은 아래에서 고르세요.
              {question.guess.missing.includes('lid') ? ' 뚜껑을 고르지 않으면 뚜껑 없는 컵으로 계산합니다.' : ''}
            </Text>
          )}
        </VStack>
      )}

      {(phase === 'failed' || phase === 'typing') && (
        <VStack gap={2}>
          {question.error && <Text type="body">{question.error}</Text>}
          {phase === 'typing' && (
            <HStack gap={2} vAlign="end" wrap="wrap">
              <TextInput
                label={question.error ? '글로 적기' : '말 대신 글로 적기'}
                value={typed}
                onChange={setTyped}
                onEnter={typed.trim() ? () => cupQuestion.submitText(typed) : undefined}
                placeholder="예: 스벅 톨 아이스, 뚜껑 닫았어"
                width="26rem"
              />
              <Button
                label="알아듣기"
                variant="secondary"
                isDisabled={!typed.trim()}
                onClick={() => cupQuestion.submitText(typed)}
              />
            </HStack>
          )}
        </VStack>
      )}

      {isChoosing ? (
        <VStack gap={4}>
          <CupChips choice={draft} onChange={setDraft} />
          <VStack gap={0.5}>
            <Text type="large">{preview.words}</Text>
            <Text type="body" color="secondary">
              {preview.advice}
            </Text>
          </VStack>
          <HStack gap={2} wrap="wrap">
            <Button label="이 컵으로 확인" variant="primary" size="lg" onClick={confirm} />
            {listenable && <Button label="다시 말하기" variant="secondary" size="lg" onClick={() => cupQuestion.retry()} />}
            <Button label="닫기" variant="ghost" size="lg" onClick={close} />
          </HStack>
        </VStack>
      ) : (
        phase === 'idle' && (
          <VStack gap={3}>
            <VStack gap={0.5}>
              <Text type="large">{current.words ?? `아직 고르지 않아 ${DEFAULT_WORDS}로 계산합니다.`}</Text>
              <Text type="body" color="secondary">
                {current.advice}
              </Text>
            </VStack>
            {!parkConfirmed && (
              <Text type="supporting" color="secondary">
                기어 P가 확인되면 말로 물어볼 수 있습니다. 지금은 직접 고르세요.
              </Text>
            )}
            <HStack gap={2} wrap="wrap">
              {parkConfirmed && (
                <Button
                  label={cup ? '말로 다시 알려 주기' : '말로 알려 주기'}
                  variant={cup ? 'secondary' : 'primary'}
                  onClick={() => cupQuestion.ask()}
                />
              )}
              <Button label="직접 고르기" variant="secondary" onClick={openEditor} />
            </HStack>
          </VStack>
        )
      )}
    </VStack>
  );
}
