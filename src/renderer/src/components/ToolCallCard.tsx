import { useState, type ReactElement } from 'react'
import type { AssistantBlock } from '../../../shared/types'
import { usePrefs } from '../prefs'
import type { Translate } from '../i18n'

type ToolCall = Extract<AssistantBlock, { type: 'toolCall' }>

function firstString(input: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  for (const value of Object.values(input)) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

function summarizeInput(name: string, input: unknown, t: Translate): string {
  if (typeof input === 'string') return input.split('\n')[0].slice(0, 160)
  if (!input || typeof input !== 'object') return ''
  const record = input as Record<string, unknown>
  switch (name) {
    case 'exec_command':
    case 'functions.exec_command':
      return firstString(record, ['cmd', 'command']) ?? ''
    case 'Bash':
      return firstString(record, ['command']) ?? ''
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return firstString(record, ['file_path']) ?? ''
    case 'Glob':
    case 'Grep':
      return firstString(record, ['pattern']) ?? ''
    case 'Task':
    case 'Agent':
      return firstString(record, ['description', 'prompt']) ?? ''
    case 'WebFetch':
      return firstString(record, ['url']) ?? ''
    case 'WebSearch':
      return firstString(record, ['query']) ?? ''
    case 'Skill':
      return firstString(record, ['skill']) ?? ''
    case 'TodoWrite':
      return t('tool.todo')
    default:
      return firstString(record, ['description', 'query', 'path']) ?? ''
  }
}

function formatInput(input: unknown): string {
  if (input == null) return ''
  if (typeof input === 'string') return input
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

const RESULT_PREVIEW_LIMIT = 20_000

export function ToolCallCard({ call }: { call: ToolCall }): ReactElement {
  const { t } = usePrefs()
  const [open, setOpen] = useState(false)
  const summary = summarizeInput(call.name, call.input, t)
  const result = call.result ?? ''
  const truncated = result.length > RESULT_PREVIEW_LIMIT

  return (
    <div className={`tool-card${call.isError ? ' tool-card--error' : ''}`}>
      <button className="tool-card__row" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className={`tool-card__chevron${open ? ' is-open' : ''}`}>▸</span>
        <span className="tool-card__name">{call.name}</span>
        {summary && <span className="tool-card__summary">{summary}</span>}
        {call.isError && <span className="tool-card__badge">{t('tool.error')}</span>}
      </button>
      {open && (
        <div className="tool-card__detail">
          {call.input != null && (
            <section>
              <h5>{t('tool.input')}</h5>
              <pre className="tool-card__pre">{formatInput(call.input)}</pre>
            </section>
          )}
          <section>
            <h5>{t('tool.result')}</h5>
            {result ? (
              <pre className="tool-card__pre">
                {truncated
                  ? `${result.slice(0, RESULT_PREVIEW_LIMIT)}${t('tool.truncated')}`
                  : result}
              </pre>
            ) : (
              <p className="tool-card__empty">{t('tool.noResult')}</p>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
