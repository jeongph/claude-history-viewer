<div align="center">

<img src="assets/logo.svg" width="110" alt="Wake 로고 — 파도 마루의 뱃머리와 W를 그리는 한 획의 물결" />

# Wake

**한국어** · [English](./README.en.md)

**Trace the wake of your coding sessions.**

Claude Code와 Codex가 로컬에 남긴 대화의 항적을 따라 — 읽고, 이어가고, 분기하세요.

[![Release](https://img.shields.io/github/v/release/followingseas/wake?color=56B7C3&label=release)](https://github.com/followingseas/wake/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/followingseas/wake/total?color=1F7A93&label=downloads)](https://github.com/followingseas/wake/releases)
[![License](https://img.shields.io/badge/license-MIT-0B1F2A)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS-E8F6F2)](https://github.com/followingseas/wake/releases/latest)

<img src=".github/assets/hero.png" width="820" alt="Wake 대화 뷰어 화면" />

</div>

---

배가 지나간 자리에 남는 물살의 흔적을 wake(항적)라고 부릅니다. Claude Code와 Codex의 로컬 대화도 각각 `~/.claude`와 `~/.codex` 디렉토리에 항적을 남깁니다. **Wake는 그 흔적을 따라가는 데스크톱 뷰어입니다** — 지난 세션을 읽기 좋은 문서로 열람하고, 멈춘 지점에서 다시 이어가고, 새로운 항로로 분기(fork)할 수 있습니다.

모든 동작은 로컬 파일 시스템 안에서만 이루어집니다. 네트워크 요청은 업데이트 확인(GitHub Releases 조회)뿐이며, 대화 기록을 외부로 전송하지 않습니다.

## 주요 기능

- **📜 대화 열람** — 사용자 입력은 터미널 프롬프트 형태로, 응답은 마크다운(표·코드 하이라이트 포함)으로 조판해 표시합니다. 도구 호출·사고 과정·시스템 메시지는 접힌 상태로 정리되어 대화의 흐름을 방해하지 않습니다.
- **🔍 세션 탐색** — 프로젝트별로 정리된 세션 목록과 `⌘F` 필터. 세션 제목·첫 메시지·폴더 이름으로 목록을 좁힙니다.
- **🔦 대화 내용 검색** — 상단 검색창(`⌘K`)에서 모든 프로젝트의 대화 본문을 찾습니다. 기억나는 단어 하나로 어느 세션의 어느 메시지였는지 짚어내고, 선택하면 그 메시지로 바로 이동합니다.
- **⏩ 터미널에서 이어가기** — 세션의 작업 디렉토리에서 `claude --resume <id>` 또는 `codex resume <id>`를 실행해 대화를 이어갑니다.
- **🔱 Fork로 열기** — Claude의 `--fork-session` 또는 `codex fork <id>`로 원본을 보존한 채 새 세션으로 분기합니다.
- **🖥 터미널 선택** — 기본값은 OS 기본 터미널. 설정에서 iTerm2 등 감지된 터미널을 선택할 수 있습니다.
- **🗑 안전한 삭제** — Claude 세션 파일을 휴지통으로 이동합니다. Codex의 삭제·보관은 Codex에서 관리합니다.
- **🌐 다국어** — 한국어 · English (시스템 언어 자동 감지)

<div align="center">
<img src=".github/assets/settings.png" width="680" alt="Wake 설정 화면" />
</div>

## 설치

### 다운로드 (권장)

[**최신 릴리스 다운로드 →**](https://github.com/followingseas/wake/releases/latest)

`.dmg`를 마운트한 뒤 `Wake.app`을 Applications 폴더로 옮기면 설치가 끝납니다. 현재 macOS(Apple Silicon) 빌드를 제공합니다.

> 서명·공증되지 않은 빌드이므로 첫 실행 시 Gatekeeper 경고가 표시됩니다. 시스템 설정 → 개인정보 보호 및 보안에서 "그래도 열기"를 눌러 허용하십시오.

### 소스에서 실행

```bash
git clone https://github.com/followingseas/wake.git
cd wake
npm install
npm run dev
```

앱으로 빌드하려면:

```bash
npm run build:mac     # macOS (.dmg)
npm run build:win     # Windows (설치형 .exe)
npm run build:linux   # Linux (AppImage, deb)
```

| 요구 사항 | 내용 |
|------|------|
| OS | macOS · Windows · Linux |
| Node.js | 20 이상 (소스 실행/빌드 시) |
| CLI | 이어가기/Fork에 해당 세션의 `claude` 또는 `codex` 명령이 PATH에 있어야 함. 열람·검색은 CLI 없이 가능 |

> 뷰어 기능은 모든 OS에서 동작합니다. 터미널 연동은 macOS(Terminal.app, iTerm2)에서 검증되었으며, Windows(Windows Terminal, cmd, PowerShell)와 Linux(GNOME Terminal, Konsole 등)는 구현되어 있으나 검증 범위가 제한적입니다. 문제가 있다면 이슈로 알려주십시오.

## 사용법

> 단축키의 `⌘` 는 Windows·Linux에서 `Ctrl` 입니다. 앱 화면에도 플랫폼에 맞는 표기가 나옵니다.

| 동작 | 방법 |
|------|------|
| 세션 열람 | 사이드바에서 프로젝트 펼침 → 세션 클릭 |
| 상세 펼치기 | 본문의 도구 호출(`▸ Bash …`)·`사고 과정` 줄 클릭 |
| 이어가기 / Fork | 상단 **터미널에서 이어가기** / **Fork로 열기** 버튼 |
| 세션 목록 좁히기 | `⌘F` — 세션 제목·첫 메시지·폴더 이름 대상 |
| 대화 내용 검색 | `⌘K` — 상단 검색창. 모든 세션의 대화 본문 대상, `↑↓` 이동 · `↵` 열기 |
| 설정 | `⌘,` 또는 사이드바 ⚙ — 언어·터미널·글자 크기·업데이트 |
| Claude 세션 삭제 | **삭제** 버튼 → 확인 후 휴지통 이동 |

## 데이터 처리 방식

- Claude 읽기 대상: `~/.claude/projects/<프로젝트>/<sessionId>.jsonl`
- Codex 읽기 대상: `$CODEX_HOME/sessions/**/*.jsonl` (`CODEX_HOME`이 없으면 `~/.codex`). 날짜 폴더가 아닌 세션 시작 작업 경로로 프로젝트를 묶습니다.
- 같은 저장소의 Claude·Codex 세션은 함께 표시하며, 세션마다 제공자 배지를 표시합니다.
- 대화 열람은 전 과정이 읽기 전용입니다. 원본 파일을 수정하지 않습니다.
- 원본 파일에 가하는 유일한 쓰기 동작은 사용자가 명시적으로 요청한 Claude 세션 삭제이며, 파일을 휴지통으로 옮기는 방식입니다. Codex 기록·상태 DB는 수정하지 않습니다.
- 설정은 OS 표준 앱 데이터 경로(`userData/settings.json`)에 저장됩니다.
- 대화 내용 검색용 색인은 `userData/search-index.jsonl`에 저장됩니다. 사용자 발화와 응답 텍스트만 담고 도구 입출력은 담지 않으며, 기기 밖으로 나가지 않습니다. 파일을 지우면 다음 실행 때 다시 만들어집니다.

## 알려진 제한

- Claude Code·Codex JSONL은 내부 저장 포맷입니다. CLI 버전에 따라 표시가 달라질 수 있으며, 파서는 알 수 없는 항목과 손상된 줄을 건너뜁니다. Codex 파서는 로컬 `codex-cli 0.153.4` 기록과 합성 테스트 데이터로 검증했습니다.
- Codex의 로컬 `sessions` 기록만 읽습니다. 보관된 세션(`archived_sessions`), 클라우드에만 있는 대화, 앱별 별도 저장소는 자동으로 가져오지 않습니다.
- Codex 제목은 첫 사용자 질문으로 표시합니다. DB에만 저장된 이름·고정 상태는 반영하지 않습니다. 암호화된 사고 과정은 복원하지 않고 기록된 공개 요약만 표시합니다.
- Codex 서브에이전트·exec 세션은 자동 생성 필터에 따르며, 부모·자식 관계는 표시하지 않습니다.
- 설계 근거·공식 문서·검증 범위는 [세션 제공자 설계](docs/architecture/session-providers.md)를 참조하십시오.
- Claude 서브에이전트(sidechain) 대화는 현재 개수만 표시하고 본문은 렌더링하지 않습니다.

## 개발

```bash
npm run dev        # HMR 개발 모드
npm run typecheck  # 타입 검사
npm run lint       # ESLint
npm run build      # 타입 검사 + 프로덕션 빌드
```

기술 스택: Electron · electron-vite · React · TypeScript · react-markdown

기여 절차와 커밋 규칙은 [기여 안내](https://github.com/followingseas/.github/blob/main/CONTRIBUTING.md)를 참조하십시오. 커밋 형식은 commitlint가 자동으로 검사합니다.

## 라이선스

[MIT](LICENSE) © [followingseas](https://github.com/followingseas)
