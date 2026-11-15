import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {HOST_SPEECH_ERRORS, HOST_SPEECH_STATES, readHostSpeech} from './hostSpeech';

/** Android 쪽의 짝. 웹과 같은 낱말과 같은 모양을 쓰는지 본다. */
const ANDROID = '../../../android/app/src/main/java/com/gamjahq/app/';
const LISTEN_FLOW = fileURLToPath(new URL(`${ANDROID}ListenFlow.kt`, import.meta.url));
const WEB_BRIDGE = fileURLToPath(new URL(`${ANDROID}WebBridge.kt`, import.meta.url));

/** Kotlin 의 `const val NAME = "value"` 들. */
function kotlinConstants(source: string): Record<string, string> {
  return Object.fromEntries([...source.matchAll(/const val (\w+) = "([^"]*)"/g)].map(m => [m[1], m[2]]));
}

/** Kotlin 함수 하나의 본문 (다음 fun 앞까지). */
function kotlinFunction(source: string, name: string): string {
  const start = source.indexOf(`fun ${name}(`);
  const next = source.indexOf('fun ', start + 4);
  return start < 0 ? '' : source.slice(start, next < 0 ? undefined : next);
}

/** JSONObject 에 넣는 키 이름들. */
const keysPut = (body: string) => [...body.matchAll(/put(?:Opt)?\("(\w+)"/g)].map(m => m[1]);

describe('네이티브 호스트의 말로 묻기 메시지 ({type: "stt"})', () => {
  it.skipIf(!existsSync(LISTEN_FLOW))('상태와 실패 까닭이 ListenFlow.kt 와 같다', () => {
    const k = kotlinConstants(readFileSync(LISTEN_FLOW, 'utf8'));
    expect([k.LISTENING, k.PARTIAL, k.FINAL, k.ERROR]).toEqual([...HOST_SPEECH_STATES]);
    expect([k.NOT_PARKED, k.UNAVAILABLE, k.TIMEOUT, k.NO_SPEECH, k.CANCELLED, k.PAUSED, k.RECOGNIZER]).toEqual([
      ...HOST_SPEECH_ERRORS,
    ]);
  });

  it.skipIf(!existsSync(WEB_BRIDGE))('WebBridge.kt 가 보내는 키와 웹이 부르는 이름이 같다', () => {
    const source = readFileSync(WEB_BRIDGE, 'utf8');
    expect(keysPut(kotlinFunction(source, 'sendStt'))).toEqual(['type', 'state', 'text', 'error', 'detail']);
    expect(kotlinFunction(source, 'sendStt')).toContain('"stt"');
    expect(keysPut(kotlinFunction(source, 'sendStatus'))).toEqual(
      expect.arrayContaining(['vehicle', 'navi', 'tts', 'serverVoice', 'stt', 'sttServer', 'parked']),
    );
    // 웹 → 네이티브: window.PleosHost.listen(), stopListening(), 묻는 말 speakWhileParked(text), 거두기 unspeak(text).
    expect(source).toMatch(/@JavascriptInterface\s+fun listen\(\)/);
    expect(source).toMatch(/@JavascriptInterface\s+fun stopListening\(\)/);
    expect(source).toMatch(/@JavascriptInterface\s+fun speakWhileParked\(text: String\)/);
    expect(source).toMatch(/@JavascriptInterface\s+fun unspeak\(text: String\)/);
  });

  it('Android 가 보내는 JSON 그대로 읽는다', () => {
    const read = (json: string) => readHostSpeech(JSON.parse(json) as Record<string, unknown>);
    expect(read('{"type":"stt","state":"listening"}')).toEqual({state: 'listening'});
    expect(read('{"type":"stt","state":"partial","text":"스타벅스 그란"}')).toEqual({state: 'partial', text: '스타벅스 그란'});
    expect(read('{"type":"stt","state":"final","text":"스타벅스 그란데 아이스"}')).toEqual({
      state: 'final',
      text: '스타벅스 그란데 아이스',
    });
    expect(read('{"type":"stt","state":"error","error":"not-parked"}')).toEqual({state: 'error', error: 'not-parked'});
    expect(read('{"type":"stt","state":"error","error":"paused"}')).toEqual({state: 'error', error: 'paused'});
    expect(read('{"type":"stt","state":"error","error":"recognizer","detail":"MIC_ERROR"}')).toEqual({
      state: 'error',
      error: 'recognizer',
      detail: 'MIC_ERROR',
    });
  });

  it('모르는 상태는 버리고, 모르는 실패 까닭은 recognizer 로 보며 그 이름을 detail 에 남긴다', () => {
    expect(readHostSpeech({state: 'started'})).toBeNull();
    expect(readHostSpeech({})).toBeNull();
    expect(readHostSpeech({state: 'error', error: 'mic-busy'})).toEqual({state: 'error', error: 'recognizer', detail: 'mic-busy'});
    expect(readHostSpeech({state: 'error'})).toEqual({state: 'error', error: 'recognizer'});
    // 듣기 시작과 실패에는 들은 말을 싣지 않는다.
    expect(readHostSpeech({state: 'listening', text: '스벅'})).toEqual({state: 'listening'});
    expect(readHostSpeech({state: 'error', error: 'timeout', text: '스벅'})).toEqual({state: 'error', error: 'timeout'});
  });
});
