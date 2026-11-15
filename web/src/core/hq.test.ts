import {describe, expect, it} from 'vitest';
import type {CupSpec} from './cup';
import {
  allowedSignals,
  canAskAboutCup,
  chosenCup,
  debriefOf,
  hydrate,
  initialState,
  isDrivingLocked,
  parkingReminderDue,
  phaseOf,
  potatoLine,
  streakAt,
  recallsAt,
  step,
  type HqEvent,
  type HqState,
} from './hq';
import type {TripWeather} from './publicdata';

/** 로컬 시각으로 2026년 11월 12일(목) 기준 시각을 만든다. */
const at = (h: number, m = 0, day = 12, month = 10, year = 2026) =>
  new Date(year, month, day, h, m).getTime();

const run = (events: HqEvent[], from: HqState = initialState()) =>
  events.reduce(step, from);

const onboard = (
  consent: Partial<{tripLog: boolean; exchange: boolean}> = {},
): HqEvent => ({
  type: 'onboard',
  at: at(8),
  name: '감돌이',
  breed: 'sumi',
  accessory: 'helmet',
  consent: {tripLog: true, exchange: true, ...consent},
});

const sig = (
  signal: 'board' | 'depart' | 'congestion-start' | 'congestion-end' | 'park',
  time: number,
): HqEvent =>
  signal === 'board'
    ? {type: 'signal', signal, at: time, scenario: 'commute-home'}
    : {type: 'signal', signal, at: time};

/** 퇴근길: 18:10 탑승, 18:12 출발, 18:25~18:43 정체, 19:02 주차. */
const commuteHome = (day = 12, month = 10, year = 2026): HqEvent[] => [
  sig('board', at(18, 10, day, month, year)),
  sig('depart', at(18, 12, day, month, year)),
  sig('congestion-start', at(18, 25, day, month, year)),
  {type: 'squad-matched', at: at(18, 25, day, month, year), squadSize: 8},
  {
    type: 'sticker-received',
    at: at(18, 30, day, month, year),
    sticker: 'cheer',
    from: '가상 감자 3호',
  },
  sig('congestion-end', at(18, 43, day, month, year)),
  sig('park', at(19, 2, day, month, year)),
];

describe('감자와 첫 만남', () => {
  it('처음에는 감자가 없다', () => {
    expect(initialState().potato).toBeNull();
  });

  it('이름, 외형, 동의를 정하면 감자가 생긴다', () => {
    const s = run([onboard({exchange: false})]);
    expect(s.potato).toMatchObject({
      name: '감돌이',
      breed: 'sumi',
      accessory: 'helmet',
    });
    expect(s.consent.tripLog).toBe(true);
    expect(s.consent.exchange).toBe(false);
  });

  it('이름이 비어 있으면 감자가 생기지 않는다', () => {
    const s = run([{...onboard(), name: '   '} as HqEvent]);
    expect(s.potato).toBeNull();
  });

  it('인사는 시각에 따라 달라진다', () => {
    const s = run([onboard()]);
    const morning = potatoLine(s, at(8)).text;
    const night = potatoLine(s, at(23)).text;
    expect(morning).toContain('아침');
    expect(night).not.toBe(morning);
  });
});

describe('운행 세션과 주행 잠금', () => {
  it('신호 순서대로 단계가 바뀐다', () => {
    let s = run([onboard()]);
    expect(phaseOf(s)).toBe('idle');
    s = step(s, sig('board', at(18, 10)));
    expect(phaseOf(s)).toBe('boarded');
    s = step(s, sig('depart', at(18, 12)));
    expect(phaseOf(s)).toBe('driving');
    s = step(s, sig('congestion-start', at(18, 25)));
    expect(phaseOf(s)).toBe('congested');
    s = step(s, sig('congestion-end', at(18, 43)));
    expect(phaseOf(s)).toBe('driving');
    s = step(s, sig('park', at(19, 2)));
    expect(phaseOf(s)).toBe('parked');
  });

  it('허용되지 않는 순서의 신호는 무시한다', () => {
    const s = run([onboard()]);
    expect(step(s, sig('park', at(9)))).toEqual(s);
    expect(step(s, sig('congestion-start', at(9)))).toEqual(s);
    const boarded = step(s, sig('board', at(18, 10)));
    expect(step(boarded, sig('board', at(18, 11)))).toEqual(boarded);
  });

  it('지금 보낼 수 있는 신호를 알려준다', () => {
    let s = run([onboard()]);
    expect(allowedSignals(s)).toEqual(['board']);
    s = run([sig('board', at(18, 10)), sig('depart', at(18, 12))], s);
    expect(allowedSignals(s).sort()).toEqual(['congestion-start', 'park']);
    s = step(s, sig('congestion-start', at(18, 25)));
    expect(allowedSignals(s).sort()).toEqual(['congestion-end', 'park']);
  });

  it('감자가 없으면 탑승 신호를 받지 않는다', () => {
    const s = step(initialState(), sig('board', at(18, 10)));
    expect(phaseOf(s)).toBe('idle');
  });

  it('주행과 정체 단계에서만 잠긴다', () => {
    let s = run([onboard(), sig('board', at(18, 10))]);
    expect(isDrivingLocked(s)).toBe(false);
    s = step(s, sig('depart', at(18, 12)));
    expect(isDrivingLocked(s)).toBe(true);
    s = step(s, sig('congestion-start', at(18, 25)));
    expect(isDrivingLocked(s)).toBe(true);
    s = step(s, sig('park', at(19, 2)));
    expect(isDrivingLocked(s)).toBe(false);
  });

  it('잠금 중에는 사용자 행동을 받지 않는다', () => {
    const s = run([onboard(), sig('board', at(18, 10)), sig('depart', at(18, 12))]);
    const renamed = step(s, {
      type: 'update-potato',
      name: '딴이름',
      breed: 'hong',
      accessory: 'none',
    });
    expect(renamed.potato?.name).toBe('감돌이');
    const consented = step(s, {type: 'set-consent', key: 'exchange', value: false});
    expect(consented.consent.exchange).toBe(true);
  });

  it('탑승 대사는 시나리오를 따른다', () => {
    const s = run([onboard(), sig('board', at(18, 10))]);
    expect(potatoLine(s, at(18, 10)).text).toContain('집까지 같이 가자');
  });

  it('운행 세션은 출발지와 목적지의 지역 이름만 갖는다', () => {
    const s = run([onboard(), sig('board', at(18, 10))]);
    expect(s.trip?.from).toBe('성수동');
    expect(s.trip?.to).toBe('정자동');
    expect(JSON.stringify(s.trip)).not.toMatch(/lat|lng|좌표/);
  });
});

