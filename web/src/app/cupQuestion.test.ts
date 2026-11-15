import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {CUP_QUESTION, readCupCatalog} from '../core/cupSpec';
import {initialState, step, type HqEvent, type HqState} from '../core/hq';
import {LISTEN_TIMEOUT_MS, NOT_PARKED_GRACE_MS, OPEN_TIMEOUT_MS, createCupQuestion, type HeardSpeech} from './cupQuestion';

/** 시험용 컵 목록. */
const CATALOG = readCupCatalog({
  source: '시험 자료',
  generic: [{id: 'medium', label: '중간 컵', volumeMl: 473}],
  shapes: {
    hot: [{maxMl: 650, topDiameterMm: 90, bottomDiameterMm: 62, heightMm: 150}],
    ice: [{maxMl: 750, topDiameterMm: 98, bottomDiameterMm: 62, heightMm: 150}],
  },
  brands: [
    {
      id: 'starbucks',
      name: '스타벅스',
      aliases: ['스벅'],
      sizes: [
        {id: 'tall', name: '톨', aliases: [], hotMl: 355, iceMl: 355},
        {id: 'venti', name: '벤티', aliases: [], hotMl: 591, iceMl: 591},
      ],
    },
  ],
});

const at = (h: number, m = 0) => new Date(2026, 10, 15, h, m).getTime();
const ONBOARD: HqEvent = {
  type: 'onboard',
  at: at(8),
  name: '감돌이',
  breed: 'sumi',
  accessory: 'helmet',
  consent: {tripLog: true, exchange: true},
};
const BOARD: HqEvent = {type: 'signal', signal: 'board', at: at(18, 10), scenario: 'drive'};
const DEPART: HqEvent = {type: 'signal', signal: 'depart', at: at(18, 12)};

