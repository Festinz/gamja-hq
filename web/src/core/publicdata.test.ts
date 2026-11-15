import {describe, expect, it} from 'vitest';
import bundled from '../data/publicapi.json';
import {
  EMPTY_PUBLIC_DATA,
  WEATHER_WORD,
  forecastHourAt,
  isHotspotActive,
  isIcyAt,
  isNearArea,
  kstDate,
  minutesAfterSunset,
  nearestCoffeeStops,
  precipitationOf,
  readPublicData,
  restAreaLine,
  restAreaName,
  skyPhase,
  sunOn,
  sunWindow,
  weatherAt,
  weatherWindow,
  type WeatherSnapshot,
} from './publicdata';

/** 한국 시각으로 적은 시각. 어느 시간대의 기기에서 돌려도 같은 순간이다. */
const kst = (text: string) => Date.parse(`${text}:00+09:00`);

/** 2026-11-15 17시부터 한 시간 간격의 단기예보. */
const forecast = (hours: {sky?: number | null; pty?: number | null; tmp?: number | null}[]) => ({
  issuedAt: '2026-11-15T17:00:00+09:00',
  nx: 62,
  ny: 123,
  hours: hours.map((h, i) => ({
    at: `2026-11-15T${String(17 + i).padStart(2, '0')}:00:00+09:00`,
    tmp: h.tmp ?? 8,
    sky: h.sky === undefined ? 1 : h.sky,
    pty: h.pty === undefined ? 0 : h.pty,
    pop: 20,
  })),
});

const snapshot = (hours: Parameters<typeof forecast>[0]): WeatherSnapshot =>
  readPublicData({weather: forecast(hours)}).weather!;

describe('앱에 넣어 둔 공공 API 자료 읽기', () => {
  it('비었거나 형식이 다른 파일은 빈 자료로 읽는다', () => {
    expect(readPublicData(null)).toEqual(EMPTY_PUBLIC_DATA);
    expect(readPublicData('x')).toEqual(EMPTY_PUBLIC_DATA);
    expect(readPublicData([])).toEqual(EMPTY_PUBLIC_DATA);
    expect(
      readPublicData({fetchedAt: null, area: null, hotspots: [], weather: null, sun: [], restAreas: [], notes: {}}),
    ).toEqual(EMPTY_PUBLIC_DATA);
  });

  it('지금 앱에 들어 있는 파일은 형식에 맞고 키를 담고 있지 않다', () => {
    const data = readPublicData(bundled as unknown);
    expect(Array.isArray(data.hotspots)).toBe(true);
    expect(Array.isArray(data.sun)).toBe(true);
    expect(Array.isArray(data.restAreas)).toBe(true);
    // 키를 담을 만한 이름의 항목이나, 가리지 않은 키가 붙은 주소가 없어야 한다.
    const text = JSON.stringify(bundled);
    expect(text).not.toMatch(/"(service_?key|api_?key|auth_?key)"\s*:/i);
    expect(text).not.toMatch(/[?&](service_?key|api_?key|key)=(?!\*)/i);
  });

  it('받은 시각과 지역, 예보 시각을 읽는다', () => {
    const data = readPublicData({
      fetchedAt: '2026-11-15T17:40:00+09:00',
      area: {name: '성남시 분당구 일대', center: [127.11, 37.38]},
      weather: forecast([{}, {}]),
    });
    expect(data.fetchedAt).toBe(kst('2026-11-15T17:40'));
    expect(data.area).toEqual({name: '성남시 분당구 일대', center: [127.11, 37.38]});
    expect(data.weather?.issuedAt).toBe(kst('2026-11-15T17:00'));
    expect(data.weather?.hours.map(h => h.at)).toEqual([kst('2026-11-15T17:00'), kst('2026-11-15T18:00')]);
  });

  it('항목마다 받은 시각을 읽는다. 예전 파일처럼 없으면 자료가 있는 항목만 fetchedAt에 받은 것으로 본다', () => {
    const carried = readPublicData({
      fetchedAt: '2026-11-20T09:00:00+09:00',
      fetched: {hotspots: '2026-11-15T17:40:00+09:00', weather: '2026-11-20T09:00:00+09:00', sun: null},
      weather: forecast([{}]),
    });
    expect(carried.fetched).toEqual({
      hotspots: kst('2026-11-15T17:40'),
      weather: kst('2026-11-20T09:00'),
      sun: null,
      restAreas: null,
    });
    const old = readPublicData({fetchedAt: '2026-11-15T17:40:00+09:00', weather: forecast([{}]), hotspots: []});
    expect(old.fetched).toEqual({hotspots: null, weather: kst('2026-11-15T17:40'), sun: null, restAreas: null});
  });

  it('사고 다발 지점은 종류와 좌표가 맞는 것만 받고, 범위를 모르면 100m로 본다', () => {
    const data = readPublicData({
      hotspots: [
        {kind: 'child', name: '성남시 분당구 정자동(정자초교 부근)', lng: 127.11, lat: 37.37, radiusM: null, accidents: 4, casualties: 5, year: '2023', source: '보행어린이 교통사고 다발지역'},
        {kind: 'ice', name: '결빙 지점', lng: 127.12, lat: 37.4, radiusM: 80, accidents: null, casualties: null, year: null},
        {kind: 'bike', name: '모르는 종류', lng: 127.1, lat: 37.4},
        {kind: 'child', name: '경도와 위도가 뒤바뀜', lng: 37.4, lat: 127.1},
        {kind: 'child', name: '좌표 없음'},
      ],
    });
    expect(data.hotspots.map(h => h.name)).toEqual(['성남시 분당구 정자동(정자초교 부근)', '결빙 지점']);
    expect(data.hotspots[0]).toMatchObject({radiusM: 100, accidents: 4, casualties: 5, year: '2023'});
    expect(data.hotspots[1]).toMatchObject({radiusM: 80, source: '결빙 교통사고 다발지역'});
  });

  it('해 뜨고 지는 시각은 HHMM으로 와도 HH:MM으로 읽고, 날짜가 이상한 날은 버린다', () => {
    const data = readPublicData({
      sun: [
        {date: '2026-11-15', sunrise: '0711', sunset: '1721'},
        {date: '2026-11-16', sunrise: '07:12', sunset: '17:20'},
        {date: '11/17', sunrise: '07:13', sunset: '17:20'},
        {date: '2026-11-18', sunrise: '17:20', sunset: '07:13'},
      ],
    });
    expect(data.sun).toEqual([
      {date: '2026-11-15', sunrise: '07:11', sunset: '17:21'},
      {date: '2026-11-16', sunrise: '07:12', sunset: '17:20'},
    ]);
  });

  it('휴게소의 커피 상표는 겹치지 않게 읽는다', () => {
    const data = readPublicData({
      restAreas: [
        {name: '죽전휴게소', route: '경부선', direction: '서울방향', lng: 127.11, lat: 37.33, coffee: ['스타벅스', '스타벅스', '', 3]},
        {name: '', route: '경부선', lng: 127.1, lat: 37.3, coffee: []},
      ],
    });
    expect(data.restAreas).toEqual([
      {name: '죽전휴게소', route: '경부선', direction: '서울방향', lng: 127.11, lat: 37.33, coffee: ['스타벅스']},
    ]);
  });
});