describe('정체 구간 공동작전', () => {
  it('교류에 동의했으면 정체 진입 때 공동작전이 시작된다', () => {
    const s = run([
      onboard(),
      sig('board', at(18, 10)),
      sig('depart', at(18, 12)),
      sig('congestion-start', at(18, 25)),
      {type: 'squad-matched', at: at(18, 25), squadSize: 8},
    ]);
    expect(s.trip?.operation).toMatchObject({
      name: '퇴근 작전',
      squadSize: 8,
      completed: false,
    });
    expect(potatoLine(s, at(18, 26)).text).toContain('감자 8마리');
  });

  it('교류에 동의하지 않았으면 부대에 묶이지 않는다', () => {
    const s = run([
      onboard({exchange: false}),
      sig('board', at(18, 10)),
      sig('depart', at(18, 12)),
      sig('congestion-start', at(18, 25)),
      {type: 'squad-matched', at: at(18, 25), squadSize: 8},
      {type: 'sticker-received', at: at(18, 30), sticker: 'cheer', from: 'x'},
    ]);
    expect(s.trip?.operation).toBeNull();
    expect(potatoLine(s, at(18, 26)).text).not.toContain('마리');
  });

  it('정체가 두 번 와도 같은 작전에 이어진다', () => {
    const s = run([
      onboard(),
      sig('board', at(18, 10)),
      sig('depart', at(18, 12)),
      sig('congestion-start', at(18, 20)),
      {type: 'squad-matched', at: at(18, 20), squadSize: 5},
      sig('congestion-end', at(18, 30)),
      sig('congestion-start', at(18, 40)),
      sig('congestion-end', at(18, 45)),
      sig('park', at(19, 0)),
    ]);
    expect(s.trip?.congestions).toHaveLength(2);
    expect(debriefOf(s)).toMatchObject({kind: 'operation', congestionMinutes: 15});
  });

  it('정체 중 주차해도 작전이 완료된다', () => {
    const s = run([
      onboard(),
      sig('board', at(18, 10)),
      sig('depart', at(18, 12)),
      sig('congestion-start', at(18, 25)),
      {type: 'squad-matched', at: at(18, 25), squadSize: 4},
      sig('park', at(18, 40)),
    ]);
    expect(s.trip?.operation?.completed).toBe(true);
    expect(debriefOf(s)?.congestionMinutes).toBe(15);
  });
});

describe('주차 후 작전 결과와 스티커', () => {
  it('주차하면 함께한 감자 수와 받은 스티커가 공개된다', () => {
    const s = run([onboard(), ...commuteHome()]);
    const d = debriefOf(s);
    expect(d).toMatchObject({
      kind: 'operation',
      operationName: '퇴근 작전',
      squadSize: 8,
      congestionMinutes: 18,
    });
    expect(d?.stickers).toEqual([{sticker: 'cheer', from: '가상 감자 3호'}]);
  });

  it('주차 전에는 결과가 없다', () => {
    const s = run([onboard(), ...commuteHome().slice(0, 5)]);
    expect(debriefOf(s)).toBeNull();
  });

  it('스티커 수신을 껐으면 받은 스티커가 없다', () => {
    const s = run([
      onboard(),
      {type: 'set-consent', key: 'receiveStickers', value: false},
      ...commuteHome(),
    ]);
    expect(debriefOf(s)?.stickers).toEqual([]);
  });

  it('정체가 없었으면 무사 귀환 결과가 나온다', () => {
    const s = run([
      onboard(),
      sig('board', at(18, 10)),
      sig('depart', at(18, 12)),
      sig('park', at(18, 40)),
    ]);
    expect(debriefOf(s)).toMatchObject({kind: 'safe-return', squadSize: 0});
  });

  it('답례 스티커는 한 운행에 한 번만 보낸다', () => {
    let s = run([onboard(), ...commuteHome()]);
    s = step(s, {type: 'send-thanks', sticker: 'luck'});
    expect(debriefOf(s)?.thanksSent).toBe('luck');
    s = step(s, {type: 'send-thanks', sticker: 'cheer'});
    expect(debriefOf(s)?.thanksSent).toBe('luck');
  });

  it('목록에 없는 스티커는 보내지 않는다', () => {
    let s = run([onboard(), ...commuteHome()]);
    s = step(s, {type: 'send-thanks', sticker: '아무 말' as never});
    expect(debriefOf(s)?.thanksSent).toBeNull();
  });

  it('부대가 없었으면 답례를 보낼 수 없다', () => {
    let s = run([
      onboard(),
      sig('board', at(18, 10)),
      sig('depart', at(18, 12)),
      sig('park', at(18, 40)),
    ]);
    s = step(s, {type: 'send-thanks', sticker: 'luck'});
    expect(debriefOf(s)?.thanksSent).toBeNull();
  });
});

