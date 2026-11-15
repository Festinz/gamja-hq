/**
 * 커피 묻기 (`CupQuestion`).
 *
 * 주차한 채(기어 P) 커피 운송작전을 켜면 감자가 "오늘은 어떤 커피 실었어? 브랜드랑 사이즈를 말해 줘." 하고
 * 보통 말로 묻고, 그 말이 끝나면 운전자의 말을 한 번 듣는다.
 * - Android 앱: 네이티브 호스트가 Pleos SpeechToText SDK로 듣는다 (window.PleosHost.listen, {type: 'stt'} 메시지).
 * - 브라우저 시뮬레이터: 음성 인식을 쓰지 않고 글로 적는다. 차량 마이크의 음성을 외부 음성 인식으로 보내지 않는다는
 *   공모전 공지에 따라, 이 앱의 음성 인식은 Pleos SpeechToText SDK 하나뿐이다.
 * 들은 말은 core/cupSpec.ts 가 알아듣고, 화면에서 확인을 눌러야 운행의 컵이 된다(dispatch 'set-cup').
 *
 * 주행 중에는 묻지도 듣지도 않는다(core/hq.ts canAskAboutCup). Android 앱에서는 네이티브 호스트가 기어 P 를
 * 확인했을 때만 묻는다(native/host.ts isParkConfirmed). 묻거나 듣는 중에 출발하면 바로 멈추고 들은 것을 버리며,
 * 아직 하지 못한 질문도 거둔다(unspeak). 출발 뒤에 늦게 온 결과도 버린다.
 */
import {useSyncExternalStore} from 'react';
import raw from '../data/cups.json';
import {canAskAboutCup, isDrivingLocked, type HqEvent, type HqState} from '../core/hq';
import {
  CUP_QUESTION,
  buildCupSpec,
  cupConfirmLine,
  parseCupUtterance,
  readCupCatalog,
  safeBumpKph,
  type CupCatalog,
  type CupChoice,
  type CupGuess,
} from '../core/cupSpec';
import {
  canListenOnHost,
  getHostStatus,
  isParkConfirmed,
  listenOnHost,
  onHostSpeech,
  stopListeningOnHost,
  subscribeHostStatus,
} from '../native/host';
import {holdSpeech, releaseSpeech, speak, speakWhileParked, speechBusyMs, unspeak} from '../sim/voice';
import {dispatch, getState, subscribeHq} from './store';

/** 형식을 확인한 컵 목록 (web/src/data/cups.json). */
export const CUP_CATALOG: CupCatalog = readCupCatalog(raw as unknown);

export type CupQuestionPhase =
  /** 아무것도 하지 않는다. */
  | 'idle'
  /** 감자가 묻는 중. 말이 끝나면 듣는다. */
  | 'asking'
  /** 듣는 중. */
  | 'listening'
  /** 다 들었다. 화면에서 확인을 기다린다. */
  | 'heard'
  /** 듣지 못했다. 다시 말하거나 칩을 누른다. */
  | 'failed'
  /** 들을 수단이 없다. 글로 적거나 칩을 누른다. */
  | 'typing';

export interface CupQuestionState {
  phase: CupQuestionPhase;
  /** 듣는 중에 들어온 말. */
  partial: string;
  /** 다 들은 말 (또는 적은 말). */
  transcript: string;
  /** 들은 말에서 알아들은 컵. */
  guess: CupGuess | null;
  /** 듣지 못한 까닭. 화면에 적는다. */
  error: string | null;
}

/**
 * 들을 수단이 알려 주는 것. 네이티브 호스트의 {type: 'stt'} 메시지(native/hostSpeech.ts)와 같은 모양이다.
 * error 는 네이티브의 까닭(not-parked, unavailable, timeout, no-speech, cancelled, paused, recognizer)이나
 * 브라우저 음성 인식의 오류 이름(not-allowed, no-speech, network 따위)이다.
 */
export interface HeardSpeech {
  state: 'listening' | 'partial' | 'final' | 'error';
  text?: string;
  /** 브라우저 음성 인식이 함께 준 다른 후보. 가장 잘 알아듣는 것을 쓴다. */
  alternatives?: string[];
  error?: string;
  /** 네이티브의 recognizer 오류일 때 SpeechToText SDK 의 ErrorType 이름 (예: "MIC_ERROR"). */
  detail?: string;
}

/** 한 번 듣는 수단. */
export interface SpeechListener {
  start(): void;
  stop(): void;
}