describe('출발 시각의 날씨', () => {
  it('가장 가까운 예보 한 시간을 쓴다', () => {
    const weather = snapshot([{sky: 1}, {sky: 4}, {sky: 3}]);
    expect(forecastHourAt(weather, kst('2026-11-15T18:20'))?.at).toBe(kst('2026-11-15T18:00'));
    expect(weatherAt(weather, kst('2026-11-15T18:20'))).toEqual({condition: 'overcast', tempC: 8});
    expect(weatherAt(weather, kst('2026-11-15T18:40'))?.condition).toBe('cloudy');
  });

  it('예보 시각과 90분 넘게 떨어진 운행에는 날씨를 쓰지 않는다', () => {
    const weather = snapshot([{sky: 1}, {sky: 1}]);
    expect(weatherAt(weather, kst('2026-11-15T19:30'))).not.toBeNull();
    expect(weatherAt(weather, kst('2026-11-15T19:31'))).toBeNull();
    expect(weatherAt(weather, kst('2026-11-15T15:29'))).toBeNull();
    // 며칠 지난 자료로는 날씨를 지어내지 않는다.
    expect(weatherAt(weather, kst('2026-11-20T18:00'))).toBeNull();
    expect(weatherAt(null, kst('2026-11-15T18:00'))).toBeNull();
  });

  it('비나 눈이 오면 하늘 상태보다 먼저 쓴다', () => {
    const weather = snapshot([{sky: 4, pty: 1}, {sky: 4, pty: 3}, {sky: 3, pty: 2}, {sky: 4, pty: 4}]);
    const at = (hour: number) => weatherAt(weather, kst(`2026-11-15T${hour}:00`));
    expect(at(17)?.condition).toBe('rain');
    expect(at(18)?.condition).toBe('snow');
    expect(at(19)?.condition).toBe('sleet');
    expect(at(20)?.condition).toBe('shower');
    expect(precipitationOf(at(17))).toBe('rain');
    expect(precipitationOf(at(18))).toBe('snow');
    expect(precipitationOf(at(19))).toBe('sleet');
    expect(precipitationOf(at(20))).toBe('rain');
    expect(precipitationOf({condition: 'clear', tempC: 3})).toBeNull();
    expect(precipitationOf(null)).toBeNull();
  });

  it('하늘 상태도 강수 형태도 모르면 날씨가 없다', () => {
    expect(weatherAt(snapshot([{sky: null, pty: null}]), kst('2026-11-15T17:00'))).toBeNull();
  });

  it('발표한 지 24시간이 지난 예보는 예보 시각이 가까워도 쓰지 않는다', () => {
    // 11월 15일 17시 발표, 16일 17시부터 한 시간 간격의 예보.
    const later: WeatherSnapshot = {
      ...snapshot([{}]),
      hours: [kst('2026-11-16T17:00'), kst('2026-11-16T18:00')].map(at => ({at, tmp: 8, sky: 1, pty: 1, pop: 60})),
    };
    expect(weatherAt(later, kst('2026-11-16T17:00'))?.condition).toBe('rain');
    expect(weatherAt(later, kst('2026-11-16T17:01'))).toBeNull();
    expect(isIcyAt(kst('2026-11-16T17:30'), {...later, hours: later.hours.map(h => ({...h, tmp: 1}))})).toBe(false);
    // 발표 시각을 모르면 예보 시각만 본다.
    expect(weatherAt({...later, issuedAt: null}, kst('2026-11-16T18:00'))?.condition).toBe('rain');
  });

  it('예보를 쓸 수 있는 출발 시각은 첫 예보 90분 앞부터, 마지막 예보 90분 뒤나 발표 24시간 뒤 가운데 이른 때까지다', () => {
    const short = snapshot([{}, {}, {}]);
    expect(weatherWindow(short)).toEqual({from: kst('2026-11-15T15:30'), to: kst('2026-11-15T20:30')});
    const long: WeatherSnapshot = {
      ...short,
      hours: Array.from({length: 48}, (_, i) => ({at: kst('2026-11-15T18:00') + i * 3_600_000, tmp: 8, sky: 1, pty: 0, pop: 0})),
    };
    expect(weatherWindow(long)).toEqual({from: kst('2026-11-15T16:30'), to: kst('2026-11-16T17:00')});
    expect(weatherWindow(null)).toBeNull();
  });

  it('작전일지에는 비나 눈을 "왔다"가 아니라 "소식이 있었다"고 적는다', () => {
    expect(WEATHER_WORD.rain).toBe('비 소식이 있던');
    expect(WEATHER_WORD.snow).toBe('눈 소식이 있던');
    expect(WEATHER_WORD.clear).toBe('맑은');
  });
});