describe('작전일지', () => {
  it('운행 기록에 동의했으면 주차 때 초안이 생긴다', () => {
    const s = run([onboard(), ...commuteHome()]);
    expect(s.draft).not.toBeNull();
    expect(s.draft?.date).toBe('2026-11-12');
    expect(s.draft?.body).toContain('성수동');
    expect(s.draft?.body).toContain('정자동');
    expect(s.draft?.body).toContain('8마리');
    expect(s.draft?.body).toContain('스티커');
  });

  it('운행 기록에 동의하지 않았으면 초안이 생기지 않는다', () => {
    const s = run([onboard({tripLog: false}), ...commuteHome()]);
    expect(s.draft).toBeNull();
  });

  it('정체가 없었던 운행의 초안에는 정체와 부대 얘기가 없다', () => {
    const s = run([
      onboard(),
      sig('board', at(18, 10)),
      sig('depart', at(18, 12)),
      sig('park', at(18, 40)),
    ]);
    expect(s.draft?.body).not.toMatch(/막히|부대|스티커/);
  });

  it('메모와 사진을 붙여 저장하면 목록 맨 위에 온다', () => {
    let s = run([onboard(), ...commuteHome(11)]);
    s = step(s, {type: 'finish-trip', at: at(19, 5, 11), save: true});
    s = run(commuteHome(12), s);
    s = step(s, {type: 'edit-draft', memo: '오늘 노을이 예뻤다', photo: 'data:image/png;base64,AA'});
    s = step(s, {type: 'finish-trip', at: at(19, 5), save: true});
    expect(s.diary).toHaveLength(2);
    expect(s.diary[0]).toMatchObject({
      date: '2026-11-12',
      memo: '오늘 노을이 예뻤다',
      photo: 'data:image/png;base64,AA',
    });
    expect(s.diary[1].date).toBe('2026-11-11');
    expect(phaseOf(s)).toBe('idle');
    expect(s.draft).toBeNull();
  });

  it('저장하지 않고 마치면 어디에도 남지 않는다', () => {
    let s = run([onboard(), ...commuteHome()]);
    s = step(s, {type: 'finish-trip', at: at(19, 5), save: false});
    expect(s.diary).toEqual([]);
    expect(s.draft).toBeNull();
    expect(s.trip).toBeNull();
  });

  it('저장한 일지를 지울 수 있다', () => {
    let s = run([onboard(), ...commuteHome()]);
    s = step(s, {type: 'finish-trip', at: at(19, 5), save: true});
    s = step(s, {type: 'delete-entry', id: s.diary[0].id});
    expect(s.diary).toEqual([]);
  });

  it('일지에는 좌표나 경로가 없다', () => {
    let s = run([onboard(), ...commuteHome()]);
    s = step(s, {type: 'finish-trip', at: at(19, 5), save: true});
    expect(JSON.stringify(s.diary)).not.toMatch(/lat|lng|coords|route/);
  });
});

describe('추억 회상과 타임캡슐', () => {
  const savedLastYear = () => {
    let s = run([onboard(), ...commuteHome(12, 10, 2025)]);
    return step(s, {type: 'finish-trip', at: at(19, 5, 12, 10, 2025), save: true});
  };

  it('예전 같은 날짜의 일지가 "N년 전 오늘"로 돌아온다', () => {
    const s = savedLastYear();
    const recalls = recallsAt(s, at(9));
    expect(recalls).toHaveLength(1);
    expect(recalls[0]).toMatchObject({kind: 'anniversary', years: 1});
    expect(recallsAt(s, at(9, 0, 13))).toEqual([]);
  });

  it('같은 해의 일지는 회상하지 않는다', () => {
    let s = run([onboard(), ...commuteHome()]);
    s = step(s, {type: 'finish-trip', at: at(19, 5), save: true});
    expect(recallsAt(s, at(21))).toEqual([]);
  });

  it('감자를 만난 날의 주년이 돌아온다', () => {
    const s = run([{...onboard(), at: at(8, 0, 12, 10, 2025)} as HqEvent]);
    expect(recallsAt(s, at(9))).toEqual([
      expect.objectContaining({kind: 'first-met', years: 1}),
    ]);
  });

  it('같은 지역에 다시 주차하면 지난 일지가 돌아온다', () => {
    let s = savedLastYear();
    s = run(commuteHome(20, 10, 2026), s);
    const recalls = recallsAt(s, at(19, 3, 20));
    expect(recalls).toEqual([
      expect.objectContaining({kind: 'revisit', area: '정자동'}),
    ]);
  });

  it('같은 일지를 기념일과 재방문으로 두 번 보여주지 않는다', () => {
    // Regression: ISSUE-004. 1년 전 오늘 쓴 일지의 장소에 오늘 다시 주차하면 같은 일지가 두 장 떴다.
    // Found by /qa on 2026-11-14
    let s = savedLastYear();
    s = run(commuteHome(12, 10, 2026), s);
    const recalls = recallsAt(s, at(19, 3));
    expect(recalls.map(r => r.kind)).toEqual(['anniversary']);
  });

  it('닫은 회상은 같은 날 다시 뜨지 않는다', () => {
    let s = savedLastYear();
    const [recall] = recallsAt(s, at(9));
    s = step(s, {type: 'dismiss-recall', key: recall.key});
    expect(recallsAt(s, at(15))).toEqual([]);
  });

  it('주차한 곳에 남긴 타임캡슐은 그 지역에 다시 왔을 때 돌아온다', () => {
    let s = run([onboard({tripLog: false}), ...commuteHome(11)]);
    s = step(s, {type: 'add-capsule', at: at(19, 3, 11), text: '여기서 첫 월급 턱을 냈다'});
    s = step(s, {type: 'finish-trip', at: at(19, 5, 11), save: false});
    expect(recallsAt(s, at(9))).toEqual([]);
    s = run(commuteHome(12), s);
    expect(recallsAt(s, at(19, 3))).toEqual([
      expect.objectContaining({
        kind: 'capsule',
        area: '정자동',
        text: '여기서 첫 월급 턱을 냈다',
      }),
    ]);
  });

  it('타임캡슐은 주차 단계에서만 남길 수 있다', () => {
    const s = run([onboard()]);
    const after = step(s, {type: 'add-capsule', at: at(9), text: '아무 데나'});
    expect(after.capsules).toEqual([]);
  });
});

