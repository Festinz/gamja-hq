/**
 * 감자의 음성 안내.
 *
 * Android 앱 안에서는 네이티브 호스트가 Pleos TextToSpeech SDK로 말한다.
 * 브라우저에서는 브라우저의 음성 합성으로 대신하되, 설치된 한국어 음성 가운데
 * 사람 목소리에 가장 가까운 것을 골라 쓴다. 기본 음성은 기계음에 가까운 경우가 많다.
 */
import {useSyncExternalStore} from 'react';
import {logSdkEvent} from '../app/sdkLog';
import {enqueue, interrupt, interrupts, speakingSeconds, watchdogMs, withdraw, type SpeechItem} from '../app/speechQueue';
import {hushOnHost, speakOnHost, unspeakOnHost} from '../native/host';
import {now} from './clock';

const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

/**
 * 한국어 음성의 자연스러움 순위. 숫자가 작을수록 먼저 고른다.
 * - 신경망 음성(Edge의 "Online (Natural)" 등)이 사람 목소리에 가장 가깝다.
 * - 그다음이 Chrome의 "Google 한국의" 같은 온라인 음성이다.
 * - 운영체제에 내장된 오프라인 음성(Windows의 Heami 등)은 기계음에 가깝다.
 */
function rank(voice: SpeechSynthesisVoice): number {
  const name = voice.name.toLowerCase();
  if (name.includes('natural') || name.includes('neural')) return 0;
  if (name.includes('online')) return 1;
  if (name.includes('google')) return 2;
  if (!voice.localService) return 3;
  return 4;
}

function pickKoreanVoice(): SpeechSynthesisVoice | null {
  if (!canSpeak) return null;
  const korean = window.speechSynthesis
    .getVoices()
    .filter(voice => voice.lang.toLowerCase().startsWith('ko'));
  if (korean.length === 0) return null;
  return korean.reduce((best, voice) => (rank(voice) < rank(best) ? voice : best));
}

let voiceName: string | null = pickKoreanVoice()?.name ?? null;
const listeners = new Set<() => void>();

// 음성 목록은 페이지가 뜬 뒤에 늦게 채워지는 브라우저가 많다.
if (canSpeak) {
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    voiceName = pickKoreanVoice()?.name ?? null;
    listeners.forEach(listener => listener());
  });
}

// 브라우저에서 말할 차례를 기다리는 줄 (규칙은 app/speechQueue.ts). Android 앱에서는 네이티브가 줄을 세운다.
let waiting: SpeechItem[] = [];
let current: (SpeechItem & {id: number}) | null = null;
let nextId = 0;

/**
 * 하던 말과 기다리는 말이 다 끝날 어림 시각 (performance.now 기준).
 * 네이티브 호스트가 말할 때는 끝났다는 신호가 오지 않아 문장 길이로 어림한다.
 * 커피를 말로 물을 때 감자의 말이 끝난 뒤에 듣기 시작하려고 둔다 (app/cupQuestion.ts).
 */
let quietAt = 0;
let lastOnHost = false;

/**
 * 커피를 말로 묻는 동안(마이크를 쓰는 동안) 미뤄 둔 보통 말. null 이면 미루지 않는다.
 * 감자 목소리가 운전자의 대답으로 들어가지 않게 한다 (네이티브 호스트와의 약속, native/hostSpeech.ts).
 */
let held: SpeechItem[] | null = null;

/** 보통 말을 미룬다. 안전 경고는 미루지 않는다. app/cupQuestion.ts 가 듣기 시작할 때 부른다. */
export function holdSpeech() {
  if (held === null) held = [];
}

/** 미루기를 풀고 미뤄 둔 말을 차례로 한다. 미루고 있지 않았으면 아무것도 하지 않는다. */
export function releaseSpeech() {
  const lines = held;
  held = null;
  lines?.forEach(say);
}

/**
 * 한 문장을 말한다. 보통 말은 하던 말을 끊지 않고 차례를 기다린다(app/speechQueue.ts).
 * urgent 는 방지턱 같은 안전 경고로, 기다리는 보통 말보다 먼저 나가고 하던 보통 말은 끊는다.
 * 커피를 말로 묻는 동안에는 보통 말을 미뤘다가 다 들은 뒤에 한다(holdSpeech).
 * 말할 수단이 없으면 로그만 남긴다.
 */
export function speak(text: string, urgent = false) {
  say({text, urgent});
}

/**
 * 주차한 채(기어 P)에서만 하는 보통 말. 커피 묻기의 질문이다 (app/cupQuestion.ts).
 * Android 앱에서는 네이티브 호스트가 기어 P 를 확인했을 때만 말하고, 말하기 전이나 말하는 중에 P 를 벗어나면
 * 버리거나 멈춘다 (Speaker.kt). 브라우저에서는 출발하거나 묻기를 그만두면 커피 묻기가 unspeak 로 거둔다.
 */