describe('자료의 지역', () => {
  const area = {name: '성남시 판교 일대', center: [127.094681, 37.4127212] as [number, number]};

  it('지역 가운데에서 reach 미터 안이면 안이고, 위치나 지역을 모르면 밖이다', () => {
    // 판교역 근처(약 3km)는 10km 안, 강릉(약 160km)은 밖이다.
    expect(isNearArea([127.1112, 37.3947], area, 10_000)).toBe(true);
    expect(isNearArea([128.8961, 37.7519], area, 10_000)).toBe(false);
    expect(isNearArea([128.8961, 37.7519], area, 50_000)).toBe(false);
    expect(isNearArea(null, area, 10_000)).toBe(false);
    expect(isNearArea([127.1112, 37.3947], null, 10_000)).toBe(false);
  });
});

describe('결빙과 사고 다발 지점', () => {
  it('12~2월이면 기온과 상관없이 결빙을 조심한다', () => {
    expect(isIcyAt(kst('2026-12-01T12:00'), null)).toBe(true);
    expect(isIcyAt(kst('2027-02-28T12:00'), null)).toBe(true);
    // 한국 시각으로 3월 1일 0시 5분은 3월이다.
    expect(isIcyAt(kst('2027-03-01T00:05'), null)).toBe(false);
  });

  it('그 밖의 달에는 그 시각 예보 기온이 3°C 이하일 때만 조심한다', () => {
    expect(isIcyAt(kst('2026-11-15T18:00'), snapshot([{tmp: 6}, {tmp: 3}]))).toBe(true);
    expect(isIcyAt(kst('2026-11-15T17:00'), snapshot([{tmp: 6}, {tmp: 3}]))).toBe(false);
    expect(isIcyAt(kst('2026-11-15T17:00'), null)).toBe(false);
  });

  it('어린이 지점은 늘 알리고 결빙 지점은 추울 때만 알린다', () => {
    expect(isHotspotActive('child', false)).toBe(true);
    expect(isHotspotActive('ice', false)).toBe(false);
    expect(isHotspotActive('ice', true)).toBe(true);
  });
});

