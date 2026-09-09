import {
  useMemo,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type RefObject
} from 'react'
import type { ProjectInfo, SessionMeta } from '../../../shared/types'
import { formatRelativeTime, shortenPath } from '../lib/format'
import { buildGroups } from '../lib/groups'
import { shortcut } from '../lib/platform'
import { usePrefs } from '../prefs'

interface Props {
  projects: ProjectInfo[]
  sessions: Record<string, SessionMeta[]>
  expanded: Set<string>
  selectedSessionPath: string | null
  query: string
  searchRef: RefObject<HTMLInputElement | null>
  onQueryChange: (query: string) => void
  /** 펼침 키와, 펼칠 때 세션을 읽어야 하는 프로젝트 id 목록 */
  onToggle: (key: string, projectIds: string[]) => void
  onSelectSession: (session: SessionMeta) => void
  onSessionMenu: (session: SessionMeta) => void
  onResizeStart: (event: ReactMouseEvent) => void
}

function Chevron({ open }: { open: boolean }): ReactElement {
  return (
    <span className={`project__chevron${open ? ' is-open' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 16 16" width="14" height="14">
        <path
          d="M6 4l4 4-4 4"
          stroke="currentColor"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

function matches(session: SessionMeta, query: string): boolean {
  const lowered = query.toLowerCase()
  return (
    session.title.toLowerCase().includes(lowered) ||
    (session.firstPrompt?.toLowerCase().includes(lowered) ?? false)
  )
}

/** 폴더 이름이 걸리면 그 안의 세션은 제목 필터만 건너뛴다. 자동 세션 필터는 그대로 받는다 */
function folderMatches(name: string, query: string): boolean {
  return name.toLowerCase().includes(query.toLowerCase())
}

// 한 항목에 프로젝트가 여럿이면 세션 목록을 합친다. 하나면 listSessions 가 이미 최근 순이라
// 그대로 넘기고, 둘 이상이면 flat 으로 새 배열을 만들어 정렬한다 — 상태에 든 배열을 제자리
// 정렬하면 안 된다. 하나라도 안 왔으면 로딩 중으로 둔다. 온 것만 보여주면 빠진 프로젝트를
// 알아챌 길이 없다.
function mergeSessions(lists: (SessionMeta[] | undefined)[]): SessionMeta[] | undefined {
  if (lists.some((list) => list === undefined)) return undefined
  const loaded = lists as SessionMeta[][]
  if (loaded.length === 1) return loaded[0]
  return loaded.flat().sort((a, b) => b.updatedAt - a.updatedAt)
}

// 목록에 실제로 그릴 세션을 고른다. undefined는 "아직 로딩 중"이라 그대로 흘려보내지만,
// 검색 중에는 빈 배열로 바꿔 "결과 없음" 판정에 걸리게 한다 — 아직 읽지 않은 프로젝트가
// 검색 결과에 빈 그룹으로 남지 않게 하려는 것이다.
// 자동 생성 세션 필터는 검색 여부와 무관하게 늘 적용하고, 제목 필터만 folderMatched일 때 건너뛴다.
function visibleSessions(
  list: SessionMeta[] | undefined,
  showAgentSessions: boolean,
  query: string,
  folderMatched: boolean
): SessionMeta[] | undefined {
  if (list === undefined) return query ? [] : undefined
  const kept = showAgentSessions ? list : list.filter((session) => session.origin === 'user')
  return query && !folderMatched ? kept.filter((session) => matches(session, query)) : kept
}

function SessionList({
  items,
  selectedSessionPath,
  onSelectSession,
  onSessionMenu
}: {
  items: SessionMeta[] | undefined
  selectedSessionPath: string | null
  onSelectSession: (session: SessionMeta) => void
  onSessionMenu: (session: SessionMeta) => void
}): ReactElement {
  const { t } = usePrefs()
  return (
    <ul className="session-list">
      {items === undefined && <li className="session-list__loading">{t('sidebar.loading')}</li>}
      {items?.map((session) => (
        <li key={session.filePath}>
          <button
            className={`session${session.filePath === selectedSessionPath ? ' is-selected' : ''}`}
            onClick={() => onSelectSession(session)}
            onContextMenu={(event) => {
              event.preventDefault()
              onSessionMenu(session)
            }}
          >
            <span className="session__title">{session.title}</span>
            <span className="session__meta">
              <span className="session__badge">
                {session.provider === 'codex' ? 'Codex' : 'Claude'}
              </span>
              {session.origin === 'agent' && (
                <span className="session__badge">{t('session.autoBadge')}</span>
              )}
              {formatRelativeTime(session.updatedAt, t)} ·{' '}
              {t('session.messages', { n: session.messageCount })}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function Sidebar({
  projects,
  sessions,
  expanded,
  selectedSessionPath,
  query,
  searchRef,
  onQueryChange,
  onToggle,
  onSelectSession,
  onSessionMenu,
  onResizeStart
}: Props): ReactElement {
  const { t, settings } = usePrefs()
  const searching = query.trim().length > 0
  const trimmedQuery = searching ? query.trim() : ''
  const groups = useMemo(
    () => buildGroups(projects, settings.showAgentSessions),
    [projects, settings.showAgentSessions]
  )

  return (
    <aside className="sidebar">
      <div className="sidebar__search">
        <input
          ref={searchRef}
          type="search"
          placeholder={t('sidebar.search', { find: shortcut('F') })}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          spellCheck={false}
        />
      </div>
      <nav className="sidebar__list">
        {groups.map((group) => {
          const open = searching || expanded.has(group.id)
          // 그룹 이름이 걸리면 워크트리·하위 폴더까지 통째로 보여준다
          const groupMatched = searching && folderMatches(group.name, trimmedQuery)
          const rootVisible = visibleSessions(
            mergeSessions(group.roots.map((root) => sessions[root.id])),
            settings.showAgentSessions,
            trimmedQuery,
            groupMatched
          )
          const subEntries = group.subs
            .map((sub) => ({
              sub,
              visible: visibleSessions(
                mergeSessions(sub.projects.map((project) => sessions[project.id])),
                settings.showAgentSessions,
                trimmedQuery,
                groupMatched || folderMatches(sub.name, trimmedQuery)
              )
            }))
            .filter((entry) => !searching || (entry.visible?.length ?? 0) > 0)
          if (searching && (rootVisible?.length ?? 0) === 0 && subEntries.length === 0) {
            return null
          }
          return (
            <section key={group.id} className="project">
              <button
                className="project__header"
                onClick={() =>
                  onToggle(
                    group.id,
                    group.roots.map((root) => root.id)
                  )
                }
                aria-expanded={open}
              >
                <Chevron open={open} />
                <span className="project__name">{group.name}</span>
                <span className="project__count">{group.totalSessions}</span>
              </button>
              {open && group.rootPath && (
                <p className="project__path">{shortenPath(group.rootPath)}</p>
              )}
              {open && group.roots.length > 0 && (
                <SessionList
                  items={rootVisible}
                  selectedSessionPath={selectedSessionPath}
                  onSelectSession={onSelectSession}
                  onSessionMenu={onSessionMenu}
                />
              )}
              {open &&
                subEntries.map(({ sub, visible }) => {
                  const subOpen = searching || expanded.has(sub.id)
                  return (
                    <div key={sub.id} className="sub">
                      <button
                        className="sub__header"
                        onClick={() =>
                          onToggle(
                            sub.id,
                            sub.projects.map((project) => project.id)
                          )
                        }
                        aria-expanded={subOpen}
                      >
                        <Chevron open={subOpen} />
                        <span className="sub__mark" aria-hidden="true">
                          {sub.kind === 'worktree' ? '⎇' : '/'}
                        </span>
                        <span className="sub__name">{sub.name}</span>
                        <span className="project__count">{sub.totalSessions}</span>
                      </button>
                      {subOpen && (
                        <SessionList
                          items={visible}
                          selectedSessionPath={selectedSessionPath}
                          onSelectSession={onSelectSession}
                          onSessionMenu={onSessionMenu}
                        />
                      )}
                    </div>
                  )
                })}
            </section>
          )
        })}
        {groups.length === 0 && <p className="sidebar__empty">{t('sidebar.empty')}</p>}
      </nav>
      <div className="sidebar__resizer" onMouseDown={onResizeStart} aria-hidden="true" />
    </aside>
  )
}