describe('임무', () => {
  it('커피 운송작전을 걸면 탑승 대사와 작전일지에 반영된다', () => {
    let s = run([onboard(), {type: 'arm-coffee'}]);
    s = step(s, sig('board', at(18, 10)));
    expect(s.trip?.coffee).toBe(true);
    expect(potatoLine(s, at(18, 10)).text).toContain('커피');
    s = run(commuteHome().slice(1), s);
    expect(s.draft?.body).toContain('커피');
    expect(s.mission.coffee).toBe(false);
  });

  it('임무를 걸지 않았으면 커피 얘기가 없다', () => {
    const s = run([onboard(), ...commuteHome()]);
    expect(s.draft?.body).not.toContain('커피');
  });

  it('주차비 알림은 시간이 되어야 울린다', () => {
    let s = run([onboard(), ...commuteHome()]);
    s = step(s, {type: 'set-parking-reminder', at: at(19, 5), minutes: 60});
    expect(parkingReminderDue(s, at(19, 30))).toBe(false);
    expect(parkingReminderDue(s, at(20, 5))).toBe(true);
    s = step(s, {type: 'complete-parking-reminder'});
    expect(parkingReminderDue(s, at(20, 10))).toBe(false);
    expect(s.mission.parking).toBeNull();
  });

  it('주행 잠금 중에는 주차비 알림을 걸 수 없다', () => {
    let s = run([onboard(), sig('board', at(18, 10)), sig('depart', at(18, 12))]);
    s = step(s, {type: 'set-parking-reminder', at: at(18, 15), minutes: 30});
    expect(s.mission.parking).toBeNull();
  });
});

describe('설정과 내 기록', () => {
  it('이름과 외형을 바꿀 수 있고 만난 날은 그대로다', () => {
    let s = run([onboard()]);
    s = step(s, {type: 'update-potato', name: '포슬이', breed: 'purple', accessory: 'sprout'});
    expect(s.potato).toMatchObject({name: '포슬이', breed: 'purple', accessory: 'sprout'});
    expect(s.potato?.metAt).toBe(at(8));
  });

  it('전체 삭제하면 처음으로 돌아간다', () => {
    let s = run([onboard(), ...commuteHome()]);
    s = step(s, {type: 'finish-trip', at: at(19, 5), save: true});
    s = step(s, {type: 'reset-all'});
    expect(s).toEqual(initialState());
  });
});

describe('누적 기록과 연속 탑승', () => {
  const finished = (days: number[]) =>
    days.reduce(
      (s, day) =>
        step(run(commuteHome(day), s), {
          type: 'finish-trip',
          at: at(19, 5, day),
          save: false,
        }),
      run([onboard()]),
    );

  it('운행을 마칠 때마다 누적 기록이 쌓인다', () => {
    const s = finished([10, 11, 12]);
    expect(s.stats).toMatchObject({
      trips: 3,
      operations: 3,
      squadMates: 24,
      stickersReceived: 3,
      congestionMinutes: 54,
    });
  });

  it('일지를 저장하지 않아도 운행은 누적된다', () => {
    expect(finished([12]).stats.trips).toBe(1);
  });

  it('매일 운행하면 연속 탑승 일수가 늘고, 하루를 거르면 끊긴다', () => {
    const s = finished([9, 10, 11]);
    expect(streakAt(s, at(21, 0, 11))).toBe(3);
    expect(streakAt(s, at(9, 0, 12))).toBe(3);
    expect(streakAt(s, at(9, 0, 13))).toBe(0);
  });

  it('같은 날 두 번 타도 연속 탑승은 하루로 센다', () => {
    let s = finished([12]);
    s = run(
      [
        sig('board', at(21, 0)),
        sig('depart', at(21, 2)),
        sig('park', at(21, 30)),
        {type: 'finish-trip', at: at(21, 35), save: false},
      ],
      s,
    );
    expect(s.stats.trips).toBe(2);
    expect(streakAt(s, at(23))).toBe(1);
  });
});

describe('음성 안내 설정', () => {
  it('기본은 켜져 있고 끌 수 있다', () => {
    let s = run([onboard()]);
    expect(s.prefs.voice).toBe(true);
    s = step(s, {type: 'set-pref', key: 'voice', value: false});
    expect(s.prefs.voice).toBe(false);
  });
});

