import { readdir, stat } from 'fs/promises'
import { basename, join } from 'path'
import type { ProjectInfo, SessionMeta, SessionOrigin } from '../../shared/types'
import { forEachJsonlLine, readHead } from './jsonl'
import { getMessage, isRealUserPrompt, summarize } from './entries'
import { originFromEntrypoint } from './sessionOrigin'
import { detectRepo } from './repo'
import { claudeRoot } from './sessionPaths'

export function projectsRoot(): string {
  // CHV_DATA_DIR: 개발·데모용 데이터 디렉토리 오버라이드
  return claudeRoot()
}

/** Claude Code 는 cwd 의 영숫자 아닌 글자를 전부 '-'로 바꿔 프로젝트 디렉터리명을 만든다 */
function projectDirName(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-')
}

function stringField(entry: Record<string, unknown>, key: string): string | null {
  const value = entry[key]
  return typeof value === 'string' && value ? value : null
}

// 프로젝트 디렉터리명은 세션을 시작한 cwd 로 정해지지만, 파일 속 cwd 는 그 뒤에 바뀔 수 있다.
// EnterWorktree 로 워크트리에 들어간 세션은 첫 엔트리부터 워크트리 경로를 싣고, 시작 cwd 는
// worktreeSession.originalCwd(worktree-state 엔트리)에만 남는다. 그래서 어느 엔트리든 두 필드를
// 다 후보로 보고 디렉터리명과 맞아떨어지는 쪽을 우선하며, 하나도 없을 때만 처음 만난 후보로 물러선다.
async function detectRealPath(dirName: string, sessionFiles: string[]): Promise<string | null> {
  let first: string | null = null
  for (const file of sessionFiles) {
    const head = await readHead(file, 32 * 1024).catch(() => '')
    for (const line of head.split('\n')) {
      if (!line.includes('"cwd"') && !line.includes('"originalCwd"')) continue
      let entry: Record<string, unknown>
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }
      const worktreeSession = entry.worktreeSession
      const candidates = [
        stringField(entry, 'cwd'),
        typeof worktreeSession === 'object' && worktreeSession !== null
          ? stringField(worktreeSession as Record<string, unknown>, 'originalCwd')
          : null
      ]
      for (const candidate of candidates) {
        if (!candidate) continue
        if (projectDirName(candidate) === dirName) return candidate
        first ??= candidate
      }
    }
  }
  return first
}

interface SessionHead {
  hasRealMessage: boolean
  origin: SessionOrigin
}

// 세션 목록에 필요한 두 가지를 한 번의 스트리밍으로 얻는다.
// - hasRealMessage: 실제 대화(사용자 프롬프트 또는 어시스턴트 메시지)가 있는지. 첫 실제
//   메시지를 찾는 즉시 중단하므로 대부분의 세션은 앞쪽 몇 KB만 읽는다. listSessions의
//   messageCount > 0 필터와 판정 기준을 맞춰 카운트가 어긋나지 않게 한다.
// - origin: 세션을 만든 주체. entrypoint는 첫 실제 메시지보다 앞서거나 같은 엔트리에 실려
//   오므로, 중단 판정보다 먼저 읽어야 놓치지 않는다.
async function scanSessionHead(filePath: string): Promise<SessionHead> {
  let found = false
  let entrypoint: string | null = null
  await forEachJsonlLine(filePath, (entry) => {
    if (entrypoint === null && typeof entry.entrypoint === 'string') entrypoint = entry.entrypoint
    if (entry.type === 'user') {
      if (isRealUserPrompt(entry)) {
        found = true
        return false
      }
    } else if (entry.type === 'assistant' && entry.isSidechain !== true) {
      if (typeof getMessage(entry)?.id === 'string') {
        found = true
        return false
      }
    }
    return undefined
  })
  return { hasRealMessage: found, origin: originFromEntrypoint(entrypoint) }
}