export function speakWhileParked(text: string) {
  say({text, urgent: false, parkedOnly: true});
}

/**
 * 한 문장을 거둔다. 기다리거나 미뤄 둔 그 말을 버리고, 지금 하는 말이면 멈추고 다음 말로 넘어간다.
 * 이미 끝난 말이면 아무 일도 없다. 커피 묻기가 출발하거나 그만 물을 때, 아직 하지 못한 질문을 거둔다.
 * Android 앱에서는 네이티브 호스트(Speaker.kt)에 알린다.
 */
export function unspeak(text: string) {
  const onHost = unspeakOnHost(text);
  if (held !== null) held = withdraw(held, text);
  const wasWaiting = waiting.some(item => item.text === text);
  const wasCurrent = current?.text === text;
  waiting = withdraw(waiting, text);
  // 끝날 어림 시각에서 그 말의 몫을 뺀다. 네이티브는 그 말이 아직 남았는지 알려 주지 않아 같이 뺀다.
  if (onHost || wasWaiting || wasCurrent)
    quietAt = Math.max(performance.now(), quietAt - speakingSeconds(text) * 1000);
  if (!wasCurrent) return;
  // 멈춘 말의 끝 신호는 버린다 (current 를 먼저 비워 두면 done 이 무시한다).
  current = null;
  window.speechSynthesis.cancel();
  speakNext();
}

function say(item: SpeechItem) {
  const {text, urgent} = item;
  if (held !== null && !urgent) {
    // 줄 세우는 규칙은 같다: 같은 말은 한 번만, 많이 밀리면 오래된 말부터 버린다.
    held = enqueue(held, item, null);
    return;
  }
  logSdkEvent({sdk: 'TextToSpeech SDK', name: 'speak', detail: text}, now());
  const onHost = speakOnHost(text, urgent, item.parkedOnly === true);
  if (onHost || canSpeak) {
    quietAt = Math.max(performance.now(), quietAt) + speakingSeconds(text) * 1000;
    lastOnHost = onHost;
  }
  if (onHost) return;
  if (!canSpeak) return;
  if (interrupts(item, current)) {
    // 끊긴 말의 끝 신호는 버린다 (current 를 먼저 비워 두면 done 이 무시한다).
    waiting = interrupt(waiting, item, current!);
    current = null;
    window.speechSynthesis.cancel();
    speakNext();
    return;
  }
  waiting = enqueue(waiting, item, current?.text ?? null);
  if (current === null) speakNext();
}

/**
 * 기다리는 말을 버리고 하던 말을 멈춘다. 주차했거나 음성 안내를 껐을 때 부른다.
 * 지난 길의 말(방지턱, 사고 다발 지점, 휴게소)이 도착한 뒤에 이어서 나오지 않게 한다.
 * Android 앱에서는 네이티브 호스트(Speaker.kt)에 멈추라고 알린다.
 */
export function hush() {
  hushOnHost();
  waiting = [];
  current = null;
  quietAt = 0;
  if (held !== null) held = [];
  if (canSpeak) window.speechSynthesis.cancel();
}

/**
 * 하던 말과 기다리는 말이 끝나기까지 남은 어림 시간 (ms). 말할 것이 없으면 0.
 * 브라우저가 말할 때는 끝 신호가 있으므로, 다 끝났으면 0이고 말하는 중이면 어림이 지나도 조금 더 기다린다.
 */
export function speechBusyMs(): number {
  const left = Math.max(0, quietAt - performance.now());
  if (lastOnHost) return left;
  return current === null && waiting.length === 0 ? 0 : Math.max(left, 300);
}

function speakNext() {
  const item = waiting.shift();
  if (!item) {
    current = null;
    return;
  }
  const id = ++nextId;
  current = {...item, id};
  // 끝 신호는 한 번만 받는다. 끝 신호를 빠뜨리는 브라우저가 있어 시간으로도 넘긴다.
  const done = () => {
    if (current?.id !== id) return;
    current = null;
    speakNext();
  };
  const utterance = new SpeechSynthesisUtterance(item.text);
  const voice = pickKoreanVoice();
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang ?? 'ko-KR';
  utterance.onend = done;
  utterance.onerror = done;
  window.setTimeout(done, watchdogMs(item.text));
  window.speechSynthesis.speak(utterance);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 브라우저에서 지금 쓰는 한국어 음성의 이름. 한국어 음성이 없으면 null. */
export function useBrowserVoiceName(): string | null {
  return useSyncExternalStore(subscribe, () => voiceName);
}
