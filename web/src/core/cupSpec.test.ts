import {describe, expect, it} from 'vitest';
import bundled from '../data/cups.json';
import {
  COFFEE_START_ML,
  CUP,
  DEFAULT_CUP,
  LID_LEAK,
  STILL,
  fillCup,
  fillHeight,
  newCup,
  readCupSpec,
  stepCup,
  type CupSpec,
} from './cup';
import {
  HEADSPACE_M,
  bumpAdvice,
  buildCupSpec,
  choiceOf,
  compactText,
  cupConfirmLine,
  equivalentCylinder,
  guessWords,
  parseCupUtterance,
  readCupCatalog,
  safeBumpKph,
  shapeFor,
  sinoKoreanNumber,
  sizeMl,
} from './cupSpec';
import {predictBump, safeBumpSpeed, safeTurnSpeed} from './drive';
import {cupWords} from './hq';

/** 시험용 컵 목록. 용량은 시험을 위해 정한 숫자다 (실제 메뉴와 다를 수 있다). */
const CATALOG = readCupCatalog({
  source: '시험 자료',
  generic: [
    {id: 'small', label: '작은 컵', volumeMl: 355},
    {id: 'medium', label: '중간 컵', volumeMl: 473},
    {id: 'large', label: '큰 컵', volumeMl: 591},
  ],
  shapes: {
    hot: [
      {maxMl: 650, topDiameterMm: 90, bottomDiameterMm: 62, heightMm: 150},
      {maxMl: 260, topDiameterMm: 80, bottomDiameterMm: 56, heightMm: 80},
      {maxMl: 400, topDiameterMm: 90, bottomDiameterMm: 60, heightMm: 100},
      {maxMl: 500, topDiameterMm: 90, bottomDiameterMm: 60, heightMm: 125},
    ],
    ice: [
      {maxMl: 400, topDiameterMm: 92, bottomDiameterMm: 57, heightMm: 95},
      {maxMl: 500, topDiameterMm: 95, bottomDiameterMm: 58, heightMm: 115},
      {maxMl: 650, topDiameterMm: 98, bottomDiameterMm: 60, heightMm: 135},
      {maxMl: 750, topDiameterMm: 98, bottomDiameterMm: 62, heightMm: 150},
    ],
  },
  brands: [
    {
      id: 'starbucks',
      name: '스타벅스',
      aliases: ['스벅', 'starbucks', '별다방'],
      sizes: [
        {id: 'short', name: '숏', aliases: ['short'], hotMl: 237, iceMl: null},
        {id: 'tall', name: '톨', aliases: ['tall', '톨사이즈'], hotMl: 355, iceMl: 355},
        {id: 'grande', name: '그란데', aliases: ['grande'], hotMl: 473, iceMl: 473},
        {id: 'venti', name: '벤티', aliases: ['venti', '큰 거'], hotMl: 591, iceMl: 591},
      ],
    },
    {
      id: 'paik',
      name: '빽다방',
      aliases: ['빽'],
      sizes: [
        {id: 'small', name: '스몰', aliases: [], hotMl: null, iceMl: 440},
        {id: 'regular', name: '기본', aliases: ['보통'], hotMl: 510, iceMl: 660},
        {id: 'big', name: '빽사이즈', aliases: ['빽 사이즈'], hotMl: null, iceMl: 990},
      ],
    },
    {
      id: 'twosome',
      name: '투썸플레이스',
      aliases: ['투썸', 'twosome'],
      sizes: [
        {id: 'regular', name: '레귤러', aliases: ['regular'], hotMl: 355, iceMl: 414},
        {id: 'large', name: '라지', aliases: ['large'], hotMl: 473, iceMl: 591},
      ],
    },
    {
      id: 'mega',
      name: '메가커피',
      aliases: ['메가', 'mega'],
      sizes: [
        {id: 'mega', name: '메가', aliases: [], hotMl: 591, iceMl: 710},
        {id: 'max', name: '맥스', aliases: ['max'], hotMl: null, iceMl: 946},
      ],
    },
    {
      id: 'ediya',
      name: '이디야',
      aliases: ['이디야커피'],
      sizes: [
        {id: 'regular', name: '레귤러', aliases: [], hotMl: 384, iceMl: 384},
        {id: 'extra', name: '엑스트라', aliases: ['extra'], hotMl: 651, iceMl: 651},
      ],
    },
  ],
});

