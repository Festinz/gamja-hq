/**
 * 커피 운송작전의 컵 고르기.
 *
 * - 컵 목록(web/src/data/cups.json)을 읽는다. 브랜드별 사이즈와 용량, 용량대별 전형적인 컵 모양이 들어 있다.
 * - 운전자가 한 말("스벅 벤티 아아, 뚜껑 닫았어")에서 브랜드, 사이즈, 핫·아이스, 뚜껑을 알아듣는다.
 * - 고른 것으로 컵 모형(core/cup.ts)이 쓰는 컵(CupSpec)을 만든다.
 * 순수 함수다. 용어는 저장소 루트의 GLOSSARY.md를 따른다.
 *
 * 컵을 원통 하나로 어림하는 방법 (수치는 모두 어림이다)
 * - 가게가 말하는 용량(톨 355ml)을 컵에 담긴 음료로 본다. 아이스 음료는 얼음을 포함한 수면까지의 양이다.
 * - 그 용량대의 전형적인 컵 모양(위 지름, 아래 지름, 높이)을 같은 비율로 늘리거나 줄여,
 *   그 음료가 가장자리에서 HEADSPACE_M(1cm) 아래까지 차게 한다.
 * - 그 컵을 가장자리 반지름이 같고, 음료의 양과 가장자리까지 남은 높이(1cm)가 같은 원통으로 바꾼다.
 *   수면이 가장자리 근처에 있으므로 기울기와 넘침은 가장자리 반지름이 정한다.
 */
import {DEFAULT_CUP, fillCup, type CupPick, type CupSpec} from './cup';
import {safeBumpSpeed} from './drive';

export type CupTemp = 'hot' | 'ice';

/** 용량대별 전형적인 컵 모양. maxMl 이하의 음료에 쓴다. 안쪽 치수 (mm). */
export interface CupShape {
  maxMl: number;
  topDiameterMm: number;
  bottomDiameterMm: number;
  heightMm: number;
}

/** 브랜드의 사이즈 하나. 그 온도로 팔지 않으면 용량이 null이다. */
export interface BrandSize {
  id: string;
  name: string;
  aliases: string[];
  hotMl: number | null;
  iceMl: number | null;
  /** 공식 수치가 아니라 언론 보도나 흔한 컵 크기로 어림한 용량이다. 화면에 "어림"이라고 적는다. */
  approx?: true;
}

export interface CupBrand {
  id: string;
  name: string;
  aliases: string[];
  sizes: BrandSize[];
}

/** 브랜드를 모를 때 고르는 컵. */
export interface GenericCup {
  id: string;
  label: string;
  volumeMl: number;
}

/** 컵 목록 (`CupCatalog`). */
export interface CupCatalog {
  /** 용량을 어디서 가져왔는가 (확인한 날짜 포함). */
  source: string;
  generic: GenericCup[];
  /** maxMl 순서. */
  shapes: Record<CupTemp, CupShape[]>;
  brands: CupBrand[];
}

export const EMPTY_CATALOG: CupCatalog = {source: '', generic: [], shapes: {hot: [], ice: []}, brands: []};

/** 음료가 가장자리에서 이만큼 아래까지 찬다고 본다 (m). */
export const HEADSPACE_M = 0.01;

/** 감자가 커피를 물을 때 하는 말. */
export const CUP_QUESTION = '오늘은 어떤 커피 실었어? 브랜드랑 사이즈를 말해 줘.';

// ───────────────────────── 컵 목록 읽기 ─────────────────────────

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
/** 50ml~2L 사이의 용량. 아니면 null. */
const mlOf = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 50 && value <= 2000 ? value : null;
const mmOf = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 20 && value <= 400 ? value : null;
const textsOf = (value: unknown): string[] =>
  listOf(value)
    .map(textOf)
    .filter((text): text is string => text !== null);

function readShape(raw: unknown): CupShape | null {
  if (!isRecord(raw)) return null;
  const maxMl = typeof raw.maxMl === 'number' && raw.maxMl > 0 ? raw.maxMl : null;
  const top = mmOf(raw.topDiameterMm);
  const bottom = mmOf(raw.bottomDiameterMm);
  const height = mmOf(raw.heightMm);
  if (maxMl === null || top === null || bottom === null || height === null) return null;
  return {maxMl, topDiameterMm: top, bottomDiameterMm: bottom, heightMm: height};
}

