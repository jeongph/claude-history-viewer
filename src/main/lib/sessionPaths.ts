import { realpath, stat } from 'fs/promises'
import { homedir } from 'os'
import { isAbsolute, join, relative, resolve, sep } from 'path'
import type { SessionProvider } from '../../shared/types'

export function claudeRoot(): string {
  return resolve(process.env.CHV_DATA_DIR ?? join(homedir(), '.claude', 'projects'))
}

export function codexHome(): string {
  return resolve(process.env.CODEX_HOME || join(homedir(), '.codex'))
}

export function codexRoot(): string {
  return join(codexHome(), 'sessions')
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/** IPC가 받은 경로는 실제 파일·루트로 검증한다. 심볼릭 링크로 루트 밖을 읽거나 지우지 않는다. */
export async function sessionFileProvider(filePath: string): Promise<SessionProvider | null> {
  if (typeof filePath !== 'string' || !filePath.endsWith('.jsonl')) return null
  const path = resolve(filePath)
  const actual = await realpath(path).catch(() => null)
  if (!actual) return null
  const info = await stat(actual).catch(() => null)
  if (!info?.isFile()) return null
  for (const [provider, root] of [
    ['claude', claudeRoot()],
    ['codex', codexRoot()]
  ] as const) {
    if (!inside(root, path)) continue
    const actualRoot = await realpath(root).catch(() => null)
    if (actualRoot && inside(actualRoot, actual)) return provider
  }
  return null
}
