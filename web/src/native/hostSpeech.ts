/**
 * 네이티브 호스트가 SpeechToText SDK로 들은 것 ({type: 'stt'} 메시지).
 * android/…/ListenFlow.kt 의 Message 와 WebBridge.kt 의 sendStt 와 짝을 이룬다. 순수 모듈이다.
 *
 *     {"type":"stt","state":"listening"}                                        마이크가 열렸다
 *     {"type":"stt","state":"partial","text":"스타벅스 그란"}                     중간 결과
 *     {"type":"stt","state":"final","text":"스타벅스 그란데 아이스"}               다 들은 말
 *     {"type":"stt","state":"error","error":"recognizer","detail":"MIC_ERROR"}   실패
 *
 * 받아들인 listen() 하나는 final 이나 error 하나로 끝난다. 웹은 listen() 을 부른 뒤 끝날 때까지
 * 감자에게 보통 말을 시키지 않는다(sim/voice.ts holdSpeech). 감자 목소리가 마이크에 들어가기 때문이다.
 */

export const HOST_SPEECH_STATES = ['listening', 'partial', 'final', 'error'] as const;
export type HostSpeechState = (typeof HOST_SPEECH_STATES)[number];

/**
 * 듣지 못한 까닭. ListenFlow.kt 의 상수와 같다.
 * - not-parked: 기어가 P 가 아니거나 아직 모른다. 듣는 중에 P 를 벗어났을 때도 (출발 신호보다 먼저 온다).
 * - unavailable: SDK·권한이 없거나 마이크를 열지 못했다 (SDK 의 PERMISSION_DENIED, NOT_SUPPORTED_API 포함).
 * - timeout: 마이크를 연 뒤 8초 안에 알아들은 말이 없다 (SDK 의 TIMEOUT 포함).
 * - no-speech: 인식이 끝났는데 알아들은 말이 없다.
 * - cancelled: 웹이 stopListening() 으로 그만두게 했다.
 * - paused: 앱 화면이 가려져(내비 전체 화면, 다른 앱) 듣기를 멈췄거나, 가려진 동안 듣기를 청했다. 들은 말은 버린다.
 * - recognizer: 그 밖의 SDK 오류. detail 에 SDK 의 ErrorType 이름이 있다.
 */
export const HOST_SPEECH_ERRORS = [
  'not-parked',
  'unavailable',
  'timeout',
  'no-speech',
  'cancelled',
  'paused',
  'recognizer',
] as const;
export type HostSpeechError = (typeof HOST_SPEECH_ERRORS)[number];

export interface HostSpeech {
  state: HostSpeechState;
  /** 들은 말 (partial, final). 네이티브가 앞뒤 빈칸을 뺐다. */
  text?: string;
  /** 실패의 까닭 (error). */
  error?: HostSpeechError;
  /** SDK 가 알린 오류의 이름 (ErrorType, 예: "MIC_ERROR", "NETWORK_ERROR"). 들은 말은 들어 있지 않다. */
  detail?: string;
}

/**
 * 네이티브가 보낸 {type: 'stt'} 메시지를 읽는다. state 가 맞지 않으면 null.
 * 모르는 오류 이름은 recognizer 로 보고, 그 이름은 detail 에 남긴다 (새 APK 가 새 이름을 보내도 실패로 끝난다).
 */
export function readHostSpeech(message: Record<string, unknown>): HostSpeech | null {
  const state = HOST_SPEECH_STATES.find(s => s === message.state);
  if (!state) return null;
  const speech: HostSpeech = {state};
  if ((state === 'partial' || state === 'final') && typeof message.text === 'string') speech.text = message.text;
  if (state === 'error') {
    const known = HOST_SPEECH_ERRORS.find(e => e === message.error);
    speech.error = known ?? 'recognizer';
    const detail =
      typeof message.detail === 'string' && message.detail.trim() !== ''
        ? message.detail.trim()
        : !known && typeof message.error === 'string' && message.error.trim() !== ''
          ? message.error.trim()
          : null;
    if (detail !== null) speech.detail = detail;
  }
  return speech;
}