function readSize(raw: unknown): BrandSize | null {
  if (!isRecord(raw)) return null;
  const id = textOf(raw.id);
  const name = textOf(raw.name);
  const hotMl = mlOf(raw.hotMl);
  const iceMl = mlOf(raw.iceMl);
  if (!id || !name || (hotMl === null && iceMl === null)) return null;
  return {id, name, aliases: textsOf(raw.aliases), hotMl, iceMl, ...(raw.approx === true ? {approx: true as const} : {})};
}

function readBrand(raw: unknown): CupBrand | null {
  if (!isRecord(raw)) return null;
  const id = textOf(raw.id);
  const name = textOf(raw.name);
  const sizes = listOf(raw.sizes)
    .map(readSize)
    .filter((size): size is BrandSize => size !== null);
  if (!id || !name || sizes.length === 0) return null;
  return {id, name, aliases: textsOf(raw.aliases), sizes};
}

/** cups.json 을 읽는다. 형식에 맞지 않는 항목은 버리고, 파일이 비어 있어도 빈 목록으로 돈다. */
export function readCupCatalog(raw: unknown): CupCatalog {
  if (!isRecord(raw)) return EMPTY_CATALOG;
  const shapes = (value: unknown) =>
    listOf(value)
      .map(readShape)
      .filter((shape): shape is CupShape => shape !== null)
      .sort((a, b) => a.maxMl - b.maxMl);
  const generic = listOf(raw.generic).flatMap(item => {
    if (!isRecord(item)) return [];
    const id = textOf(item.id);
    const label = textOf(item.label);
    const volumeMl = mlOf(item.volumeMl);
    return id && label && volumeMl !== null ? [{id, label, volumeMl}] : [];
  });
  const brands = listOf(raw.brands)
    .map(readBrand)
    .filter((brand): brand is CupBrand => brand !== null);
  return {
    source: textOf(raw.source) ?? '',
    generic,
    shapes: {hot: shapes(isRecord(raw.shapes) ? raw.shapes.hot : null), ice: shapes(isRecord(raw.shapes) ? raw.shapes.ice : null)},
    brands,
  };
}

// ───────────────────────── 말 알아듣기 ─────────────────────────

export type CupField = 'brand' | 'size' | 'temp' | 'lid';

/** 한 말에서 알아들은 것. 모르는 것은 비어 있다. */
export interface CupGuess {
  brandId?: string;
  /** 브랜드를 알면 그 브랜드의 사이즈 id, 모르면 브랜드 없는 컵(generic)의 id. */
  sizeId?: string;
  /** 사이즈 이름 대신 용량을 바로 말했을 때 (ml). 예: "24온스" → 710. */
  volumeMl?: number;
  temp: CupTemp | null;
  lid: boolean | null;
  /** 0~1. 알아들은 것의 몫에서 엇갈린 말(두 브랜드를 말함 따위)마다 조금씩 뺀다. */
  confidence: number;
  /** 알아듣지 못한 것. */
  missing: CupField[];
}

/** 소문자로 바꾸고 띄어쓰기와 문장 부호를 뺀다. "스타 벅스" → "스타벅스". */
export function compactText(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s.,!?~·…'"“”‘’()[\]{}:;\-_/]+/g, '');
}

const HOT_WORDS = ['따뜻한', '따뜻하게', '따듯한', '따뜻', '뜨거운', '뜨겁게', '뜨거', '뜨아', '따아', '핫', 'hot'];
const ICE_WORDS = ['아이스', '아아', '아샷추', '차가운', '차갑게', '시원한', '시원하게', '얼음', 'iced', 'ice'];
/** 뚜껑 뒤에 오면 뚜껑이 없다는 말. 먼저 나온 것이 정한다. */
const LID_OFF_STEMS = ['없', '열', '안', '뺐', '뺏', '빼', '뗐', '뗏', '떼', '벗'];
const LID_ON_STEMS = ['닫', '있', '덮', '씌', '꽉', '끼', '꼈', '잠', '했', '해', '챙', '덥'];
const LID_ON_WORDS = ['빨대', '스트로우', '스트로', '텀블러'];
const LID_OFF_WORDS = ['오픈컵', '열린컵', '머그'];

