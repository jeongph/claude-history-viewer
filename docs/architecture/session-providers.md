# Claude Code·Codex 세션 지원

## Why

Wake는 CLI를 실행하지 않고도 로컬 대화를 읽고 검색하는 뷰어다. 공급자마다 다른
저장 구조를 화면과 검색에 노출하면 새 공급자를 붙일 때마다 모든 계층을 고쳐야 한다.
`src/main/lib/sessions.ts`를 공통 진입점으로 두고 공급자별 파서를 공통
`Conversation`으로 변환한다. 원본 세션 ID는 CLI에 그대로 전달하고, UI 선택·검색의
파일 식별에는 `filePath`를 사용해 공급자 사이의 ID 충돌을 피한다.

## 공식 문서에 따른 선택

2026-09-09에 확인한 OpenAI 공식 문서:

- [CLI 명령](https://learn.chatgpt.com/docs/developer-commands?surface=cli):
  재개는 `codex resume <SESSION_ID>`, 분기는 `codex fork <SESSION_ID>`를 사용한다.
  사용자가 지정한 작업 경로에서 실행하며 승인·샌드박스 옵션을 덮어쓰지 않는다.
- [App Server](https://learn.chatgpt.com/docs/app-server): `thread/list`와
  `thread/read`는 저장된 대화의 공식 조회 인터페이스다. `thread/read`의
  `includeTurns: true`로 재개 없이 대화를 읽을 수 있다.
  향후 앱의 제목·고정·보관 상태까지 동기화할 때 사용할 후보로 남긴다.
- CLI의 `codex delete`는 영구 삭제이며 App Server는 SQLite 메타데이터도 관리한다.
  Wake의 복구 가능한 휴지통 삭제와 의미가 다르므로 Codex에는 삭제 버튼을
  비활성화하고 IPC에서도 거부한다. 삭제·보관은 Codex에서 수행한다.

이번 구현은 CLI 프로세스·로그인 없이 읽는 기존 사용성을 유지하기 위해 JSONL을
직접 읽는다. **공식 App Server 응답 스키마와 내부 rollout JSONL 스키마는 다르다.**
공식 문서가 rollout의 안정성을 보장한다고 가정하지 않는다. 내부 포맷의 확인 근거는
로컬 `codex-cli 0.153.4` 기록이며, 실제 사용자 대화는 테스트 fixture에 복사하지 않는다.

## 구현 경계

| 영역           | 위치·동작                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------- |
| 공통 진입점    | `sessions.ts`: 프로젝트·세션 목록, 색인용 목록, 대화 로드                                          |
| Claude         | 기존 `scanner.ts`·`parser.ts` 유지. `CHV_DATA_DIR` 개발용 재정의 지원                              |
| Codex 탐색     | `codexScanner.ts`: `$CODEX_HOME/sessions/**/*.jsonl`, 기본 `~/.codex`                              |
| Codex 프로젝트 | `session_meta.cwd`의 해시를 프로젝트 ID로 사용. 마지막 `turn_context.cwd`는 재개 경로              |
| Codex 본문     | `codexParser.ts`: `response_item` 기준, 해당 턴·역할의 본문이 없을 때 이전 `event_msg` 메시지 보충 |
| 도구           | function/custom 호출과 출력을 `call_id`로 연결. 비 JSON 문자열 입력도 보존                         |
| 검색           | 정규화된 대화에서 사용자 질문·응답만 추출. UI와 같은 ref 사용. 인덱스 v2로 재구축                  |
| 경로           | `sessionPaths.ts`: JSONL·실제 파일·허용 루트 검사. 루트 밖 심볼릭 링크 거부                        |

날짜 폴더는 저장소 소속을 나타내지 않으므로 프로젝트로 취급하지 않는다. 같은 Git
저장소의 Claude·Codex 프로젝트는 기존 저장소 그룹 로직으로 합친다. 알 수 없는
source는 사용자 세션으로 남기고, `exec`·`subagent`는 자동 생성 세션으로 분류한다.

## 지원 범위와 제한

- 로컬 활성 rollout의 질문·응답·공개 reasoning 요약·function/custom 도구·중단·압축 경계.
- base64 PNG/JPEG/GIF/WebP 사용자 이미지. 외부 URL이나 로컬 이미지 경로는 자동으로 읽지 않는다.
- 보관 디렉터리·클라우드 전용 대화·앱별 별도 저장소는 탐색하지 않는다.
- 제목은 첫 실제 사용자 질문이다. DB에만 저장된 사용자 지정 제목·고정 상태는 읽지 않는다.
- 암호화된 reasoning은 복원하지 않는다. 서브에이전트 부모·자식 관계는 표시하지 않는다.
- 알 수 없는 이벤트와 손상된 JSONL 줄은 건너뛴다. 최신 내부 이벤트를 모두 재현하는
  Codex UI와의 완전한 동등성을 보장하지 않는다.
- macOS/Linux 재개 명령에는 읽기에 사용한 `CODEX_HOME`을 명시한다. Windows는
  실행한 자식 프로세스의 환경 상속을 사용한다. Windows·Linux 실터미널 검증은 별도다.

## 검증

```sh
npm ci
npm test
npm run lint
npm run build
```

`codex.test.ts`는 합성 데이터로 중복 제거, 공개 요약, 도구 연결, 이미지·압축·중단,
캐시 갱신, Codex만 설치된 환경, 두 공급자의 동일 ID, 검색 ref와 경로 검증을 확인한다.
`actions.test.ts`는 실제 CLI를 실행하지 않고 재개·분기 명령, 셸 인자와 Codex 삭제
거부를 확인한다. 사용자 세션을 재개·분기·삭제하는 동작은 자동 테스트로 실행하지 않는다.