export interface CupQuestionDeps {
  getState(): HqState;
  /** 운행 상태나 기어 P 확인(isParkConfirmed)이 바뀔 때 알린다. */
  subscribeState(listener: () => void): () => void;
  dispatch(event: HqEvent): unknown;
  catalog: CupCatalog;
  /** 감자가 보통 말로 말한다 (안전 경고가 아니다). 컵을 확인한 뒤의 말에 쓴다. */
  speak(text: string): void;
  /**
   * 묻는 말. 주차한 채(기어 P)에서만 하는 보통 말이다 (sim/voice.ts speakWhileParked). Android 앱에서는
   * 네이티브가 기어 P 를 확인했을 때만 말하고 P 를 벗어나면 버리거나 멈춘다. 없으면 speak 로 말한다.
   */
  speakWhileParked?(text: string): void;
  /**
   * 한 문장을 거둔다 (sim/voice.ts unspeak). 기다리던 말이면 버리고, 하는 중이면 멈춘다.
   * 묻는 말이 끝나기 전에 출발하거나 묻기를 그만두면 그 말을 거둔다.
   */
  unspeak?(text: string): void;
  /**
   * 기어 P 가 확인됐는가 (native/host.ts isParkConfirmed). Android 앱에서는 Vehicle SDK 가 기어 P 를 읽었을 때만
   * true 다. 없으면 웹의 운행 단계만 본다.
   */
  isParkConfirmed?(): boolean;
  /** 음성 안내를 켰는가. 껐으면 묻는 말은 화면에만 띄우고 바로 듣는다. */
  voiceOn(): boolean;
  /** 하던 말과 기다리는 말이 끝나기까지 남은 어림 시간 (ms). */
  speechBusyMs(): number;
  /** 들을 수단. 없으면 null (글로 적는다). */
  makeListener(emit: (speech: HeardSpeech) => void): SpeechListener | null;
  /**
   * 듣는 동안 감자의 보통 말을 미루고(holdSpeech), 다 들으면 미룬 말을 한다(releaseSpeech).
   * 감자 목소리가 마이크에 들어가지 않게 한다. 네이티브 호스트와의 약속이다 (native/hostSpeech.ts).
   */
  holdSpeech?(): void;
  releaseSpeech?(): void;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface CupQuestion {
  /** 감자가 묻고 듣는다. 물을 수 없는 때(주행 중, 커피 운송작전이 꺼짐, 기어 P 를 확인하지 못함)면 false. */
  ask(): boolean;
  /** 묻지 않고 바로 다시 듣는다 ("다시 말하기"). */
  retry(): boolean;
  /** 말 대신 적은 것을 알아듣는다. */
  submitText(text: string): boolean;
  /** 고른 컵을 운행에 넣는다. 아무것도 고르지 않았으면 기본 컵. */
  confirm(choice: CupChoice): boolean;
  /** 묻기와 듣기를 멈추고 처음으로. */
  stop(): void;
  getSnapshot(): CupQuestionState;
  subscribe(listener: () => void): () => void;
}

const IDLE: CupQuestionState = {phase: 'idle', partial: '', transcript: '', guess: null, error: null};

/** 마이크가 열린 뒤 이만큼 지나도 다 들은 말이 오지 않으면 듣지 못한 것으로 본다 (ms). */
export const LISTEN_TIMEOUT_MS = 12_000;
/**
 * 듣기를 부탁한 뒤 마이크가 열리기까지 기다리는 시간 (ms). 네이티브 호스트는 하던 말이 끝난 뒤에
 * 마이크를 연다(최대 15초 기다림, android/…/ListenFlow.kt). 마이크가 열리면 LISTEN_TIMEOUT_MS 로 다시 잰다.
 */
export const OPEN_TIMEOUT_MS = 20_000;
/** 감자의 말이 끝났는지 이만큼마다 다시 본다 (ms). */
const QUIET_POLL_MS = 1000;
/** 감자의 말이 끝나기를 이 횟수까지만 다시 기다린다 (약 30초). 어림이 틀려도 언젠가는 듣는다. */
const MAX_QUIET_WAITS = 30;

/**
 * 들을 수단이 알려 준 실패를 화면의 말로. 마이크나 음성 인식을 쓸 수 없으면 글로 적게 한다.
 * 네이티브 호스트의 까닭과 SpeechToText SDK 의 ErrorType 이름
 * (detail: MIC_ERROR, AUDIO_ERROR, NETWORK_ERROR, SERVER_INTERNAL_ERROR, UNAUTHENTICATED, ON_DEVICE_ENGINE_ERROR,
 * UNAVAILABLE_LANGUAGE …)을 함께 본다.
 */
function failureOf(error: string | undefined, detail?: string): {message: string; typing: boolean} {
  const e = `${error ?? ''} ${detail ?? ''}`.toLowerCase();
  // 앱 화면이 가려져(내비 전체 화면, 다른 앱) 네이티브가 듣기를 멈췄다. 돌아와서 다시 말하면 된다.
  if (/\bpaused\b/.test(e)) return {message: PAUSED_MESSAGE, typing: false};
  if (/not-allowed|permission|audio|mic_error|unavailable|not_available|not_supported|unauthenticated|on_device_engine|language|client/.test(e))
    return {message: '음성 인식이나 마이크를 쓸 수 없습니다. 글로 적거나 아래에서 고르세요.', typing: true};
  if (/no-speech|no_speech|nomatch|no_match|timeout/.test(e))
    return {message: '말소리를 듣지 못했습니다. 다시 말하거나 아래에서 고르세요.', typing: false};
  if (/network|server/.test(e))
    return {message: '음성 인식 서버에 닿지 못했습니다. 다시 말하거나 아래에서 고르세요.', typing: false};
  return {message: '잘 듣지 못했습니다. 다시 말하거나 아래에서 고르세요.', typing: false};
}

/**
 * 네이티브 호스트가 기어 P 를 확인하지 못해 듣지 않았을 때 (웹은 아직 주차 중이라고 알 때).
 * 차가 움직이는 중일 수 있으므로 글로 적는 칸은 열지 않고 칩으로만 고르게 한다.
 */
const NOT_PARKED_MESSAGE = '주차 중(기어 P)인지 확인되지 않아 듣지 않았습니다. 아래에서 고르세요.';
/** 앱 화면이 가려져 네이티브 호스트가 듣기를 멈췄을 때 (hostSpeech.ts 의 paused). */
const PAUSED_MESSAGE = '화면이 가려져 듣기를 멈췄습니다. 다시 말하거나 아래에서 고르세요.';
/** not-parked 뒤에 출발 신호가 오는지 기다리는 시간 (ms). 네이티브는 둘을 잇달아 보낸다. */
export const NOT_PARKED_GRACE_MS = 500;

export function createCupQuestion(deps: CupQuestionDeps): CupQuestion {
  let state: CupQuestionState = IDLE;
  /** 묻기 한 번마다 바뀐다. 지난 묻기의 타이머와 늦게 온 결과를 버리는 데 쓴다. */
  let session = 0;
  let listener: SpeechListener | null = null;
  let timers: unknown[] = [];
  /** 듣기의 시간 초과를 재는 타이머. 마이크가 열리면 다시 건다. */
  let watchdog: unknown = null;
  /**
   * 묻는 말을 말하라고 넘겼고, 아직 다 했다고 볼 수 없다 (마이크가 열리기 전). 네이티브는 감자의 말이 끝나야
   * 마이크를 열므로, 마이크가 열렸으면 질문은 끝났다. 그 전에 멈추면 질문을 거둔다.
   */
  let questionPending = false;
  const subscribers = new Set<() => void>();

  const set = (next: Partial<CupQuestionState>) => {
    state = {...state, ...next};
    subscribers.forEach(s => s());
  };
  const canAsk = () => canAskAboutCup(deps.getState()) && (deps.isParkConfirmed?.() ?? true);

  const halt = () => {
    timers.forEach(deps.clearTimer);
    timers = [];
    watchdog = null;
    const was = listener;
    listener = null;
    if (!was) return;
    was.stop();
    // 다 들었다. 듣는 동안 미뤄 둔 감자의 말을 한다.
    deps.releaseSpeech?.();
  };

  const cancel = () => {
    session += 1;
    halt();
    // 아직 하지 못한 질문은 거둔다. 출발한 뒤에 "브랜드랑 사이즈를 말해 줘"가 나오지 않게 한다.
    if (questionPending) {
      questionPending = false;
      deps.unspeak?.(CUP_QUESTION);
    }
    if (state !== IDLE) {
      state = IDLE;
      subscribers.forEach(s => s());
    }
  };

  /** 이 묻기가 아직 살아 있고 물어도 되는 때에만 run 을 부른다. */
  const later = (id: number, run: () => void, ms: number) => {
    const handle = deps.setTimer(() => {
      if (id !== session) return;
      if (!canAsk()) return cancel();
      run();
    }, ms);
    timers.push(handle);
    return handle;
  };

  /** 말 한 마디를 알아듣는다. 후보가 여럿이면 가장 잘 알아듣는 것. */
  const understand = (texts: string[]): {text: string; guess: CupGuess} => {
    let best = {text: texts[0] ?? '', guess: parseCupUtterance(texts[0] ?? '', deps.catalog)};
    for (const text of texts.slice(1)) {
      const guess = parseCupUtterance(text, deps.catalog);
      if (guess.confidence > best.guess.confidence) best = {text, guess};
    }
    return best;
  };

  const listen = (id: number) => {
    if (id !== session || !canAsk()) return cancel();
    halt();
    const giveUp = () => heard({state: 'error', error: 'timeout'});
    const armWatchdog = (ms: number) => {
      if (watchdog !== null) deps.clearTimer(watchdog);
      watchdog = later(id, giveUp, ms);
    };
    const heard = (speech: HeardSpeech) => {
      if (id !== session || listener === null) return;
      // 듣는 사이에 출발했으면 들은 것을 버린다.
      if (!canAsk()) return cancel();
      // 마이크가 열렸으면(들은 말이 왔으면) 감자의 질문은 끝났다.
      if (speech.state !== 'error') questionPending = false;
      switch (speech.state) {
        case 'listening':
          // 마이크가 열렸다. 여기서부터 시간 초과를 다시 잰다.
          armWatchdog(LISTEN_TIMEOUT_MS);
          set({phase: 'listening'});
          break;
        case 'partial':
          set({phase: 'listening', partial: speech.text ?? ''});
          break;
        case 'final': {
          const texts = [speech.text ?? '', ...(speech.alternatives ?? [])].filter(t => t.trim() !== '');
          halt();
          if (texts.length === 0) {
            set({phase: 'failed', partial: '', error: failureOf('no-speech').message});
            break;
          }
          const best = understand(texts);
          set({phase: 'heard', partial: '', transcript: best.text, guess: best.guess, error: null});
          break;
        }
        case 'error': {
          // 웹은 듣기를 멈출 때 받기부터 끊고 stopListening() 을 부른다. 그래서 여기 오는 cancelled 는
          // 지난 듣기의 늦은 대답이다 ("다시 말하기"를 바로 눌렀을 때). 이번 듣기는 이어 간다.
          if (speech.error === 'cancelled') return;
          halt();
          // 출발하면 네이티브는 not-parked 를 출발 신호보다 먼저 보낸다. 곧이어 출발 신호가 오면
          // 상태 구독(아래 deps.subscribeState)이 멈추도록 잠깐 기다린다. 그래도 웹이 주차 중이라고 알면
          // 네이티브가 기어 P 를 확인하지 못한 것이다. 차가 움직이는 중일 수 있어 글로 적게 하지 않고 칩만 둔다.
          if (speech.error === 'not-parked') {
            later(id, () => set({phase: 'failed', partial: '', error: NOT_PARKED_MESSAGE}), NOT_PARKED_GRACE_MS);
            break;
          }
          const failure = failureOf(speech.error, speech.detail);
          set({phase: failure.typing ? 'typing' : 'failed', partial: '', error: failure.message});
          break;
        }
      }
    };
    const made = deps.makeListener(heard);
    if (!made) {
      set({phase: 'typing', partial: '', error: null});
      return;
    }
    listener = made;
    set({phase: 'listening', partial: '', transcript: '', guess: null, error: null});
    armWatchdog(OPEN_TIMEOUT_MS);
    // 다 들을 때까지 감자는 보통 말을 하지 않는다 (halt 가 다시 풀어 준다).
    deps.holdSpeech?.();
    made.start();
  };

  /** 감자의 말이 다 끝나면 듣는다. */
  const listenWhenQuiet = (id: number, waits: number) => {
    const busy = deps.speechBusyMs();
    if (busy <= 0 || waits >= MAX_QUIET_WAITS) return listen(id);
    later(id, () => listenWhenQuiet(id, waits + 1), Math.min(busy + 300, QUIET_POLL_MS));
  };

  deps.subscribeState(() => {
    // 출발했거나, 커피 운송작전을 껐거나, 기어 P 를 확인할 수 없게 됐으면 묻기와 듣기를 멈추고 질문을 거둔다.
    if ((state.phase !== 'idle' || questionPending) && !canAsk()) cancel();
  });

  return {
    ask() {
      if (!canAsk()) return false;
      cancel();
      const id = session;
      set({phase: 'asking'});
      if (!deps.voiceOn()) {
        later(id, () => listen(id), 300);
        return true;
      }
      // 탑승한 뒤에 켜면 감자가 먼저 "커피가 탑승했습니다"를 말한다. 그 말이 줄에 선 다음에 묻는다.
      later(
        id,
        () => {
          questionPending = true;
          if (deps.speakWhileParked) deps.speakWhileParked(CUP_QUESTION);
          else deps.speak(CUP_QUESTION);
          listenWhenQuiet(id, 0);
        },
        80,
      );
      return true;
    },
    retry() {
      if (!canAsk()) return false;
      cancel();
      listen(session);
      return true;
    },
    submitText(text) {
      if (!canAsk() || text.trim() === '') return false;
      cancel();
      set({phase: 'heard', transcript: text.trim(), guess: parseCupUtterance(text, deps.catalog), error: null});
      return true;
    },
    confirm(choice) {
      const s = deps.getState();
      if (!s.potato || isDrivingLocked(s)) return false;
      const spec = buildCupSpec(choice, deps.catalog);
      deps.dispatch({type: 'set-cup', cup: spec});
      cancel();
      if (spec && deps.voiceOn()) deps.speak(cupConfirmLine(spec, safeBumpKph(spec)));
      return true;
    },
    stop: cancel,
    getSnapshot: () => state,
    subscribe(listener) {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
  };
}

// ───────────────────────── 들을 수단 ─────────────────────────

/** 네이티브 호스트의 SpeechToText SDK. */
function hostListener(emit: (speech: HeardSpeech) => void): SpeechListener {
  let off: (() => void) | null = null;
  return {
    start() {
      off = onHostSpeech(speech => emit(speech));
      if (!listenOnHost()) {
        off();
        off = null;
        emit({state: 'error', error: 'unavailable'});
      }
    },
    stop() {
      off?.();
      off = null;
      stopListeningOnHost();
    },
  };
}

/**
 * 지금 말로 들을 수 있는가. Android 앱에서 네이티브 호스트의 SpeechToText SDK 를 쓸 수 있을 때만이다
 * (기어 P 를 확인해야 한다). 브라우저 시뮬레이터와 WebView 의 Web Speech API 는 쓰지 않는다: 소리를 외부 서버로
 * 보낼 수 있고, 네이티브의 기어 P 확인도 거치지 않는다.
 */
export function canListen(): boolean {
  return getHostStatus().isNative && canListenOnHost();
}

/** canListen 과 같은 갈래로 들을 수단을 고른다. 들을 수단이 없으면 null (글로 적는다). */
function makeListener(emit: (speech: HeardSpeech) => void): SpeechListener | null {
  return canListen() ? hostListener(emit) : null;
}

// ───────────────────────── 앱의 커피 묻기 ─────────────────────────

export const cupQuestion: CupQuestion = createCupQuestion({
  getState,
  // 운행 상태와 네이티브 호스트의 상태(기어 P 확인)가 바뀔 때 모두 본다.
  subscribeState: listener => {
    const offHq = subscribeHq(listener);
    const offHost = subscribeHostStatus(listener);
    return () => {
      offHq();
      offHost();
    };
  },
  dispatch,
  catalog: CUP_CATALOG,
  speak: text => speak(text),
  speakWhileParked: text => speakWhileParked(text),
  unspeak: text => unspeak(text),
  isParkConfirmed: () => isParkConfirmed(),
  voiceOn: () => getState().prefs.voice,
  speechBusyMs,
  makeListener,
  holdSpeech,
  releaseSpeech,
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
});

/** 커피 운송작전을 켜고, 주차한 채라면 감자가 실은 커피를 묻는다. 홈의 단추와 도우미의 스위치가 쓴다. */
export function armCoffee() {
  dispatch({type: 'arm-coffee'});
  cupQuestion.ask();
}

/** 커피 운송작전을 끈다. 묻거나 듣던 것도 멈춘다. */
export function disarmCoffee() {
  cupQuestion.stop();
  dispatch({type: 'disarm-coffee'});
}

export function useCupQuestion(): CupQuestionState {
  return useSyncExternalStore(cupQuestion.subscribe, cupQuestion.getSnapshot);
}
