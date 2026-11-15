import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// 네이티브 호스트가 없는 브라우저로 본다. 로그는 이 시험과 관계없다.
vi.mock('../native/host', () => ({speakOnHost: () => false, hushOnHost: () => false, unspeakOnHost: () => false}));
vi.mock('../app/sdkLog', () => ({logSdkEvent: () => {}}));

/** 브라우저 음성 합성을 흉내 낸다. 말한 문장과 멈춘 횟수를 적는다. */
class FakeUtterance {
  text: string;
  voice: unknown = null;
  lang = '';
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

let spoken: string[] = [];
let cancels = 0;
let playing: FakeUtterance | null = null;

const synth = {
  speak(utterance: FakeUtterance) {
    spoken.push(utterance.text);
    playing = utterance;
  },
  cancel() {
    cancels += 1;
    const cut = playing;
    playing = null;
    cut?.onerror?.();
  },
  getVoices: () => [],
  addEventListener() {},
};

/** 지금 말하는 문장을 끝까지 말한다. */
function finish() {
  const done = playing;
  playing = null;
  done?.onend?.();
}

async function loadVoice() {
  vi.resetModules();
  vi.stubGlobal('window', {
    speechSynthesis: synth,
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
  });
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  return import('./voice');
}

const REST = '다음 시험휴게소에 커피 매장이 있어.';
const BUMP = '사령관님! 전방에 방지턱입니다. 속도를 줄여 주십시오!';
const CHILD = '사령관님! 어린이 교통사고가 잦은 곳입니다. 살펴 가겠습니다.';

describe('브라우저에서 감자의 말 차례', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    spoken = [];
    cancels = 0;
    playing = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('보통 말은 하던 말을 끊지 않고 끝난 뒤에 나간다', async () => {
    const {speak} = await loadVoice();
    speak('출발! 운전에 집중해. 나는 조용히 있을게.');
    speak(REST);
    expect(cancels).toBe(0);
    expect(spoken).toEqual(['출발! 운전에 집중해. 나는 조용히 있을게.']);
    finish();
    expect(spoken).toEqual(['출발! 운전에 집중해. 나는 조용히 있을게.', REST]);
  });

  it('안전 경고는 하던 보통 말을 끊고 바로 나가고, 끊긴 말은 경고 뒤에 처음부터 다시 한다', async () => {
    const {speak} = await loadVoice();
    speak(REST);
    speak(BUMP, true);
    expect(cancels).toBe(1);
    expect(spoken).toEqual([REST, BUMP]);
    finish();
    expect(spoken).toEqual([REST, BUMP, REST]);
    finish();
    expect(playing).toBeNull();
  });

  it('안전 경고끼리는 끊지 않고 온 차례대로 나간다', async () => {
    const {speak} = await loadVoice();
    speak(BUMP, true);
    speak(CHILD, true);
    expect(cancels).toBe(0);
    expect(spoken).toEqual([BUMP]);
    finish();
    expect(spoken).toEqual([BUMP, CHILD]);
  });

  it('끝 신호가 오지 않아도 시간이 지나면 다음 말로 넘어간다', async () => {
    const {speak} = await loadVoice();
    speak(BUMP, true);
    speak(REST);
    vi.advanceTimersByTime(15_000);
    expect(spoken).toEqual([BUMP, REST]);
  });

  it('주차하거나 음성을 끄면(hush) 기다리던 말을 버리고 하던 말을 멈춘다', async () => {
    const {hush, speak} = await loadVoice();
    speak(BUMP, true);
    speak(REST);
    hush();
    expect(cancels).toBe(1);
    finish();
    vi.advanceTimersByTime(15_000);
    expect(spoken).toEqual([BUMP]);
    speak('오늘도 무사 귀환했습니다!');
    expect(spoken).toEqual([BUMP, '오늘도 무사 귀환했습니다!']);
  });

  it('커피를 말로 묻는 동안(holdSpeech) 보통 말은 미뤘다가 다 들은 뒤(releaseSpeech)에 한다', async () => {
    const {holdSpeech, releaseSpeech, speak, speechBusyMs} = await loadVoice();
    const HELLO = '어서 와! 오늘은 어디로 가?';
    holdSpeech();
    speak(HELLO);
    speak(HELLO);
    speak(REST);
    expect(spoken).toEqual([]);
    expect(speechBusyMs()).toBe(0);
    // 안전 경고는 미루지 않는다.
    speak(BUMP, true);
    expect(spoken).toEqual([BUMP]);
    finish();
    releaseSpeech();
    expect(spoken).toEqual([BUMP, HELLO]);
    finish();
    expect(spoken).toEqual([BUMP, HELLO, REST]);
    // 두 번 풀어도 다시 말하지 않는다.
    releaseSpeech();
    finish();
    expect(spoken).toEqual([BUMP, HELLO, REST]);
  });

  it('거둔 말(unspeak)은 기다리던 줄에서 빠지고, 하던 말이면 멈추고 다음 말로 넘어간다', async () => {
    const {speak, speakWhileParked, speechBusyMs, unspeak} = await loadVoice();
    const BOARDED = '사령관님! 커피가 탑승했습니다. 편안한 길로 모시겠습니다.';
    const QUESTION = '오늘은 어떤 커피 실었어? 브랜드랑 사이즈를 말해 줘.';
    // 기다리던 질문을 거두면 나오지 않는다.
    speak(BOARDED);
    speakWhileParked(QUESTION);
    speak(REST);
    unspeak(QUESTION);
    expect(cancels).toBe(0);
    finish();
    expect(spoken).toEqual([BOARDED, REST]);
    finish();
    expect(speechBusyMs()).toBe(0);
    // 하던 질문을 거두면 멈추고 다음 말을 한다. 멈춘 말의 끝 신호로 한 번 더 넘어가지 않는다.
    speakWhileParked(QUESTION);
    speak(BUMP, true);
    finish();
    speak(REST);
    expect(spoken).toEqual([BOARDED, REST, QUESTION, BUMP, QUESTION]);
    unspeak(QUESTION);
    expect(cancels).toBe(2);
    expect(spoken).toEqual([BOARDED, REST, QUESTION, BUMP, QUESTION, REST]);
    finish();
    expect(playing).toBeNull();
    // 이미 끝난 말을 거둬도 아무 일도 없다.
    unspeak(QUESTION);
    expect(cancels).toBe(2);
  });

  it('미뤄 둔 말도 거둘 수 있다', async () => {
    const {holdSpeech, releaseSpeech, speak, unspeak} = await loadVoice();
    holdSpeech();
    speak(REST);
    speak('어서 와!');
    unspeak(REST);
    releaseSpeech();
    expect(spoken).toEqual(['어서 와!']);
  });

  it('미루는 동안 hush 하면 미룬 말도 버린다', async () => {
    const {holdSpeech, hush, releaseSpeech, speak} = await loadVoice();
    holdSpeech();
    speak(REST);
    hush();
    releaseSpeech();
    expect(spoken).toEqual([]);
    speak(REST);
    expect(spoken).toEqual([REST]);
  });
});