describe('실제 차량에서 온 운행', () => {
  // 실제 차량에서는 시나리오가 없다. 출발지, 목적지, 정체 도로가 운행 중에 차례로 알려진다.
  const realTrip = (): HqEvent[] => [
    {type: 'signal', signal: 'board', at: at(18, 10), scenario: 'drive'},
    {type: 'trip-info', from: '역삼동'},
    sig('depart', at(18, 12)),
    {type: 'trip-info', to: '판교역'},
    {type: 'signal', signal: 'congestion-start', at: at(18, 25), road: '경부고속도로'},
    {type: 'squad-matched', at: at(18, 25), squadSize: 4},
    sig('congestion-end', at(18, 40)),
    sig('park', at(19, 0)),
  ];

  it('운행 중에 알려진 출발지, 목적지, 정체 도로가 작전일지에 들어간다', () => {
    const s = run([onboard(), ...realTrip()]);
    expect(s.trip).toMatchObject({from: '역삼동', to: '판교역', road: '경부고속도로'});
    expect(s.draft?.body).toContain('역삼동');
    expect(s.draft?.body).toContain('판교역');
    expect(s.draft?.body).toContain('경부고속도로에서');
    expect(debriefOf(s)).toMatchObject({kind: 'operation', squadSize: 4, congestionMinutes: 15});
  });

  it('주행 잠금 중에도 운행 정보는 받는다', () => {
    const s = run([onboard(), ...realTrip().slice(0, 4)]);
    expect(isDrivingLocked(s)).toBe(true);
    expect(s.trip?.to).toBe('판교역');
  });

  it('목적지를 모르는 운행도 일지가 자연스럽다', () => {
    const s = run([
      onboard(),
      {type: 'signal', signal: 'board', at: at(18, 10), scenario: 'drive'},
      sig('depart', at(18, 12)),
      sig('park', at(18, 40)),
    ]);
    expect(s.draft?.body).not.toMatch(/undefined|null|  |에서 에|로 향했다/);
    expect(s.draft?.body).toContain('무사히 도착했다');
  });

  it('주차한 뒤에 도착지가 알려져도 일지 초안에 반영된다', () => {
    let s = run([
      onboard(),
      {type: 'signal', signal: 'board', at: at(18, 10), scenario: 'drive'},
      sig('depart', at(18, 12)),
      sig('park', at(18, 40)),
    ]);
    s = step(s, {type: 'trip-info', to: '정자동'});
    expect(s.draft?.body).toContain('정자동에 무사히 도착했다');
  });

  it('1분이 안 되는 짧은 정체도 부대와 함께였다면 일지에 남는다', () => {
    const s = run([
      onboard(),
      {type: 'signal', signal: 'board', at: at(18, 10), scenario: 'drive'},
      sig('depart', at(18, 12)),
      {type: 'signal', signal: 'congestion-start', at: at(18, 25), road: '경부고속도로'},
      {type: 'squad-matched', at: at(18, 25), squadSize: 4},
      sig('congestion-end', at(18, 25) + 20_000),
      sig('park', at(19, 0)),
    ]);
    expect(s.draft?.body).toContain('감자 4마리');
    expect(s.draft?.body).not.toContain('0분');
  });

  it('운행이 없을 때 온 운행 정보는 무시한다', () => {
    const s = run([onboard()]);
    expect(step(s, {type: 'trip-info', to: '판교역'})).toEqual(s);
  });

  it('도착지를 모르면 타임캡슐을 남길 수 없다', () => {
    let s = run([
      onboard(),
      {type: 'signal', signal: 'board', at: at(18, 10), scenario: 'drive'},
      sig('depart', at(18, 12)),
      sig('park', at(18, 40)),
    ]);
    s = step(s, {type: 'add-capsule', at: at(18, 41), text: '어딘지 모를 곳'});
    expect(s.capsules).toEqual([]);
  });
});

describe('내비가 알려주는 과속방지턱', () => {
  const driving = (): HqEvent[] => [
    onboard(),
    {type: 'arm-coffee'},
    {type: 'signal', signal: 'board', at: at(18, 10), scenario: 'drive'},
    sig('depart', at(18, 12)),
  ];

  it('주행 중 지난 방지턱을 세어 결과와 일지에 싣는다', () => {
    const s = run([
      ...driving(),
      {type: 'bump', at: at(18, 15)},
      {type: 'bump', at: at(18, 20)},
      sig('park', at(18, 40)),
    ]);
    expect(debriefOf(s)).toMatchObject({coffee: true, bumps: 2});
    expect(s.draft?.body).toContain('방지턱 2개');
  });

  it('주행 중이 아닐 때 온 방지턱은 세지 않는다', () => {
    const s = run([
      onboard(),
      {type: 'signal', signal: 'board', at: at(18, 10), scenario: 'drive'},
      {type: 'bump', at: at(18, 11)},
    ]);
    expect(s.trip?.bumps).toBe(0);
    expect(step(run([onboard()]), {type: 'bump', at: at(9)}).trip).toBeNull();
  });

  it('커피 운송작전이 아니면 일지에 방지턱 얘기가 없다', () => {
    const s = run([
      onboard(),
      {type: 'signal', signal: 'board', at: at(18, 10), scenario: 'drive'},
      sig('depart', at(18, 12)),
      {type: 'bump', at: at(18, 15)},
      sig('park', at(18, 40)),
    ]);
    expect(debriefOf(s)?.bumps).toBe(1);
    expect(s.draft?.body).not.toContain('방지턱');
  });
});

