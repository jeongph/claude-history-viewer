import type {
  AssistantBlock,
  Conversation,
  ConversationItem,
  SessionOrigin,
  UserImage
} from '../../shared/types'
import { forEachJsonlLine } from './jsonl'
import { summarize } from './entries'

type RecordValue = Record<string, unknown>
type ToolCall = Extract<AssistantBlock, { type: 'toolCall' }>

function record(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {}
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function textContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map(record)
    .filter((part) =>
      ['input_text', 'output_text', 'text', 'summary_text'].includes(String(part.type))
    )
    .map((part) => string(part.text) ?? '')
    .join('\n')
}

function images(value: unknown): UserImage[] {
  if (!Array.isArray(value)) return []
  return value.map(record).flatMap((part) => {
    if (part.type !== 'input_image') return []
    const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(
      string(part.image_url) ?? ''
    )
    return match ? [{ mediaType: match[1], data: match[2] }] : []
  })
}

function toolInput(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function toolOutput(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? '')
}

export interface CodexTranscript {
  conversation: Conversation
  id: string | null
  projectCwd: string | null
  cwd: string | null
  gitBranch: string | null
  origin: SessionOrigin
  firstPrompt: string | null
  messageCount: number
  createdAt: number | null
  updatedAt: number | null
}

/**
 * Rollout은 내부 저장 형식이다. response_item을 본문 기준으로 삼고 event_msg는
 * 해당 턴·역할의 본문이 없을 때만 보충한다. 같은 응답의 완료 알림을 두 번 그리지 않는다.
 * 암호화된 reasoning은 읽지 않으며 저장된 공개 요약만 표시한다.
 */
