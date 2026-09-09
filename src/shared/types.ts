/** 세션을 만든 주체. 'agent'는 도구가 SDK로 띄운 헤드리스 세션이다. */
export type SessionOrigin = 'user' | 'agent'

export type SessionProvider = 'claude' | 'codex'

/**
 * 저장소 루트가 아닌 프로젝트가 루트와 맺는 관계.
 * - worktree: 도구가 만든 워크트리 자리. 살아 있으면 .git 으로, 지워졌으면 경로 모양으로 판정한다
 * - subdir: 저장소 안의 하위 폴더
 */
export interface RepoSub {
  kind: 'worktree' | 'subdir'
  /**
   * 사이드바에 보일 이름. subdir 는 루트 기준 상대 경로, worktree 는 워크트리명이고
   * 워크트리 안의 하위 폴더면 뒤에 워크트리 기준 상대 경로가 붙는다
   */
  name: string
}

/**
 * 프로젝트가 속한 저장소. sub 가 null 이면 프로젝트 자신이 저장소 루트(또는 저장소 밖의 독립 폴더)다.
 * rootPath 는 심볼릭 링크를 푼 경로라 같은 저장소면 어디로 들어왔든 같은 문자열이다.
 */
export type RepoInfo =
  | {
      /** 저장소 루트 절대 경로. realPath 가 없으면 null */
      rootPath: string | null
      sub: null
    }
  | {
      /** 저장소 루트(메인 워크트리) 절대 경로. realPath 가 없어 디렉터리명으로만 추정했으면 null */
      rootPath: string | null
      /** 저장소 루트의 프로젝트 디렉터리명. rootPath 없이 루트를 찾는 폴백 키라 모르면 null */
      rootDirName: string | null
      sub: RepoSub
    }

export interface ProjectInfo {
  id: string
  dirName: string
  dirPath: string
  realPath: string | null
  name: string
  sessionCount: number
  /** 자동 생성(agent) 세션을 뺀 개수. 목록 필터가 꺼져 있을 때 배지에 쓴다 */
  userSessionCount: number
  lastActiveAt: number
  repo: RepoInfo
}

export interface SessionMeta {
  provider: SessionProvider
  id: string
  projectId: string
  filePath: string
  title: string
  firstPrompt: string | null
  messageCount: number
  createdAt: number | null
  updatedAt: number
  gitBranch: string | null
  cwd: string | null
  fileSize: number
  origin: SessionOrigin
}

export type AssistantBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | {
      type: 'toolCall'
      id: string
      name: string
      input: unknown
      result: string | null
      isError: boolean
    }

export interface UserImage {
  mediaType: string
  data: string
}

export interface UserMetaInfo {
  /**
   * 'command'(슬래시 커맨드)·'injected'(주입 컨텍스트)는 label에 내용이 들어가고,
   * 나머지는 kind 기반 번역 라벨을 쓴다.
   * - bashRun: ! 셸 명령 실행. label = 명령어, detail = 출력(뒤따르는 bashOutput 엔트리를 병합)
   * - bashOutput: 짝이 되는 bashRun 없이 단독으로 남은 셸 출력
   * - task: 백그라운드 작업 알림. label = summary
   * - interrupt: 사용자가 Esc로 중단. label = 'tool-use'면 도구 실행 중단
   * - compact: 컨텍스트 요약으로 이어진 세션 경계. detail = 이월된 요약 전문
   */
  kind:
    | 'command'
    | 'output'
    | 'context'
    | 'injected'
    | 'bashRun'
    | 'bashOutput'
    | 'task'
    | 'interrupt'
    | 'compact'
  label: string | null
  detail: string | null
}

export type ConversationItem =
  | {
      kind: 'user'
      uuid: string
      timestamp: string | null
      text: string
      images: UserImage[]
      meta: UserMetaInfo | null
    }
  | {
      kind: 'assistant'
      uuid: string
      timestamp: string | null
      blocks: AssistantBlock[]
    }

export interface Conversation {
  sessionId: string
  items: ConversationItem[]
  sidechainCount: number
  hiddenCount: number
}

export interface ActionResult {
  ok: boolean
  error?: string
}

export interface TerminalOption {
  id: string
  label: string
}

