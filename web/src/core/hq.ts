/**
 * 작전본부 코어.
 *
 * 상태 하나와 `step(상태, 사건) → 상태` 함수 하나로 된 순수 모듈이다.
 * 시각은 사건에 실려 들어오고, 코어는 시계나 난수를 직접 부르지 않는다.
 * 용어는 저장소 루트의 GLOSSARY.md를 따른다.
 */

// ───────────────────────── 고정 데이터 ─────────────────────────

import {COFFEE_START_ML, leftPercent, readCupSpec, type CupSpec} from './cup';
import {
  WEATHER_WORD,
  minutesAfterSunset,
  precipitationOf,
  skyPhase,
  type HotspotKind,
  type SkyPhase,
  type SunTimes,
  type TripWeather,
} from './publicdata';

export const BREEDS = {
  sumi: '수미감자',
  hong: '홍감자',
  purple: '자색감자',
} as const;
export type Breed = keyof typeof BREEDS;

export const ACCESSORIES = {
  none: '맨머리',
  helmet: '모자',
  sprout: '새싹',
  glasses: '동글 안경',
} as const;
export type Accessory = keyof typeof ACCESSORIES;

export const STICKERS = {
  cheer: '오늘도 고생 많으십니다.',
  gohome: '저도 퇴근하고 싶습니다.',
  luck: '귀하의 감자에게 행운을 빕니다.',
  coffee: '커피 운송작전의 성공을 기원합니다.',
  safe: '오늘도 무사 귀환하시길 바랍니다!',
  hang: '조금만 더 버팁시다. 감자는 강합니다.',
} as const;
export type StickerId = keyof typeof STICKERS;

export interface Scenario {
  label: string;
  from: string;
  to: string;
  road: string;
  operationName: string;
  /** 시뮬레이터가 탑승 시각으로 쓰는 값. */
  startHour: number;
  startMinute: number;
}

export const SCENARIOS = {
  'commute-home': {
    label: '퇴근길',
    from: '성수동',
    to: '정자동',
    road: '경부고속도로 양재 부근',
    operationName: '퇴근 작전',
    startHour: 18,
    startMinute: 10,
  },
  'commute-work': {
    label: '출근길',
    from: '정자동',
    to: '성수동',
    road: '분당수서로 청담대교 부근',
    operationName: '출근 작전',
    startHour: 8,
    startMinute: 5,
  },
  'weekend-trip': {
    label: '주말 나들이',
    from: '정자동',
    to: '강릉 안목해변',
    road: '영동고속도로 여주 부근',
    operationName: '나들이 작전',
    startHour: 9,
    startMinute: 30,
  },
  /** 실제 지역의 길. 성남시 시흥동(판교 제2테크노밸리)에서 삼평동까지, 실제 경로와 공공데이터를 쓴다. */
  'pangyo-commute': {
    label: '판교 출근길 · 실제 지도',
    from: '시흥동',
    to: '삼평동',
    road: '대왕판교로',
    operationName: '출근 작전',
    startHour: 8,
    startMinute: 30,
  },
  /** 실제 차량의 운행. 출발지, 목적지, 정체 도로는 운행 중에 알려진다. */
  drive: {
    label: '운행',
    from: '',
    to: '',
    road: '',
    operationName: '오늘의 작전',
    startHour: 0,
    startMinute: 0,
  },
} as const satisfies Record<string, Scenario>;
export type ScenarioId = keyof typeof SCENARIOS;

/** 시뮬레이터에서 고를 수 있는 시나리오. 실제 차량용 'drive'는 뺀다. */
export const DEMO_SCENARIOS = ['pangyo-commute', 'commute-home', 'commute-work', 'weekend-trip'] as const;

// ───────────────────────── 상태 ─────────────────────────

export type TripPhase = 'idle' | 'boarded' | 'driving' | 'congested' | 'parked';
export type VehicleSignal =
  | 'board'
  | 'depart'
  | 'congestion-start'
  | 'congestion-end'
  | 'park';

export interface Potato {
  name: string;
  breed: Breed;
  accessory: Accessory;
  metAt: number;
}

export interface Consent {
  /** 운행 기록을 작전일지 초안에 쓰는 데 동의. */
  tripLog: boolean;
  /** 정체 구간에서 감자 부대에 묶이는 데 동의. */
  exchange: boolean;
  /** 다른 감자의 스티커를 받는다. */
  receiveStickers: boolean;
}

export interface ReceivedSticker {
  sticker: StickerId;
  from: string;
}

export interface Operation {
  name: string;
  /** 교류 중계가 부대를 묶어주기 전에는 null. */
  squadSize: number | null;
  stickers: ReceivedSticker[];
  completed: boolean;
}

export interface Trip {
  id: string;
  scenario: ScenarioId;
  from: string;
  to: string;
  road: string;
  phase: Exclude<TripPhase, 'idle'>;
  boardedAt: number;
  departedAt: number | null;
  parkedAt: number | null;
  congestions: {startedAt: number; endedAt: number | null}[];
  operation: Operation | null;
  /** 커피 운송작전. 내비에 편안한 길을 청하고, 컵 속 커피가 넘치는지 계산해 보여준다. */
  coffee: boolean;
  /** 커피 운송작전에 실은 컵. 고르지 않았으면 null이고, 기본 컵(뚜껑 없는 420ml)으로 계산한다. */
  cup: CupSpec | null;
  /** 운행 중 지나온 과속방지턱 수. 내비의 주의 지점 정보에서 온다. */
  bumps: number;
  /** 커피 운송작전 중 컵에서 넘쳐 흐른 양 (ml). 컵 모형(core/cup.ts)이 계산해 알려준다. */
  spilledMl: number;
  /** 감자가 미리 알리고 지나간 사고 다발 지점 수. 한국도로교통공단 자료에서 온다. */
  hotspots: Record<HotspotKind, number>;
  /** 출발 시각의 날씨 예보 (기상청 단기예보). 예보가 없거나 오래됐거나, 차가 자료의 지역 밖이면 null. */
  weather: TripWeather | null;
  /** 주차한 날의 해 뜨고 지는 시각 (한국천문연구원). 자료가 없거나 차가 자료의 지역 밖이면 null. */
  sun: SunTimes | null;
  thanksSent: StickerId | null;
}

