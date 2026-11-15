/**
 * 감자의 말을 차례로 내보내는 줄.
 *
 * 보통 말끼리는 하던 말을 끊지 않고 뒤에 세운다. 끊으면 "근처 감자 부대를 찾는 중입니다!"처럼
 * 앞 문장이 반쯤 잘려 들린다.
 *
 * - 지금 말하는 문장이나 이미 기다리는 문장과 같은 말은 넣지 않는다.
 * - 급한 말(방지턱 같은 안전 경고)은 기다리는 보통 말들 앞에 선다.
 * - 급한 말은 하던 보통 말을 끊고 바로 나간다. 끊긴 말은 보통 말들 맨 앞으로 돌아가 경고 뒤에 처음부터 다시 한다.
 *   급한 말끼리는 끊지 않는다. Android 앱의 SpeechQueue.kt 도 같은 규칙이다.
 * - 기다리는 말이 MAX_WAITING 개를 넘으면 오래된 보통 말부터 버린다. 지난 상황의 말이다.
 * - 거둔 말(withdraw)은 줄에서 빼고, 지금 하던 말이면 멈추고 다음 말로 넘어간다. 커피 묻기의 질문처럼
 *   주차한 채에서만 하는 말을, 출발하거나 그만 물을 때 거둔다.
 */
export interface SpeechItem {
  text: string;
  urgent: boolean;
  /**
   * 주차한 채(기어 P)에서만 하는 말 (커피 묻기의 질문). Android 앱에서는 네이티브 호스트가 기어 P 를
   * 확인했을 때만 말하고, P 를 벗어나면 버리거나 멈춘다 (SpeechQueue.kt dropParkedOnly).
   */
  parkedOnly?: boolean;
}

export const MAX_WAITING = 3;

/** 기다리는 줄에 새 말을 넣은 새 줄. speaking 은 지금 말하는 문장(없으면 null). */
export function enqueue(
  waiting: readonly SpeechItem[],
  item: SpeechItem,
  speaking: string | null,
): SpeechItem[] {
  if (item.text === speaking || waiting.some(w => w.text === item.text)) return [...waiting];
  const next = item.urgent
    ? [...waiting.filter(w => w.urgent), item, ...waiting.filter(w => !w.urgent)]
    : [...waiting, item];
  while (next.length > MAX_WAITING) {
    const oldestNormal = next.findIndex(w => !w.urgent);
    next.splice(oldestNormal === -1 ? 0 : oldestNormal, 1);
  }
  return next;
}

/** 새 말이 지금 하던 말(speaking)을 끊고 먼저 나가야 하는가. 안전 경고만 보통 말을 끊는다. */
export function interrupts(item: SpeechItem, speaking: SpeechItem | null): boolean {
  return item.urgent && speaking !== null && !speaking.urgent && speaking.text !== item.text;
}

/**
 * 안전 경고 item 이 하던 보통 말 cut 을 끊었을 때의 새 줄. 경고는 enqueue 와 같이 보통 말들 앞에 서고
 * (보통 말을 하는 동안에는 기다리는 경고가 없으므로 맨 앞이다), 끊긴 말은 보통 말들 맨 앞으로 돌아가
 * 경고 뒤에 처음부터 다시 한다. 줄이 넘치면 enqueue 와 같이 오래된 보통 말부터 버린다.
 */
export function interrupt(waiting: readonly SpeechItem[], item: SpeechItem, cut: SpeechItem): SpeechItem[] {
  const rest = waiting.filter(w => w.text !== cut.text);
  // 끊긴 말은 그대로 다시 선다 (주차한 채에서만 하는 말이면 그 표시도 남는다).
  const again: SpeechItem = {text: cut.text, urgent: false, ...(cut.parkedOnly ? {parkedOnly: true} : {})};
  return enqueue([...rest.filter(w => w.urgent), again, ...rest.filter(w => !w.urgent)], item, null);
}

/**
 * 한 문장을 거둔 새 줄 (기다리던 그 말을 뺀다). 지금 하던 말이면 부른 쪽이 멈추고 다음 말로 넘어간다.
 * Android 앱의 SpeechQueue.kt withdraw 와 같은 규칙이다.
 */
export function withdraw(waiting: readonly SpeechItem[], text: string): SpeechItem[] {
  return waiting.filter(w => w.text !== text);
}

/** 한국어 음성이 한 글자(띄어쓰기와 문장 부호 포함)를 말하는 데 드는 어림 시간 (초). */
export const SECONDS_PER_CHAR = 0.2;

/** 한 문장을 다 말하는 데 드는 어림 시간 (초). 다른 안전 경고와 겹칠지 가늠할 때 쓴다. */
export function speakingSeconds(text: string): number {
  return text.length * SECONDS_PER_CHAR;
}

/**
 * 말이 끝났다는 신호가 오지 않을 때를 대비한 넉넉한 시간(ms).
 * 한국어 음성은 한 글자에 0.2초 안팎이다.
 */
export function watchdogMs(text: string): number {
  return Math.min(15_000, 1_500 + text.length * 250);
}