export async function readCodexTranscript(filePath: string): Promise<CodexTranscript> {
  const ordered: { order: number; item: ConversationItem }[] = []
  const fallback: {
    order: number
    turn: number
    role: 'user' | 'assistant'
    text: string
    timestamp: string | null
  }[] = []
  const canonicalRoles = new Set<string>()
  const calls = new Map<string, ToolCall>()
  let id: string | null = null
  let projectCwd: string | null = null
  let cwd: string | null = null
  let gitBranch: string | null = null
  let origin: SessionOrigin = 'user'
  let createdAt: number | null = null
  let updatedAt: number | null = null
  let order = 0
  let turn = 0
  let hiddenCount = 0

  const assistant = (blocks: AssistantBlock[], timestamp: string | null): void => {
    if (blocks.length)
      ordered.push({
        order,
        item: { kind: 'assistant', uuid: `codex-${order}`, timestamp, blocks }
      })
  }

  await forEachJsonlLine(filePath, (entry) => {
    order += 1
    const payload = record(entry.payload)
    const timestamp = string(entry.timestamp)
    const time = timestamp ? Date.parse(timestamp) : NaN
    if (Number.isFinite(time)) {
      createdAt ??= time
      updatedAt = time
    }

    if (entry.type === 'session_meta') {
      id ??= string(payload.id) ?? string(payload.session_id)
      projectCwd ??= string(payload.cwd)
      cwd ??= projectCwd
      gitBranch = string(record(payload.git).branch) ?? gitBranch
      const source = payload.source ?? payload.thread_source
      if (source === 'exec' || source === 'subagent' || record(source).subagent) origin = 'agent'
      return
    }
    if (entry.type === 'turn_context') {
      cwd = string(payload.cwd) ?? cwd
      return
    }
    if (entry.type === 'event_msg') {
      if (payload.type === 'task_started') turn += 1
      if (payload.type === 'user_message' || payload.type === 'agent_message') {
        const text = string(payload.message)
        if (text)
          fallback.push({
            order,
            turn,
            role: payload.type === 'user_message' ? 'user' : 'assistant',
            text,
            timestamp
          })
      }
      if (payload.type === 'turn_aborted') {
        ordered.push({
          order,
          item: {
            kind: 'user',
            uuid: `codex-${order}`,
            timestamp,
            text: '',
            images: [],
            meta: { kind: 'interrupt', label: null, detail: null }
          }
        })
      }
      return
    }
    if (entry.type === 'compacted') {
      ordered.push({
        order,
        item: {
          kind: 'user',
          uuid: `codex-${order}`,
          timestamp,
          text: '',
          images: [],
          meta: { kind: 'compact', label: null, detail: string(payload.message) }
        }
      })
      return
    }
    if (entry.type !== 'response_item') return

    if (payload.type === 'message') {
      const role = payload.role
      const text = textContent(payload.content)
      if (role === 'assistant') {
        if (text.trim()) {
          canonicalRoles.add(`${turn}:assistant`)
          assistant([{ type: 'text', text }], timestamp)
        }
      } else if (role === 'user' || role === 'developer' || role === 'system') {
        const attached = images(payload.content)
        if (!text.trim() && !attached.length) {
          hiddenCount += 1
          return
        }
        // Codex가 user 롤로 저장한 작업 지침·환경은 실제 질문과 검색/제목에서 분리한다.
        const injected =
          role !== 'user' ||
          /^(?:# AGENTS\.md instructions|<environment_context>|<permissions instructions>|<INSTRUCTIONS>)/.test(
            text.trim()
          )
        if (!injected) canonicalRoles.add(`${turn}:user`)
        ordered.push({
          order,
          item: {
            kind: 'user',
            uuid: `codex-${order}`,
            timestamp,
            text: injected ? '' : text,
            images: attached,
            meta: injected ? { kind: 'injected', label: summarize(text, 100), detail: text } : null
          }
        })
      }
      return
    }
    if (payload.type === 'reasoning') {
      const summary = textContent(payload.summary)
      if (summary.trim()) assistant([{ type: 'thinking', text: summary }], timestamp)
      else hiddenCount += 1
      return
    }
    if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
      const callId = string(payload.call_id)
      const name = string(payload.name)
      if (!callId || !name) return
      const call: ToolCall = {
        type: 'toolCall',
        id: callId,
        name,
        input: toolInput(payload.arguments ?? payload.input),
        result: null,
        isError: false
      }
      calls.set(callId, call)
      assistant([call], timestamp)
      return
    }
    if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
      const call = calls.get(string(payload.call_id) ?? '')
      if (call) {
        call.result = toolOutput(payload.output)
        call.isError =
          payload.is_error === true ||
          record(payload.output).is_error === true ||
          /(?:Process exited with code|Exit code:)\s*[1-9]\d*/.test(call.result)
        calls.delete(call.id)
      }
      return
    }
    hiddenCount += 1
  })

  for (const event of fallback) {
    if (canonicalRoles.has(`${event.turn}:${event.role}`)) continue
    const base = { uuid: `codex-${event.order}`, timestamp: event.timestamp }
    ordered.push({
      order: event.order,
      item:
        event.role === 'user'
          ? { ...base, kind: 'user', text: event.text, images: [], meta: null }
          : { ...base, kind: 'assistant', blocks: [{ type: 'text', text: event.text }] }
    })
  }
  const items = ordered.sort((a, b) => a.order - b.order).map(({ item }) => item)
  const prompts = items.filter((item) => item.kind === 'user' && item.meta === null)
  const first = prompts.find((item) => item.kind === 'user' && item.text.trim())
  return {
    id,
    projectCwd,
    cwd,
    gitBranch,
    origin,
    createdAt,
    updatedAt,
    firstPrompt: first?.kind === 'user' ? summarize(first.text, 120) : null,
    messageCount:
      prompts.length +
      items.filter(
        (item) => item.kind === 'assistant' && item.blocks.some((block) => block.type === 'text')
      ).length,
    conversation: { sessionId: id ?? '', items, sidechainCount: 0, hiddenCount }
  }
}