/**
 * 뚜껑이 없다는 "노뚜껑", "무뚜껑", "노 뚜껑"과 홀로 쓴 "노"("뚜껑 노")를 "뚜껑 없음", "없음"으로 바꾼다.
 * 띄어쓰기를 지우기 전에 낱말 첫머리에서만 본다. "아메리카노 뚜껑 있어", "카푸치노 뚜껑 닫았어",
 * "너무 뚜껑을 꽉 닫았어"의 노·무는 앞 낱말의 끝 글자라 뚜껑이 없다는 말이 아니다.
 */
function markNoLid(text: string): string {
  return text
    .normalize('NFC')
    .replace(/(^|[^가-힣a-zA-Z0-9])[노무][\s.,!?~·…'"]*뚜껑/g, '$1뚜껑 없음')
    .replace(/(^|[^가-힣a-zA-Z0-9])노(?=$|[^가-힣a-zA-Z0-9])/g, '$1없음');
}
/** 바로 뒤에 오면 앞의 말을 지운다. "아이스 말고 뜨거운 거", "톨, 아니 그란데". */
const NEGATORS = ['말고', '아니고', '아니라', '아니야', '아니요', '아님', '아니', '빼고'];

/**
 * 브랜드를 모를 때나 브랜드에 그 이름의 사이즈가 없을 때 쓰는 크기 낱말.
 * common 은 여러 브랜드가 함께 쓰는 낱말이라, 이것만 듣고 브랜드를 어림하지 않는다.
 * 숏·톨·그란데·벤티는 컵 목록에서 한 브랜드에만 있으면 그 브랜드로 어림한다.
 */
const RELATIVE_SIZES: {rank: 'small' | 'medium' | 'large'; common: string[]; named: string[]}[] = [
  // 레귤러·보통은 그 가게의 기본 사이즈라 가장 작은 쪽으로 본다 (브랜드 없는 컵에서는 355ml).
  {
    rank: 'small',
    common: ['제일작은', '가장작은', '젤작은', '작은', '스몰', 'small', '레귤러', 'regular', '보통'],
    named: ['숏', '쇼트', 'short', '톨', 'tall'],
  },
  {rank: 'medium', common: ['중간', '미디엄', 'medium'], named: ['그란데', 'grande']},
  {
    rank: 'large',
    common: ['제일큰', '가장큰', '젤큰', '큰', '라지', 'large', '빅', 'big', '엑스트라', 'extra', '점보', 'jumbo', '맥스', 'max'],
    named: ['벤티', 'venti'],
  },
];
const COMMON_SIZE_WORDS = [...RELATIVE_SIZES.flatMap(r => r.common), '기본', '사이즈'];

/**
 * 이 사이즈 낱말만 듣고 브랜드를 어림해도 되는가. "큰 거", "기본", "스몰사이즈"처럼 흔한 크기 낱말이 든 것은 안 된다
 * (컵 목록에서 한 브랜드에만 별칭으로 있어도 다른 브랜드 손님도 그렇게 말한다).
 */
const namesBrand = (term: string) => !COMMON_SIZE_WORDS.some(word => term.includes(word));

const OUNCE_ML = 29.5735;

interface Hit<T> {
  value: T;
  start: number;
  end: number;
  term: string;
}

/** text 안에서 낱말들이 나오는 자리. 같은 갈래 안에서는 더 긴 낱말에 들어 있는 짧은 낱말을 뺀다. */
function findAll<T>(text: string, terms: {term: string; value: T}[]): Hit<T>[] {
  const hits: Hit<T>[] = [];
  for (const {term, value} of terms) {
    if (term.length < 2 && !/[가-힣]/.test(term)) continue;
    let from = 0;
    for (;;) {
      const at = text.indexOf(term, from);
      if (at < 0) break;
      hits.push({value, start: at, end: at + term.length, term});
      from = at + 1;
    }
  }
  return hits
    .filter(hit => !hits.some(other => other !== hit && other.start <= hit.start && other.end >= hit.end && other.term.length > hit.term.length))
    .sort((a, b) => a.start - b.start || b.end - a.end);
}

/** 낱말 바로 뒤에 "말고", "아니" 같은 말이 오면 그 낱말은 지운 것으로 본다. 조사 하나는 건너뛴다. */
function isNegated(text: string, end: number): boolean {
  const rest = text.slice(end).replace(/^(으로|은|는|이|가|을|를|도|로|거|걸|건)/, '');
  return NEGATORS.some(negator => rest.startsWith(negator));
}

/** 지우지 않은 마지막 낱말과, 서로 다른 값이 둘 넘게 남았는가. */
function lastOf<T>(text: string, hits: Hit<T>[], key: (value: T) => string): {hit: Hit<T> | null; conflict: boolean} {
  const kept = hits.filter(hit => !isNegated(text, hit.end));
  const values = new Set(kept.map(hit => key(hit.value)));
  return {hit: kept.length > 0 ? kept[kept.length - 1] : null, conflict: values.size > 1};
}

const termsOf = (...lists: string[][]) => [...new Set(lists.flat().map(compactText).filter(Boolean))];

/** 이미 쓴 자리를 지워 다른 갈래가 다시 쓰지 못하게 한다. */
const mask = (text: string, hit: {start: number; end: number}) =>
  text.slice(0, hit.start) + ' '.repeat(hit.end - hit.start) + text.slice(hit.end);

const SINO: Record<string, number> = {일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9};

/** "이십사" → 24, "오백" → 500. 한자어 수가 아니면 null ("사이"처럼 숫자 글자가 잇달아 오면 수가 아니다). */
export function sinoKoreanNumber(word: string): number | null {
  let total = 0;
  let digit = 0;
  for (const ch of word) {
    if (ch in SINO) {
      if (digit) return null;
      digit = SINO[ch];
    } else if (ch === '십' || ch === '백' || ch === '천') {
      total += (digit || 1) * (ch === '십' ? 10 : ch === '백' ? 100 : 1000);
      digit = 0;
    } else return null;
  }
  const value = total + digit;
  return value > 0 ? value : null;
}

/** "24온스", "16oz", "500ml", "오백 미리", "1리터" 같은 용량. 100ml~1.5L 밖이면 버린다. */
function volumeIn(text: string): {ml: number; start: number; end: number} | null {
  const units: {pattern: string; ml: number}[] = [
    {pattern: '온스|온즈|ounces|ounce|oz', ml: OUNCE_ML},
    {pattern: '밀리리터|밀리|미리|ml|㎖|cc|씨씨', ml: 1},
    {pattern: '리터|l(?![a-z])', ml: 1000},
  ];
  const found: {ml: number; start: number; end: number}[] = [];
  for (const unit of units) {
    const digits = new RegExp(`(\\d+(?:\\.\\d+)?)(?:${unit.pattern})`, 'g');
    for (const m of text.matchAll(digits)) found.push({ml: Number(m[1]) * unit.ml, start: m.index, end: m.index + m[0].length});
    const words = new RegExp(`([일이삼사오육칠팔구십백천]+)(?:${unit.pattern})`, 'g');
    for (const m of text.matchAll(words)) {
      // "아이스이십사온스"처럼 앞 낱말의 끝 글자가 붙으면 수가 되는 가장 긴 끝부분을 쓴다.
      const word = m[1];
      for (let i = 0; i < word.length; i++) {
        const value = sinoKoreanNumber(word.slice(i));
        if (value !== null) {
          found.push({ml: value * unit.ml, start: m.index + i, end: m.index + m[0].length});
          break;
        }
      }
    }
  }
  const usable = found.filter(f => f.ml >= 100 && f.ml <= 1500).sort((a, b) => a.start - b.start);
  return usable.length > 0 ? usable[usable.length - 1] : null;
}

/** 그 온도로 파는 용량. 그 온도로 팔지 않으면 다른 온도의 용량. */
export function sizeMl(size: BrandSize, temp: CupTemp | null): number {
  if (temp === 'ice') return size.iceMl ?? size.hotMl ?? 0;
  if (temp === 'hot') return size.hotMl ?? size.iceMl ?? 0;
  return size.hotMl ?? size.iceMl ?? 0;
}

/** 그 온도로 파는 사이즈를 용량 순서로. 그 온도로 파는 것이 없으면 모든 사이즈. */
function sizesFor(brand: CupBrand, temp: CupTemp | null): BrandSize[] {
  const offered = temp === null ? brand.sizes : brand.sizes.filter(s => (temp === 'ice' ? s.iceMl : s.hotMl) !== null);
  return [...(offered.length > 0 ? offered : brand.sizes)].sort((a, b) => sizeMl(a, temp) - sizeMl(b, temp));
}

function byRank<T>(list: T[], rank: 'small' | 'medium' | 'large'): T | undefined {
  if (list.length === 0) return undefined;
  if (rank === 'small') return list[0];
  if (rank === 'large') return list[list.length - 1];
  return list[Math.floor((list.length - 1) / 2)];
}

/** 용량이 가장 가까운 것. 차이가 tolerance(비율)를 넘으면 undefined. */
function nearest<T>(list: T[], ml: number, volumeOf: (item: T) => number, tolerance: number): T | undefined {
  let best: T | undefined;
  let gap = Infinity;
  for (const item of list) {
    const d = Math.abs(volumeOf(item) - ml);
    if (d < gap) {
      gap = d;
      best = item;
    }
  }
  return best !== undefined && gap <= ml * tolerance ? best : undefined;
}

/**
 * 운전자가 한 말에서 컵을 알아듣는다.
 * "스벅 벤티 아아 뚜껑 닫았어" → 스타벅스, 벤티, 아이스, 뚜껑 닫음.
 * 같은 갈래를 두 번 말하면 나중 말을 따르고("톨, 아니 그란데"), "말고"·"아니" 앞의 말은 지운다.
 * 브랜드 없이 한 브랜드에만 있는 사이즈 이름을 말하면("그란데") 그 브랜드로 어림한다.
 */
export function parseCupUtterance(text: string, catalog: CupCatalog): CupGuess {
  let t = compactText(markNoLid(text));
  let conflicts = 0;

  // 온도.
  const temps = findAll<CupTemp>(t, [
    ...termsOf(HOT_WORDS).map(term => ({term, value: 'hot' as const})),
    ...termsOf(ICE_WORDS).map(term => ({term, value: 'ice' as const})),
  ]);
  const temp = lastOf(t, temps, value => value);
  if (temp.conflict) conflicts += 1;

  // 뚜껑.
  let lid: boolean | null = null;
  const lidHits: {at: number; value: boolean}[] = [];
  for (const hit of findAll(t, [...termsOf(['뚜껑', '리드']).map(term => ({term, value: true}))])) {
    if (LID_OFF_WORDS.some(word => t.slice(Math.max(0, hit.start - 3), hit.end + 2).includes(word))) {
      lidHits.push({at: hit.start, value: false});
      continue;
    }
    let value = true;
    for (const ch of t.slice(hit.end, hit.end + 6)) {
      if (LID_OFF_STEMS.includes(ch)) {
        value = false;
        break;
      }
      if (LID_ON_STEMS.includes(ch)) break;
    }
    lidHits.push({at: hit.start, value});
  }
  for (const hit of findAll(t, termsOf(LID_ON_WORDS).map(term => ({term, value: true})))) lidHits.push({at: hit.start, value: true});
  for (const hit of findAll(t, termsOf(LID_OFF_WORDS).map(term => ({term, value: false}))))
    if (!lidHits.some(other => other.at >= hit.start && other.at < hit.end)) lidHits.push({at: hit.start, value: false});
  lidHits.sort((a, b) => a.at - b.at);
  if (lidHits.length > 0) {
    lid = lidHits[lidHits.length - 1].value;
    if (new Set(lidHits.map(h => h.value)).size > 1) conflicts += 1;
  }

  // 용량을 바로 말했으면 그 자리는 사이즈 낱말로 다시 쓰지 않는다.
  const volume = volumeIn(t);
  if (volume) t = mask(t, volume);

  // 브랜드.
  const brandHits = findAll(
    t,
    catalog.brands.flatMap(brand => termsOf([brand.name], brand.aliases, [brand.id]).map(term => ({term, value: brand}))),
  );
  const brandPick = lastOf(t, brandHits, brand => brand.id);
  if (brandPick.conflict) conflicts += 1;
  let brand = brandPick.hit?.value ?? null;
  let inferredBrand = false;
  const tempValue = temp.hit?.value ?? null;
  // 브랜드 이름 속의 낱말은 사이즈로 다시 쓰지 않는다. 다만 브랜드 별칭과 같은 이름의 사이즈("메가커피 메가")는
  // 그 별칭이 따로 한 번 더 나왔을 때 사이즈로 본다.
  const outsideBrand = <T,>(hits: Hit<T>[], strict: boolean) =>
    hits.filter(
      hit =>
        !brandHits.some(
          b => b.start <= hit.start && b.end >= hit.end && (strict ? b.end - b.start > hit.end - hit.start : true),
        ),
    );

  // 사이즈.
  let sizeId: string | undefined;
  let volumeMl: number | undefined;
  const relative = lastOf(
    t,
    outsideBrand(
      findAll(
        t,
        RELATIVE_SIZES.flatMap(r => termsOf(r.common, r.named).map(term => ({term, value: r.rank}))),
      ),
      false,
    ),
    value => value,
  );
  if (brand) {
    const own = lastOf(
      t,
      outsideBrand(
        findAll(t, brand.sizes.flatMap(size => termsOf([size.name], size.aliases, [size.id]).map(term => ({term, value: size})))),
        true,
      ),
      size => size.id,
    );
    if (own.conflict) conflicts += 1;
    const list = sizesFor(brand, tempValue);
    const picked =
      own.hit?.value ??
      (volume ? nearest(list, volume.ml, size => sizeMl(size, tempValue), 0.15) : undefined) ??
      (relative.hit ? byRank(list, relative.hit.value) : undefined);
    if (picked) sizeId = picked.id;
    else if (volume) volumeMl = Math.round(volume.ml);
  } else {
    // 브랜드를 말하지 않았다. 한 브랜드에만 있는 사이즈 이름이면 그 브랜드로 어림한다.
    const named = findAll(
      t,
      catalog.brands.flatMap(b =>
        b.sizes.flatMap(size =>
          termsOf([size.name], size.aliases)
            .filter(namesBrand)
            .map(term => ({term, value: {brand: b, size}})),
        ),
      ),
    );
    const own = lastOf(t, named, value => `${value.brand.id}:${value.size.id}`);
    const owners = new Set(named.filter(hit => own.hit && hit.term === own.hit.term).map(hit => hit.value.brand.id));
    if (own.hit && owners.size === 1) {
      brand = own.hit.value.brand;
      sizeId = own.hit.value.size.id;
      inferredBrand = true;
    } else if (volume) {
      const generic = nearest(catalog.generic, volume.ml, g => g.volumeMl, 0.03);
      if (generic) sizeId = generic.id;
      else volumeMl = Math.round(volume.ml);
    } else if (relative.hit) {
      sizeId = byRank([...catalog.generic].sort((a, b) => a.volumeMl - b.volumeMl), relative.hit.value)?.id;
    }
  }

  // 그 사이즈를 한 온도로만 팔면 온도는 그것이다.
  let tempOut: CupTemp | null = tempValue;
  if (tempOut === null && brand && sizeId) {
    const size = brand.sizes.find(s => s.id === sizeId);
    if (size && (size.hotMl === null) !== (size.iceMl === null)) tempOut = size.hotMl === null ? 'ice' : 'hot';
  }

  const hasSize = sizeId !== undefined || volumeMl !== undefined;
  const score =
    (brand ? (inferredBrand ? 0.15 : 0.3) : 0) +
    (hasSize ? 0.3 : 0) +
    (tempOut ? 0.25 : 0) +
    (lid !== null ? 0.15 : 0) -
    0.1 * conflicts;
  const missing: CupField[] = [];
  if (!brand) missing.push('brand');
  if (!hasSize) missing.push('size');
  if (!tempOut) missing.push('temp');
  if (lid === null) missing.push('lid');
  return {
    ...(brand ? {brandId: brand.id} : {}),
    ...(sizeId !== undefined ? {sizeId} : {}),
    ...(volumeMl !== undefined ? {volumeMl} : {}),
    temp: tempOut,
    lid,
    confidence: Math.round(Math.min(1, Math.max(0, score)) * 100) / 100,
    missing,
  };
}

// ───────────────────────── 컵 만들기 ─────────────────────────

/** 고른 것. 말로 들은 것(CupGuess)이나 화면에서 누른 것. 모르는 것은 비워 둔다. */
export interface CupChoice {
  brandId?: string | null;
  sizeId?: string | null;
  volumeMl?: number | null;
  temp?: CupTemp | null;
  lid?: boolean | null;
}

export const TEMP_WORD: Record<CupTemp, string> = {hot: '핫', ice: '아이스'};
export const lidWord = (lid: boolean) => (lid ? '뚜껑 닫음' : '뚜껑 없음');

/** 가장 아래 반지름 rb, 가장자리 반지름 rt, 높이 h인 컵에 바닥에서 z까지 찬 부피 (m³). */
function frustumVolume(rb: number, rt: number, h: number, z: number): number {
  const r = rb + ((rt - rb) * z) / h;
  return (Math.PI * z * (rb * rb + rb * r + r * r)) / 3;
}

/** 이 양과 온도에 쓰는 컵 모양. 용량대가 맞는 것이 없으면 가장 큰 것, 그 온도 모양이 없으면 다른 온도의 것. */
export function shapeFor(fillMl: number, temp: CupTemp, catalog: CupCatalog): CupShape {
  const list = catalog.shapes[temp].length > 0 ? catalog.shapes[temp] : catalog.shapes[temp === 'hot' ? 'ice' : 'hot'];
  // 모양 자료가 없으면 기본 컵과 같은 원통.
  if (list.length === 0)
    return {maxMl: Infinity, topDiameterMm: DEFAULT_CUP.radius * 2000, bottomDiameterMm: DEFAULT_CUP.radius * 2000, heightMm: DEFAULT_CUP.height * 1000};
  return list.find(shape => shape.maxMl >= fillMl) ?? list[list.length - 1];
}

/**
 * fillMl 의 음료가 가장자리 1cm 아래까지 차도록 shape 을 같은 비율로 늘리거나 줄인 컵을
 * 같은 원통으로 바꾼다. 원통의 반지름은 가장자리 반지름, 높이는 음료 높이 + 1cm다.
 */
export function equivalentCylinder(fillMl: number, shape: CupShape): {radius: number; height: number; capacityMl: number; scale: number} {
  const fill = fillMl * 1e-6;
  const rt = shape.topDiameterMm / 2000;
  const rb = shape.bottomDiameterMm / 2000;
  const h = shape.heightMm / 1000;
  const filled = (s: number) => frustumVolume(rb * s, rt * s, h * s, Math.max(0, h * s - HEADSPACE_M));
  let lo = 0.05;
  let hi = 10;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (filled(mid) < fill) lo = mid;
    else hi = mid;
  }
  const scale = (lo + hi) / 2;
  const radius = rt * scale;
  const area = Math.PI * radius * radius;
  const height = fill / area + HEADSPACE_M;
  return {radius, height, capacityMl: area * height * 1e6, scale};
}

/**
 * 브랜드 사이즈를 고르지 않았을 때 쓰는 사이즈. 컵 목록에서 "기본"이라고 부르는 사이즈가 있으면 그것,
 * 없으면 가장 흔한 355ml에 가장 가까운 것.
 */
function usualSize(brand: CupBrand, temp: CupTemp | null): BrandSize {
  const list = sizesFor(brand, temp);
  const basic = list.find(size => [size.name, ...size.aliases].some(word => compactText(word) === '기본'));
  return basic ?? nearest(list, 355, size => sizeMl(size, temp), Infinity) ?? list[0];
}

/**
 * 고른 것으로 컵을 만든다. 아무것도 고르지 않았으면 null (기본 컵으로 계산한다).
 * - 온도를 모르면 그 사이즈를 핫으로 팔면 핫, 아니면 아이스.
 * - 뚜껑을 모르면 뚜껑 없는 컵으로 본다. 넘치지 않는 속도를 낮게 잡아 더 조심스럽다.
 * - 브랜드만 알면 그 브랜드에서 355ml에 가장 가까운 사이즈, 크기만 알면 그 크기의 브랜드 없는 컵이다.
 */
export function buildCupSpec(choice: CupChoice, catalog: CupCatalog): CupSpec | null {
  const brand = catalog.brands.find(b => b.id === choice.brandId) ?? null;
  let size = brand?.sizes.find(s => s.id === choice.sizeId) ?? null;
  const generic = brand ? null : catalog.generic.find(g => g.id === choice.sizeId) ?? null;
  const volume = choice.volumeMl && choice.volumeMl >= 50 && choice.volumeMl <= 2000 ? choice.volumeMl : null;
  const nothing = !brand && !generic && volume === null && choice.temp == null && choice.lid == null;
  if (nothing) return null;

  if (brand && !size) {
    // 용량을 말했으면 그 용량에 가까운 사이즈, 맞는 것이 없으면 말한 용량 그대로 쓴다.
    const list = sizesFor(brand, choice.temp ?? null);
    size =
      volume !== null
        ? (nearest(list, volume, s => sizeMl(s, choice.temp ?? null), 0.15) ?? null)
        : usualSize(brand, choice.temp ?? null);
  }
  const temp: CupTemp = choice.temp ?? (size ? (size.hotMl !== null ? 'hot' : 'ice') : 'hot');
  const lid = choice.lid ?? false;
  const medium = nearest(catalog.generic, 473, g => g.volumeMl, Infinity);
  const fillMl = size ? sizeMl(size, temp) : generic ? generic.volumeMl : volume ?? medium?.volumeMl ?? 473;
  const said = volume !== null ? `${Math.round(volume)}ml 컵` : null;
  const name =
    brand && size
      ? `${brand.name} ${size.name}`
      : brand && said
        ? `${brand.name} ${said}`
        : generic
          ? generic.label
          : said ?? medium?.label ?? '중간 컵';
  const pick: CupPick = {
    brandId: brand?.id ?? null,
    sizeId: size?.id ?? generic?.id ?? (volume === null ? medium?.id ?? null : null),
    volumeMl: size || generic ? null : volume,
    temp,
    lid,
  };
  const cylinder = equivalentCylinder(fillMl, shapeFor(fillMl, temp, catalog));
  return {
    label: `${name} ${TEMP_WORD[temp]}(${lidWord(lid)})`,
    capacityMl: cylinder.capacityMl,
    fillMl,
    radius: cylinder.radius,
    height: cylinder.height,
    lid,
    ice: temp === 'ice',
    pick,
  };
}

/** 컵을 다시 고를 때의 처음 값. */
export function choiceOf(spec: CupSpec | null): CupChoice {
  const pick = spec?.pick;
  if (!pick) return {};
  return {brandId: pick.brandId, sizeId: pick.sizeId, volumeMl: pick.volumeMl, temp: pick.temp, lid: pick.lid};
}

// ───────────────────────── 화면과 음성에 쓰는 말 ─────────────────────────

/** 알아들은 것을 낱말 칩으로. 모르는 것은 null. */
export function guessWords(choice: CupChoice, catalog: CupCatalog): Record<CupField, string | null> {
  const brand = catalog.brands.find(b => b.id === choice.brandId) ?? null;
  const said = choice.volumeMl ? `${Math.round(choice.volumeMl)}ml` : null;
  const size = brand
    ? (brand.sizes.find(s => s.id === choice.sizeId)?.name ?? said)
    : (catalog.generic.find(g => g.id === choice.sizeId)?.label ?? said);
  return {
    brand: brand?.name ?? null,
    size,
    temp: choice.temp ? TEMP_WORD[choice.temp] : null,
    lid: choice.lid === null || choice.lid === undefined ? null : lidWord(choice.lid),
  };
}

/** 이 컵으로 방지턱을 넘을 때 넘치지 않는 속도 (km/h, 시속 1km 단위). 컵이 없으면 기본 컵. */
export function safeBumpKph(spec: CupSpec | null): number {
  return Math.floor(safeBumpSpeed(fillCup(spec ?? DEFAULT_CUP)) * 3.6 + 1e-9);
}

/** 방지턱을 계산한 가장 빠른 속도 (km/h). */
export const MAX_CHECKED_KPH = 60;

/**
 * 화면과 음성으로 권하는 방지턱 속도의 상한 (km/h). 과속방지턱은 천천히 넘으라고 둔 시설이라,
 * 뚜껑 덕분에 커피가 더 빨라도 버틴다고 계산되어도 이보다 빠른 속도는 권하지 않는다.
 */
export const BUMP_ADVICE_CAP_KPH = 30;

/** 권하는 방지턱 속도. 계산한 속도와 상한 가운데 낮은 쪽이다. */
export function advisedBumpKph(kph: number): number {
  return Math.min(kph, BUMP_ADVICE_CAP_KPH);
}

/** "방지턱 시속 22km 아래면 안 넘쳐요 · 어림". 시속 30km보다 빠른 속도는 권하지 않는다. */
export function bumpAdvice(kph: number): string {
  if (kph < 5) return '가득 차서 방지턱에서는 넘치기 쉬워요 · 어림';
  return `방지턱 시속 ${advisedBumpKph(kph)}km 아래면 안 넘쳐요 · 어림`;
}

/** 컵을 확인한 뒤 감자가 하는 말. 평소 말투(반말)다. 시속 30km보다 빠른 속도는 권하지 않는다. */
export function cupConfirmLine(spec: CupSpec, kph: number): string {
  const name = spec.label.replace(/\(.*\)$/, '');
  if (kph < 5) return `좋아, ${name}! 가득 찼으니 방지턱은 아주 천천히 부탁해.`;
  return `좋아, ${name}! 방지턱은 시속 ${advisedBumpKph(kph)}km 아래로 부탁해.`;
}
