import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionProvider } from '../../shared/types'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn().mockResolvedValue(undefined), showItemInFolder: vi.fn() }
}))
vi.mock('./settings', () => ({ loadSettings: () => ({ terminal: 'auto' }) }))
vi.mock('./terminals', () => ({
  resolveTerminalId: () => 'terminal-app',
  launchInTerminal: vi.fn().mockResolvedValue({ ok: true })
}))

import { shell } from 'electron'
import { launchInTerminal } from './terminals'
import { deleteSession, forkSession, resumeSession, revealSession } from './actions'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wake-actions-'))
  vi.stubEnv('CODEX_HOME', join(root, "codex's home"))
  vi.stubEnv('CHV_DATA_DIR', join(root, 'claude'))
  mkdirSync(join(root, "codex's home", 'sessions'), { recursive: true })
  mkdirSync(join(root, 'claude', 'repo'), { recursive: true })
  vi.clearAllMocks()
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe('공급자별 세션 동작', () => {
  it('Claude와 Codex의 공식 재개·분기 명령을 선택한다', async () => {
    await resumeSession('abc-123', root, 'claude')
    expect(vi.mocked(launchInTerminal).mock.calls.at(-1)?.[2]).toContain('claude --resume abc-123')
    await forkSession('abc-123', root, 'claude')
    expect(vi.mocked(launchInTerminal).mock.calls.at(-1)?.[2]).toContain(
      'claude --resume abc-123 --fork-session'
    )
    await resumeSession('abc-123', root, 'codex')
    expect(vi.mocked(launchInTerminal).mock.calls.at(-1)?.[2]).toContain('codex resume abc-123')
    await forkSession('abc-123', root, 'codex')
    const command = vi.mocked(launchInTerminal).mock.calls.at(-1)?.[2] ?? ''
    expect(command).toContain('codex fork abc-123')
    if (process.platform !== 'win32') {
      expect(command).toContain("env CODEX_HOME='")
      expect(command).toContain("codex'\\''s home")
    }
  })

  it('잘못된 공급자와 셸 삽입 문자열은 실행하지 않는다', async () => {
    expect((await resumeSession('x; touch /tmp/no', root, 'codex')).ok).toBe(false)
    expect((await resumeSession('abc', root, 'other' as SessionProvider)).ok).toBe(false)
    expect(launchInTerminal).not.toHaveBeenCalled()
  })

  it('Codex는 Finder에서 열 수 있지만 휴지통 삭제는 Claude에만 허용한다', async () => {
    const codex = join(root, "codex's home", 'sessions', 'rollout.jsonl')
    const claude = join(root, 'claude', 'repo', 'session.jsonl')
    writeFileSync(codex, '{}')
    writeFileSync(claude, '{}')
    expect((await revealSession(codex)).ok).toBe(true)
    expect(shell.showItemInFolder).toHaveBeenCalledWith(codex)
    expect((await deleteSession(codex)).ok).toBe(false)
    expect(shell.trashItem).not.toHaveBeenCalled()
    expect((await deleteSession(claude)).ok).toBe(true)
    expect(shell.trashItem).toHaveBeenCalledWith(claude)
    expect((await deleteSession(join(root, 'unrelated.jsonl'))).ok).toBe(false)
  })
})
