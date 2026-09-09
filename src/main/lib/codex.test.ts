import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readCodexTranscript } from './codexParser'
import { listCodexProjects, listCodexSessions } from './codexScanner'
import { listProjects, listSessionCatalog, listSessions, loadConversation } from './sessions'
import { extractSearchMessages } from './searchExtract'
import { indexMessages, matchDocument } from './searchMatch'
import { sessionFileProvider } from './sessionPaths'

let root: string
let sessionPath: string
const id = '12345678-1234-1234-1234-123456789abc'
const row = (type: string, payload: unknown): object => ({
  timestamp: '2026-09-09T00:00:00Z',
  type,
  payload
})
const message = (role: string, text: string): object =>
  row('response_item', {
    type: 'message',
    role,
    content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }]
  })

function write(rows: unknown[]): void {
  writeFileSync(sessionPath, rows.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wake-codex-'))
  vi.stubEnv('CODEX_HOME', join(root, 'codex'))
  vi.stubEnv('CHV_DATA_DIR', join(root, 'claude'))
  const dir = join(root, 'codex', 'sessions', '2026', '09', '09')
  mkdirSync(dir, { recursive: true })
  sessionPath = join(dir, `rollout-2026-09-09T00-00-00-${id}.jsonl`)
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe('Codex rollout', () => {
  it('본문과 완료 이벤트를 중복 표시하지 않고 도구 결과를 연결한다', async () => {
    write([
      row('session_meta', { id, cwd: root, source: 'cli', git: { branch: 'feature/test' } }),
      row('event_msg', { type: 'task_started', turn_id: 't1' }),
      message('developer', '내부 지침'),
      message('user', '# AGENTS.md instructions for /repo\n지침'),
      message('user', '검색할 실제 질문'),
      row('event_msg', { type: 'user_message', message: '검색할 실제 질문' }),
      row('response_item', {
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: '공개 요약' }],
        encrypted_content: 'secret'
      }),
      row('response_item', {
        type: 'function_call',
        call_id: 'c1',
        name: 'exec_command',
        arguments: '{"cmd":"pwd"}'
      }),
      row('response_item', {
        type: 'function_call_output',
        call_id: 'c1',
        output: 'Process exited with code 1'
      }),
      row('response_item', {
        type: 'custom_tool_call',
        call_id: 'c2',
        name: 'apply_patch',
        input: '*** Begin Patch\n*** End Patch'
      }),
      row('response_item', { type: 'custom_tool_call_output', call_id: 'c2', output: 'ok' }),
      message('assistant', '검색할 최종 답변'),
      row('event_msg', { type: 'agent_message', message: '검색할 최종 답변' }),
      row('event_msg', { type: 'task_complete', last_agent_message: '검색할 최종 답변' }),
      null,
      [],
      42,
      row('response_item', { type: 'unknown_future_type' })
    ])
    appendFileSync(sessionPath, '{"partial":')
    const parsed = await readCodexTranscript(sessionPath)
    expect(parsed).toMatchObject({
      id,
      cwd: root,
      gitBranch: 'feature/test',
      firstPrompt: '검색할 실제 질문',
      messageCount: 2
    })
    const searchable = extractSearchMessages(parsed.conversation)
    expect(searchable.map((m) => m.text)).toEqual(['검색할 실제 질문', '검색할 최종 답변'])
    expect(JSON.stringify(parsed.conversation)).not.toContain('secret')
    const blocks = parsed.conversation.items.flatMap((item) =>
      item.kind === 'assistant' ? item.blocks : []
    )
    expect(blocks).toContainEqual({ type: 'thinking', text: '공개 요약' })
    expect(blocks).toContainEqual({
      type: 'toolCall',
      id: 'c1',
      name: 'exec_command',
      input: { cmd: 'pwd' },
      result: 'Process exited with code 1',
      isError: true
    })
    expect(blocks).toContainEqual({
      type: 'toolCall',
      id: 'c2',
      name: 'apply_patch',
      input: '*** Begin Patch\n*** End Patch',
      result: 'ok',
      isError: false
    })
    expect(new Set(parsed.conversation.items.map((item) => item.uuid)).size).toBe(
      parsed.conversation.items.length
    )
    const before = searchable.map((m) => m.ref)
    appendFileSync(sessionPath, '\n' + JSON.stringify(message('assistant', '추가 답변')))
    const after = extractSearchMessages((await readCodexTranscript(sessionPath)).conversation)
    expect(after.slice(0, 2).map((m) => m.ref)).toEqual(before)
  })

  it('event 전용 기록, 중단·압축 경계와 이미지 입력을 읽는다', async () => {
    write([
      row('session_meta', { id, cwd: root, source: { subagent: { parent_thread_id: 'parent' } } }),
      row('event_msg', { type: 'user_message', message: '옛 질문' }),
      row('event_msg', { type: 'agent_message', message: '옛 답변' }),
      row('event_msg', { type: 'task_started' }),
      row('response_item', {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_image', image_url: 'data:image/png;base64,YQ==' }]
      }),
      row('event_msg', { type: 'turn_aborted' }),
      row('compacted', { message: '이월 요약' })
    ])
    const parsed = await readCodexTranscript(sessionPath)
    expect(parsed.origin).toBe('agent')
    expect(extractSearchMessages(parsed.conversation).map((m) => m.text)).toEqual([
      '옛 질문',
      '옛 답변'
    ])
    expect(parsed.conversation.items).toContainEqual(
      expect.objectContaining({ kind: 'user', images: [{ mediaType: 'image/png', data: 'YQ==' }] })
    )
    expect(parsed.conversation.items).toContainEqual(
      expect.objectContaining({ meta: { kind: 'compact', label: null, detail: '이월 요약' } })
    )
  })
})

