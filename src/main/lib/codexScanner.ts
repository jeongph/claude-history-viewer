import { createHash } from 'crypto'
import { readdir, stat } from 'fs/promises'
import { basename, join } from 'path'
import type { ProjectInfo, SessionMeta } from '../../shared/types'
import { readCodexTranscript } from './codexParser'
import { codexRoot, sessionFileProvider } from './sessionPaths'
import { detectRepo } from './repo'

const cache = new Map<
  string,
  { mtimeMs: number; size: number; projectCwd: string | null; meta: SessionMeta | null }
>()

/** 날짜별 저장 폴더는 프로젝트가 아니다. cwd를 별도 키로 써 같은 작업 폴더를 묶는다. */
export function codexProjectId(cwd: string | null): string {
  return `codex:${createHash('sha256')
    .update(cwd ?? '')
    .digest('hex')}`
}

async function sessionFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    }
  )
  const files: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    // 링크는 따라가지 않는다. 날짜 폴더 사이의 순환과 외부 파일 색인을 막는다.
    if (entry.isDirectory()) files.push(...(await sessionFiles(path)))
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path)
  }
  return files
}

export async function listCodexSessions(): Promise<SessionMeta[]> {
  const files = await sessionFiles(codexRoot())
  const seen = new Set(files)
  for (const path of cache.keys()) if (!seen.has(path)) cache.delete(path)
  const sessions: SessionMeta[] = []
  for (const filePath of files) {
    const info = await stat(filePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (!info?.size) continue
    const cached = cache.get(filePath)
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
      if (cached.meta) sessions.push(cached.meta)
      continue
    }
    if ((await sessionFileProvider(filePath)) !== 'codex') continue
    const transcript = await readCodexTranscript(filePath)
    const meta: SessionMeta | null =
      transcript.id && transcript.messageCount > 0
        ? {
            provider: 'codex',
            id: transcript.id,
            projectId: codexProjectId(transcript.projectCwd),
            filePath,
            title: transcript.firstPrompt ?? '(Codex)',
            firstPrompt: transcript.firstPrompt,
            messageCount: transcript.messageCount,
            createdAt: transcript.createdAt,
            updatedAt: Math.max(transcript.updatedAt ?? 0, info.mtimeMs),
            cwd: transcript.cwd,
            gitBranch: transcript.gitBranch,
            origin: transcript.origin,
            fileSize: info.size
          }
        : null
    cache.set(filePath, {
      mtimeMs: info.mtimeMs,
      size: info.size,
      projectCwd: transcript.projectCwd,
      meta
    })
    if (meta) sessions.push(meta)
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function listCodexProjects(): Promise<ProjectInfo[]> {
  const sessions = await listCodexSessions()
  const groups = new Map<string, SessionMeta[]>()
  for (const session of sessions) {
    const group = groups.get(session.projectId) ?? []
    group.push(session)
    groups.set(session.projectId, group)
  }
  const projects: ProjectInfo[] = []
  for (const [id, group] of groups) {
    // 최신 cwd는 이어가기에 쓰고, 프로젝트 소속은 시작 cwd를 유지한다.
    const realPath = cache.get(group[0].filePath)?.projectCwd ?? null
    projects.push({
      id,
      dirName: id,
      dirPath: codexRoot(),
      realPath,
      name: realPath ? basename(realPath) : 'Codex',
      sessionCount: group.length,
      userSessionCount: group.filter((session) => session.origin === 'user').length,
      lastActiveAt: group[0].updatedAt,
      repo: await detectRepo(id, realPath)
    })
  }
  return projects
}
