import {Card} from '@astryxdesign/core/Card';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Heading} from '@astryxdesign/core/Heading';
import {Item} from '@astryxdesign/core/Item';
import {List} from '@astryxdesign/core/List';
import {VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {Token} from '@astryxdesign/core/Token';
import {CUP_CATALOG} from '../app/cupQuestion';
import {PUBLIC_DATA} from '../app/publicdata';
import {useSdkLog} from '../app/sdkLog';
import {
  PUBLIC_SECTIONS,
  kstDate,
  sunWindow,
  weatherWindow,
  type PublicSection,
} from '../core/publicdata';
import {hasRealSignals, useHostStatus} from '../native/host';
import {useNow} from '../sim/clock';
import {formatDateTime} from '../ui/format';
import {Page, SimulationNote} from '../ui/Page';

/** 공공 API 자료를 받는 방식. 네 가지 공공 API 기능에 똑같이 적는다. */
const AT_BUILD = '자료는 빌드할 때 받아 앱에 넣어 두었고, 앱에는 API 키가 없으며 실행 중에 이 API를 부르지 않습니다.';

const SECTION_LABEL: Record<PublicSection, string> = {
  hotspots: '사고 다발 지점',
  weather: '날씨',
  sun: '해 지는 시각',
  restAreas: '휴게소',
};

/** "2027-01-13" → "2027년 1월 13일" */
function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

/** 앱에 넣어 둔 예보를 언제까지 쓰는지. 기간이 지났으면 그렇다고 적는다. 예보가 없으면 null. */
function weatherStatus(at: number): string | null {
  const span = weatherWindow(PUBLIC_DATA.weather);
  if (!span) return null;
  const issuedAt = PUBLIC_DATA.weather?.issuedAt ?? null;
  const issued = issuedAt === null ? '들어 있는 예보' : `들어 있는 예보(${formatDateTime(issuedAt)} 발표)`;
  return at > span.to
    ? `${issued}는 ${formatDateTime(span.to)} 출발까지만 쓸 수 있어, 기간이 지난 지금은 날씨를 쓰지 않습니다.`
    : `${issued}로 ${formatDateTime(span.from)}부터 ${formatDateTime(span.to)} 사이의 출발에 날씨를 씁니다.`;
}

/** 앱에 넣어 둔 해 뜨고 지는 시각 자료의 기간. 기간이 지났으면 그렇다고 적는다. 자료가 없으면 null. */
function sunStatus(at: number): string | null {
  const span = sunWindow(PUBLIC_DATA.sun);
  if (!span) return null;
  const range = `${dayLabel(span.from)} ~ ${dayLabel(span.to)}`;
  return kstDate(at) > span.to
    ? `들어 있는 자료(${range})의 기간이 지나 지금은 주차 시각으로 하늘을 어림합니다.`
    : `들어 있는 자료: ${range}`;
}

/** 출처마다 받은 시각이 다르면(예전 자료를 이어 썼으면) 그 항목과 시각, 들어 있지 않은 항목을 적는다. */
function sectionNotes(): string {
  const fetchedAt = PUBLIC_DATA.fetchedAt;
  if (fetchedAt === null) return '';
  const older = PUBLIC_SECTIONS.flatMap(section => {
    const at = PUBLIC_DATA.fetched[section];
    return at !== null && Math.abs(at - fetchedAt) > 60_000 ? [`${SECTION_LABEL[section]} ${formatDateTime(at)}`] : [];
  });
  const missing = PUBLIC_SECTIONS.filter(section => PUBLIC_DATA.fetched[section] === null).map(s => SECTION_LABEL[s]);
  return [
    older.length > 0 ? ` 그때 받지 못한 출처는 예전에 받은 자료를 그대로 씁니다 (${older.join(', ')}).` : '',
    missing.length > 0 ? ` ${missing.join(', ')} 자료는 들어 있지 않아 그 기능이 쉬고 있습니다.` : '',
  ].join('');
}

/** 기능마다 어떤 Pleos SDK·API에 기대는지. API 이름은 Pleos Vehicle 샘플 앱과 공개 문서 기준이다. */
const MAPPINGS: {feature: string; sdk: string; api: string; use: string; status?: (at: number) => string | null}[] = [
  {
    feature: '운행 세션 시작과 종료',
    sdk: 'Vehicle SDK',
    api: 'Gear.registerGearSelection, VehicleGear',
    use: '기어가 P를 벗어나면 출발, P로 돌아오면 주차로 봅니다. 주행 중에는 화면을 잠급니다.',
  },
  {
    feature: '목적지와 도착',
    sdk: 'NaviHelper SDK',
    api: 'onRouteStarted, onDestinationArrived, onCurrentLocationInfo',
    use: '안내 시작과 도착 이벤트로 목적지 이름을, 현재 위치 주소로 출발 지역 이름을 얻습니다.',
  },
  {
    feature: '정체 구간 감지',
    sdk: 'NaviHelper SDK',
    api: 'getRouteStateInfo, TrafficStatus.congestionItemList',
    use: '경로 위 정체 구간(SLOW 이상)에 들어서면 같은 길의 감자들과 묶이고, 벗어나면 풀립니다. 도로 이름도 여기서 옵니다.',
  },
  {
    feature: '같은 길 감자 묶기 · 2차 PT까지',
    sdk: 'FusedLocation SDK',
    api: '현재 위치 → 도로 구간',
    use: '계획: 좌표는 기기에 두고 구간 이름과 시간대만 중계 서버로 보내 익명으로 묶습니다. 지금은 서버 없이 가상 감자로 보여 줍니다.',
  },
  {
    feature: '타임캡슐 재방문 알림 · 2차 PT까지',
    sdk: 'FusedLocation SDK',
    api: 'ProximityAlertRequest',
    use: '계획: 남긴 장소를 100m 벗어났다가 50m 안으로 돌아오면 알립니다. 지금은 주차한 곳의 동네 이름으로 다시 온 것을 알아봅니다.',
  },
  {
    feature: '주행 중 감자 안내',
    sdk: 'TextToSpeech SDK',
    api: 'TextToSpeech.speak, Mode.ON_DEVICE · HYBRID',
    use: '주행 중에는 화면 대신 한 문장 음성으로만 알립니다.',
  },
  {
    feature: '커피 정보 말로 받기',
    sdk: 'SpeechToText SDK',
    api: 'SpeechToText.request · stop, ResultListener.onUpdated · onEndedRecognition · onError, Mode.ON_DEVICE · HYBRID',
    use: '주차한 채(기어 P)로 커피 운송작전을 켜면 감자가 "오늘은 어떤 커피 실었어?" 하고 묻고, 그 말이 끝난 뒤 한 번(8초까지) 듣습니다. 브랜드, 사이즈, 핫·아이스, 뚜껑을 알아듣고, 화면에서 확인을 눌러야 그 컵으로 넘치지 않는 속도를 계산합니다. Vehicle SDK가 기어 P를 읽었을 때만 묻고 듣습니다. 질문이 끝나기 전에 기어가 P를 벗어나면 그 질문을 거두고, 듣는 중이면 바로 멈춥니다. 앱 화면이 가려져도 듣기를 멈춥니다. 마이크는 Pleos 음성 서비스가 엽니다(권한 STT_SERVICE). 앱이 받는 것은 알아들은 글자뿐이고 저장하지 않습니다. 브라우저 시뮬레이터에서는 음성 인식 없이 글로 적습니다.',
  },
  {
    feature: '주행 제한 상태 읽기 · 2차 PT까지',
    sdk: 'AAOS',
    api: 'CarUxRestrictions',
    use: '계획: 주행 제한 상태를 읽어 메뉴, 입력, 스티커 선택을 막습니다. 지금 주행 잠금은 Vehicle SDK의 기어 신호(P가 아니면 잠금)로 동작합니다.',
  },
  {
    feature: '주행 지도',
    sdk: 'NaviHelper SDK',
    api: 'getTBTInfo, onCautionPointInfo, getRouteStateInfo, getDestinationInfo, getCurrentLocationInfo',
    use: '주행 중에는 지금 위치와 목적지 좌표를 경로 서비스(TMAP, 키가 없으면 OpenStreetMap의 OSRM)에 보내 길의 실제 모양을 받고, 지도 타일을 OpenFreeMap에서 받아 기울인 3D 지도에 그립니다. 다음 회전, 앞쪽 정체 구간, 남은 거리를 그 위에 얹습니다. 좌표는 이 기기와 이 요청에만 쓰고 기록에는 남기지 않습니다.',
  },
  {
    feature: '지도 위의 차',
    sdk: 'AAOS 차량 속성',
    api: 'CarPropertyManager, PERF_VEHICLE_SPEED',
    use: '계기판과 같은 차량 속도로 지도 위의 감자 차가 길을 따라 나아갑니다. 내비의 위치가 바뀌면 그 위치로 맞춥니다.',
  },
  {
    feature: '실제 과속방지턱과 보호구역',
    sdk: '공공데이터포털',
    api: '경기도 성남시_과속방지턱, 전국어린이보호구역표준데이터',
    use: '경로에서 12m 안의 방지턱과 학교 300m 안의 구간을 길 위에 얹고, 방지턱을 넘기 전에 넘치지 않는 속도를 알립니다.',
  },
  {
    feature: '사고 다발 지점',
    sdk: '공공데이터포털',
    api: '한국도로교통공단 보행어린이 교통사고 다발지역, 결빙 교통사고 다발지역',
    use: `경로가 지점의 범위(반지름, 150m까지)를 지나면 실제 지도에 옅게 칠하고, 그 범위에 들어서기 100m(빠르면 5초) 앞에서 감자가 음성으로 먼저 알립니다. 결빙 지점은 예보 기온이 3°C 이하이거나 12~2월일 때만 알립니다. 미리 알리고 지나간 지점 수는 작전 결과와 작전일지에 적습니다. ${AT_BUILD}`,
  },
  {
    feature: '날씨',
    sdk: '공공데이터포털',
    api: '기상청 단기예보 조회서비스',
    use: `출발 시각에 가장 가까운 예보 한 시간으로 출발 인사(비나 눈 소식)와 작전일지 첫 줄("맑은 저녁, …")을 씁니다. 예보 시각과 90분 넘게 떨어지거나 발표한 지 24시간이 지난 예보, 예보 지역에서 10km 넘게 떨어진 운행에는 날씨를 쓰지 않습니다. ${AT_BUILD}`,
    status: weatherStatus,
  },
  {
    feature: '해 지는 시각',
    sdk: '공공데이터포털',
    api: '한국천문연구원 출몰시각 정보',
    use: `성남의 해 뜨고 지는 시각으로 그림일기의 하늘(낮, 해 질 녘, 밤)을 고르고, 해가 진 뒤에 도착하면 일지에 몇 분 뒤였는지 적습니다. 그날 자료가 없거나 성남에서 50km 넘게 떨어진 곳에 주차하면 주차 시각으로 어림합니다. ${AT_BUILD}`,
    status: sunStatus,
  },
  {
    feature: '휴게소 커피',
    sdk: '한국도로공사',
    api: '고속도로 공공데이터 포털 휴게소 기준정보, 휴게소 브랜드 매장',
    use: `도우미에서 가까운 휴게소 세 곳과 그 안의 커피 매장을 보여주고, 경로가 커피 매장이 있는 휴게소 500m 안을 지나면 감자가 한 번 알려줍니다. ${AT_BUILD}`,
  },
  {
    feature: '커피 운송작전',
    sdk: 'NaviHelper SDK, 가속도 센서',
    api: 'changeRouteOption(COMFORTABLE), onCautionPointInfo(SPEED_BUMP), SensorManager',
    use: '출발할 때 편안한 길을 청합니다. 차가 받는 힘으로 컵 속 커피의 기울기와 넘침을 계산하고, 과속방지턱이 가까워지면 넘치지 않는 속도를 음성으로 알립니다.',
  },
];

/** Pleos 연동. 심사에서 묻는 "SDK가 핵심 경험에 어떻게 쓰이는가"를 앱 안에서 보여준다. */
export function Integration() {
  const sdkLog = useSdkLog();
  const host = useHostStatus();
  const isReal = hasRealSignals(host);
  // 시뮬레이터가 시계를 돌리면 앱의 "지금"이 바뀐다. 예보와 해 지는 시각은 그 "지금"으로 고른다.
  const at = useNow();

  return (
    <Page
      title="Pleos 연동"
      description="이 앱의 핵심 경험은 차량과 내비가 보내는 신호에서 시작합니다.">
      <Card padding={5}>
        <VStack gap={3}>
          <VStack gap={1}>
            <Heading level={2}>기능과 SDK 대응</Heading>
            {isReal ? (
              <Text type="supporting" color="secondary">
                Pleos 연결됨 · Vehicle SDK {host.vehicle ? '연결' : '없음'} · NaviHelper SDK{' '}
                {host.navi ? '연결' : '없음'} · TextToSpeech SDK {host.tts ? '연결' : '없음'} · SpeechToText SDK{' '}
                {host.stt ? (host.sttServer ? '연결(서버 인식)' : '연결(차량 내장 엔진)') : '없음'}
              </Text>
            ) : (
              <SimulationNote>
                지금은 시뮬레이터가 신호를 대신 보냅니다. Android 앱으로 Pleos Connect에서 실행하면 아래 SDK에서 실제 신호를 받습니다.
              </SimulationNote>
            )}
          </VStack>
          <List hasDividers>
            {MAPPINGS.map(m => {
              const status = m.status?.(at) ?? null;
              return (
                <Item
                  key={m.feature}
                  align="start"
                  label={m.feature}
                  description={
                    <VStack gap={1}>
                      <Text type="supporting" color="secondary">
                        {m.api}
                      </Text>
                      <Text type="body">{m.use}</Text>
                      {status && (
                        <Text type="supporting" color="secondary">
                          {status}
                        </Text>
                      )}
                    </VStack>
                  }
                  endContent={<Token label={m.sdk} size="sm" />}
                />
              );
            })}
          </List>
        </VStack>
      </Card>

      <Card padding={5}>
        <VStack gap={2}>
          <Heading level={2}>지도와 데이터 출처</Heading>
          <Text type="body">
            지도 데이터 © OpenStreetMap 기여자 (ODbL, openstreetmap.org/copyright) · 지도 스키마 © OpenMapTiles (CC BY 4.0) · 타일
            OpenFreeMap · 지도 그리기 MapLibre GL JS
          </Text>
          <Text type="body">경로: TMAP 자동차 경로안내 (SK open API) 또는 OSRM (OpenStreetMap 데이터)</Text>
          <Text type="body">
            과속방지턱: 공공데이터포털 「경기도 성남시_과속방지턱」 · 어린이 보호구역: 「전국어린이보호구역표준데이터」 · 주차장:
            「전국주차장정보표준데이터」
          </Text>
          <Text type="body">
            사고 다발 지점: 한국도로교통공단 「보행어린이 교통사고 다발지역」, 「결빙 교통사고 다발지역」 · 날씨: 기상청 「단기예보」 ·
            해 뜨고 지는 시각: 한국천문연구원 「출몰시각 정보」 (공공데이터포털)
          </Text>
          <Text type="body">휴게소와 커피 매장: 한국도로공사 「휴게소 기준정보」, 「휴게소 브랜드 매장」 (고속도로 공공데이터 포털)</Text>
          {CUP_CATALOG.source && (
            <Text type="body">
              커피 컵 용량: {CUP_CATALOG.source} · 컵 치수와 뚜껑의 효과는 어림입니다.
            </Text>
          )}
          <Text type="supporting" color="secondary">
            {PUBLIC_DATA.fetchedAt === null
              ? '이 빌드에는 공공 API 자료가 들어 있지 않아 사고 다발 지점, 날씨, 해 지는 시각, 휴게소 기능이 쉬고 있습니다.'
              : `공공 API 자료는 ${formatDateTime(PUBLIC_DATA.fetchedAt)}에 받아 앱에 넣었습니다${
                  PUBLIC_DATA.area ? ` (날씨와 해 지는 시각은 ${PUBLIC_DATA.area.name} 기준)` : ''
                }.${sectionNotes()} 앱에는 API 키가 없고 실행 중에 이 API들을 부르지 않습니다. 이 API들에는 지금 위치를 보내지 않습니다.`}
          </Text>
        </VStack>
      </Card>

      <Card padding={5}>
        <VStack gap={3}>
          <Heading level={2}>SDK 이벤트 로그</Heading>
          {sdkLog.length === 0 ? (
            <EmptyState
              isCompact
              title="아직 받은 신호가 없습니다"
              description="차량 신호가 들어오면 어느 SDK의 어떤 API에서 왔는지 여기에 기록됩니다."
            />
          ) : (
            <List hasDividers density="compact">
              {sdkLog.map((event, i) => (
                <Item
                  key={`${event.at}-${i}`}
                  label={`${event.name} · ${event.detail}`}
                  description={formatDateTime(event.at)}
                  endContent={<Token label={event.sdk} size="sm" />}
                />
              ))}
            </List>
          )}
        </VStack>
      </Card>
    </Page>
  );
}
