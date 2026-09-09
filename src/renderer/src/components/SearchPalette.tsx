import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { SearchHit, SearchProgress, SearchResults, SearchSnippet } from '../../../shared/types'
import { formatRelativeTime } from '../lib/format'
import { usePrefs } from '../prefs'

interface Props {
  query: string
  /** 지금 입력된 질의에 대한 결과만 넘어온다 — 낡은 결과는 null */
  results: SearchResults | null
  progress: SearchProgress | null
  failed: boolean
  /** projectId를 사이드바에 보이는 이름으로 옮긴다 */
  projectLabel: (projectId: string) => string
  onQueryChange: (query: string) => void
  onOpenHit: (hit: SearchHit, ref: string) => void
  onClose: () => void
}

interface Row {
  hit: SearchHit
  snippet: SearchSnippet
  /** 이 행이 세션의 첫 스니펫이면 위에 세션 머리글을 그린다 */
  first: boolean
}

export function SearchPalette({
  query,
  results,
  progress,
  failed,
  projectLabel,
  onQueryChange,
  onOpenHit,
  onClose
}: Props): ReactElement {
  const { t } = usePrefs()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)

  const rows = useMemo<Row[]>(
    () =>
      (results?.hits ?? []).flatMap((hit) =>
        hit.snippets.map((snippet, index) => ({ hit, snippet, first: index === 0 }))
      ),
    [results]
  )

  // 인덱스 갱신으로 결과가 줄어들면 선택이 목록 밖을 가리킬 수 있다
  const activeIndex = Math.min(active, Math.max(0, rows.length - 1))

  // 선택이 화면 밖으로 나가면 따라 스크롤한다
  useEffect(() => {
    listRef.current?.querySelector('.snippet.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  // 닫을 때 팔레트를 연 컨트롤로 포커스를 돌려준다.
  // 첫 렌더에서 잡아야 한다 — 이펙트 시점에는 입력창의 autoFocus가 이미 가져간 뒤다
  const [opener] = useState(() => document.activeElement)
  useEffect(
    () => () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    },
    [opener]
  )

  const trimmed = query.trim()
  // 응답도 진행률도 못 받았으면 인덱싱 중으로 본다 — 그 사이에 "결과 없음"을 보여주면 안 된다
  const indexing = results ? results.indexing : !progress?.ready

  let status: string
  if (indexing) {
    status =
      progress && progress.total > 0
        ? t('search.indexing', { done: progress.done, total: progress.total })
        : t('search.indexingPrep')
  } else if (!trimmed) {
    // 질의를 지웠으면 직전 실패보다 안내가 먼저다
    status = t('search.hint')
  } else if (failed) {
    status = t('search.failed')
  } else if (!results) {
    // 디바운스·왕복 중이다. 아직 결과가 없다고 단정하지 않는다
    status = t('search.searching')
  } else if (results.degraded) {
    // 인덱스가 불완전하면 찾은 게 있어도 "이게 전부"라고 말하지 않는다
    status = results.hits.length === 0 ? t('search.failed') : t('search.partial')
  } else if (results.hits.length === 0) {
    status = t('search.empty', { query: trimmed })
  } else {
    const matches = results.hits.reduce((sum, hit) => sum + hit.matchCount, 0)
    status = t('search.summary', { sessions: results.hits.length, matches })
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (rows.length === 0) return
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((activeIndex + step + rows.length) % rows.length)
      return
    }
    if (event.key === 'Enter') {
      const row = rows[activeIndex]
      if (row) onOpenHit(row.hit, row.snippet.ref)
    }
  }

  return (
    // 바깥을 누르면 닫힌다. 이 오버레이는 팔레트 뒤 화면을 가리지 않는다
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={t('search.open')}
        onMouseDown={(event) => event.stopPropagation()}
        // Tab으로 뒤 화면의 컨트롤로 빠져나가면 ↑↓·↵가 더는 듣지 않는다.
        // 팔레트는 입력창에서만 조작하므로 Tab 자체를 막아 포커스를 붙잡아 둔다
        onKeyDown={(event) => {
          if (event.key === 'Tab') event.preventDefault()
        }}
      >
        <div className="palette__input-row">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <line
              x1="10.4"
              y1="10.4"
              x2="14"
              y2="14"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="palette__input"
            placeholder={t('search.placeholder')}
            value={query}
            onChange={(event) => {
              // 질의가 바뀌면 선택을 맨 위로 되돌린다
              setActive(0)
              onQueryChange(event.target.value)
            }}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoFocus
          />
        </div>
        <p className="palette__status">{status}</p>
        {rows.length > 0 && (
          <div className="palette__results" ref={listRef}>
            {rows.map((row, index) => (
              <div key={`${row.hit.filePath}-${row.snippet.ref}-${index}`}>
                {row.first && (
                  <div className="palette__group">
                    <span className="palette__group-title">{row.hit.title}</span>
                    <span className="palette__group-meta">
                      {projectLabel(row.hit.projectId)} · {formatRelativeTime(row.hit.updatedAt, t)}{' '}
                      · {t('search.matches', { n: row.hit.matchCount })}
                    </span>
                  </div>
                )}
                <button
                  className={`snippet${index === activeIndex ? ' is-active' : ''}`}
                  onMouseMove={() => setActive(index)}
                  onClick={() => onOpenHit(row.hit, row.snippet.ref)}
                >
                  <span className="snippet__role">
                    {row.snippet.role === 'user'
                      ? t('search.role.user')
                      : row.hit.provider === 'codex'
                        ? 'Codex'
                        : t('search.role.assistant')}
                  </span>
                  <span className="snippet__text">
                    {row.snippet.before}
                    <mark>{row.snippet.match}</mark>
                    {row.snippet.after}
                  </span>
                </button>
              </div>
            ))}
            {results?.truncated && (
              <p className="palette__truncated">
                {t('search.truncated', { n: results.hits.length })}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