export async function listProjects(): Promise<ProjectInfo[]> {
  const root = projectsRoot()
  const dirents = await readdir(root, { withFileTypes: true }).catch(() => [])
  const projects: ProjectInfo[] = []

  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue
    const dirPath = join(root, dirent.name)
    const files = await readdir(dirPath).catch(() => [])
    const sessionFiles: { path: string; mtimeMs: number; origin: SessionOrigin }[] = []
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue
      const filePath = join(dirPath, file)
      const info = await stat(filePath).catch(() => null)
      if (!info || info.size === 0) continue
      const head = await scanSessionHead(filePath).catch(() => null)
      if (!head?.hasRealMessage) continue
      sessionFiles.push({ path: filePath, mtimeMs: info.mtimeMs, origin: head.origin })
    }
    if (sessionFiles.length === 0) continue

    sessionFiles.sort((a, b) => b.mtimeMs - a.mtimeMs)
    const realPath = await detectRealPath(
      dirent.name,
      sessionFiles.slice(0, 3).map((f) => f.path)
    )
    projects.push({
      id: dirent.name,
      dirName: dirent.name,
      dirPath,
      realPath,
      name: realPath
        ? basename(realPath)
        : (dirent.name.split('-').filter(Boolean).pop() ?? dirent.name),
      sessionCount: sessionFiles.length,
      userSessionCount: sessionFiles.filter((f) => f.origin === 'user').length,
      lastActiveAt: sessionFiles[0].mtimeMs,
      repo: await detectRepo(dirent.name, realPath)
    })
  }

  return projects.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
}

interface MetaCacheEntry {
  mtimeMs: number
  size: number
  meta: SessionMeta
}

const metaCache = new Map<string, MetaCacheEntry>()

async function readSessionMeta(
  projectId: string,
  filePath: string,
  mtimeMs: number,
  size: number
): Promise<SessionMeta> {
  const cached = metaCache.get(filePath)
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached.meta

  let title: string | null = null
  let summaryTitle: string | null = null
  let firstPrompt: string | null = null
  let firstTimestamp: string | null = null
  let lastTimestamp: string | null = null
  let gitBranch: string | null = null
  let cwd: string | null = null
  let entrypoint: string | null = null
  let userCount = 0
  const assistantMessageIds = new Set<string>()

  await forEachJsonlLine(filePath, (entry) => {
    if (entrypoint === null && typeof entry.entrypoint === 'string') entrypoint = entry.entrypoint
    if (entry.type === 'ai-title' && typeof entry.aiTitle === 'string') {
      title = entry.aiTitle
      return
    }
    if (entry.type === 'summary' && typeof entry.summary === 'string') {
      summaryTitle = entry.summary
      return
    }
    if (typeof entry.timestamp === 'string') {
      firstTimestamp ??= entry.timestamp
      lastTimestamp = entry.timestamp
    }
    if (typeof entry.gitBranch === 'string' && entry.gitBranch) gitBranch = entry.gitBranch
    if (typeof entry.cwd === 'string' && entry.cwd) cwd = entry.cwd

    if (entry.type === 'user') {
      const prompt = isRealUserPrompt(entry)
      if (prompt) {
        userCount += 1
        firstPrompt ??= summarize(prompt, 120)
      }
    } else if (entry.type === 'assistant' && entry.isSidechain !== true) {
      const id = getMessage(entry)?.id
      if (typeof id === 'string') assistantMessageIds.add(id)
    }
  })

  const meta: SessionMeta = {
    provider: 'claude',
    id: basename(filePath, '.jsonl'),
    projectId,
    filePath,
    title: title ?? summaryTitle ?? firstPrompt ?? '(빈 세션)',
    firstPrompt,
    messageCount: userCount + assistantMessageIds.size,
    createdAt: firstTimestamp ? Date.parse(firstTimestamp) : null,
    updatedAt: lastTimestamp ? Date.parse(lastTimestamp) : mtimeMs,
    gitBranch,
    cwd,
    fileSize: size,
    origin: originFromEntrypoint(entrypoint)
  }
  metaCache.set(filePath, { mtimeMs, size, meta })
  return meta
}

export async function listSessions(projectId: string): Promise<SessionMeta[]> {
  const dirPath = join(projectsRoot(), projectId)
  const files = await readdir(dirPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const metas: SessionMeta[] = []
  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue
    const filePath = join(dirPath, file)
    const info = await stat(filePath).catch(() => null)
    if (!info || info.size === 0) continue
    metas.push(await readSessionMeta(projectId, filePath, info.mtimeMs, info.size))
  }
  return metas.filter((meta) => meta.messageCount > 0).sort((a, b) => b.updatedAt - a.updatedAt)
}