export interface AppSettings {
  /** 'auto'면 OS 기본 터미널을 사용한다 */
  terminal: string
  /** 'auto'면 시스템 언어를 따른다 */
  language: 'auto' | 'ko' | 'en'
  fontScale: 'small' | 'normal' | 'large'
  expandThinking: boolean
  showMeta: boolean
  /** 도구가 SDK로 띄운 자동 세션을 목록에 표시할지. 기본은 숨김 */
  showAgentSessions: boolean
  checkUpdatesOnLaunch: boolean
}

export interface SettingsInfo {
  settings: AppSettings
  terminals: TerminalOption[]
}

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string | null
  hasUpdate: boolean
  url: string
  /** true면 앱 안에서 받아 설치한다(다운로드 시작은 사용자 승인). false면 릴리스 페이지로 안내한다 */
  auto: boolean
}

export type UpdateEvent =
  /** 새 버전을 찾았다. 다운로드는 사용자가 승인해야 시작한다 */
  | { type: 'available'; version: string }
  | { type: 'downloading'; version: string; percent: number }
  | { type: 'ready'; version: string }
  | { type: 'error'; message: string }

export interface SearchSnippet {
  /** 매칭된 ConversationItem의 uuid */
  ref: string
  role: 'user' | 'assistant'
  /** 매칭 앞 문맥 — 잘렸으면 앞에 말줄임표가 붙는다 */
  before: string
  /** 원문 대소문자를 보존한 매칭 부분 */
  match: string
  /** 매칭 뒤 문맥 — 잘렸으면 뒤에 말줄임표가 붙는다 */
  after: string
}

export interface SearchHit {
  provider: SessionProvider
  sessionId: string
  projectId: string
  filePath: string
  title: string
  updatedAt: number
  /** 세션 전체 매칭 수 — snippets 길이보다 클 수 있다 */
  matchCount: number
  snippets: SearchSnippet[]
}

export interface SearchResults {
  query: string
  hits: SearchHit[]
  /** 세션 수 상한에 걸려 잘렸으면 true */
  truncated: boolean
  /** 최초 인덱스 구축 중이라 부분 결과면 true */
  indexing: boolean
  /** 인덱싱이 실패해 인덱스가 불완전하다 — hits가 비어도 "그런 대화 없음"으로 읽으면 안 된다 */
  degraded: boolean
}

export interface SearchProgress {
  /** 처리한 프로젝트 수 */
  done: number
  /** 전체 프로젝트 수 — 집계 전이면 0 */
  total: number
  /** 최초 인덱스 구축이 끝났으면 true */
  ready: boolean
  /**
   * 인덱스 내용이 바뀔 때마다 증가한다. 검색은 정합을 기다리지 않고 낡았을 수 있는
   * 인덱스로 즉시 답하므로, 렌더러는 이 값이 올랐을 때만 자기 결과가 낡았음을 안다.
   * ready는 최초 1회만 뒤집혀 이 역할을 못 한다.
   */
  revision: number
  /** 인덱싱이 실패했으면 true */
  failed: boolean
}

export interface SessionHistoryApi {
  listProjects: () => Promise<ProjectInfo[]>
  listSessions: (projectId: string) => Promise<SessionMeta[]>
  loadConversation: (filePath: string) => Promise<Conversation>
  searchSessions: (query: string) => Promise<SearchResults>
  resumeSession: (
    sessionId: string,
    cwd: string | null,
    provider: SessionProvider
  ) => Promise<ActionResult>
  forkSession: (
    sessionId: string,
    cwd: string | null,
    provider: SessionProvider
  ) => Promise<ActionResult>
  deleteSession: (filePath: string) => Promise<ActionResult>
  revealSession: (filePath: string) => Promise<ActionResult>
  openExternal: (url: string) => Promise<void>
  getSettings: () => Promise<SettingsInfo>
  saveSettings: (settings: Partial<AppSettings>) => Promise<SettingsInfo>
  checkForUpdate: (force?: boolean) => Promise<UpdateInfo>
  onUpdateEvent: (callback: (event: UpdateEvent) => void) => () => void
  onOpenSettings: (callback: () => void) => () => void
  onSearchProgress: (callback: (progress: SearchProgress) => void) => () => void
  showSessionMenu: (labels: {
    reveal: string
    delete: string
    canDelete: boolean
  }) => Promise<'reveal' | 'delete' | null>
  /** 승인만 전달한다 — 완료가 아니라 시작이다. 진행·완료·실패는 update:event 로 온다 */
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
}
