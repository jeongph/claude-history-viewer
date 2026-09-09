import { useEffect, useRef, type ReactElement } from 'react'
import type { Conversation, ProjectInfo, SessionMeta, UserMetaInfo } from '../../../shared/types'
import { formatBytes, formatFullDate, shortenPath } from '../lib/format'
import { usePrefs } from '../prefs'
import { AssistantTurn, UserMessage } from './MessageItems'

// 사용자 액션(! 셸 명령, Esc 중단)과 세션 경계는 시스템 메시지 숨김과 무관하게 항상 보여준다
const ALWAYS_VISIBLE_META = new Set<UserMetaInfo['kind']>(['bashRun', 'interrupt', 'compact'])

interface Props {
  session: SessionMeta
  project: ProjectInfo | null
  conversation: Conversation | null
  loading: boolean
  /** 검색 결과에서 열었을 때 이동·강조할 아이템 uuid */
  highlightRef: string | null
  onResume: () => void
  onFork: () => void
  onDelete: () => void
  onReveal: () => void
}

export function ConversationView({
  session,
  project,
  conversation,
  loading,
  highlightRef,
  onResume,
  onFork,
  onDelete,
  onReveal
}: Props): ReactElement {
  const { t, settings } = usePrefs()
  const scrollRef = useRef<HTMLDivElement>(null)
  const cwd = session.cwd ?? project?.realPath ?? null
  const items = conversation
    ? conversation.items.filter(
        (item) =>
          settings.showMeta ||
          item.kind !== 'user' ||
          item.meta === null ||
          ALWAYS_VISIBLE_META.has(item.meta.kind)
      )
    : []

  // 검색은 meta 없는 사용자 아이템과 어시스턴트 turn만 인덱싱하므로, showMeta 설정과
  // 무관하게 대상 노드가 항상 그려져 있다. 강조 해제 시점은 App이 관리한다
  useEffect(() => {
    if (!highlightRef || !conversation) return
    // start 정렬 — 어시스턴트 턴은 화면보다 길 수 있어 center로 맞추면 강조 테두리가 화면 밖으로 나간다
    scrollRef.current
      ?.querySelector(`[data-uuid="${CSS.escape(highlightRef)}"]`)
      ?.scrollIntoView({ block: 'start' })
  }, [highlightRef, conversation])

  return (
    <main className="conversation">
      <header className="conversation__header">
        <div className="conversation__heading">
          <h1 title={session.title}>{session.title}</h1>
          <p className="conversation__meta">
            <span className="session__badge">
              {session.provider === 'codex' ? 'Codex' : 'Claude'}
            </span>
            {cwd && <span>{shortenPath(cwd)}</span>}
            {session.gitBranch && <span className="conversation__branch">{session.gitBranch}</span>}
            <span>{formatFullDate(session.updatedAt)}</span>
            <span>{t('session.messages', { n: session.messageCount })}</span>
            <span>{formatBytes(session.fileSize)}</span>
            {conversation && conversation.sidechainCount > 0 && (
              <span>{t('header.subagentHidden', { n: conversation.sidechainCount })}</span>
            )}
          </p>
        </div>
        <div className="conversation__actions">
          <button className="btn btn--primary" onClick={onResume} title={t('action.resume.hint')}>
            {t('action.resume')}
          </button>
          <button className="btn" onClick={onFork} title={t('action.fork.hint')}>
            {t('action.fork')}
          </button>
          <button className="btn" onClick={onReveal} title={t('action.reveal.hint')}>
            {t('action.reveal')}
          </button>
          <button
            className="btn btn--danger"
            onClick={onDelete}
            disabled={session.provider === 'codex'}
            title={session.provider === 'codex' ? t('action.delete.codexHint') : undefined}
          >
            {t('action.delete')}
          </button>
        </div>
      </header>
      <div className="conversation__scroll" ref={scrollRef}>
        {loading && <p className="conversation__status">{t('conversation.loading')}</p>}
        {!loading && conversation && items.length === 0 && (
          <p className="conversation__status">{t('conversation.empty')}</p>
        )}
        {!loading && conversation && (
          <div className="timeline">
            {items.map((item) =>
              item.kind === 'user' ? (
                <UserMessage key={item.uuid} item={item} highlighted={item.uuid === highlightRef} />
              ) : (
                <AssistantTurn
                  key={item.uuid}
                  item={item}
                  highlighted={item.uuid === highlightRef}
                />
              )
            )}
          </div>
        )}
      </div>
    </main>
  )
}