/** 그림일기의 그림에 쓰는 그날의 사실. */
export interface DiaryScene {
  /** 주차한 시각 (0~23시). 하늘 색을 정한다. */
  hour: number;
  /** 주차한 때의 하늘. 해 뜨고 지는 시각을 알 때만 있고, 있으면 hour보다 먼저 쓴다. */
  sky?: SkyPhase;
  coffee: boolean;
  /** 실은 컵이 아이스 컵인가. 컵을 골랐을 때만 있다. 없으면 예전처럼 뚜껑 덮은 종이컵을 그린다. */
  iced?: boolean;
  /** 실은 컵에 뚜껑을 닫았는가. 컵을 골랐을 때만 있다. */
  lid?: boolean;
  /** 같은 정체 구간에서 만난 감자 수. */
  squad: number;
}

export interface DiaryDraft {
  tripId: string;
  /** 주차한 날. 로컬 날짜 YYYY-MM-DD. */
  date: string;
  title: string;
  body: string;
  from: string;
  to: string;
  memo: string;
  photo: string | null;
  /** 예전에 저장한 일기에는 없다. */
  scene?: DiaryScene;
}

export interface DiaryEntry extends DiaryDraft {
  id: string;
  savedAt: number;
}

export interface TimeCapsule {
  id: string;
  area: string;
  text: string;
  createdAt: number;
}

export interface HqState {
  version: 1;
  potato: Potato | null;
  consent: Consent;
  trip: Trip | null;
  draft: DiaryDraft | null;
  diary: DiaryEntry[];
  capsules: TimeCapsule[];
  dismissedRecalls: string[];
  mission: {
    /** 다음 운행에 켜 둔 커피 운송작전. */
    coffee: boolean;
    /** 다음 운행에 실을 컵. 고르지 않았으면 null (기본 컵). 탑승하면 운행으로 옮겨 간다. */
    cup: CupSpec | null;
    parking: {setAt: number; dueAt: number} | null;
  };
  /** 마친 운행의 누적 기록. 일지 저장 여부와 무관하게 쌓인다. */
  stats: {
    trips: number;
    operations: number;
    squadMates: number;
    stickersReceived: number;
    congestionMinutes: number;
    /** 운행을 마친 날들. 로컬 날짜 YYYY-MM-DD, 중복 없음. */
    days: string[];
  };
  prefs: {
    /** 주행 중 감자 대사를 음성으로 안내한다. */
    voice: boolean;
  };
}

export function initialState(): HqState {
  return {
    version: 1,
    potato: null,
    consent: {tripLog: false, exchange: false, receiveStickers: true},
    trip: null,
    draft: null,
    diary: [],
    capsules: [],
    dismissedRecalls: [],
    mission: {coffee: false, cup: null, parking: null},
    stats: {
      trips: 0,
      operations: 0,
      squadMates: 0,
      stickersReceived: 0,
      congestionMinutes: 0,
      days: [],
    },
    prefs: {voice: true},
  };
}

// ───────────────────────── 사건 ─────────────────────────

export type HqEvent =
  // 사용자 행동
  | {
      type: 'onboard';
      at: number;
      name: string;
      breed: Breed;
      accessory: Accessory;
      consent: {tripLog: boolean; exchange: boolean};
    }
  | {type: 'update-potato'; name: string; breed: Breed; accessory: Accessory}
  | {type: 'set-consent'; key: keyof Consent; value: boolean}
  | {type: 'set-pref'; key: keyof HqState['prefs']; value: boolean}
  | {type: 'send-thanks'; sticker: StickerId}
  | {type: 'edit-draft'; memo?: string; photo?: string | null}
  | {type: 'finish-trip'; at: number; save: boolean}
  | {type: 'delete-entry'; id: string}
  | {type: 'add-capsule'; at: number; text: string}
  | {type: 'dismiss-recall'; key: string}
  | {type: 'arm-coffee'}
  | {type: 'disarm-coffee'}
  /** 커피 운송작전에 실은 컵을 정한다. null이면 기본 컵. 주차한 채(기어 P)로 탑승 전이나 탑승 중에만 받는다. */
  | {type: 'set-cup'; cup: CupSpec | null}
  | {type: 'set-parking-reminder'; at: number; minutes: number}
  | {type: 'complete-parking-reminder'}
  | {type: 'reset-all'}
  // 차량 신호원에서 오는 사건
  | {type: 'signal'; signal: 'board'; at: number; scenario: ScenarioId}
  /** 출발. weather는 출발 시각의 날씨로, 앱에 넣어 둔 예보에 그 시각이 있을 때만 싣는다. */
  | {type: 'signal'; signal: 'depart'; at: number; weather?: TripWeather | null}
  | {type: 'signal'; signal: 'congestion-start'; at: number; road?: string}
  | {type: 'signal'; signal: 'congestion-end'; at: number}
  /** 주차. sun은 그날의 해 뜨고 지는 시각으로, 앱에 넣어 둔 자료에 그날이 있을 때만 싣는다. */
  | {type: 'signal'; signal: 'park'; at: number; sun?: SunTimes | null}
  /** 과속방지턱 하나를 지난다. 내비의 주의 지점 정보에서 온다. */
  | {type: 'bump'; at: number}
  /** 감자가 미리 알린 사고 다발 지점 하나를 지난다. 주행 엔진이 실제 경로 위에서 센다. */
  | {type: 'hotspot'; at: number; kind: HotspotKind}
  /** 커피 운송작전 중 컵에서 커피가 넘쳤다. 컵 모형이 계산한 양이다. */
  | {type: 'spill'; at: number; ml: number}
  /** 운행 중에 알려지는 출발지, 목적지, 정체 도로의 이름. */
  | {type: 'trip-info'; from?: string; to?: string; road?: string}
  // 교류 중계에서 오는 사건
  | {type: 'squad-matched'; at: number; squadSize: number}
  | {type: 'sticker-received'; at: number; sticker: StickerId; from: string};

