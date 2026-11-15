import {describe, expect, it} from 'vitest';
import {MAX_WAITING, enqueue, interrupt, interrupts, speakingSeconds, watchdogMs, withdraw, type SpeechItem} from './speechQueue';

const normal = (text: string): SpeechItem => ({text, urgent: false});
const urgent = (text: string): SpeechItem => ({text, urgent: true});

describe('감자의 말 줄 세우기', () => {
  it('새 말은 하던 말을 끊지 않고 뒤에 선다', () => {
    const waiting = enqueue([], normal('사령관님! 길이 막혔습니다.'), '근처 감자 부대를 찾는 중입니다!');
    expect(waiting.map(w => w.text)).toEqual(['사령관님! 길이 막혔습니다.']);
  });

  it('지금 말하는 문장이나 이미 기다리는 문장은 다시 넣지 않는다', () => {
    expect(enqueue([], normal('가'), '가')).toEqual([]);
    expect(enqueue([normal('가')], normal('가'), null)).toEqual([normal('가')]);
  });

  it('안전 경고는 보통 말들 앞에, 먼저 온 경고 뒤에 선다', () => {
    let waiting = enqueue([], normal('감자 넷이 모였어요'), '출발!');
    waiting = enqueue(waiting, urgent('전방에 방지턱입니다'), '출발!');
    waiting = enqueue(waiting, urgent('어린이 보호구역입니다'), '출발!');
    expect(waiting.map(w => w.text)).toEqual(['전방에 방지턱입니다', '어린이 보호구역입니다', '감자 넷이 모였어요']);
  });

  it('줄이 넘치면 오래된 보통 말부터 버린다', () => {
    let waiting: SpeechItem[] = [];
    for (const text of ['하나', '둘', '셋', '넷']) waiting = enqueue(waiting, normal(text), '말하는 중');
    expect(waiting).toHaveLength(MAX_WAITING);
    expect(waiting.map(w => w.text)).toEqual(['둘', '셋', '넷']);
  });

  it('줄이 넘쳐도 안전 경고는 남는다', () => {
    let waiting = [urgent('방지턱'), normal('하나'), normal('둘')];
    waiting = enqueue(waiting, urgent('보호구역'), '말하는 중');
    expect(waiting.map(w => w.text)).toEqual(['방지턱', '보호구역', '둘']);
  });

  it('끝 신호가 안 올 때 기다리는 시간은 문장 길이에 비례하고 15초를 넘지 않는다', () => {
    expect(watchdogMs('가나다')).toBe(2_250);
    expect(watchdogMs('가'.repeat(200))).toBe(15_000);
  });

  it('안전 경고만 하던 보통 말을 끊는다. 경고끼리는 끊지 않는다', () => {
    expect(interrupts(urgent('전방에 방지턱입니다'), normal('다음 죽전휴게소에 커피 매장이 있어.'))).toBe(true);
    expect(interrupts(urgent('전방에 방지턱입니다'), urgent('어린이 사고가 잦은 곳입니다'))).toBe(false);
    expect(interrupts(normal('감자 넷이 모였어요'), normal('출발!'))).toBe(false);
    expect(interrupts(urgent('전방에 방지턱입니다'), null)).toBe(false);
  });

  it('끊긴 보통 말은 경고 뒤, 기다리던 보통 말들 앞에서 처음부터 다시 한다', () => {
    const waiting = interrupt([normal('감자 넷이 모였어요')], urgent('전방에 방지턱입니다'), normal('다음 휴게소에 커피 매장이 있어.'));
    expect(waiting.map(w => w.text)).toEqual(['전방에 방지턱입니다', '다음 휴게소에 커피 매장이 있어.', '감자 넷이 모였어요']);
    expect(waiting[1].urgent).toBe(false);
  });

  it('끊고 다시 세운 줄도 넘치면 오래된 보통 말부터 버린다', () => {
    const waiting = interrupt([normal('하나'), normal('둘'), normal('셋')], urgent('경고'), normal('말하던 것'));
    expect(waiting).toHaveLength(MAX_WAITING);
    expect(waiting.map(w => w.text)).toEqual(['경고', '둘', '셋']);
  });

  it('거둔 말은 줄에서 빠지고 다른 말의 차례는 그대로다', () => {
    const waiting = [urgent('방지턱'), {text: '질문', urgent: false, parkedOnly: true}, normal('도착')];
    expect(withdraw(waiting, '질문').map(w => w.text)).toEqual(['방지턱', '도착']);
    expect(withdraw(waiting, '없는 말')).toEqual(waiting);
  });

  it('안전 경고가 끊은 주차 중의 말은 다시 설 때도 주차 중의 말이다', () => {
    const waiting = interrupt([], urgent('전방에 방지턱입니다'), {text: '질문', urgent: false, parkedOnly: true});
    expect(waiting).toEqual([urgent('전방에 방지턱입니다'), {text: '질문', urgent: false, parkedOnly: true}]);
  });

  it('한 문장을 말하는 데 드는 시간을 글자 수로 어림한다', () => {
    expect(speakingSeconds('가나다라마')).toBeCloseTo(1, 6);
  });
});
