import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement
} from 'react'
import type {
  AppSettings,
  Conversation,
  ProjectInfo,
  SearchHit,
  SearchProgress,
  SearchResults,
  SessionMeta,
  UpdateInfo
} from '../../shared/types'

import { makeTranslate, resolveLanguage } from './i18n'
import { DEFAULT_SETTINGS, PrefsContext, type Prefs } from './prefs'
import { buildGroups, type SubGroup } from './lib/groups'
import { isDownloadFailure, nextBanner, type UpdateBannerState } from './lib/updateBanner'
import { shortcut } from './lib/platform'
import { Sidebar } from './components/Sidebar'
import { ConversationView } from './components/ConversationView'
import { SearchPalette } from './components/SearchPalette'
import { TopBar } from './components/TopBar'
import { ConfirmDialog } from './components/ConfirmDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { WakeMark } from './components/WakeMark'

export default function App(): ReactElement {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [sessions, setSessions] = useState<Record<string, SessionMeta[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<SessionMeta | null>(null)
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [loadingConversation, setLoadingConversation] = useState(false)
  const [query, setQuery] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<SessionMeta | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [update, setUpdate] = useState<UpdateBannerState | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null)
  const [searchProgress, setSearchProgress] = useState<SearchProgress | null>(null)
  const [searchFailed, setSearchFailed] = useState(false)
  const [highlightRef, setHighlightRef] = useState<string | null>(null)
  const searchRequestRef = useRef(0)
  const selectRequestRef = useRef(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const loadedProjects = useRef<Set<string>>(new Set())
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('wake:sidebarWidth'))
    return Number.isFinite(saved) && saved >= 220 && saved <= 560 ? saved : 300
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    () => localStorage.getItem('wake:sidebarCollapsed') === '1'
  )

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      localStorage.setItem('wake:sidebarCollapsed', prev ? '0' : '1')
      return !prev
    })
  }, [])

  const startSidebarResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    const clamp = (x: number): number => Math.min(560, Math.max(220, x))
    const onMove = (e: MouseEvent): void => setSidebarWidth(clamp(e.clientX))
    const onUp = (e: MouseEvent): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('is-resizing')
      localStorage.setItem('wake:sidebarWidth', String(clamp(e.clientX)))
    }
    document.body.classList.add('is-resizing')
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const lang = resolveLanguage(settings.language)
  const t = useMemo(() => makeTranslate(lang), [lang])

  const updateSettings = useCallback(async (partial: Partial<AppSettings>) => {
    const info = await window.api.saveSettings(partial)
    setSettings(info.settings)
  }, [])

  const prefs = useMemo<Prefs>(
    () => ({ settings, lang, t, updateSettings }),
    [settings, lang, t, updateSettings]
  )

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 2600)
  }, [])

  // 언어가 바뀌어도 loadSessions 가 새로 만들어지지 않게 한다. 시작 효과가 이 함수에 묶여 있어
  // 함수가 바뀌면 프로젝트를 처음부터 다시 읽는다
  const translateRef = useRef(t)
  useEffect(() => {
    translateRef.current = t
  }, [t])

  // 이벤트 콜백이 직전 배너를 봐야 하는데, 실패 토스트 판단이 걸려 있어 setUpdate(prev=>…) 안에
  // 넣을 수 없다(StrictMode 에서 updater 는 순수해야 한다). 시작 효과에 update 를 묶을 수도 없어
  // ref 로 읽는다. 이펙트로 미러링하면 연달아 오는 이벤트가 낡은 값을 보므로 여기서 함께 쓴다
  const updateRef = useRef<UpdateBannerState | null>(null)
  const applyUpdate = useCallback((next: UpdateBannerState | null) => {
    updateRef.current = next
    setUpdate(next)
  }, [])

  const loadSessions = useCallback(
    async (projectId: string) => {
      if (loadedProjects.current.has(projectId)) return
      loadedProjects.current.add(projectId)
      let metas: SessionMeta[]
      try {
        metas = await window.api.listSessions(projectId)
      } catch (error) {
        // 그냥 놓치면 스피너가 영원히 돌고 다시 시도할 길도 없다. 표시를 지워 다음 펼침에서 재시도하게 한다
        loadedProjects.current.delete(projectId)
        console.error('[sidebar] 세션 목록 조회 실패', projectId, error)
        showToast(translateRef.current('sidebar.loadFailed'))
        return
      }
      setSessions((prev) => ({ ...prev, [projectId]: metas }))
      // 시작 시 카운트는 파일 수 휴리스틱이라 실제 목록으로 보정한다.
      // 상태에서 지우지는 않는다 — 빈 그룹을 숨기는 일은 buildGroups가 맡고,
      // 그래야 표시 토글을 되돌렸을 때 프로젝트가 다시 나타난다.
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? {
                ...p,
                sessionCount: metas.length,
                userSessionCount: metas.filter((m) => m.origin === 'user').length
              }
            : p
        )
      )
    },
    [showToast]
  )

  useEffect(() => {
    // 새 버전 확인·진행·완료·실패가 전부 이 이벤트로 온다. 전이는 nextBanner 가 맡는다
    const unsubscribe = window.api.onUpdateEvent((event) => {
      const prev = updateRef.current
      const next = nextBanner(prev, event)
      // 승인하고 기다리던 다운로드가 끊긴 것은 조용히 넘기지 않는다
      if (isDownloadFailure(prev, next)) showToast(translateRef.current('update.failed'))
      applyUpdate(next)
    })
    // 첫 그룹 자동 펼침이 설정에 좌우되므로 설정을 먼저 받고 프로젝트를 읽는다
    window.api.getSettings().then((info) => {
      setSettings(info.settings)
      if (info.settings.checkUpdatesOnLaunch) {
        window.api.checkForUpdate().then((updateInfo: UpdateInfo) => {
          // auto 모드는 이벤트가 배너를 그리므로 링크 배너는 legacy(dev) 경로에서만 띄운다
          if (updateInfo.hasUpdate && !updateInfo.auto && updateInfo.latestVersion) {
            applyUpdate({ mode: 'link', version: updateInfo.latestVersion, url: updateInfo.url })
          }
        })
      }
      window.api
        .listProjects()
        .then((list) => {
          setProjects(list)
          // 최상위는 그룹 단위이므로 첫 그룹을 펼치고 그 루트 프로젝트들의 세션을 읽는다
          const first = buildGroups(list, info.settings.showAgentSessions)[0]
          if (first) {
            setExpanded(new Set([first.id]))
            first.roots.forEach((root) => loadSessions(root.id))
          }
        })
        // 조용히 죽으면 "세션 없음" 안내가 떠서 읽기 실패와 구분이 안 된다
        .catch((error) => console.error('[startup] 프로젝트 목록 조회 실패', error))
    })
    return unsubscribe
  }, [applyUpdate, loadSessions, showToast])

  // 애플리케이션 메뉴(wake > 설정…)에서 설정 열기
  useEffect(() => window.api.onOpenSettings(() => setShowSettings(true)), [])

  useEffect(() => window.api.onSearchProgress(setSearchProgress), [])

  // 인덱스가 갱신되면(revision) 같은 질의를 자동으로 다시 돌린다
  useEffect(() => {
    // 질의가 비거나 팔레트를 닫아도 번호를 올린다 — 그래야 이미 떠난 요청의 응답이
    // 뒤늦게 돌아와 상태를 덮어쓰지 않는다
    const requestId = ++searchRequestRef.current
    if (!searchOpen) return undefined
    const trimmed = searchQuery.trim()
    if (!trimmed) return undefined
    const timer = window.setTimeout(() => {
      // 다시 시도하는 동안에는 이전 실패 표시를 걷는다
      setSearchFailed(false)
      window.api
        .searchSessions(trimmed)
        .then((results) => {
          // 늦게 도착한 이전 질의의 응답은 버린다
          if (requestId !== searchRequestRef.current) return
          setSearchFailed(false)
          setSearchResults(results)
        })
        .catch((error) => {
          if (requestId !== searchRequestRef.current) return
          console.error('[search] 질의 실패', error)
          // 이전 질의의 결과를 남겨두면 새 질의의 결과처럼 읽힌다
          setSearchResults(null)
          setSearchFailed(true)
        })
    }, 200)
    return () => window.clearTimeout(timer)
  }, [searchOpen, searchQuery, searchProgress?.ready, searchProgress?.revision])

  // 강조는 대화가 실제로 그려진 뒤부터 재는데, 로딩이 길어도 표시를 놓치지 않기 위해서다
  useEffect(() => {
    if (!highlightRef || !conversation) return undefined
    const timer = window.setTimeout(() => setHighlightRef(null), 3000)
    return () => window.clearTimeout(timer)
  }, [highlightRef, conversation])

  // 검색 시 아직 안 읽은 프로젝트의 세션 메타를 모두 로드한다
  useEffect(() => {
    if (!query.trim()) return
    for (const project of projects) loadSessions(project.id)
  }, [query, projects, loadSessions])

  const openContentSearch = useCallback(() => {
    setSearchOpen(true)
    // 사이드바에 입력해 둔 질의가 있으면 그대로 이어받는다
    setSearchQuery((previous) => previous || query)
  }, [query])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        openContentSearch()
        return
      }
      // CapsLock이 켜져 있으면 ⌘F도 key가 'F'로 오므로 양쪽 다 정규화해서 비교한다
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchRef.current?.focus()
      }
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault()
        setShowSettings(true)
      }
      if (event.key === 'Escape') {
        setShowSettings(false)
        setDeleteTarget(null)
        setSearchOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openContentSearch])

  // key 는 그룹 id 이거나 하위 항목 id 다. 한 항목에 프로젝트가 여럿일 수 있어 읽을 대상을 따로 받는다
  const toggleExpanded = useCallback(
    (key: string, projectIds: string[]) => {
      const opening = !expanded.has(key)
      setExpanded((prev) => {
        const next = new Set(prev)
        if (opening) next.add(key)
        else next.delete(key)
        return next
      })
      // 상태 갱신 함수 안에서 부르면 React 가 갱신 함수를 두 번 돌릴 때 요청도 두 번 나간다
      if (opening) projectIds.forEach((projectId) => loadSessions(projectId))
    },
    [expanded, loadSessions]
  )

  const selectSession = useCallback(
    async (session: SessionMeta, highlight: string | null = null) => {
      // 두 세션을 빠르게 연달아 고르면 로드가 역순으로 끝날 수 있다. 그때 늦게 온
      // 대화가 헤더와 다른 세션의 본문을 그리지 않도록 마지막 선택만 반영한다
      const requestId = ++selectRequestRef.current
      setSelected(session)
      setConversation(null)
      setHighlightRef(highlight)
      setLoadingConversation(true)
      try {
        const loaded = await window.api.loadConversation(session.filePath)
        if (requestId !== selectRequestRef.current) return
        setConversation(loaded)
      } catch (error) {
        if (requestId !== selectRequestRef.current) return
        // 실패하면 헤더만 남은 빈 패널이 되므로, 왜 비었는지는 알려줘야 한다
        console.error('[conversation] 로드 실패', error)
        showToast(t('toast.loadFailed'))
      } finally {
        if (requestId === selectRequestRef.current) setLoadingConversation(false)
      }
    },
    [showToast, t]
  )

  const openSessionMenu = useCallback(
    async (session: SessionMeta) => {
      const choice = await window.api.showSessionMenu({
        reveal: t('menu.reveal'),
        delete: t('menu.delete'),
        canDelete: session.provider === 'claude'
      })
      if (choice === 'reveal') window.api.revealSession(session.filePath)
      else if (choice === 'delete' && session.provider === 'claude') setDeleteTarget(session)
    },
    [t]
  )

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selected?.projectId) ?? null,
    [projects, selected]
  )

  const groups = useMemo(
    () => buildGroups(projects, settings.showAgentSessions),
    [projects, settings.showAgentSessions]
  )

  const projectLabel = useCallback(
    (projectId: string) => {
      const project = projects.find((candidate) => candidate.id === projectId)
      if (!project) return projectId
      const sub = project.repo.sub
      const group = groups.find((candidate) =>
        candidate.subs.some((slot) => slot.projects.some((p) => p.id === projectId))
      )
      // 워크트리·하위 폴더 세션은 어느 저장소의 어디인지 같이 보여야 구분이 된다
      if (!sub || !group) return project.name
      return sub.kind === 'worktree' ? `${group.name} ⎇ ${sub.name}` : `${group.name}/${sub.name}`
    },
    [groups, projects]
  )

  const openHit = useCallback(
    async (hit: SearchHit, ref: string) => {
      // 사이드바 목록은 프로젝트당 한 번만 읽어 두므로, 그 뒤 생긴 세션은 검색에만 잡힌다
      let session = sessions[hit.projectId]?.find((meta) => meta.filePath === hit.filePath)
      if (!session) {
        let metas: SessionMeta[]
        try {
          metas = await window.api.listSessions(hit.projectId)
        } catch (error) {
          // 여기서 그냥 던지면 클릭이 아무 반응 없이 죽는다
          console.error('[search] 세션 목록 조회 실패', error)
          showToast(t('search.openFailed'))
          return
        }
        loadedProjects.current.add(hit.projectId)
        setSessions((previous) => ({ ...previous, [hit.projectId]: metas }))
        session = metas.find((meta) => meta.filePath === hit.filePath)
      }
      if (!session) {
        showToast(t('search.missing'))
        return
      }
      // 검색으로 연 세션은 그 그룹까지 펼쳐야 사이드바에서 선택 상태가 보인다. 하위 항목이면 그 항목도 펼친다
      const inSlot = (slot: SubGroup): boolean =>
        slot.projects.some((project) => project.id === hit.projectId)
      const group = groups.find(
        (candidate) =>
          candidate.roots.some((root) => root.id === hit.projectId) || candidate.subs.some(inSlot)
      )
      const slot = group?.subs.find(inSlot)
      setExpanded((previous) => {
        const next = new Set(previous)
        if (group) next.add(group.id)
        if (slot) next.add(slot.id)
        return next
      })
      // 한 항목에 프로젝트가 여럿이면 나머지 프로젝트의 세션도 읽어야 목록이 온전하다
      for (const project of slot?.projects ?? group?.roots ?? []) loadSessions(project.id)
      setSearchOpen(false)
      await selectSession(session, ref || null)
    },
    [groups, loadSessions, selectSession, sessions, showToast, t]
  )

  const runAction = useCallback(
    async (kind: 'resume' | 'fork') => {
      if (!selected) return
      const cwd = selected.cwd ?? selectedProject?.realPath ?? null
      const action = kind === 'resume' ? window.api.resumeSession : window.api.forkSession
      const result = await action(selected.id, cwd, selected.provider)
      if (result.ok) {
        showToast(kind === 'resume' ? t('toast.resume') : t('toast.fork'))
      } else {
        showToast(t('toast.actionFailed', { error: result.error ?? t('toast.unknownError') }))
      }
    },
    [selected, selectedProject, showToast, t]
  )

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    const result = await window.api.deleteSession(target.filePath)
    if (!result.ok) {
      showToast(t('toast.deleteFailed', { error: result.error ?? t('toast.unknownError') }))
      return
    }
    loadedProjects.current.delete(target.projectId)
    const metas = await window.api.listSessions(target.projectId)
    loadedProjects.current.add(target.projectId)
    setSessions((prev) => ({ ...prev, [target.projectId]: metas }))
    setProjects((prev) =>
      prev.map((p) =>
        p.id === target.projectId
          ? {
              ...p,
              sessionCount: metas.length,
              userSessionCount: metas.filter((m) => m.origin === 'user').length
            }
          : p
      )
    )
    if (selected?.filePath === target.filePath) {
      setSelected(null)
      setConversation(null)
    }
    showToast(t('toast.deleted'))
  }, [deleteTarget, selected, showToast, t])

  return (
    <PrefsContext.Provider value={prefs}>
      <div
        className={`app${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}
        data-font-scale={settings.fontScale}
        style={{ '--sidebar-width': `${sidebarCollapsed ? 0 : sidebarWidth}px` } as CSSProperties}
      >
        <TopBar
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={toggleSidebar}
          onOpenSearch={openContentSearch}
        />
        <Sidebar
          projects={projects}
          sessions={sessions}
          expanded={expanded}
          selectedSessionPath={selected?.filePath ?? null}
          query={query}
          searchRef={searchRef}
          onQueryChange={setQuery}
          onToggle={toggleExpanded}
          onSelectSession={selectSession}
          onSessionMenu={openSessionMenu}
          onResizeStart={startSidebarResize}
        />
        {selected ? (
          <ConversationView
            session={selected}
            project={selectedProject}
            conversation={conversation}
            loading={loadingConversation}
            highlightRef={highlightRef}
            onResume={() => runAction('resume')}
            onFork={() => runAction('fork')}
            onDelete={() => setDeleteTarget(selected)}
            onReveal={() => window.api.revealSession(selected.filePath)}
          />
        ) : (
          <main className="conversation conversation--empty">
            <div className="empty-state">
              <div className="empty-state__mark">
                <WakeMark size={84} />
              </div>
              <p>{t('empty.title')}</p>
              <p className="empty-state__hint">
                {t('empty.hint', { find: shortcut('F'), search: shortcut('K') })}
              </p>
            </div>
          </main>
        )}
        {searchOpen && (
          <SearchPalette
            query={searchQuery}
            results={searchResults?.query === searchQuery.trim() ? searchResults : null}
            progress={searchProgress}
            failed={searchFailed}
            projectLabel={projectLabel}
            onQueryChange={setSearchQuery}
            onOpenHit={openHit}
            onClose={() => setSearchOpen(false)}
          />
        )}
        {deleteTarget && (
          <ConfirmDialog
            title={t('delete.title')}
            body={t('delete.body', { title: deleteTarget.title })}
            confirmLabel={t('delete.confirm')}
            onConfirm={confirmDelete}
            onCancel={() => setDeleteTarget(null)}
          />
        )}
        {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
        {update && update.mode !== 'dismissed' && (
          <div className="update-banner" role="status">
            <span className="update-banner__text">
              {(update.mode === 'link' || update.mode === 'available') &&
                t('update.banner', { v: `v${update.version}` })}
              {update.mode === 'requested' && t('update.requested', { v: `v${update.version}` })}
              {update.mode === 'downloading' &&
                t('update.downloading', { v: `v${update.version}`, p: update.percent })}
              {update.mode === 'ready' && t('update.ready', { v: `v${update.version}` })}
            </span>
            {update.mode === 'link' && (
              <button
                className="btn btn--primary"
                onClick={() => {
                  window.api.openExternal(update.url)
                  applyUpdate({ mode: 'dismissed' })
                }}
              >
                {t('update.download')}
              </button>
            )}
            {update.mode === 'available' && (
              <button
                className="btn btn--primary"
                onClick={() => {
                  // 첫 진행률은 빨라야 1초 뒤다. 그 전에 끊기면 화면이 전혀 안 바뀌므로 먼저 표시한다
                  const version = update.version
                  applyUpdate({ mode: 'requested', version })
                  window.api.downloadUpdate().catch(() => {
                    // 'error' 이벤트가 이미 되돌렸으면 두 번 알리지 않는다. 취소처럼 이벤트가
                    // 오지 않는 실패만 여기서 수습한다
                    if (updateRef.current?.mode !== 'requested') return
                    applyUpdate({ mode: 'available', version })
                    showToast(t('update.failed'))
                  })
                }}
              >
                {t('update.download')}
              </button>
            )}
            {update.mode === 'ready' && (
              <button className="btn btn--primary" onClick={() => window.api.installUpdate()}>
                {t('update.restart')}
              </button>
            )}
            <button
              className="update-banner__close"
              onClick={() => applyUpdate({ mode: 'dismissed' })}
              aria-label={t('common.close')}
            >
              ×
            </button>
          </div>
        )}
        {toast && <div className="toast">{toast}</div>}
      </div>
    </PrefsContext.Provider>
  )
}
