/**
 * 교류 중계(ExchangeRelay)의 시뮬레이션 구현.
 *
 * 실제 서비스에서는 서버가 같은 정체 구간의 참여 차량을 익명으로 묶고 스티커를
 * 전달한다. 여기서는 가상 감자 부대를 만들어 같은 사건을 코어에 넣는다.
 * 실제 서버 구현은 같은 사건(squad-matched, sticker-received)을 보내면 된다.
 */
import {STICKERS, type HqEvent, type HqState, type StickerId} from '../core/hq';

type Emit = (event: HqEvent) => HqState;

const STICKER_IDS = Object.keys(STICKERS) as StickerId[];

export function createSimulatedRelay(emit: Emit, clock: () => number) {
  let timers: ReturnType<typeof setTimeout>[] = [];
  let pending: {sticker: StickerId; from: string}[] = [];

  const deliverNext = () => {
    const next = pending.shift();
    if (next) emit({type: 'sticker-received', at: clock(), ...next});
  };

  return {
    /** 정체 구간에 들어섰다. 부대를 묶고 스티커를 예약한다. */
    enterCongestion(state: HqState) {
      const operation = state.trip?.operation;
      if (!operation || operation.squadSize !== null) return;
      const squadSize = 3 + Math.floor(Math.random() * 7);
      const stickerCount = 1 + Math.floor(Math.random() * 3);
      const shuffled = [...STICKER_IDS].sort(() => Math.random() - 0.5);
      pending = shuffled.slice(0, stickerCount).map(sticker => ({
        sticker,
        from: `가상 감자 ${1 + Math.floor(Math.random() * squadSize)}호`,
      }));
      timers.push(
        setTimeout(
          () => emit({type: 'squad-matched', at: clock(), squadSize}),
          1200,
        ),
      );
      pending.forEach((_, i) => {
        timers.push(setTimeout(deliverNext, 4000 + i * 3000));
      });
    },
    /** 주차했다. 아직 전달하지 못한 스티커를 모두 전달한다. */
    park() {
      timers.forEach(clearTimeout);
      timers = [];
      while (pending.length > 0) deliverNext();
    },
    clear() {
      timers.forEach(clearTimeout);
      timers = [];
      pending = [];
    },
  };
}