const NEXT_SIGNALS: Record<TripPhase, VehicleSignal[]> = {
  idle: ['board'],
  boarded: ['depart'],
  driving: ['congestion-start', 'park'],
  congested: ['congestion-end', 'park'],
  parked: [],
};

// ───────────────────────── 조회 ─────────────────────────

export function phaseOf(state: HqState): TripPhase {
  return state.trip?.phase ?? 'idle';
}

export function isDrivingLocked(state: HqState): boolean {
  const phase = phaseOf(state);
  return phase === 'driving' || phase === 'congested';
}

export function allowedSignals(state: HqState): VehicleSignal[] {
  if (!state.potato) return [];
  return NEXT_SIGNALS[phaseOf(state)];
}

/**
 * 감자가 실은 커피를 말로 물어도 되는가. 커피 운송작전을 켰고, 차가 주차한 채(기어 P)로
 * 탑승 전(대기)이나 탑승한 뒤 출발 전일 때만이다. 주행 중에는 묻지도 듣지도 않는다.
 */
export function canAskAboutCup(state: HqState): boolean {
  if (!state.potato || isDrivingLocked(state)) return false;
  const phase = phaseOf(state);
  if (phase === 'idle') return state.mission.coffee;
  return phase === 'boarded' && state.trip!.coffee;
}

/** 지금 고른 컵. 탑승했으면 운행의 컵, 아니면 다음 운행에 실을 컵. 고르지 않았으면 null. */
export function chosenCup(state: HqState): CupSpec | null {
  return state.trip ? (state.trip.cup ?? null) : state.mission.cup;
}

export type Mood = 'hello' | 'sleepy' | 'ready' | 'focus' | 'stuck' | 'proud';

export interface PotatoLine {
  text: string;
  mood: Mood;
}

/** 감자의 지금 대사. 시각, 운행 단계, 기록처럼 확인된 사실만 쓴다. */
export function potatoLine(state: HqState, at: number): PotatoLine {
  const trip = state.trip;
  if (!trip) {
    const hour = new Date(at).getHours();
    if (hour >= 5 && hour < 11)
      return {text: '좋은 아침! 오늘은 어디로 가?', mood: 'hello'};
    if (hour >= 11 && hour < 17)
      return {text: '낮이네. 차에서 기다리고 있었어!', mood: 'hello'};
    if (hour >= 17 && hour < 21)
      return {text: '저녁이네. 오늘 하루도 수고 많았어!', mood: 'hello'};
    return {text: '밤이 깊었어. 차는 내가 지키고 있을게.', mood: 'sleepy'};
  }
  switch (trip.phase) {
    case 'boarded':
      if (trip.coffee)
        return {
          text: '사령관님! 커피가 탑승했습니다. 오늘의 임무는 무사 운송입니다!',
          mood: 'ready',
        };
      return {text: BOARD_LINES[trip.scenario], mood: 'ready'};
    case 'driving': {
      if (trip.congestions.length > 0)
        return {text: '길이 풀렸습니다! 다시 출발합니다.', mood: 'focus'};
      // 출발 시각에 비나 눈 예보가 있으면 그 얘기를 한다. 빌드할 때 받은 예보이므로 "온다"고 하지 않고 "소식이 있다"고 한다.
      const falling = precipitationOf(trip.weather ?? null);
      if (trip.coffee)
        return {
          text: falling
            ? `커피 운송작전 개시! ${FALLING[falling]} 소식이 있으니 살살 부탁드립니다.`
            : '커피 운송작전 개시! 살살 부탁드립니다.',
          mood: 'focus',
        };
      return {
        text: falling
          ? `출발! ${FALLING[falling]} 소식이 있으니 천천히 가자. 나는 조용히 있을게.`
          : '출발! 운전에 집중해. 나는 조용히 있을게.',
        mood: 'focus',
      };
    }
    case 'congested':
      if (!trip.operation)
        return {text: '길이 막혔네. 내가 옆에 있을게.', mood: 'stuck'};
      return trip.operation.squadSize
        ? {
            text: `사령관님! 길이 막혔습니다. 감자 ${trip.operation.squadSize}마리도 함께 고립 중입니다!`,
            mood: 'stuck',
          }
        : {text: '사령관님! 길이 막혔습니다. 근처 감자 부대를 찾는 중입니다!', mood: 'stuck'};
    case 'parked':
      return {text: '오늘도 무사 귀환했습니다!', mood: 'proud'};
  }
}

const FALLING: Record<NonNullable<ReturnType<typeof precipitationOf>>, string> = {
  rain: '비',
  snow: '눈',
  sleet: '진눈깨비',
};

const BOARD_LINES: Record<ScenarioId, string> = {
  'commute-home': '오늘도 수고했어! 집까지 같이 가자.',
  'commute-work': '오늘도 출근하는 거야? 나도 같이 가!',
  'weekend-trip': '나들이다! 강릉까지 같이 가자.',
  'pangyo-commute': '오늘은 판교로 출근이네! 나도 같이 가!',
  drive: '어디 가? 나도 같이 갈래!',
};

