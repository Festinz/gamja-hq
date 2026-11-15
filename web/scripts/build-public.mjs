/**
 * 공개용 빌드. 저장소의 apk/ 에 넣을 APK 는 이 빌드로 만든다.
 *
 * Vite 는 VITE_ 로 시작하는 값을 웹앱 묶음에 그대로 넣는다. web/.env.local 의 API 키(…KEY)가
 * 공개 저장소의 APK 에 들어가지 않도록, 키 이름을 찾아 빈 값으로 덮은 채 빌드한다.
 * Vite 는 이미 있는 환경 변수를 .env 파일보다 먼저 쓴다.
 *
 * 키가 비면 앱은 키가 필요 없는 길로 돈다 (경로는 OpenStreetMap 의 OSRM).
 */
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const envFile = new URL('../.env.local', import.meta.url);
const blanked = [];
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const name = /^\s*(VITE_\w*KEY\w*)\s*=/.exec(line)?.[1];
    if (name) {
      process.env[name] = '';
      blanked.push(name);
    }
  }
}
console.log(blanked.length ? `빈 값으로 빌드하는 키: ${blanked.join(', ')}` : '.env.local 에 키가 없습니다.');
await build({root});