describe('커피 운송작전', () => {
  const driving = (): HqEvent[] => [
    onboard(),
    {type: 'arm-coffee'},
    {type: 'signal', signal: 'board', at: at(18, 10), scenario: 'drive'},
    sig('depart', at(18, 12)),
  ];

  it('커피를 싣고 타면 감자가 운송 임무를 알린다', () => {
    const s = run([
      onboard(),
      {type: 'arm-coffee'},
      {type: 'signal', signal: 'board', at: at(18, 10), scenario: 'drive'},
    ]);
    expect(potatoLine(s, at(18, 10)).text).toBe(
      '사령관님! 커피가 탑승했습니다. 오늘의 임무는 무사 운송입니다!',
    );
  });

  it('한 방울도 흘리지 않으면 작전 성공으로 적는다', () => {
    const s = run([...driving(), {type: 'bump', at: at(18, 15)}, sig('park', at(18, 40))]);
    expect(debriefOf(s)).toMatchObject({spilledMl: 0, coffeeLeftPercent: 100});
    expect(s.draft?.body).toContain('한 방울도 흘리지 않았다');
  });

  it('넘친 양을 더해 결과와 일지에 싣는다', () => {
    const s = run([
      ...driving(),
      {type: 'spill', at: at(18, 15), ml: 12},
      {type: 'spill', at: at(18, 16), ml: 30},
      sig('park', at(18, 40)),
    ]);
    expect(debriefOf(s)).toMatchObject({spilledMl: 42, coffeeLeftPercent: 90});
    expect(s.draft?.body).toContain('42ml쯤 흘렸지만 90%는 지켜냈다');
  });

  it('커피를 싣지 않았거나 주행 중이 아니면 넘침을 세지 않는다', () => {
    const noCoffee = run([
      onboard(),
      {type: 'signal', signal: 'board', at: at(18, 10), scenario: 'drive'},
      sig('depart', at(18, 12)),
      {type: 'spill', at: at(18, 15), ml: 12},
    ]);
    expect(noCoffee.trip?.spilledMl).toBe(0);
    const parked = run([...driving(), sig('park', at(18, 40)), {type: 'spill', at: at(18, 41), ml: 12}]);
    expect(parked.trip?.spilledMl).toBe(0);
  });
});

describe('공공 API 자료: 날씨', () => {
  // 실제 차량의 운행. 출발지와 목적지를 모른다.
  const departWith = (weather: TripWeather | null): HqEvent[] => [
    {type: 'signal', signal: 'board', at: at(18, 0), scenario: 'drive'},
    {type: 'signal', signal: 'depart', at: at(18, 2), weather},
  ];
  const firstLine = (s: HqState) => s.draft?.body.split('\n\n')[0];

  it('출발 시각이 맑으면 일지 첫 줄이 "맑은 저녁"으로 시작한다', () => {
    const s = run([onboard(), ...departWith({condition: 'clear', tempC: 9}), sig('park', at(18, 40))]);
    expect(firstLine(s)).toBe('맑은 저녁, 오후 6시 2분에 길을 나섰다.');
  });

  it('비 예보가 있으면 출발 인사와 일지 첫 줄이 "비 소식"을 말한다 (빌드 때 받은 예보라 비가 온다고 단정하지 않는다)', () => {
    let s = run([onboard(), ...departWith({condition: 'rain', tempC: 7})]);
    expect(potatoLine(s, at(18, 3)).text).toBe('출발! 비 소식이 있으니 천천히 가자. 나는 조용히 있을게.');
    s = step(s, sig('park', at(18, 40)));
    expect(firstLine(s)).toBe('비 소식이 있던 저녁, 오후 6시 2분에 길을 나섰다.');
  });

  it('커피 운송작전 중에 눈 예보가 있으면 보고하는 말투로 알린다', () => {
    const s = run([onboard(), {type: 'arm-coffee'}, ...departWith({condition: 'snow', tempC: -1})]);
    expect(potatoLine(s, at(18, 3)).text).toBe('커피 운송작전 개시! 눈 소식이 있으니 살살 부탁드립니다.');
  });

  it('흐리기만 하면 출발 인사는 그대로다', () => {
    const s = run([onboard(), ...departWith({condition: 'overcast', tempC: 12})]);
    expect(potatoLine(s, at(18, 3)).text).toBe('출발! 운전에 집중해. 나는 조용히 있을게.');
  });

  it('날씨를 모르면 출발 인사와 일지 첫 줄이 예전 그대로다', () => {
    let s = run([onboard(), ...departWith(null)]);
    expect(potatoLine(s, at(18, 3)).text).toBe('출발! 운전에 집중해. 나는 조용히 있을게.');
    s = step(s, sig('park', at(18, 40)));
    expect(firstLine(s)).toBe('오후 6시 2분에 길을 나섰다.');
  });

  it('시나리오의 출발지와 목적지도 날씨와 함께 적는다', () => {
    const cloudy: TripWeather = {condition: 'cloudy', tempC: 10};
    const home = run([
      onboard(),
      sig('board', at(18, 10)),
      {type: 'signal', signal: 'depart', at: at(18, 12), weather: cloudy},
      sig('park', at(19, 2)),
    ]);
    expect(firstLine(home)).toBe('구름 많은 저녁, 오후 6시 12분에 성수동에서 퇴근길에 올라 정자동으로 향했다.');
    const pangyo = run([
      onboard(),
      {type: 'signal', signal: 'board', at: at(8, 30), scenario: 'pangyo-commute'},
      {type: 'signal', signal: 'depart', at: at(8, 32), weather: {condition: 'clear', tempC: 2}},
      sig('park', at(8, 43)),
    ]);
    expect(firstLine(pangyo)).toBe('맑은 아침, 오전 8시 32분에 시흥동을 떠나 삼평동으로 출근했다.');
  });
});