describe('해 뜨고 지는 시각', () => {
  const sun = [{date: '2026-11-15', sunrise: '07:11', sunset: '17:21'}];
  const times = sunOn(sun, kst('2026-11-15T18:01'))!;

  it('그날(한국 시각)의 자료를 고른다', () => {
    expect(times).toEqual({sunrise: kst('2026-11-15T07:11'), sunset: kst('2026-11-15T17:21')});
    expect(sunOn(sun, kst('2026-11-16T08:00'))).toBeNull();
    expect(kstDate(kst('2026-11-16T00:30'))).toBe('2026-11-16');
  });

  it('해 지는 시각 앞뒤 30분은 해 질 녘, 그 뒤와 해 뜨기 전은 밤이다', () => {
    expect(skyPhase(kst('2026-11-15T12:00'), times)).toBe('day');
    expect(skyPhase(kst('2026-11-15T16:51'), times)).toBe('sunset');
    expect(skyPhase(kst('2026-11-15T17:51'), times)).toBe('sunset');
    expect(skyPhase(kst('2026-11-15T17:52'), times)).toBe('night');
    expect(skyPhase(kst('2026-11-15T06:30'), times)).toBe('night');
  });

  it('해가 진 지 몇 분 뒤인지 센다', () => {
    expect(minutesAfterSunset(kst('2026-11-15T18:01'), times)).toBe(40);
    expect(minutesAfterSunset(kst('2026-11-15T17:00'), times)).toBeNull();
  });

  it('자료의 첫날과 끝날을 안다', () => {
    expect(sunWindow([{date: '2026-11-16', sunrise: '07:12', sunset: '17:20'}, ...sun])).toEqual({
      from: '2026-11-15',
      to: '2026-11-16',
    });
    expect(sunWindow([])).toBeNull();
  });
});

describe('휴게소 커피', () => {
  const area = (name: string, lat: number, coffee: string[]) => ({
    name,
    route: '경부선',
    direction: '부산방향',
    lng: 127.1,
    lat,
    coffee,
  });

  it('커피 매장이 있는 휴게소를 가까운 순서로 세 곳까지 고른다', () => {
    const from = [127.1, 37.4] as const;
    const stops = nearestCoffeeStops(
      [area('넷째', 37.0, ['할리스']), area('커피 없음', 37.39, []), area('둘째', 37.3, ['스타벅스']), area('첫째', 37.35, ['투썸플레이스']), area('셋째', 37.2, ['스타벅스'])],
      from,
    );
    expect(stops.map(stop => stop.name)).toEqual(['첫째', '둘째', '셋째']);
    expect(stops[0].meters).toBeGreaterThan(5000);
    expect(stops[0].meters).toBeLessThan(6000);
  });

  it('감자는 휴게소 이름에 휴게소를 한 번만 붙이고, 커피 운송작전 중에는 보고한다', () => {
    expect(restAreaName('죽전')).toBe('죽전휴게소');
    expect(restAreaName('죽전(서울)휴게소')).toBe('죽전(서울)휴게소');
    expect(restAreaName('서하남행복드림쉼터')).toBe('서하남행복드림쉼터');
    expect(restAreaLine('죽전휴게소', false)).toBe('다음 죽전휴게소에 커피 매장이 있어.');
    expect(restAreaLine('죽전휴게소', true)).toBe('사령관님! 다음 죽전휴게소에 커피 매장이 있습니다.');
    // 한국도로공사 자료의 이름은 방향이 괄호로 붙어 온다. 감자는 괄호를 빼고 부른다.
    expect(restAreaLine('죽전(서울)휴게소', false)).toBe('다음 죽전휴게소에 커피 매장이 있어.');
    expect(restAreaLine('양북임시(상)휴게소', true)).toBe('사령관님! 다음 양북임시휴게소에 커피 매장이 있습니다.');
  });

  it('앱에 넣어 둔 휴게소 이름으로 한 말에는 괄호가 없고 휴게소를 한 번만 부른다', () => {
    for (const area of readPublicData(bundled as unknown).restAreas.filter(a => a.coffee.length > 0)) {
      const line = restAreaLine(area.name, false);
      expect(line).not.toMatch(/[()]/);
      expect(line.match(/휴게소|쉼터/g)).toHaveLength(1);
    }
  });
});
