# 감자 작전본부

현대자동차 Pleos 앱 공모전용 감성형 차량 앱. 웹앱은 `web/`에 있다.

- 용어는 `GLOSSARY.md`를 따른다. 코드와 화면 문구에서 같은 낱말을 쓴다.
- 스펙과 티켓: `docs/agents/issue-tracker.md` 참고 (`.scratch/gamja-hq/`).
- UI는 Astryx 규칙을 따른다: `web/.claude/CLAUDE.md`.
- `android/`는 웹앱을 WebView에 띄우고 Pleos SDK 이벤트를 차량 신호로 넘기는 앱이다. `android/README.md` 참고. 웹앱을 고치면 `web`에서 `npm run build`를 한 뒤 APK를 다시 빌드한다.
- `draft-sample/`은 팀원이 만든 Android APK 초안이다. 참고용이며 빌드에 쓰지 않는다.

## 명령 (`web/`에서)

- `npm run dev` 개발 서버
- `npm test` 코어 테스트
- `npm run typecheck` 타입 검사
- `npm run build` 프로덕션 빌드