describe('공공 API 자료: 해 지는 시각', () => {
  // 해 뜨는 시각 오전 7시 11분, 지는 시각 오후 5시 21분.
  const sun = {sunrise: at(7, 11), sunset: at(17, 21)};
  const parkAt = (h: number, m: number, withSun = true) =>
    run([
      onboard(),
      {type: 'signal', signal: 'board', at: at(h - 1, m), scenario: 'drive'},
      sig('depart', at(h - 1, m + 2)),
      {type: 'signal', signal: 'park', at: at(h, m), sun: withSun ? sun : null},
    ]);

  it('해가 진 뒤에 도착하면 몇 분 뒤였는지 적고, 그림의 하늘은 밤이다', () => {
    const s = parkAt(18, 1);
    expect(s.draft?.body).toContain('오후 6시 1분, 무사히 도착했다. 해가 진 지 40분 뒤였다.');
    expect(s.draft?.scene?.sky).toBe('night');
  });

  it('해 지는 시각 앞뒤 30분 안이면 그림의 하늘은 해 질 녘이다', () => {
    const s = parkAt(17, 40);
    expect(s.draft?.body).toContain('해가 진 지 19분 뒤였다.');
    expect(s.draft?.scene?.sky).toBe('sunset');
    expect(parkAt(17, 0).draft?.scene?.sky).toBe('sunset');
    expect(parkAt(17, 0).draft?.body).not.toContain('해가');
  });

  it('한 시간이 넘으면 10분 단위로 어림하고, 세 시간이 넘으면 적지 않는다', () => {
    expect(parkAt(19, 2).draft?.body).toContain('해가 진 지 1시간 40분쯤 뒤였다.');
    expect(parkAt(19, 20).draft?.body).toContain('해가 진 지 2시간쯤 뒤였다.');
    expect(parkAt(23, 30).draft?.body).not.toContain('해가');
    expect(parkAt(23, 30).draft?.scene?.sky).toBe('night');
  });

  it('낮에 도착하면 해 얘기가 없고 하늘은 낮이다', () => {
    const s = parkAt(13, 0);
    expect(s.draft?.body).not.toContain('해가');
    expect(s.draft?.scene?.sky).toBe('day');
  });

  it('그날 자료가 없으면 해 얘기를 하지 않고 그림은 주차 시각으로 하늘을 어림한다', () => {
    const s = parkAt(18, 1, false);
    expect(s.draft?.body).not.toContain('해가');
    expect(s.draft?.scene).toEqual({hour: 18, coffee: false, squad: 0});
  });

  it('일지에는 해 지는 시각이 들어가도 좌표가 없다', () => {
    let s = parkAt(18, 1);
    s = step(s, {type: 'finish-trip', at: at(18, 5), save: true});
    expect(JSON.stringify(s.diary)).not.toMatch(/lat|lng|coords|route/);
  });
});

describe('공공 API 자료: 사고 다발 지점', () => {
  const driving = (): HqEvent[] => [
    onboard(),
    {type: 'signal', signal: 'board', at: at(18, 0), scenario: 'drive'},
    sig('depart', at(18, 2)),
  ];

  it('감자가 알리고 지나간 지점을 세어 결과와 일지에 싣는다', () => {
    const s = run([
      ...driving(),
      {type: 'hotspot', at: at(18, 10), kind: 'child'},
      {type: 'hotspot', at: at(18, 12), kind: 'child'},
      {type: 'hotspot', at: at(18, 15), kind: 'ice'},
      sig('park', at(18, 40)),
    ]);
    expect(s.trip?.hotspots).toEqual({child: 2, ice: 1});
    expect(debriefOf(s)?.hotspots).toBe(3);
    expect(s.draft?.body).toContain(
      '가는 길에 어린이 교통사고가 잦은 곳 두 군데와 겨울철 결빙 사고가 잦은 곳을 지났다. 감돌이가 미리 알려 줘서 살펴 갔다.',
    );
  });

  it('한 곳만 지났으면 수를 적지 않는다', () => {
    const s = run([...driving(), {type: 'hotspot', at: at(18, 10), kind: 'child'}, sig('park', at(18, 40))]);
    expect(s.draft?.body).toContain('가는 길에 어린이 교통사고가 잦은 곳을 지났다.');
  });

  it('주행 중이 아닐 때 온 지점은 세지 않고, 지나지 않았으면 일지에 없다', () => {
    let s = run([
      onboard(),
      {type: 'signal', signal: 'board', at: at(18, 0), scenario: 'drive'},
      {type: 'hotspot', at: at(18, 1), kind: 'child'},
    ]);
    expect(s.trip?.hotspots).toEqual({child: 0, ice: 0});
    s = run([sig('depart', at(18, 2)), sig('park', at(18, 40))], s);
    expect(debriefOf(s)?.hotspots).toBe(0);
    expect(s.draft?.body).not.toContain('사고');
  });

  it('예전에 저장한 운행은 지점 수, 날씨, 해 지는 시각 없이도 되살아난다', () => {
    const saved = JSON.parse(JSON.stringify(run(driving())));
    delete saved.trip.hotspots;
    delete saved.trip.weather;
    delete saved.trip.sun;
    const restored = hydrate(saved);
    expect(restored.trip).toMatchObject({hotspots: {child: 0, ice: 0}, weather: null, sun: null});
    const parked = step(restored, sig('park', at(18, 40)));
    expect(debriefOf(parked)?.hotspots).toBe(0);
    expect(parked.draft?.body).toContain('무사히 도착했다');
  });
});