const parse = (text: string) => parseCupUtterance(text, CATALOG);

describe('컵 목록 읽기', () => {
  it('형식에 맞지 않는 항목은 버리고, 컵 모양은 용량 순서로 둔다', () => {
    const catalog = readCupCatalog({
      source: ' 출처 ',
      generic: [{id: 'small', label: '작은 컵', volumeMl: 355}, {id: 'x', label: '', volumeMl: 300}, {id: 'y', label: '너무 작음', volumeMl: 5}],
      shapes: {hot: [{maxMl: 500, topDiameterMm: 90, bottomDiameterMm: 60, heightMm: 125}, {maxMl: 400, topDiameterMm: -1}], ice: 'x'},
      brands: [
        {id: 'a', name: '가게', aliases: ['가', 3], sizes: [{id: 's', name: '작은', hotMl: null, iceMl: null}]},
        {id: 'b', name: '나게', sizes: [{id: 's', name: '보통', hotMl: 355}]},
      ],
    });
    expect(catalog.source).toBe('출처');
    expect(catalog.generic.map(g => g.id)).toEqual(['small']);
    expect(catalog.shapes.hot).toHaveLength(1);
    expect(catalog.shapes.ice).toEqual([]);
    expect(catalog.brands.map(b => b.id)).toEqual(['b']);
    expect(catalog.brands[0].sizes[0]).toEqual({id: 's', name: '보통', aliases: [], hotMl: 355, iceMl: null});
    expect(CATALOG.shapes.hot.map(s => s.maxMl)).toEqual([260, 400, 500, 650]);
  });

  it('파일이 비어 있거나 망가져도 빈 목록으로 돈다', () => {
    expect(readCupCatalog(null).brands).toEqual([]);
    expect(readCupCatalog('x').generic).toEqual([]);
  });

  it('cups.json 에 적은 머리 공간과 뚜껑 계수가 있으면 코드의 값과 같다', () => {
    const notes = bundled as {fill?: {headspaceMm?: number}; lid?: {spillFactor?: number}};
    if (notes.fill?.headspaceMm !== undefined) expect(notes.fill.headspaceMm).toBeCloseTo(HEADSPACE_M * 1000, 9);
    if (notes.lid?.spillFactor !== undefined) expect(notes.lid.spillFactor).toBeCloseTo(LID_LEAK, 9);
  });

  it('앱에 넣은 cups.json 은 읽을 수 있고, 모든 브랜드 사이즈로 컵을 만들 수 있다', () => {
    const catalog = readCupCatalog(bundled as unknown);
    expect(catalog.source.length).toBeGreaterThan(0);
    expect(catalog.generic.length).toBeGreaterThan(0);
    expect(catalog.shapes.hot.length + catalog.shapes.ice.length).toBeGreaterThan(0);
    for (const brand of catalog.brands)
      for (const size of brand.sizes)
        for (const temp of ['hot', 'ice'] as const) {
          const spec = buildCupSpec({brandId: brand.id, sizeId: size.id, temp, lid: false}, catalog);
          // 저장했다 다시 읽어도 같은 컵이다 (반지름 1~10cm, 높이 3~30cm 안).
          expect(readCupSpec(JSON.parse(JSON.stringify(spec))), `${brand.name} ${size.name} ${temp}`).toEqual(spec);
        }
  });

  it('앱에 넣은 cups.json 의 항목을 하나도 버리지 않고, 어림한 용량 표시(approx)도 지킨다', () => {
    const raw = bundled as unknown as {
      generic: unknown[];
      shapes: {hot: unknown[]; ice: unknown[]};
      brands: {id: string; sizes: {id: string; approx?: boolean}[]}[];
    };
    const catalog = readCupCatalog(bundled as unknown);
    expect(catalog.generic).toHaveLength(raw.generic.length);
    expect(catalog.shapes.hot).toHaveLength(raw.shapes.hot.length);
    expect(catalog.shapes.ice).toHaveLength(raw.shapes.ice.length);
    const ids = (brands: {id: string; sizes: {id: string}[]}[]) => brands.map(b => `${b.id}:${b.sizes.map(s => s.id).join(',')}`);
    expect(ids(catalog.brands)).toEqual(ids(raw.brands));
    const approx = (brands: {id: string; sizes: {id: string; approx?: boolean}[]}[]) =>
      brands.flatMap(b => b.sizes.filter(s => s.approx === true).map(s => `${b.id}:${s.id}`));
    expect(approx(catalog.brands)).toEqual(approx(raw.brands));
    expect(approx(catalog.brands).length).toBeGreaterThan(0);
  });

  it('브랜드 공식 홈페이지가 출처가 아닌(언론 보도, 자료 없음) 브랜드의 사이즈는 모두 어림(approx)이다', () => {
    const raw = bundled as unknown as {brands: {id: string; source?: string; sizes: {id: string; approx?: boolean}[]}[]};
    // 공식 홈페이지 주소로 시작하는 출처만 공식 수치다. 그 밖의 출처의 용량은 칩에 "(어림)"이라고 적어야 한다.
    const unofficial = raw.brands.filter(brand => !/^https:\/\//.test(brand.source ?? ''));
    expect(unofficial.map(brand => brand.id)).toEqual(expect.arrayContaining(['coffeebean', 'angelinus', 'droptop', 'caffebene']));
    const notMarked = unofficial.flatMap(brand => brand.sizes.filter(size => size.approx !== true).map(size => `${brand.id}:${size.id}`));
    expect(notMarked).toEqual([]);
  });

  it('앱에 넣은 cups.json 으로 흔한 주문을 알아듣는다', () => {
    const catalog = readCupCatalog(bundled as unknown);
    const said = (text: string) => {
      const spec = buildCupSpec(parseCupUtterance(text, catalog), catalog)!;
      return {label: spec.label, fillMl: spec.fillMl};
    };
    expect(said('스벅 아아 벤티')).toEqual({label: '스타벅스 벤티 아이스(뚜껑 없음)', fillMl: 591});
    expect(said('메가 아메리카노 큰 거')).toEqual({label: '메가커피 메가리카노 아이스(뚜껑 없음)', fillMl: 946});
    expect(said('이디야 엑스트라 따뜻한 거')).toEqual({label: '이디야커피 엑스트라 핫(뚜껑 없음)', fillMl: 650});
    expect(said('스타벅스 톨 따뜻한 아메리카노 뚜껑 있어')).toEqual({label: '스타벅스 톨 핫(뚜껑 닫음)', fillMl: 355});
  });

  it('앱에 넣은 cups.json 의 브랜드와 사이즈 이름을 말하면 그 컵으로 알아듣는다', () => {
    const catalog = readCupCatalog(bundled as unknown);
    for (const brand of catalog.brands)
      for (const size of brand.sizes) {
        const guess = parseCupUtterance(`${brand.name} ${size.name}`, catalog);
        expect({brand: guess.brandId, size: guess.sizeId}, `${brand.name} ${size.name}`).toEqual({brand: brand.id, size: size.id});
      }
  });
});

describe('말 알아듣기', () => {
  it('"스벅 벤티 아아 뚜껑 닫았어"를 다 알아듣는다', () => {
    expect(parse('스벅 벤티 아아 뚜껑 닫았어')).toEqual({
      brandId: 'starbucks',
      sizeId: 'venti',
      temp: 'ice',
      lid: true,
      confidence: 1,
      missing: [],
    });
  });

  it('스타벅스와 스벅, 띄어 쓴 이름, 영어 이름을 같은 브랜드로 본다', () => {
    for (const text of ['스타벅스 톨', '스벅 톨', '스타 벅스 톨', 'Starbucks tall', '별다방 톨사이즈'])
      expect(parse(text), text).toMatchObject({brandId: 'starbucks', sizeId: 'tall'});
  });

  it('따뜻한·뜨거운·핫은 핫, 아이스·차가운·아아는 아이스다', () => {
    for (const text of ['따뜻한 거', '뜨거운 걸로', '핫으로', '뜨아']) expect(parse(text).temp, text).toBe('hot');
    for (const text of ['아이스', '차가운 거', '아아', '아이스 아메리카노', 'iced']) expect(parse(text).temp, text).toBe('ice');
  });

  it('뚜껑을 닫았는지 알아듣는다. 빨대를 꽂았으면 뚜껑이 있는 컵이다', () => {
    expect(parse('뚜껑 닫았어').lid).toBe(true);
    expect(parse('뚜껑 있어').lid).toBe(true);
    expect(parse('빨대 꽂았어').lid).toBe(true);
    expect(parse('뚜껑 없어').lid).toBe(false);
    expect(parse('뚜껑은 안 닫았어').lid).toBe(false);
    expect(parse('뚜껑 열었어').lid).toBe(false);
    expect(parse('노뚜껑').lid).toBe(false);
    expect(parse('스벅 톨').lid).toBeNull();
  });

  it('"아메리카노 뚜껑", "카푸치노 뚜껑"의 노는 뚜껑이 없다는 말이 아니다. 낱말 첫머리의 노·무만 본다', () => {
    expect(parse('스타벅스 톨 따뜻한 아메리카노 뚜껑 있어')).toMatchObject({
      brandId: 'starbucks',
      sizeId: 'tall',
      temp: 'hot',
      lid: true,
    });
    expect(parse('카푸치노 뚜껑 닫았어').lid).toBe(true);
    expect(parse('너무 뚜껑을 꽉 닫았어').lid).toBe(true);
    expect(parse('뚜껑 아메리카노').lid).toBe(true);
    expect(parse('노란 뚜껑 덮었어').lid).toBe(true);
    expect(parse('노 뚜껑이야').lid).toBe(false);
    expect(parse('아메리카노, 노뚜껑').lid).toBe(false);
    expect(parse('무뚜껑 라떼').lid).toBe(false);
    expect(parse('뚜껑 노').lid).toBe(false);
    expect(parse('아메리카노 뚜껑 없어').lid).toBe(false);
  });

  it('말하지 않은 것은 missing 에 적고 확신이 낮다', () => {
    const guess = parse('스타벅스 톨 따뜻한 거');
    expect(guess).toMatchObject({brandId: 'starbucks', sizeId: 'tall', temp: 'hot', lid: null, missing: ['lid']});
    expect(guess.confidence).toBeLessThan(1);
    expect(parse('')).toEqual({temp: null, lid: null, confidence: 0, missing: ['brand', 'size', 'temp', 'lid']});
  });

  it('"말고"·"아니" 앞의 말은 지우고 나중 말을 따른다', () => {
    expect(parse('아이스 말고 따뜻한 거, 스벅 톨')).toMatchObject({temp: 'hot', sizeId: 'tall'});
    expect(parse('스벅 톨, 아니 그란데')).toMatchObject({brandId: 'starbucks', sizeId: 'grande'});
    expect(parse('큰 거 말고 작은 거, 뜨거운 걸로')).toMatchObject({sizeId: 'small', temp: 'hot'});
  });

  it('브랜드를 두 개 말하면 나중 것을 따르고 확신을 낮춘다', () => {
    const guess = parse('투썸 아니고 스벅 톨');
    expect(guess).toMatchObject({brandId: 'starbucks', sizeId: 'tall'});
    const both = parse('투썸 스벅 톨');
    expect(both.brandId).toBe('starbucks');
    expect(both.confidence).toBeLessThan(parse('스벅 톨').confidence);
  });

  it('브랜드 없이 한 브랜드에만 있는 사이즈 이름을 말하면 그 브랜드로 어림한다', () => {
    const guess = parse('그란데 아이스');
    expect(guess).toMatchObject({brandId: 'starbucks', sizeId: 'grande', temp: 'ice'});
    expect(guess.confidence).toBeLessThan(parse('스벅 그란데 아이스').confidence);
  });

  it('여러 브랜드가 함께 쓰는 크기 낱말만 들으면 브랜드 없는 컵이다', () => {
    expect(parse('레귤러 아이스')).toMatchObject({sizeId: 'small', temp: 'ice', missing: ['brand', 'lid']});
    expect(parse('라지 핫')).toMatchObject({sizeId: 'large'});
    expect(parse('중간 거')).toMatchObject({sizeId: 'medium'});
    expect(parse('작은 거')).toMatchObject({sizeId: 'small'});
    expect(parse('큰 거')).toMatchObject({sizeId: 'large'});
  });

  it('브랜드를 알면 큰 거·작은 거는 그 브랜드의 가장 큰·작은 사이즈다 (그 온도로 파는 것 가운데)', () => {
    expect(parse('스벅 제일 큰 거').sizeId).toBe('venti');
    expect(parse('스벅 작은 거 핫').sizeId).toBe('short');
    // 숏은 핫으로만 판다. 아이스에서 가장 작은 것은 톨이다.
    expect(parse('스벅 작은 거 아이스').sizeId).toBe('tall');
    expect(parse('이디야 큰 거 빨대 꽂았어')).toMatchObject({brandId: 'ediya', sizeId: 'extra', lid: true});
  });

  it('브랜드의 사이즈 이름이 흔한 크기 낱말보다 먼저다', () => {
    expect(parse('메가 맥스')).toMatchObject({brandId: 'mega', sizeId: 'max', temp: 'ice'});
    expect(parse('투썸 라지 핫 뚜껑 열었어')).toMatchObject({brandId: 'twosome', sizeId: 'large', temp: 'hot', lid: false});
  });

  it('브랜드 별칭과 같은 이름의 사이즈도 알아듣는다', () => {
    expect(parse('메가커피 메가 아이스')).toMatchObject({brandId: 'mega', sizeId: 'mega', temp: 'ice'});
    expect(parse('빽다방 빽사이즈')).toMatchObject({brandId: 'paik', sizeId: 'big', temp: 'ice'});
  });

  it('한 브랜드에만 별칭으로 있어도 흔한 크기 낱말("큰 거")로는 브랜드를 어림하지 않는다', () => {
    expect(parse('큰 거 아이스')).toMatchObject({sizeId: 'large', temp: 'ice', missing: ['brand', 'lid']});
    expect(parse('큰 거 아이스').brandId).toBeUndefined();
    // 브랜드를 말하면 그 브랜드의 별칭을 따른다.
    expect(parse('스벅 큰 거').sizeId).toBe('venti');
  });

  it('온스와 ml로 말한 용량을 알아듣는다', () => {
    expect(parse('메가커피 24온스 아이스')).toMatchObject({brandId: 'mega', sizeId: 'mega'});
    expect(parse('스벅 이십 온스')).toMatchObject({brandId: 'starbucks', sizeId: 'venti'});
    expect(parse('16 oz 핫')).toMatchObject({sizeId: 'medium', temp: 'hot'});
    expect(parse('오백 미리 아이스')).toMatchObject({volumeMl: 500, temp: 'ice'});
    expect(parse('오백 미리 아이스').sizeId).toBeUndefined();
    expect(sinoKoreanNumber('이십사')).toBe(24);
    expect(sinoKoreanNumber('오백')).toBe(500);
    expect(sinoKoreanNumber('십')).toBe(10);
    expect(sinoKoreanNumber('사이')).toBeNull();
  });

  it('그 사이즈를 한 온도로만 팔면 온도를 어림한다', () => {
    expect(parse('스벅 숏')).toMatchObject({sizeId: 'short', temp: 'hot'});
    expect(parse('스벅 숏').missing).not.toContain('temp');
  });

  it('띄어쓰기와 문장 부호를 지우고 소문자로 맞춘다', () => {
    expect(compactText(' 스타 벅스, Tall!  ')).toBe('스타벅스tall');
  });

  it('알아들은 것을 낱말 칩으로 보여 준다', () => {
    expect(guessWords(parse('스벅 벤티 아아 뚜껑 닫았어'), CATALOG)).toEqual({
      brand: '스타벅스',
      size: '벤티',
      temp: '아이스',
      lid: '뚜껑 닫음',
    });
    expect(guessWords(parse('작은 거'), CATALOG)).toEqual({brand: null, size: '작은 컵', temp: null, lid: null});
  });
});

describe('컵 만들기', () => {
  it('고른 브랜드, 사이즈, 온도, 뚜껑으로 이름과 양을 정한다', () => {
    const spec = buildCupSpec({brandId: 'starbucks', sizeId: 'venti', temp: 'ice', lid: true}, CATALOG)!;
    expect(spec).toMatchObject({label: '스타벅스 벤티 아이스(뚜껑 닫음)', fillMl: 591, lid: true, ice: true});
    expect(spec.pick).toEqual({brandId: 'starbucks', sizeId: 'venti', volumeMl: null, temp: 'ice', lid: true});
    expect(cupWords(spec)).toBe('스타벅스 벤티 아이스(뚜껑 닫음) 591ml');
    expect(choiceOf(spec)).toMatchObject({brandId: 'starbucks', sizeId: 'venti', temp: 'ice', lid: true});
    // 같은 사이즈라도 그 온도의 용량을 쓴다.
    expect(buildCupSpec({brandId: 'twosome', sizeId: 'large', temp: 'ice'}, CATALOG)!.fillMl).toBe(591);
    expect(buildCupSpec({brandId: 'twosome', sizeId: 'large', temp: 'hot'}, CATALOG)!.fillMl).toBe(473);
  });

  it('아무것도 고르지 않으면 null 이고 기본 컵으로 계산한다', () => {
    expect(buildCupSpec({}, CATALOG)).toBeNull();
    expect(buildCupSpec(parse(''), CATALOG)).toBeNull();
    expect(safeBumpKph(null)).toBe(safeBumpKph(DEFAULT_CUP));
  });

  it('모르는 것은 정해 둔 값으로 채운다: 뚜껑은 없는 것으로, 온도는 그 사이즈를 파는 쪽으로', () => {
    expect(buildCupSpec({brandId: 'starbucks', sizeId: 'tall'}, CATALOG)).toMatchObject({lid: false, ice: false});
    expect(buildCupSpec({brandId: 'mega', sizeId: 'max'}, CATALOG)).toMatchObject({ice: true, fillMl: 946});
    // 브랜드만 알면 355ml에 가장 가까운 사이즈, 뚜껑만 알면 중간 컵.
    expect(buildCupSpec({brandId: 'starbucks'}, CATALOG)!.label).toBe('스타벅스 톨 핫(뚜껑 없음)');
    expect(buildCupSpec({lid: true}, CATALOG)!.label).toBe('중간 컵 핫(뚜껑 닫음)');
  });

  it('용량을 바로 말한 컵은 이름에 용량이 있어 다시 적지 않는다', () => {
    const spec = buildCupSpec(parse('오백 미리 아이스'), CATALOG)!;
    expect(spec.label).toBe('500ml 컵 아이스(뚜껑 없음)');
    expect(cupWords(spec)).toBe('500ml 컵 아이스(뚜껑 없음)');
  });

  it('브랜드와 함께 말한 용량이 그 브랜드의 어느 사이즈와도 맞지 않으면 말한 용량을 쓴다', () => {
    const guess = parse('스벅 24온스 아이스');
    expect(guess).toMatchObject({brandId: 'starbucks', volumeMl: 710});
    expect(guessWords(guess, CATALOG).size).toBe('710ml');
    const spec = buildCupSpec(guess, CATALOG)!;
    expect(spec).toMatchObject({label: '스타벅스 710ml 컵 아이스(뚜껑 없음)', fillMl: 710});
    expect(spec.pick).toMatchObject({brandId: 'starbucks', sizeId: null, volumeMl: 710});
  });

  it('브랜드만 말하면 컵 목록이 "기본"이라고 부르는 사이즈, 없으면 355ml에 가까운 사이즈다', () => {
    expect(buildCupSpec(parse('빽다방 아아'), CATALOG)).toMatchObject({fillMl: 660, ice: true});
    expect(buildCupSpec(parse('스벅 아아'), CATALOG)).toMatchObject({fillMl: 355, ice: true});
  });

  it('용량대가 맞는 컵 모양을 고르고, 맞는 것이 없으면 가장 큰 것을 쓴다', () => {
    expect(shapeFor(355, 'hot', CATALOG).maxMl).toBe(400);
    expect(shapeFor(400, 'hot', CATALOG).maxMl).toBe(400);
    expect(shapeFor(651, 'hot', CATALOG).maxMl).toBe(650);
    expect(shapeFor(946, 'ice', CATALOG).maxMl).toBe(750);
    // 그 온도의 모양이 없으면 다른 온도의 것, 아무것도 없으면 기본 컵과 같은 원통.
    const hotOnly = readCupCatalog({shapes: {hot: [{maxMl: 500, topDiameterMm: 90, bottomDiameterMm: 60, heightMm: 125}]}});
    expect(shapeFor(355, 'ice', hotOnly).maxMl).toBe(500);
    expect(shapeFor(355, 'hot', readCupCatalog({})).topDiameterMm).toBeCloseTo(CUP.radius * 2000, 6);
  });

  it('원통 컵은 같은 비율의 원통이 되고, 음료는 가장자리 1cm 아래까지 찬다', () => {
    const cylinder = equivalentCylinder(420, {maxMl: 500, topDiameterMm: 78, bottomDiameterMm: 78, heightMm: 100});
    expect(cylinder.height).toBeCloseTo(0.1 * cylinder.scale, 9);
    expect(cylinder.radius).toBeCloseTo(0.039 * cylinder.scale, 9);
    expect(Math.PI * cylinder.radius ** 2 * (cylinder.height - HEADSPACE_M) * 1e6).toBeCloseTo(420, 6);
  });

  it('아래가 좁은 컵은 가장자리 반지름이 같고 음료와 남은 높이(1cm)가 같은 원통이 된다', () => {
    const shape = {maxMl: 500, topDiameterMm: 90, bottomDiameterMm: 60, heightMm: 125};
    const cylinder = equivalentCylinder(473, shape);
    expect(cylinder.radius).toBeCloseTo((90 / 2000) * cylinder.scale, 9);
    const spec: CupSpec = {...DEFAULT_CUP, radius: cylinder.radius, height: cylinder.height, fillMl: 473};
    expect(spec.height - fillHeight(473, spec)).toBeCloseTo(HEADSPACE_M, 9);
    expect(cylinder.capacityMl - 473).toBeCloseTo(Math.PI * cylinder.radius ** 2 * HEADSPACE_M * 1e6, 6);
    // 이 시험 컵 모양은 473ml를 담으면 가장자리가 1cm 남는 크기와 거의 같다.
    expect(cylinder.scale).toBeGreaterThan(0.9);
    expect(cylinder.scale).toBeLessThan(1.1);
  });

  it('큰 사이즈일수록 많이 담고 컵도 크다. 아이스 컵은 같은 양이라도 입구가 넓다', () => {
    const small = buildCupSpec({sizeId: 'small', temp: 'hot'}, CATALOG)!;
    const large = buildCupSpec({sizeId: 'large', temp: 'hot'}, CATALOG)!;
    expect(large.fillMl).toBeGreaterThan(small.fillMl);
    expect(large.capacityMl).toBeGreaterThan(small.capacityMl);
    const iced = buildCupSpec({sizeId: 'large', temp: 'ice'}, CATALOG)!;
    expect(iced.radius).toBeGreaterThan(large.radius);
    for (const spec of [small, large, iced]) {
      expect(spec.capacityMl).toBeGreaterThan(spec.fillMl);
      expect(readCupSpec(spec)).toEqual(spec);
    }
  });

  it('저장소에서 읽은 컵이 이상하면 버린다', () => {
    const spec = buildCupSpec({brandId: 'starbucks', sizeId: 'tall', temp: 'hot', lid: true}, CATALOG)!;
    expect(readCupSpec(spec)).toEqual(spec);
    expect(readCupSpec({...spec, radius: 2})).toBeNull();
    expect(readCupSpec({...spec, fillMl: spec.capacityMl * 2})).toBeNull();
    expect(readCupSpec({...spec, label: ''})).toBeNull();
    expect(readCupSpec('컵')).toBeNull();
    // 고른 것(pick)만 이상하면 그것만 버린다.
    const {pick: _pick, ...withoutPick} = spec;
    expect(readCupSpec({...spec, pick: {temp: '미지근'}})).toEqual(withoutPick);
  });
});

describe('고른 컵의 물리', () => {
  const kph = (spec: CupSpec) => safeBumpSpeed(fillCup(spec)) * 3.6;
  const base = buildCupSpec({sizeId: 'medium', temp: 'hot', lid: false}, CATALOG)!;

  it('기본 컵의 계산은 예전 그대로다', () => {
    expect(newCup()).toEqual(fillCup(DEFAULT_CUP));
    expect(DEFAULT_CUP).toMatchObject({radius: 0.039, height: 0.1, fillMl: COFFEE_START_ML, lid: false});
    expect(Math.round(safeBumpSpeed(newCup()) * 3.6)).toBe(28);
    expect(safeBumpKph(null)).toBe(28);
    expect(predictBump(newCup(), 50 / 3.6).spillMl).toBeGreaterThan(1);
  });

  it('더 가득 찬 컵은 방지턱에서 더 천천히 넘어야 한다', () => {
    const fuller: CupSpec = {...base, fillMl: base.fillMl + Math.PI * base.radius ** 2 * 0.004 * 1e6};
    expect(kph(fuller)).toBeLessThan(kph(base));
  });

  it('입구가 넓은 컵은 같은 여유에서도 더 천천히 넘어야 한다', () => {
    const scale = 1.25;
    const wider: CupSpec = {
      ...base,
      radius: base.radius * scale,
      fillMl: base.fillMl * scale * scale,
      capacityMl: base.capacityMl * scale * scale,
    };
    expect(wider.height - fillHeight(wider.fillMl, wider)).toBeCloseTo(base.height - fillHeight(base.fillMl, base), 9);
    expect(kph(wider)).toBeLessThan(kph(base));
    expect(safeTurnSpeed(fillCup(wider), 25)).toBeLessThan(safeTurnSpeed(fillCup(base), 25));
  });

  it('가장자리까지 여유가 많은 높은 컵은 더 빨리 넘어도 된다', () => {
    const taller: CupSpec = {...base, height: base.height + 0.006, capacityMl: base.capacityMl * 1.1};
    expect(kph(taller)).toBeGreaterThan(kph(base));
  });

  it('뚜껑을 닫으면 넘치는 양이 열린 컵의 LID_LEAK 배다', () => {
    const lidded: CupSpec = {...base, lid: true};
    const open = predictBump(fillCup(base), 40 / 3.6).spillMl;
    const closed = predictBump(fillCup(lidded), 40 / 3.6).spillMl;
    expect(open).toBeGreaterThan(5);
    expect(closed).toBeLessThan(open * LID_LEAK * 1.5);
    expect(closed).toBeGreaterThan(0);
    expect(kph(lidded)).toBeGreaterThanOrEqual(kph(base));
    // 오래 기울어 있으면 뚜껑이 있어도 마시는 구멍으로 계속 샌다. 그래도 열린 컵보다 적다.
    const hold = (spec: CupSpec, seconds: number) => {
      let cup = fillCup(spec);
      for (let t = 0; t < seconds; t += 0.02) cup = stepCup(cup, {...STILL, accelLat: 4.5}, 0.02);
      return cup.spilledMl;
    };
    expect(hold(lidded, 1)).toBeLessThan(hold(base, 1) * 0.2);
    expect(hold(lidded, 5)).toBeLessThan(hold(base, 5));
  });

  it('브랜드 컵의 넘치지 않는 속도는 그럴듯한 범위다', () => {
    for (const choice of [
      {brandId: 'starbucks', sizeId: 'tall', temp: 'hot' as const, lid: false},
      {brandId: 'starbucks', sizeId: 'venti', temp: 'ice' as const, lid: true},
      {brandId: 'mega', sizeId: 'max', temp: 'ice' as const, lid: false},
    ]) {
      const value = safeBumpKph(buildCupSpec(choice, CATALOG));
      expect(value, JSON.stringify(choice)).toBeGreaterThanOrEqual(10);
      expect(value, JSON.stringify(choice)).toBeLessThanOrEqual(60);
    }
  });

  it('화면과 음성의 말', () => {
    expect(bumpAdvice(22)).toBe('방지턱 시속 22km 아래면 안 넘쳐요 · 어림');
    // 계산한 속도가 빨라도 방지턱은 시속 30km보다 빠르게 권하지 않는다.
    expect(bumpAdvice(31)).toBe('방지턱 시속 30km 아래면 안 넘쳐요 · 어림');
    expect(bumpAdvice(60)).toBe('방지턱 시속 30km 아래면 안 넘쳐요 · 어림');
    expect(bumpAdvice(0)).toContain('넘치기 쉬워요');
    const spec = buildCupSpec({brandId: 'starbucks', sizeId: 'venti', temp: 'ice', lid: true}, CATALOG)!;
    expect(cupConfirmLine(spec, 24)).toBe('좋아, 스타벅스 벤티 아이스! 방지턱은 시속 24km 아래로 부탁해.');
    expect(cupConfirmLine(spec, 45)).toBe('좋아, 스타벅스 벤티 아이스! 방지턱은 시속 30km 아래로 부탁해.');
    expect(sizeMl(CATALOG.brands[0].sizes[0], 'ice')).toBe(237);
  });
});
