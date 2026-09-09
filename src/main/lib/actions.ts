import { existsSync } from 'fs'
import { homedir } from 'os'
import { shell } from 'electron'
import type { ActionResult, SessionProvider } from '../../shared/types'
import { codexHome, sessionFileProvider } from './sessionPaths'
import { loadSettings } from './settings'
import { launchInTerminal, resolveTerminalId } from './terminals'

function escapeForShell(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}

const SESSION_ID_RE = /^[a-zA-Z0-9-]{1,64}$/

async function openInTerminal(
  sessionId: string,
  cwd: string | null,
  fork: boolean,
  provider: SessionProvider
): Promise<ActionResult> {
  // 세션 ID는 jsonl 파일명에서 유래하므로 셸 삽입을 막기 위해 형식을 강제한다
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
    return { ok: false, error: '세션 ID 형식이 올바르지 않습니다.' }
  }
  if (provider !== 'claude' && provider !== 'codex')
    return { ok: false, error: '지원하지 않는 세션 제공자입니다.' }
  if (cwd !== null && typeof cwd !== 'string')
    return { ok: false, error: '작업 경로가 올바르지 않습니다.' }
  const terminalId = resolveTerminalId(loadSettings().terminal)
  if (!terminalId) {
    return { ok: false, error: '사용 가능한 터미널을 찾지 못했습니다.' }
  }

  const workdir = cwd && existsSync(cwd) ? cwd : homedir()
  const flags = fork ? `--resume ${sessionId} --fork-session` : `--resume ${sessionId}`
  let invocation =
    provider === 'codex' ? `codex ${fork ? 'fork' : 'resume'} ${sessionId}` : `claude ${flags}`
  // Terminal.app은 앱 환경을 상속하지 않는다. 읽은 CODEX_HOME과 재개할 저장소를 맞춘다.
  if (provider === 'codex' && process.platform !== 'win32')
    invocation = `env CODEX_HOME=${escapeForShell(codexHome())} ${invocation}`
  // Windows 터미널은 spawn cwd로 작업 디렉토리를 잡으므로 cd를 붙이지 않는다
  const command =
    process.platform === 'win32' ? invocation : `cd ${escapeForShell(workdir)} && ${invocation}`

  return launchInTerminal(terminalId, workdir, command)
}

export function resumeSession(
  sessionId: string,
  cwd: string | null,
  provider: SessionProvider
): Promise<ActionResult> {
  return openInTerminal(sessionId, cwd, false, provider)
}

export function forkSession(
  sessionId: string,
  cwd: string | null,
  provider: SessionProvider
): Promise<ActionResult> {
  return openInTerminal(sessionId, cwd, true, provider)
}

export async function deleteSession(filePath: string): Promise<ActionResult> {
  const provider = await sessionFileProvider(filePath)
  if (provider === 'codex')
    return { ok: false, error: 'Codex 세션 삭제·보관은 Codex에서 관리해 주세요.' }
  if (provider !== 'claude') {
    return { ok: false, error: '세션 파일 경로가 아닙니다.' }
  }
  try {
    await shell.trashItem(filePath)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function revealSession(filePath: string): Promise<ActionResult> {
  if (!(await sessionFileProvider(filePath))) {
    return { ok: false, error: '세션 파일 경로가 아닙니다.' }
  }
  shell.showItemInFolder(filePath)
  return { ok: true }
}