describe('공급자 통합', () => {
  it('Claude가 없는 설치에서도 Codex를 탐색하고 검색 ref로 본문에 도달한다', async () => {
    write([row('session_meta', { id, cwd: root, source: 'cli' }), message('user', '바다 검색')])
    const projects = await listProjects()
    expect(projects).toHaveLength(1)
    const sessions = await listSessions(projects[0].id)
    expect(sessions[0]).toMatchObject({ id, provider: 'codex', messageCount: 1 })
    expect((await listSessionCatalog()).get(projects[0].id)).toEqual(sessions)
    const conversation = await loadConversation(sessionPath)
    const hit = matchDocument(
      {
        ...sessions[0],
        sessionId: id,
        messages: indexMessages(extractSearchMessages(conversation))
      },
      '검색',
      5
    )
    expect(hit?.provider).toBe('codex')
    expect(conversation.items.some((item) => item.uuid === hit?.snippets[0].ref)).toBe(true)
  })

  it('시작 cwd로 묶고 마지막 cwd로 재개하며 변경·삭제된 파일의 캐시를 갱신한다', async () => {
    write([
      row('session_meta', { id, cwd: root }),
      message('user', '첫 질문'),
      row('turn_context', { cwd: join(root, 'worktree') })
    ])
    expect((await listCodexProjects())[0].realPath).toBe(root)
    expect((await listCodexSessions())[0].cwd).toBe(join(root, 'worktree'))
    appendFileSync(sessionPath, JSON.stringify(message('assistant', '대답')) + '\n')
    expect((await listCodexSessions())[0].messageCount).toBe(2)
    rmSync(sessionPath)
    expect(await listCodexSessions()).toEqual([])
  })

  it('두 공급자에 같은 ID가 있어도 각각 열고 보관·외부 링크는 탐색하지 않는다', async () => {
    write([row('session_meta', { id, cwd: root }), message('user', 'Codex 질문')])
    const claudeDir = join(root, 'claude', 'repo')
    mkdirSync(claudeDir, { recursive: true })
    const claudePath = join(claudeDir, `${id}.jsonl`)
    writeFileSync(
      claudePath,
      JSON.stringify({ type: 'user', cwd: root, message: { content: 'Claude 질문' } })
    )
    const archive = join(root, 'codex', 'archived_sessions')
    mkdirSync(archive)
    writeFileSync(
      join(archive, 'archived.jsonl'),
      JSON.stringify(row('session_meta', { id: 'archived' }))
    )
    const outside = join(root, 'outside.jsonl')
    writeFileSync(outside, '{}')
    const link = join(root, 'codex', 'sessions', 'outside.jsonl')
    symlinkSync(outside, link)
    expect(await sessionFileProvider(link)).toBeNull()
    await expect(loadConversation(outside)).rejects.toThrow()
    await expect(listSessions('../outside')).rejects.toThrow()
    const catalog = await listSessionCatalog()
    expect([...catalog.values()].flat()).toHaveLength(2)
    expect(extractSearchMessages(await loadConversation(claudePath))[0].text).toBe('Claude 질문')
    expect(extractSearchMessages(await loadConversation(sessionPath))[0].text).toBe('Codex 질문')
  })
})