export interface Debrief {
  kind: 'operation' | 'safe-return';
  operationName: string | null;
  squadSize: number;
  congestionMinutes: number;
  tripMinutes: number;
  stickers: ReceivedSticker[];
  thanksSent: StickerId | null;
  from: string;
  to: string;
  coffee: boolean;
  /** 실은 컵과 든 양. 예: "스타벅스 벤티 아이스(뚜껑 닫음) 591ml". 고르지 않았으면(기본 컵) null. */
  cup: string | null;
  /** 출발할 때 컵에 든 양 (ml). 고른 컵의 음료 양, 아니면 기본 컵의 420ml. */
  coffeeMl: number;
  bumps: number;
  /** 감자가 미리 알리고 지나간 사고 다발 지점 수. */
  hotspots: number;
  /** 커피 운송작전에서 흘린 양 (ml)과 지켜낸 비율 (%). */
  spilledMl: number;
  coffeeLeftPercent: number;
}

/** 작전 결과. 주차 단계에서만 공개된다. */
export function debriefOf(state: HqState): Debrief | null {
  const trip = state.trip;
  if (!trip || trip.phase !== 'parked') return null;
  const squadSize = trip.operation?.squadSize ?? 0;
  return {
    kind: squadSize > 0 ? 'operation' : 'safe-return',
    operationName: trip.operation?.name ?? null,
    squadSize,
    congestionMinutes: congestionMinutes(trip),
    tripMinutes: minutesBetween(trip.departedAt ?? trip.boardedAt, trip.parkedAt!),
    stickers: trip.operation?.stickers ?? [],
    thanksSent: trip.thanksSent,
    from: trip.from,
    to: trip.to,
    coffee: trip.coffee,
    cup: trip.cup ? cupWords(trip.cup) : null,
    coffeeMl: coffeeStartOf(trip),
    bumps: trip.bumps,
    hotspots: hotspotsOf(trip).child + hotspotsOf(trip).ice,
    spilledMl: spilledOf(trip),
    coffeeLeftPercent: leftPercent(coffeeStartOf(trip) - spilledOf(trip), spilledOf(trip)),
  };
}

export type Recall =
  | {kind: 'anniversary'; key: string; years: number; entry: DiaryEntry}
  | {kind: 'first-met'; key: string; years: number}
  | {kind: 'revisit'; key: string; area: string; entry: DiaryEntry}
  | {kind: 'capsule'; key: string; area: string; text: string; createdAt: number};

/** 지금 꺼내 보여줄 추억. 닫은 것은 같은 날 다시 나오지 않는다. */
export function recallsAt(state: HqState, at: number): Recall[] {
  if (!state.potato || isDrivingLocked(state)) return [];
  const today = dateKey(at);
  const [year, monthDay] = splitDate(today);
  const recalls: Recall[] = [];

  const [metYear, metMonthDay] = splitDate(dateKey(state.potato.metAt));
  if (metMonthDay === monthDay && metYear < year)
    recalls.push({
      kind: 'first-met',
      key: `first-met:${today}`,
      years: year - metYear,
    });

  for (const entry of state.diary) {
    const [entryYear, entryMonthDay] = splitDate(entry.date);
    if (entryMonthDay === monthDay && entryYear < year)
      recalls.push({
        kind: 'anniversary',
        key: `anniversary:${entry.id}:${today}`,
        years: year - entryYear,
        entry,
      });
  }

  const trip = state.trip;
  if (trip?.phase === 'parked' && trip.to) {
    // 기념일 회상으로 이미 꺼낸 일지는 재방문 회상으로 또 꺼내지 않는다.
    const shown = new Set(
      recalls.flatMap(r => (r.kind === 'anniversary' ? [r.entry.id] : [])),
    );
    const visited = state.diary.find(
      e => e.to === trip.to && e.tripId !== trip.id && !shown.has(e.id),
    );
    if (visited)
      recalls.push({
        kind: 'revisit',
        key: `revisit:${visited.id}:${today}`,
        area: trip.to,
        entry: visited,
      });
    for (const capsule of state.capsules) {
      if (capsule.area === trip.to && capsule.createdAt < trip.boardedAt)
        recalls.push({
          kind: 'capsule',
          key: `capsule:${capsule.id}:${today}`,
          area: capsule.area,
          text: capsule.text,
          createdAt: capsule.createdAt,
        });
    }
  }

  return recalls.filter(r => !state.dismissedRecalls.includes(r.key));
}

