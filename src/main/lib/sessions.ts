import { readdir } from 'fs/promises'
import type { Conversation, ProjectInfo, SessionMeta } from '../../shared/types'
import { listProjects as listClaudeProjects, listSessions as listClaudeSessions } from './scanner'
import { parseConversation } from './parser'
import { listCodexProjects, listCodexSessions } from './codexScanner'
import { readCodexTranscript } from './codexParser'
import { claudeRoot, sessionFileProvider } from './sessionPaths'

/** 공급자별 저장 구조를 이 경계 안에 가둔다. UI와 검색은 파일 디렉터리를 추정하지 않는다. */
export async function listProjects(): Promise<ProjectInfo[]> {
  const groups = await Promise.all([listClaudeProjects(), listCodexProjects()])
  return groups.flat().sort((a, b) => b.lastActiveAt - a.lastActiveAt)
}

export async function listSessionCatalog(): Promise<Map<string, SessionMeta[] | null>> {
  const dirs = await readdir(claudeRoot(), { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    }
  )
  const codex = await listCodexSessions()
  const catalog = new Map<string, SessionMeta[] | null>()
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue
    catalog.set(dir.name, await listClaudeSessions(dir.name).catch(() => null))
  }
  for (const session of codex) {
    const group = catalog.get(session.projectId) ?? []
    group.push(session)
    catalog.set(session.projectId, group)
  }
  return catalog
}

export async function listSessions(projectId: string): Promise<SessionMeta[]> {
  if (typeof projectId !== 'string') throw new TypeError('Invalid project ID')
  if (/^codex:[a-f0-9]{64}$/.test(projectId))
    return (await listCodexSessions()).filter((session) => session.projectId === projectId)
  if (!projectId || projectId === '.' || projectId === '..' || /[\\/:\0]/.test(projectId))
    throw new Error('Invalid project ID')
  return listClaudeSessions(projectId)
}

export async function loadConversation(filePath: string): Promise<Conversation> {
  const provider = await sessionFileProvider(filePath)
  if (provider === 'claude') return parseConversation(filePath)
  if (provider === 'codex') return (await readCodexTranscript(filePath)).conversation
  throw new Error('세션 파일 경로가 아닙니다.')
}
