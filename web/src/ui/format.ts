const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** "2026-11-12" → "2026년 11월 12일 목요일" */
export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${y}년 ${m}월 ${d}일 ${weekday}요일`;
}

/** "11월 12일 (목) 18:25" */
export function formatDateTime(at: number): string {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]}) ${hh}:${mm}`;
}

/** 출발지와 도착지를 한 줄로. 실제 차량에서는 둘 중 하나를 모를 수 있다. */
export function routeLabel(from: string, to: string): string {
  if (from && to) return `${from} → ${to}`;
  if (to) return `${to} 도착`;
  if (from) return `${from} 출발`;
  return '운행';
}

/** 만난 날부터 오늘까지 며칠째인지. 만난 날이 1일째. */
export function daysTogether(metAt: number, at: number): number {
  const start = new Date(metAt);
  start.setHours(0, 0, 0, 0);
  const today = new Date(at);
  today.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((today.getTime() - start.getTime()) / 86_400_000) + 1);
}

/** 사진을 긴 변 960px 이하의 JPEG 데이터 URL로 줄인다. */
export async function shrinkPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 960 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.8);
}