describe('커피 운송작전에 실은 컵', () => {
  /** 시험용 컵. 스타벅스 벤티 아이스를 원통으로 어림한 것과 비슷한 숫자다. */
  const VENTI: CupSpec = {
    label: '스타벅스 벤티 아이스(뚜껑 닫음)',
    capacityMl: 662,
    fillMl: 591,
    radius: 0.0475,
    height: 0.0934,
    lid: true,
    ice: true,
    pick: {brandId: 'starbucks', sizeId: 'venti', volumeMl: null, temp: 'ice', lid: true},
  };
  const realBoard: HqEvent = {type: 'signal', signal: 'board', at: at(18, 10), scenario: 'drive'};
  const armed = (): HqEvent[] => [onboard(), {type: 'arm-coffee'}, {type: 'set-cup', cup: VENTI}];

  it('고른 컵은 다음 운행에 실리고, 탑승하면 운행으로 옮겨 간다', () => {
    let s = run(armed());
    expect(s.mission.cup).toEqual(VENTI);
    expect(chosenCup(s)).toEqual(VENTI);
    s = step(s, realBoard);
    expect(s.trip?.cup).toEqual(VENTI);
    expect(chosenCup(s)).toEqual(VENTI);
    expect(s.mission).toMatchObject({coffee: false, cup: null});
  });

  it('작전 결과와 일지에 그 컵과 든 양을 적고, 지켜낸 비율은 그 양으로 센다', () => {
    const s = run([
      ...armed(),
      realBoard,
      sig('depart', at(18, 12)),
      {type: 'bump', at: at(18, 15)},
      {type: 'spill', at: at(18, 15), ml: 12},
      sig('park', at(18, 40)),
    ]);
    expect(debriefOf(s)).toMatchObject({
      cup: '스타벅스 벤티 아이스(뚜껑 닫음) 591ml',
      coffeeMl: 591,
      spilledMl: 12,
      coffeeLeftPercent: 98,
    });
    expect(s.draft?.body).toContain(
      '방지턱 1개를 넘는 동안 스타벅스 벤티 아이스(뚜껑 닫음) 591ml 가운데 12ml쯤 흘렸지만 98%는 지켜냈다.',
    );
    expect(s.draft?.scene).toMatchObject({coffee: true, iced: true, lid: true});
  });

  it('한 방울도 흘리지 않았으면 그 컵으로 작전 성공을 적는다', () => {
    const s = run([...armed(), realBoard, sig('depart', at(18, 12)), sig('park', at(18, 40))]);
    expect(s.draft?.body).toContain('스타벅스 벤티 아이스(뚜껑 닫음) 591ml 가운데 한 방울도 흘리지 않았다. 작전 성공!');
  });

  it('컵을 고르지 않았으면 기본 컵(420ml)으로 계산하고 예전처럼 적는다', () => {
    const s = run([
      onboard(),
      {type: 'arm-coffee'},
      realBoard,
      sig('depart', at(18, 12)),
      {type: 'spill', at: at(18, 15), ml: 42},
      sig('park', at(18, 40)),
    ]);
    expect(s.trip?.cup).toBeNull();
    expect(debriefOf(s)).toMatchObject({cup: null, coffeeMl: 420, coffeeLeftPercent: 90});
    expect(s.draft?.body).toContain('오늘의 임무는 커피 무사 운송이었다. 42ml쯤 흘렸지만 90%는 지켜냈다.');
    expect(s.draft?.scene).toEqual({hour: 18, coffee: true, squad: 0});
  });

  it('넘친 양은 그 컵에 든 양을 넘지 않는다', () => {
    const s = run([...armed(), realBoard, sig('depart', at(18, 12)), {type: 'spill', at: at(18, 15), ml: 9999}]);
    expect(s.trip?.spilledMl).toBe(591);
  });

  it('탑승한 뒤 출발 전에는 운행의 컵을 바꾸고, 커피 운송작전을 끄면 컵도 지운다', () => {
    let s = run([onboard(), {type: 'arm-coffee'}, realBoard, {type: 'set-cup', cup: VENTI}]);
    expect(s.trip?.cup).toEqual(VENTI);
    s = step(s, {type: 'set-cup', cup: null});
    expect(s.trip?.cup).toBeNull();
    s = run([{type: 'set-cup', cup: VENTI}, {type: 'disarm-coffee'}], s);
    expect(s.trip).toMatchObject({coffee: false, cup: null});
    const idle = run([...armed(), {type: 'disarm-coffee'}]);
    expect(idle.mission).toMatchObject({coffee: false, cup: null});
  });

  it('주차한 채(기어 P)로 커피 운송작전을 켰을 때만 컵을 물을 수 있다', () => {
    expect(canAskAboutCup(run([onboard()]))).toBe(false);
    expect(canAskAboutCup(run([onboard(), {type: 'arm-coffee'}]))).toBe(true);
    expect(canAskAboutCup(run([onboard(), {type: 'arm-coffee'}, realBoard]))).toBe(true);
    expect(canAskAboutCup(run([onboard(), realBoard]))).toBe(false);
    const driving = run([onboard(), {type: 'arm-coffee'}, realBoard, sig('depart', at(18, 12))]);
    expect(isDrivingLocked(driving)).toBe(true);
    expect(canAskAboutCup(driving)).toBe(false);
    expect(canAskAboutCup(step(driving, sig('congestion-start', at(18, 20))))).toBe(false);
    expect(canAskAboutCup(step(driving, sig('park', at(18, 40))))).toBe(false);
  });

  it('주행 중이거나 주차한 뒤(작전 결과)에는 컵을 바꾸지 않는다', () => {
    const driving = run([onboard(), {type: 'arm-coffee'}, realBoard, sig('depart', at(18, 12))]);
    expect(step(driving, {type: 'set-cup', cup: VENTI})).toBe(driving);
    const parked = step(driving, sig('park', at(18, 40)));
    expect(step(parked, {type: 'set-cup', cup: VENTI})).toEqual(parked);
  });

  it('형식이 맞지 않는 컵은 받지 않고, 저장된 이상한 컵은 버린다', () => {
    const s = run([onboard(), {type: 'arm-coffee'}]);
    expect(step(s, {type: 'set-cup', cup: {...VENTI, radius: 3}})).toEqual(s);
    const saved = JSON.parse(JSON.stringify(run(armed())));
    expect(hydrate(saved).mission.cup).toEqual(VENTI);
    saved.mission.cup = {...VENTI, fillMl: -1};
    expect(hydrate(saved).mission.cup).toBeNull();
    const oldTrip = JSON.parse(JSON.stringify(run([onboard(), {type: 'arm-coffee'}, realBoard])));
    delete oldTrip.trip.cup;
    delete oldTrip.mission.cup;
    const restored = hydrate(oldTrip);
    expect(restored.trip?.cup).toBeNull();
    expect(restored.mission.cup).toBeNull();
  });
});