/** 가짜 저장소, 가짜 음성, 가짜 귀로 커피 묻기를 띄운다. */
function world(events: HqEvent[], options: {canListen?: boolean} = {}) {
  let state: HqState = events.reduce(step, initialState());
  const subscribers = new Set<() => void>();
  const spoken: string[] = [];
  /** 말하라고 넘긴 주차 중의 말 가운데 아직 거두지 않은 것 (음성 줄). */
  let queue: string[] = [];
  /** 거둔 말. */
  const unspoken: string[] = [];
  /** 네이티브 호스트가 기어 P 를 확인했는가. */
  let parked = true;
  const ears: {emit: (speech: HeardSpeech) => void; started: boolean; stopped: boolean}[] = [];
  /** 감자의 보통 말을 미루고 있는가 (듣는 동안). */
  const voice = {holding: false, holds: 0, releases: 0};
  let busy = 0;
  const notify = () => subscribers.forEach(s => s());
  const send = (event: HqEvent) => {
    state = step(state, event);
    notify();
  };
  const question = createCupQuestion({
    getState: () => state,
    subscribeState: listener => {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    dispatch: event => send(event),
    catalog: CATALOG,
    speak: text => spoken.push(text),
    speakWhileParked: text => {
      spoken.push(text);
      queue.push(text);
    },
    unspeak: text => {
      unspoken.push(text);
      queue = queue.filter(line => line !== text);
    },
    isParkConfirmed: () => parked,
    voiceOn: () => state.prefs.voice,
    speechBusyMs: () => busy,
    makeListener: emit => {
      if (options.canListen === false) return null;
      const ear = {emit, started: false, stopped: false};
      ears.push(ear);
      return {
        start: () => {
          // 듣기 시작할 때는 감자가 이미 말을 미루고 있다.
          expect(voice.holding).toBe(true);
          ear.started = true;
        },
        stop: () => {
          ear.stopped = true;
        },
      };
    },
    holdSpeech: () => {
      voice.holding = true;
      voice.holds += 1;
    },
    releaseSpeech: () => {
      voice.holding = false;
      voice.releases += 1;
    },
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  });
  return {
    question,
    send,
    spoken,
    unspoken,
    get queue() {
      return queue;
    },
    ears,
    voice,
    get state() {
      return state;
    },
    setBusy(ms: number) {
      busy = ms;
    },
    /** 네이티브 호스트가 알린 기어 P 확인이 바뀐다 (status 메시지). */
    setParked(value: boolean) {
      parked = value;
      notify();
    },
    /** 감자의 말이 다 끝나고 듣기 시작할 때까지 보낸다. */
    untilListening() {
      vi.advanceTimersByTime(100);
      busy = 0;
      vi.advanceTimersByTime(1500);
    },
  };
}

describe('커피 묻기: 주차한 채로만 묻고 듣는다', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('주행 중에는 묻지도 듣지도 않는다', () => {
    const w = world([ONBOARD, {type: 'arm-coffee'}, BOARD, DEPART]);
    expect(w.question.ask()).toBe(false);
    expect(w.question.retry()).toBe(false);
    expect(w.question.submitText('스벅 톨')).toBe(false);
    vi.advanceTimersByTime(20_000);
    expect(w.spoken).toEqual([]);
    expect(w.ears).toEqual([]);
    expect(w.question.getSnapshot().phase).toBe('idle');
  });

  it('커피 운송작전을 켜지 않았으면 묻지 않는다', () => {
    const w = world([ONBOARD]);
    expect(w.question.ask()).toBe(false);
  });

  it('주차한 채로 켜면 감자가 묻고, 그 말이 끝난 뒤에 듣고, 확인하면 다음 운행의 컵이 된다', () => {
    const w = world([ONBOARD, {type: 'arm-coffee'}]);
    expect(w.question.ask()).toBe(true);
    expect(w.question.getSnapshot().phase).toBe('asking');
    w.setBusy(5000);
    vi.advanceTimersByTime(100);
    expect(w.spoken).toEqual([CUP_QUESTION]);
    // 감자가 말하는 동안에는 듣지 않는다.
    vi.advanceTimersByTime(3000);
    expect(w.ears).toHaveLength(0);
    w.setBusy(0);
    vi.advanceTimersByTime(1500);
    expect(w.ears).toHaveLength(1);
    expect(w.ears[0].started).toBe(true);
    expect(w.question.getSnapshot().phase).toBe('listening');

    w.ears[0].emit({state: 'partial', text: '스벅 벤티'});
    expect(w.question.getSnapshot()).toMatchObject({phase: 'listening', partial: '스벅 벤티'});
    w.ears[0].emit({state: 'final', text: '스벅 벤티 아아 뚜껑 닫았어'});
    const heard = w.question.getSnapshot();
    expect(heard).toMatchObject({phase: 'heard', transcript: '스벅 벤티 아아 뚜껑 닫았어'});
    expect(heard.guess).toMatchObject({brandId: 'starbucks', sizeId: 'venti', temp: 'ice', lid: true});
    expect(w.ears[0].stopped).toBe(true);

    expect(w.question.confirm(heard.guess!)).toBe(true);
    expect(w.state.mission.cup?.label).toBe('스타벅스 벤티 아이스(뚜껑 닫음)');
    expect(w.question.getSnapshot().phase).toBe('idle');
    expect(w.spoken[w.spoken.length - 1]).toMatch(/^좋아, 스타벅스 벤티 아이스! /);
  });

  it('탑승한 뒤 출발 전(기어 P)에도 묻고, 확인하면 이번 운행의 컵이 된다', () => {
    const w = world([ONBOARD, BOARD, {type: 'arm-coffee'}]);
    expect(w.question.ask()).toBe(true);
    w.untilListening();
    w.ears[0].emit({state: 'final', text: '스타벅스 톨 따뜻한 거'});
    w.question.confirm(w.question.getSnapshot().guess!);
    expect(w.state.trip?.cup?.label).toBe('스타벅스 톨 핫(뚜껑 없음)');
  });

  it('듣는 중에 출발하면 바로 멈추고, 늦게 온 결과는 버린다', () => {
    const w = world([ONBOARD, {type: 'arm-coffee'}, BOARD]);
    w.question.ask();
    w.untilListening();
    expect(w.question.getSnapshot().phase).toBe('listening');
    w.send(DEPART);
    expect(w.ears[0].stopped).toBe(true);
    expect(w.question.getSnapshot().phase).toBe('idle');
    w.ears[0].emit({state: 'final', text: '스벅 벤티 아이스'});
    expect(w.question.getSnapshot()).toMatchObject({phase: 'idle', guess: null});
    expect(w.state.trip?.cup).toBeNull();
    // 확인도 받지 않는다.
    expect(w.question.confirm({brandId: 'starbucks', sizeId: 'venti'})).toBe(false);
    expect(w.state.trip?.cup).toBeNull();
  });

  it('감자가 묻는 중에 출발하면 듣기를 시작하지 않고, 아직 하지 못한 질문을 거둔다', () => {
    const w = world([ONBOARD, {type: 'arm-coffee'}, BOARD]);
    w.question.ask();
    // 탑승 인사("커피가 탑승했습니다…")가 아직 나오는 중이라 질문은 그 뒤에 줄을 서 있다.
    w.setBusy(4000);
    vi.advanceTimersByTime(100);
    expect(w.queue).toEqual([CUP_QUESTION]);
    w.send(DEPART);
    // 주행 중에 "브랜드랑 사이즈를 말해 줘"가 나오지 않는다.
    expect(w.unspoken).toEqual([CUP_QUESTION]);
    expect(w.queue).toEqual([]);
    w.setBusy(0);
    vi.advanceTimersByTime(20_000);
    expect(w.ears).toHaveLength(0);
    expect(w.question.getSnapshot().phase).toBe('idle');
  });

  it('질문이 끝나기 전에 듣기를 청했어도(네이티브는 질문이 끝나야 마이크를 연다) 출발하면 질문을 거둔다', () => {
    const w = world([ONBOARD, {type: 'arm-coffee'}, BOARD]);
    w.question.ask();
    // 웹의 어림으로는 질문이 끝나 듣기를 청했지만, 마이크는 아직 열리지 않았다.
    w.untilListening();
    expect(w.ears).toHaveLength(1);
    w.send(DEPART);
    expect(w.ears[0].stopped).toBe(true);
    expect(w.unspoken).toEqual([CUP_QUESTION]);
    expect(w.queue).toEqual([]);
  });

  it('마이크가 열렸으면 질문은 끝났다. 출발해도 거둘 말이 없다', () => {
    const w = world([ONBOARD, {type: 'arm-coffee'}, BOARD]);
    w.question.ask();
    w.untilListening();
    w.ears[0].emit({state: 'listening'});
    w.send(DEPART);
    expect(w.unspoken).toEqual([]);
  });

  it('묻지 않기를 누르거나 커피 운송작전을 끄면 아직 하지 못한 질문을 거둔다', () => {
    const w = world([ONBOARD, {type: 'arm-coffee'}]);
    w.setBusy(5000);
    w.question.ask();
    vi.advanceTimersByTime(100);
    w.question.stop();
    expect(w.unspoken).toEqual([CUP_QUESTION]);
    expect(w.queue).toEqual([]);
    w.question.ask();
    vi.advanceTimersByTime(100);
    expect(w.queue).toEqual([CUP_QUESTION]);
    w.send({type: 'disarm-coffee'});
    expect(w.question.getSnapshot().phase).toBe('idle');
    expect(w.unspoken).toEqual([CUP_QUESTION, CUP_QUESTION]);
    expect(w.queue).toEqual([]);
  });

  it('Android 앱이 기어 P 를 확인하지 못하면 묻지도 듣지도 않는다. 확인이 풀리면 멈추고 질문을 거둔다', () => {
    const w = world([ONBOARD, {type: 'arm-coffee'}, BOARD]);
    // 웹의 운행 단계는 탑승(주차한 채)이지만, Vehicle SDK 가 기어 P 를 읽지 못했다.
    w.setParked(false);
    expect(w.question.ask()).toBe(false);
    expect(w.question.retry()).toBe(false);
    expect(w.question.submitText('스벅 톨')).toBe(false);
    vi.advanceTimersByTime(20_000);
    expect(w.spoken).toEqual([]);
    expect(w.ears).toEqual([]);
    // 기어 P 를 확인하면 묻는다.
    w.setParked(true);
    w.setBusy(5000);
    expect(w.question.ask()).toBe(true);
    vi.advanceTimersByTime(100);
    expect(w.queue).toEqual([CUP_QUESTION]);
    // 질문이 끝나기 전에 확인이 풀리면 멈추고 질문을 거둔다.
    w.setParked(false);
    expect(w.question.getSnapshot().phase).toBe('idle');
    expect(w.unspoken).toEqual([CUP_QUESTION]);
    w.setBusy(0);
    vi.advanceTimersByTime(20_000);
    expect(w.ears).toHaveLength(0);
  });

  it('화면이 가려져 네이티브가 듣기를 멈추면(paused) 들은 말을 버리고 다시 말하기를 권한다', () => {
    const w = world([ONBOARD, {type: 'arm-coffee'}]);
    w.question.ask();
    w.untilListening();
    w.ears[0].emit({state: 'listening'});
    w.ears[0].emit({state: 'partial', text: '스벅'});
    w.ears[0].emit({state: 'error', error: 'paused'});
    expect(w.question.getSnapshot()).toMatchObject({phase: 'failed', partial: '', error: expect.stringContaining('화면이 가려져')});
    expect(w.ears[0].stopped).toBe(true);
    expect(w.voice.holding).toBe(false);
    expect(w.question.retry()).toBe(true);
    expect(w.ears).toHaveLength(2);
  });

  it('들어서 확인을 기다리는 중에 출발하면 들은 것을 버린다', () => {
    const w = world([ONBOARD, {type: 'arm-coffee'}, BOARD]);
    w.question.ask();
    w.untilListening();
    w.ears[0].emit({state: 'final', text: '스벅 톨'});
    expect(w.question.getSnapshot().phase).toBe('heard');
    w.send(DEPART);
    expect(w.question.getSnapshot()).toMatchObject({phase: 'idle', guess: null, transcript: ''});
  });

  it('커피 운송작전을 끄면 묻기와 듣기를 멈춘다', () => {
    const w = world([ONBOARD, {type: 'arm-coffee'}]);
    w.question.ask();
    w.untilListening();
    w.send({type: 'disarm-coffee'});
    expect(w.ears[0].stopped).toBe(true);
    expect(w.question.getSnapshot().phase).toBe('idle');
  });

  it('음성 안내를 껐으면 말하지 않고 바로 듣는다', () => {
    const w = world([ONBOARD, {type: 'set-pref', key: 'voice', value: false}, {type: 'arm-coffee'}]);
    w.question.ask();
    vi.advanceTimersByTime(400);
    expect(w.spoken).toEqual([]);
    expect(w.ears).toHaveLength(1);
    w.ears[0].emit({state: 'final', text: '스벅 톨 아이스'});
    w.question.confirm(w.question.getSnapshot().guess!);
    // 확인한 뒤에도 말하지 않는다.
    expect(w.spoken).toEqual([]);
  });

  it('들을 수단이 없으면 글로 적고, 적은 말을 알아듣는다', () => {
    const w = world([ONBOARD, {type: 'arm-coffee'}], {canListen: false});
    w.question.ask();
    w.untilListening();
    expect(w.question.getSnapshot().phase).toBe('typing');
    expect(w.question.submitText('스벅 톨 아이스, 뚜껑 닫았어')).toBe(true);
    expect(w.question.getSnapshot().guess).toMatchObject({brandId: 'starbucks', sizeId: 'tall', temp: 'ice', lid: true});
  });

  it('마이크가 열린 뒤 말소리가 오지 않으면 듣지 못한 것으로 보고 멈춘다', () => {
    const w = world([ONBOARD, {type: 'arm-coffee'}]);
    w.question.ask();
    w.untilListening();
    // 네이티브 호스트는 하던 말이 끝난 뒤에 마이크를 연다. 열리기 전에는 기다린다.
    vi.advanceTimersByTime(LISTEN_TIMEOUT_MS + 10);
    expect(w.question.getSnapshot().phase).toBe('listening');
    w.ears[0].emit({state: 'listening'});
    vi.advanceTimersByTime(LISTEN_TIMEOUT_MS - 100);
    expect(w.question.getSnapshot().phase).toBe('listening');
    vi.advanceTimersByTime(200);
    expect(w.question.getSnapshot()).toMatchObject({phase: 'failed', error: expect.stringContaining('듣지 못했습니다')});
    expect(w.ears[0].stopped).toBe(true);
    // 다시 말하기는 묻지 않고 바로 듣는다.
    expect(w.question.retry()).toBe(true);
    expect(w.ears).toHaveLength(2);
    expect(w.spoken).toEqual([CUP_QUESTION]);
  });

  it('마이크가 끝내 열리지 않아도 멈춘다', () => {
    const w = world([ONBOARD, {type: 'arm-coffee'}]);
    w.question.ask();
    w.untilListening();
    vi.advanceTimersByTime(OPEN_TIMEOUT_MS + 10);
    expect(w.question.getSnapshot().phase).toBe('failed');
    expect(w.ears[0].stopped).toBe(true);
  });

  it('출발하면 네이티브 호스트가 출발 신호보다 먼저 not-parked 를 보낸다. 출발 신호가 오면 멈춘다', () => {
    const w = world([ONBOARD, {type: 'arm-coffee'}, BOARD]);
    w.question.ask();
    w.untilListening();
    w.ears[0].emit({state: 'listening'});
    w.ears[0].emit({state: 'partial', text: '스벅 벤'});
    w.ears[0].emit({state: 'error', error: 'not-parked'});
    expect(w.ears[0].stopped).toBe(true);
    w.send(DEPART);
    expect(w.question.getSnapshot()).toMatchObject({phase: 'idle', partial: '', transcript: '', guess: null, error: null});
    vi.advanceTimersByTime(NOT_PARKED_GRACE_MS + 10);
    expect(w.question.getSnapshot()).toMatchObject({phase: 'idle', error: null});
    expect(w.state.trip?.cup).toBeNull();
  });

  it('웹은 주차 중인데 네이티브 호스트가 기어 P 를 확인하지 못했으면 글로 적게 하지 않고 칩으로 고르게 한다', () => {
    const w = world([ONBOARD, {type: 'arm-coffee'}]);
    w.question.ask();
    w.untilListening();
    w.ears[0].emit({state: 'error', error: 'not-parked'});
    expect(w.ears[0].stopped).toBe(true);
    expect(w.voice.holding).toBe(false);
    vi.advanceTimersByTime(NOT_PARKED_GRACE_MS + 10);
    // 차가 움직이는 중일 수 있어 글로 적는 칸(typing)은 열지 않는다.
    expect(w.question.getSnapshot()).toMatchObject({phase: 'failed', error: expect.stringContaining('기어 P')});
  });

  it('지난 듣기의 늦은 cancelled 는 이번 듣기를 멈추지 않는다', () => {
    const w = world([ONBOARD, {type: 'arm-coffee'}]);
    w.question.ask();
    w.untilListening();
    w.ears[0].emit({state: 'error', error: 'timeout'});
    expect(w.question.getSnapshot().phase).toBe('failed');
    // "다시 말하기": 웹은 지난 귀를 닫고(stopListening) 바로 새로 듣는다. 네이티브의 cancelled 가 늦게 온다.
    w.question.retry();
    w.ears[1].emit({state: 'error', error: 'cancelled'});
    expect(w.question.getSnapshot().phase).toBe('listening');
    w.ears[1].emit({state: 'listening'});
    w.ears[1].emit({state: 'final', text: '스벅 톨 아이스'});
    expect(w.question.getSnapshot()).toMatchObject({phase: 'heard', guess: {brandId: 'starbucks', sizeId: 'tall', temp: 'ice'}});
  });

  it('네이티브 호스트의 실패 까닭과 SDK 오류 이름(detail)으로 화면의 말을 고른다', () => {
    const w = world([ONBOARD, {type: 'arm-coffee'}]);
    w.question.ask();
    w.untilListening();
    const cases: [HeardSpeech, 'typing' | 'failed', string][] = [
      [{state: 'error', error: 'unavailable'}, 'typing', '쓸 수 없습니다'],
      [{state: 'error', error: 'unavailable', detail: 'PERMISSION_DENIED'}, 'typing', '쓸 수 없습니다'],
      [{state: 'error', error: 'recognizer', detail: 'MIC_ERROR'}, 'typing', '마이크'],
      [{state: 'error', error: 'recognizer', detail: 'AUDIO_ERROR'}, 'typing', '마이크'],
      [{state: 'error', error: 'recognizer', detail: 'UNAUTHENTICATED'}, 'typing', '쓸 수 없습니다'],
      [{state: 'error', error: 'recognizer', detail: 'ON_DEVICE_ENGINE_ERROR'}, 'typing', '쓸 수 없습니다'],
      [{state: 'error', error: 'recognizer', detail: 'UNAVAILABLE_LANGUAGE'}, 'typing', '쓸 수 없습니다'],
      [{state: 'error', error: 'recognizer', detail: 'NETWORK_ERROR'}, 'failed', '서버'],
      [{state: 'error', error: 'recognizer', detail: 'SERVER_INTERNAL_ERROR'}, 'failed', '서버'],
      [{state: 'error', error: 'recognizer', detail: 'UNKNOWN'}, 'failed', '잘 듣지 못했습니다'],
      [{state: 'error', error: 'timeout'}, 'failed', '말소리를 듣지 못했습니다'],
      [{state: 'error', error: 'no-speech'}, 'failed', '말소리를 듣지 못했습니다'],
    ];
    cases.forEach(([speech, phase, words], i) => {
      w.ears[i].emit(speech);
      expect(w.question.getSnapshot(), JSON.stringify(speech)).toMatchObject({phase, error: expect.stringContaining(words)});
      expect(w.ears[i].stopped).toBe(true);
      w.question.retry();
    });
  });

  it('듣는 동안 감자는 보통 말을 미루고, 다 듣거나 멈추면 다시 말한다', () => {
    const w = world([ONBOARD, {type: 'arm-coffee'}]);
    w.setBusy(5000);
    w.question.ask();
    vi.advanceTimersByTime(100);
    // 묻는 말은 미루지 않는다.
    expect(w.spoken).toEqual([CUP_QUESTION]);
    expect(w.voice).toMatchObject({holding: false, holds: 0});
    w.untilListening();
    expect(w.voice).toMatchObject({holding: true, holds: 1, releases: 0});
    w.ears[0].emit({state: 'listening'});
    w.ears[0].emit({state: 'final', text: '스벅 톨'});
    expect(w.voice).toMatchObject({holding: false, releases: 1});
    // 다시 말하기도 같다. 그만 듣기로 멈춰도 미루기를 푼다.
    w.question.retry();
    expect(w.voice.holding).toBe(true);
    w.question.stop();
    expect(w.voice).toMatchObject({holding: false, holds: 2, releases: 2});
    // 마이크가 끝내 열리지 않아도 푼다.
    w.question.retry();
    vi.advanceTimersByTime(OPEN_TIMEOUT_MS + 10);
    expect(w.voice).toMatchObject({holding: false, holds: 3, releases: 3});
    // 확인한 뒤의 말은 미루지 않는다.
    w.question.confirm({brandId: 'starbucks', sizeId: 'tall'});
    expect(w.spoken[w.spoken.length - 1]).toMatch(/^좋아, 스타벅스 톨/);
    expect(w.voice.holding).toBe(false);
  });

  it('마이크를 쓸 수 없으면 글로 적게 한다', () => {
    const w = world([ONBOARD, {type: 'arm-coffee'}]);
    w.question.ask();
    w.untilListening();
    w.ears[0].emit({state: 'error', error: 'not-allowed'});
    expect(w.question.getSnapshot()).toMatchObject({phase: 'typing', error: expect.stringContaining('마이크')});
  });

  it('네이티브 호스트가 보낸 Android 음성 인식 오류도 알아본다', () => {
    const w = world([ONBOARD, {type: 'arm-coffee'}]);
    w.question.ask();
    w.untilListening();
    w.ears[0].emit({state: 'error', error: 'ERROR_INSUFFICIENT_PERMISSIONS'});
    expect(w.question.getSnapshot().phase).toBe('typing');
    w.question.retry();
    w.ears[1].emit({state: 'error', error: 'ERROR_NO_MATCH'});
    expect(w.question.getSnapshot()).toMatchObject({phase: 'failed', error: expect.stringContaining('듣지 못했습니다')});
  });

  it('후보가 여럿이면 가장 잘 알아듣는 것을 쓴다', () => {
    const w = world([ONBOARD, {type: 'arm-coffee'}]);
    w.question.ask();
    w.untilListening();
    w.ears[0].emit({state: 'final', text: '수박 벤치', alternatives: ['스벅 벤티 아이스']});
    expect(w.question.getSnapshot()).toMatchObject({transcript: '스벅 벤티 아이스'});
  });

  it('아무것도 고르지 않고 확인하면 기본 컵이다', () => {
    const w = world([ONBOARD, {type: 'arm-coffee'}]);
    expect(w.question.confirm({})).toBe(true);
    expect(w.state.mission.cup).toBeNull();
  });
});
