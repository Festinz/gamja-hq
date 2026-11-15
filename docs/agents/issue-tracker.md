# Issue tracker: Local Markdown

이 저장소의 스펙과 티켓은 `.scratch/` 아래 마크다운 파일로 둔다.

- 기능 하나에 폴더 하나: `.scratch/<feature-slug>/`
- 스펙: `.scratch/<feature-slug>/spec.md`
- 티켓: `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, `01`부터 의존 순서대로. 티켓 하나에 파일 하나.
- 상태는 파일 위쪽의 `Status:` 줄에 적는다 (`ready-for-agent`, `claimed`, `resolved`).
- 막는 티켓은 `Blocked by:` 줄에 번호로 적는다.