/** 오늘 또는 어제까지 이어진 연속 탑승 일수. */
export function streakAt(state: HqState, at: number): number {
  const days = new Set(state.stats.days);
  const cursor = new Date(at);
  cursor.setHours(12, 0, 0, 0);
  if (!days.has(dateKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(dateKey(cursor.getTime()))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function parkingReminderDue(state: HqState, at: number): boolean {
  return state.mission.parking !== null && at >= state.mission.parking.dueAt;
}

// ───────────────────────── 전이 ─────────────────────────

export function step(state: HqState, event: HqEvent): HqState {
  switch (event.type) {
    case 'signal':
      return onSignal(state, event);
    case 'trip-info':
      return onTripInfo(state, event);
    case 'bump':
      return isDrivingLocked(state)
        ? {...state, trip: {...state.trip!, bumps: state.trip!.bumps + 1}}
        : state;
    case 'hotspot': {
      if (!isDrivingLocked(state) || (event.kind !== 'child' && event.kind !== 'ice')) return state;
      const passed = hotspotsOf(state.trip!);
      return {
        ...state,
        trip: {...state.trip!, hotspots: {...passed, [event.kind]: passed[event.kind] + 1}},
      };
    }
    case 'spill':
      return isDrivingLocked(state) && state.trip!.coffee && event.ml > 0
        ? {
            ...state,
            trip: {
              ...state.trip!,
              spilledMl: Math.min(coffeeStartOf(state.trip!), spilledOf(state.trip!) + event.ml),
            },
          }
        : state;
    case 'squad-matched':
      return onSquadMatched(state, event.squadSize);
    case 'sticker-received':
      return onStickerReceived(state, event);
    default:
      // 주행 잠금 중에는 사용자 행동을 받지 않는다.
      if (isDrivingLocked(state)) return state;
      return onUserAction(state, event);
  }
}

function onSignal(
  state: HqState,
  event: Extract<HqEvent, {type: 'signal'}>,
): HqState {
  if (!allowedSignals(state).includes(event.signal)) return state;
  const at = event.at;

  if (event.signal === 'board') {
    const scenario = SCENARIOS[event.scenario];
    const trip: Trip = {
      id: `trip-${at}`,
      scenario: event.scenario,
      from: scenario.from,
      to: scenario.to,
      road: scenario.road,
      phase: 'boarded',
      boardedAt: at,
      departedAt: null,
      parkedAt: null,
      congestions: [],
      operation: null,
      coffee: state.mission.coffee,
      cup: state.mission.coffee ? state.mission.cup : null,
      bumps: 0,
      spilledMl: 0,
      hotspots: {child: 0, ice: 0},
      weather: null,
      sun: null,
      thanksSent: null,
    };
    return {...state, trip, mission: {...state.mission, coffee: false, cup: null}};
  }

  const trip = state.trip!;
  switch (event.signal) {
    case 'depart':
      return {
        ...state,
        trip: {...trip, phase: 'driving', departedAt: at, weather: event.weather ?? null},
      };
    case 'congestion-start':
      return {
        ...state,
        trip: {
          ...trip,
          phase: 'congested',
          road: event.road?.trim() || trip.road,
          congestions: [...trip.congestions, {startedAt: at, endedAt: null}],
          operation:
            trip.operation ??
            (state.consent.exchange
              ? {
                  name: SCENARIOS[trip.scenario].operationName,
                  squadSize: null,
                  stickers: [],
                  completed: false,
                }
              : null),
        },
      };
    case 'congestion-end':
      return {
        ...state,
        trip: {
          ...trip,
          phase: 'driving',
          congestions: closeCongestion(trip.congestions, at),
        },
      };
    case 'park':
      return withDraft({
        ...state,
        trip: {
          ...trip,
          phase: 'parked',
          parkedAt: at,
          sun: event.sun ?? null,
          congestions: closeCongestion(trip.congestions, at),
          operation: trip.operation && {...trip.operation, completed: true},
        },
      });
  }
}

function onTripInfo(
  state: HqState,
  event: Extract<HqEvent, {type: 'trip-info'}>,
): HqState {
  const trip = state.trip;
  if (!trip) return state;
  return withDraft({
    ...state,
    trip: {
      ...trip,
      from: event.from?.trim() || trip.from,
      to: event.to?.trim() || trip.to,
      road: event.road?.trim() || trip.road,
    },
  });
}

function onSquadMatched(state: HqState, squadSize: number): HqState {
  const trip = state.trip;
  if (!trip?.operation || trip.operation.completed || squadSize < 1)
    return state;
  return {
    ...state,
    trip: {...trip, operation: {...trip.operation, squadSize}},
  };
}

function onStickerReceived(
  state: HqState,
  event: Extract<HqEvent, {type: 'sticker-received'}>,
): HqState {
  const trip = state.trip;
  if (!trip?.operation || !state.consent.receiveStickers) return state;
  if (!(event.sticker in STICKERS)) return state;
  return withDraft({
    ...state,
    trip: {
      ...trip,
      operation: {
        ...trip.operation,
        stickers: [
          ...trip.operation.stickers,
          {sticker: event.sticker, from: event.from},
        ],
      },
    },
  });
}

type UserAction = Exclude<
  HqEvent,
  {type: 'signal' | 'trip-info' | 'bump' | 'hotspot' | 'spill' | 'squad-matched' | 'sticker-received'}
>;

function onUserAction(state: HqState, event: UserAction): HqState {
  switch (event.type) {
    case 'onboard': {
      const name = event.name.trim();
      if (state.potato || !name) return state;
      return {
        ...state,
        potato: {
          name,
          breed: event.breed,
          accessory: event.accessory,
          metAt: event.at,
        },
        consent: {...state.consent, ...event.consent},
      };
    }
    case 'update-potato': {
      const name = event.name.trim();
      if (!state.potato || !name) return state;
      return {
        ...state,
        potato: {
          ...state.potato,
          name,
          breed: event.breed,
          accessory: event.accessory,
        },
      };
    }
    case 'set-consent':
      return {...state, consent: {...state.consent, [event.key]: event.value}};
    case 'set-pref':
      return {...state, prefs: {...state.prefs, [event.key]: event.value}};
    case 'send-thanks': {
      const trip = state.trip;
      if (debriefOf(state)?.kind !== 'operation' || !trip) return state;
      if (trip.thanksSent || !(event.sticker in STICKERS)) return state;
      return withDraft({...state, trip: {...trip, thanksSent: event.sticker}});
    }
    case 'edit-draft':
      if (!state.draft) return state;
      return {
        ...state,
        draft: {
          ...state.draft,
          memo: event.memo ?? state.draft.memo,
          photo: event.photo === undefined ? state.draft.photo : event.photo,
        },
      };
    case 'finish-trip': {
      if (state.trip?.phase !== 'parked') return state;
      const diary =
        event.save && state.draft
          ? [
              {
                ...state.draft,
                memo: state.draft.memo.trim(),
                id: `entry-${state.draft.tripId}`,
                savedAt: event.at,
              },
              ...state.diary,
            ].sort((a, b) => b.date.localeCompare(a.date) || b.savedAt - a.savedAt)
          : state.diary;
      const trip = state.trip;
      const day = dateKey(trip.parkedAt!);
      const squad = trip.operation?.squadSize ?? 0;
      const stats = {
        trips: state.stats.trips + 1,
        operations: state.stats.operations + (squad > 0 ? 1 : 0),
        squadMates: state.stats.squadMates + squad,
        stickersReceived:
          state.stats.stickersReceived + (trip.operation?.stickers.length ?? 0),
        congestionMinutes: state.stats.congestionMinutes + congestionMinutes(trip),
        days: state.stats.days.includes(day)
          ? state.stats.days
          : [...state.stats.days, day],
      };
      return {...state, trip: null, draft: null, diary, stats};
    }
    case 'delete-entry':
      return {...state, diary: state.diary.filter(e => e.id !== event.id)};
    case 'add-capsule': {
      const text = event.text.trim();
      if (state.trip?.phase !== 'parked' || !state.trip.to || !text) return state;
      return {
        ...state,
        capsules: [
          ...state.capsules,
          {
            id: `capsule-${event.at}`,
            area: state.trip.to,
            text,
            createdAt: event.at,
          },
        ],
      };
    }
    case 'dismiss-recall':
      if (state.dismissedRecalls.includes(event.key)) return state;
      return {
        ...state,
        dismissedRecalls: [...state.dismissedRecalls, event.key],
      };
    case 'arm-coffee':
      if (!state.potato) return state;
      if (state.trip?.phase === 'boarded')
        return {...state, trip: {...state.trip, coffee: true}};
      if (state.trip) return state;
      return {...state, mission: {...state.mission, coffee: true}};
    case 'disarm-coffee':
      if (state.trip?.phase === 'boarded')
        return {...state, trip: {...state.trip, coffee: false, cup: null}};
      return {...state, mission: {...state.mission, coffee: false, cup: null}};
    case 'set-cup': {
      // 주행 잠금 중에는 여기까지 오지 않는다. 주차한 뒤(작전 결과)에는 지난 운행의 컵을 바꾸지 않는다.
      if (!state.potato) return state;
      const cup = event.cup === null ? null : readCupSpec(event.cup);
      if (event.cup !== null && cup === null) return state;
      if (state.trip?.phase === 'boarded') return {...state, trip: {...state.trip, cup}};
      if (state.trip) return state;
      return {...state, mission: {...state.mission, cup}};
    }
    case 'set-parking-reminder':
      if (!state.potato || event.minutes <= 0) return state;
      return {
        ...state,
        mission: {
          ...state.mission,
          parking: {setAt: event.at, dueAt: event.at + event.minutes * 60_000},
        },
      };
    case 'complete-parking-reminder':
      return {...state, mission: {...state.mission, parking: null}};
    case 'reset-all':
      return initialState();
  }
}

// ───────────────────────── 작전일지 초안 ─────────────────────────

/** 주차 단계이고 운행 기록에 동의했으면 초안을 (다시) 쓴다. 메모와 사진은 지킨다. */
function withDraft(state: HqState): HqState {
  const trip = state.trip;
  if (!trip || trip.phase !== 'parked' || !state.consent.tripLog || !state.potato)
    return state;
  return {
    ...state,
    draft: {
      tripId: trip.id,
      date: dateKey(trip.parkedAt!),
      title: `오늘의 감자 작전일지 · ${SCENARIOS[trip.scenario].label}`,
      body: writeDiaryBody(trip, state.potato),
      from: trip.from,
      to: trip.to,
      memo: state.draft?.tripId === trip.id ? state.draft.memo : '',
      photo: state.draft?.tripId === trip.id ? state.draft.photo : null,
      scene: {
        hour: new Date(trip.parkedAt!).getHours(),
        // 해 지는 시각을 알면 그것으로 하늘을 정한다. 모르면 그림이 주차 시각으로 어림한다.
        ...(trip.sun ? {sky: skyPhase(trip.parkedAt!, trip.sun)} : {}),
        coffee: trip.coffee,
        // 컵을 골랐으면 그 컵(아이스 컵, 뚜껑)으로 그린다.
        ...(trip.coffee && trip.cup ? {iced: trip.cup.ice, lid: trip.cup.lid} : {}),
        squad: trip.operation?.squadSize ?? 0,
      },
    },
  };
}

/** 운행 세션에 실제로 기록된 사건만 엮어 이야기를 쓴다. */
function writeDiaryBody(trip: Trip, potato: Potato): string {
  const paragraphs: string[] = [];
  const departedAt = trip.departedAt ?? trip.boardedAt;
  const startedAt = clock(departedAt);
  const toward = `${trip.to}${josa(trip.to, '으로', '로')}`;
  const where = trip.road ? `${trip.road}에서 ` : '';
  // 출발 시각의 날씨 예보를 알면 "맑은 저녁, 오후 6시 2분에"나 "비 소식이 있던 저녁, …"으로 시작한다.
  // 모르면 예전 그대로 시각으로 시작한다.
  const weather = trip.weather ?? null;
  const when = weather
    ? `${WEATHER_WORD[weather.condition]} ${partOfDay(departedAt)}, ${startedAt}에`
    : null;

  switch (trip.scenario) {
    case 'commute-home':
      paragraphs.push(
        when
          ? `${when} ${trip.from}에서 퇴근길에 올라 ${toward} 향했다.`
          : `오늘은 ${trip.from}에서 퇴근길에 올랐다. ${startedAt}에 출발해 ${toward} 향했다.`,
      );
      break;
    case 'commute-work':
    case 'pangyo-commute':
      paragraphs.push(
        `${when ?? `${startedAt},`} ${trip.from}${josa(trip.from, '을', '를')} 떠나 ${toward} 출근했다.`,
      );
      break;
    case 'weekend-trip':
      paragraphs.push(
        `기다리던 나들이 날이다. ${when ?? `${startedAt}에`} ${trip.from}${josa(trip.from, '을', '를')} 떠나 ${toward} 향했다.`,
      );
      break;
    case 'drive':
      if (trip.from && trip.to)
        paragraphs.push(`${when ?? `${startedAt},`} ${trip.from}에서 출발해 ${toward} 향했다.`);
      else if (trip.to) paragraphs.push(`${when ?? `${startedAt}에`} 출발해 ${toward} 향했다.`);
      else if (trip.from) paragraphs.push(`${when ?? `${startedAt},`} ${trip.from}에서 길을 나섰다.`);
      else paragraphs.push(`${when ?? `${startedAt}에`} 길을 나섰다.`);
      break;
  }

  if (trip.coffee) {
    const spilled = Math.round(spilledOf(trip));
    const over = trip.bumps > 0 ? `방지턱 ${trip.bumps}개를 넘는 동안 ` : '';
    // 컵을 골랐으면 "스타벅스 벤티 아이스(뚜껑 닫음) 591ml 가운데"처럼 그 컵을 적는다.
    const cup = trip.cup ? `${cupWords(trip.cup)} 가운데 ` : '';
    const start = coffeeStartOf(trip);
    paragraphs.push(
      spilled < 1
        ? `오늘의 임무는 커피 무사 운송이었다. ${over}${cup}한 방울도 흘리지 않았다. 작전 성공!`
        : `오늘의 임무는 커피 무사 운송이었다. ${over}${cup}${spilled}ml쯤 흘렸지만 ${leftPercent(
            start - spilled,
            spilled,
          )}%는 지켜냈다.`,
    );
  }

  // 감자가 미리 알린 사고 다발 지점을 지났으면 적는다.
  const passed = hotspotsOf(trip);
  const spots = [
    passed.child > 0 ? placesPhrase('어린이 교통사고가 잦은 곳', passed.child) : '',
    passed.ice > 0 ? placesPhrase('겨울철 결빙 사고가 잦은 곳', passed.ice) : '',
  ].filter(Boolean);
  if (spots.length > 0) {
    const listed = spots.length === 2 ? `${spots[0]}${josa(spots[0], '과', '와')} ${spots[1]}` : spots[0];
    paragraphs.push(
      `가는 길에 ${listed}${josa(listed, '을', '를')} 지났다. ${potato.name}${josa(potato.name, '이', '가')} 미리 알려 줘서 살펴 갔다.`,
    );
  }

  const stuck = congestionMinutes(trip);
  const operation = trip.operation;
  const squad = operation?.squadSize ?? 0;
  if (operation && squad > 0) {
    const howLong = stuck > 0 ? `${stuck}분 동안` : '잠깐';
    paragraphs.push(
      `그런데 ${where}길이 꽉 찼다. ${howLong} 꼼짝 못 했지만 혼자는 아니었다. 같은 구간에 감자 ${squad}마리가 함께 서 있었다.`,
    );
    const stickers = operation.stickers;
    const lines: string[] = [];
    if (stickers.length > 0)
      lines.push(
        `우리 감자는 응원 스티커를 ${stickers.length}장 받았다. "${STICKERS[stickers[0].sticker]}"`,
      );
    if (trip.thanksSent)
      lines.push(`우리도 "${STICKERS[trip.thanksSent]}" 하고 답례했다.`);
    lines.push(
      '서로 어디로 가는지는 몰라도 잠깐 같은 길에서 고생한 동료들이었다.',
    );
    paragraphs.push(lines.join(' '));
  } else if (stuck > 0) {
    paragraphs.push(
      `${where}${stuck}분쯤 차가 서 있었다. ${potato.name}${josa(potato.name, '과', '와')} 둘이서 조용히 버텼다.`,
    );
  }

  // 해가 진 뒤에 도착했으면 몇 분 뒤였는지 덧붙인다 (한국천문연구원 출몰시각, 성남 기준).
  const dusk = trip.sun ? afterSunsetWords(minutesAfterSunset(trip.parkedAt!, trip.sun)) : '';
  const arrived = `${clock(trip.parkedAt!)}, ${trip.to ? `${trip.to}에 ` : ''}무사히 도착했다.${dusk ? ` ${dusk}` : ''}`;
  paragraphs.push(
    squad > 0
      ? `${arrived} 차는 막혀도, 감자들의 이야기는 계속된다.`
      : `${arrived} 별일 없이 도착한 것도 좋은 하루다.`,
  );
  return paragraphs.join('\n\n');
}

// ───────────────────────── 도우미 ─────────────────────────

/** 저장돼 있던 예전 운행에는 값이 없을 수 있다. */
function spilledOf(trip: Trip): number {
  return trip.spilledMl ?? 0;
}

/** 출발할 때 컵에 든 양 (ml). 고른 컵이 없으면 기본 컵의 420ml. */
function coffeeStartOf(trip: Trip): number {
  return trip.cup?.fillMl ?? COFFEE_START_ML;
}

/** "스타벅스 벤티 아이스(뚜껑 닫음) 591ml". 이름에 이미 용량이 있으면("500ml 컵") 다시 적지 않는다. */
export function cupWords(cup: CupSpec): string {
  const ml = `${Math.round(cup.fillMl)}ml`;
  return cup.label.includes(ml) ? cup.label : `${cup.label} ${ml}`;
}

/** 저장돼 있던 예전 운행에는 값이 없을 수 있다. */
function hotspotsOf(trip: Trip): Record<HotspotKind, number> {
  return {child: trip.hotspots?.child ?? 0, ice: trip.hotspots?.ice ?? 0};
}

const NATIVE_COUNTS = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'];

/** "어린이 교통사고가 잦은 곳", "어린이 교통사고가 잦은 곳 두 군데". */
function placesPhrase(place: string, count: number): string {
  if (count <= 1) return place;
  return `${place} ${count < NATIVE_COUNTS.length ? `${NATIVE_COUNTS[count]} 군데` : `${count}군데`}`;
}

/** 때를 나타내는 말. 날씨와 함께 "맑은 저녁"처럼 쓴다. */
function partOfDay(at: number): string {
  const hour = new Date(at).getHours();
  if (hour < 5) return '새벽';
  if (hour < 11) return '아침';
  if (hour < 17) return '낮';
  if (hour < 21) return '저녁';
  return '밤';
}

/** 해가 진 뒤 도착한 시간을 일지의 말로. 해가 지기 전이거나 세 시간 넘게 지났으면 빈 문자열. */
function afterSunsetWords(minutes: number | null): string {
  if (minutes === null || minutes >= 180) return '';
  if (minutes < 5) return '해가 막 진 뒤였다.';
  if (minutes < 60) return `해가 진 지 ${minutes}분 뒤였다.`;
  // 한 시간이 넘으면 10분 단위로 어림한다.
  const rounded = Math.round(minutes / 10) * 10;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return `해가 진 지 ${hours}시간${rest > 0 ? ` ${rest}분` : ''}쯤 뒤였다.`;
}

function closeCongestion(
  congestions: Trip['congestions'],
  at: number,
): Trip['congestions'] {
  return congestions.map(c => (c.endedAt === null ? {...c, endedAt: at} : c));
}

function congestionMinutes(trip: Trip): number {
  return trip.congestions.reduce(
    (sum, c) => sum + (c.endedAt === null ? 0 : minutesBetween(c.startedAt, c.endedAt)),
    0,
  );
}

function minutesBetween(from: number, to: number): number {
  return Math.max(0, Math.round((to - from) / 60_000));
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 로컬 날짜 YYYY-MM-DD. */
export function dateKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function splitDate(date: string): [year: number, monthDay: string] {
  return [Number(date.slice(0, 4)), date.slice(5)];
}

/** "오후 6시 12분" 꼴의 시각. */
export function clock(at: number): string {
  const d = new Date(at);
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h < 12 ? '오전' : '오후';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${period} ${hour12}시` : `${period} ${hour12}시 ${m}분`;
}

/** 받침 유무로 조사를 고른다. '으로/로'는 ㄹ 받침도 '로'를 쓴다. */
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  const final = finalOf(word.trim());
  if (final === 'none') return withoutFinal;
  // ㄹ 받침 뒤에는 '으로'가 아니라 '로'가 온다 (서울로, Gamdol로).
  if (final === 'rieul' && withFinal === '으로') return withoutFinal;
  return withFinal;
}

/** 낱말이 받침으로 끝나는가. 한글이 아니면 읽는 소리로 어림한다 (Station → 션, Gamdol → 돌, 3 → 삼). */
function finalOf(word: string): 'none' | 'rieul' | 'other' {
  const last = word.slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  if (code >= 0 && code <= 11171) {
    const final = code % 28;
    return final === 0 ? 'none' : final === 8 ? 'rieul' : 'other';
  }
  if (/[0-9]/.test(last)) return '178'.includes(last) ? 'rieul' : '036'.includes(last) ? 'other' : 'none';
  // 대문자 약자는 한 글자씩 읽는다 (KT → 케이티, LG → 엘지, BMW → 비엠더블유, SM → 에스엠, CAR → 씨에이알).
  const token = word.split(/\s+/).pop() ?? word;
  if (/^[A-Z]{1,4}$/.test(token)) return 'LR'.includes(last) ? 'rieul' : 'MN'.includes(last) ? 'other' : 'none';
  // 영어 낱말은 끝소리 l은 ㄹ, m·n·ng은 받침으로 읽고, 나머지는 '으'를 붙여 읽는 경우가 많다 (Ted → 테드, Mark → 마크).
  const letter = last.toLowerCase();
  if (letter === 'l') return 'rieul';
  if (letter === 'm' || letter === 'n') return 'other';
  if (letter === 'g' && word.slice(-2, -1).toLowerCase() === 'n') return 'other';
  return 'none';
}

/** 저장소에서 읽은 값을 상태로 되살린다. 형식이 다르면 처음 상태를 준다. */
export function hydrate(raw: unknown): HqState {
  if (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as {version?: unknown}).version === 1
  )
  {
    const base = initialState();
    const saved = raw as Partial<HqState>;
    return {
      ...base,
      ...saved,
      // 예전 판에서 저장한 운행에는 커피가 참·거짓이 아니거나 방지턱과 넘친 양, 사고 다발 지점,
      // 날씨와 해 지는 시각이 없을 수 있다.
      trip: saved.trip
        ? {
            ...saved.trip,
            coffee: Boolean(saved.trip.coffee),
            cup: readCupSpec(saved.trip.cup),
            bumps: Number(saved.trip.bumps) || 0,
            spilledMl: Number(saved.trip.spilledMl) || 0,
            hotspots: {
              child: Number(saved.trip.hotspots?.child) || 0,
              ice: Number(saved.trip.hotspots?.ice) || 0,
            },
            weather: saved.trip.weather ?? null,
            sun: saved.trip.sun ?? null,
          }
        : null,
      mission: {
        ...base.mission,
        ...saved.mission,
        coffee: Boolean(saved.mission?.coffee),
        cup: readCupSpec(saved.mission?.cup),
      },
      stats: {...base.stats, ...saved.stats},
      prefs: {...base.prefs, ...saved.prefs},
    };
  }
  return initialState();
}
