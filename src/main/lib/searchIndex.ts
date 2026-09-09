import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { app, type BrowserWindow } from 'electron'
import type { SearchHit, SearchProgress, SearchResults, SessionMeta } from '../../shared/types'
import { listSessionCatalog, loadConversation } from './sessions'
import { extractSearchMessages, type SearchMessage } from './searchExtract'
import {
  foldCase,
  indexMessages,
  isDocumentFresh,
  matchDocument,
  type SearchDocument
} from './searchMatch'

/**
 * 저장 형식이 바뀌면 올린다 — 값이 다르면 저장된 인덱스를 버리고 다시 만든다.
 * StoredDocument의 필드뿐 아니라 parser.ts의 아이템 경계나 uuid 부여 방식이 바뀔 때도
 * 올려야 한다. ref가 파서 출력의 uuid라서, 그대로 두면 저장된 ref가 오류 없이 엉뚱한
 * 메시지를 가리킨다.
 */
const INDEX_VERSION = 2
const MAX_SNIPPETS_PER_SESSION = 5
const MAX_HITS = 200
/** 검색이 들어올 때마다 전체 정합을 돌리지 않도록 두는 최소 간격 */
const RECONCILE_INTERVAL_MS = 5000
/** 첫 화면 로딩과 CPU를 다투지 않도록 인덱싱 시작을 미루는 시간 */
const INDEX_START_DELAY_MS = 1500

/** 디스크에 저장하는 형태 — 소문자 사본은 적재할 때 다시 만든다 */
type StoredDocument = Omit<SearchDocument, 'messages'> & { messages: SearchMessage[] }

const documents = new Map<string, SearchDocument>()
let ready = false
let failed = false
let revision = 0
let progress: SearchProgress = { done: 0, total: 0, ready: false, revision: 0, failed: false }
let running: Promise<void> | null = null
let lastReconcileAt = 0
let progressWindow: BrowserWindow | null = null

function indexPath(): string {
  return join(app.getPath('userData'), 'search-index.jsonl')
}

function emitProgress(done: number, total: number): void {
  progress = { done, total, ready, revision, failed }
  if (progressWindow && !progressWindow.isDestroyed()) {
    progressWindow.webContents.send('search:progress', progress)
  }
}

function isStoredMessage(value: unknown): value is SearchMessage {
  const message = value as SearchMessage | null
  return (
    !!message &&
    typeof message.ref === 'string' &&
    typeof message.text === 'string' &&
    (message.role === 'user' || message.role === 'assistant')
  )
}

function isStoredDocument(value: unknown): value is StoredDocument {
  const stored = value as StoredDocument | null
  return (
    !!stored &&
    (stored.provider === 'claude' || stored.provider === 'codex') &&
    typeof stored.sessionId === 'string' &&
    typeof stored.projectId === 'string' &&
    typeof stored.filePath === 'string' &&
    typeof stored.title === 'string' &&
    typeof stored.updatedAt === 'number' &&
    typeof stored.fileSize === 'number' &&
    Array.isArray(stored.messages) &&
    stored.messages.every(isStoredMessage)
  )
}

async function loadFromDisk(): Promise<void> {
  let raw: string
  try {
    raw = await readFile(indexPath(), 'utf8')
  } catch (error) {
    // 첫 실행이면 파일이 없는 게 정상이다. 다른 이유라면 매 실행 전체 재인덱싱으로
    // 이어지므로 흔적을 남긴다
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[search] 저장된 인덱스를 읽지 못했다', error)
    }
    return
  }

  const lines = raw.split('\n')
  let version: unknown
  try {
    version = (JSON.parse(lines[0]) as { v?: unknown }).v
  } catch {
    version = null
  }
  if (version !== INDEX_VERSION) return

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue
    let stored: unknown
    try {
      stored = JSON.parse(line)
    } catch {
      // 줄 하나가 깨져도 나머지는 살린다. JSON.parse만 감싼다 — 아래 변환에서 나는
      // 예외는 데이터가 아니라 이쪽 코드의 문제다
      continue
    }
    if (!isStoredDocument(stored)) continue
    documents.set(stored.filePath, { ...stored, messages: indexMessages(stored.messages) })
  }
}

async function persist(): Promise<void> {
  const path = indexPath()
  const temporary = `${path}.tmp`
  const lines = [JSON.stringify({ v: INDEX_VERSION })]
  for (const document of documents.values()) {
    const stored: StoredDocument = {
      ...document,
      messages: document.messages.map(({ ref, role, text }) => ({ ref, role, text }))
    }
    lines.push(JSON.stringify(stored))
  }
  await mkdir(dirname(path), { recursive: true })
  // 부분 기록된 인덱스를 남기지 않도록 임시 파일에 쓰고 원자적으로 바꿔 끼운다
  await writeFile(temporary, lines.join('\n'))
  await rename(temporary, path)
}

async function buildDocument(meta: SessionMeta): Promise<SearchDocument | null> {
  const conversation = await loadConversation(meta.filePath).catch((error) => {
    // 세션 하나가 깨져도 나머지 인덱싱은 계속하되, 조용히 사라지게 두지는 않는다
    console.error('[search] 세션 파싱 실패', meta.filePath, error)
    return null
  })
  if (!conversation) return null
  return {
    provider: meta.provider,
    sessionId: meta.id,
    projectId: meta.projectId,
    filePath: meta.filePath,
    title: meta.title,
    updatedAt: meta.updatedAt,
    fileSize: meta.fileSize,
    // 검색할 본문이 없는 세션도 빈 문서로 남긴다. 인덱스에서 빼면 아래 스킵 검사가 영영
    // 걸리지 않아 매 정합마다 다시 파싱하고 revision을 올린다
    messages: indexMessages(extractSearchMessages(conversation))
  }
}

async function reconcile(): Promise<void> {
  const catalog = await listSessionCatalog()
  emitProgress(0, catalog.size)

  const seen = new Set<string>()
  let changed = false
  let done = 0

  for (const [projectId, metas] of catalog) {
    if (metas === null) {
      // 목록을 못 읽었을 뿐이므로, 이 프로젝트의 기존 문서를 사라진 것으로 취급하지 않는다
      for (const document of documents.values()) {
        if (document.projectId === projectId) seen.add(document.filePath)
      }
    } else {
      for (const meta of metas) {
        seen.add(meta.filePath)
        if (isDocumentFresh(documents.get(meta.filePath), meta)) continue
        const document = await buildDocument(meta)
        if (document) {
          documents.set(meta.filePath, document)
          changed = true
        } else if (documents.delete(meta.filePath)) {
          changed = true
        }
      }
    }
    done += 1
    emitProgress(done, catalog.size)
    // 메타가 전부 캐시에 걸리면 프로젝트 루프가 거의 동기로 돈다. 그때도 렌더러 IPC가
    // 끼어들 틈이 생기도록 프로젝트마다 한 번 넘긴다
    await new Promise((resolve) => setImmediate(resolve))
  }

  for (const filePath of [...documents.keys()]) {
    if (seen.has(filePath)) continue
    documents.delete(filePath)
    changed = true
  }

  ready = true
  failed = false
  lastReconcileAt = Date.now()
  if (changed) revision += 1
  emitProgress(done, catalog.size)
  if (changed) {
    await persist().catch((error) => console.error('[search] 인덱스 저장 실패', error))
  }
}

function ensureIndex(): Promise<void> {
  if (!running) {
    running = (async () => {
      try {
        if (!ready) await loadFromDisk()
        await reconcile()
      } catch (error) {
        // ready를 세우지 않으면 검색이 영영 "인덱싱 중"에 묶인다. 대신 failed로 인덱스가
        // 불완전함을 알려, 빈 결과가 "그런 대화는 없다"로 읽히지 않게 한다
        console.error('[search] 인덱싱 실패', error)
        ready = true
        failed = true
        lastReconcileAt = Date.now()
        emitProgress(progress.done, progress.total)
      }
    })().finally(() => {
      running = null
    })
  }
  return running
}

export function initSearchIndex(window: BrowserWindow): void {
  progressWindow = window
  setTimeout(() => void ensureIndex(), INDEX_START_DELAY_MS)
}

export async function searchSessions(query: string): Promise<SearchResults> {
  const trimmed = query.trim()
  if (!trimmed) {
    return { query: trimmed, hits: [], truncated: false, indexing: !ready, degraded: failed }
  }

  // 정합을 기다리지 않는다 — 지금 인덱스로 즉시 답하고, 갱신되면 revision이 올라
  // 렌더러가 같은 질의를 다시 던진다
  if (!ready || Date.now() - lastReconcileAt > RECONCILE_INTERVAL_MS) {
    void ensureIndex()
  }

  // 본문과 같은 함수로 접어야 매칭 인덱스를 원문 슬라이스에 그대로 쓸 수 있다
  const folded = foldCase(trimmed)
  const hits: SearchHit[] = []
  for (const document of documents.values()) {
    const hit = matchDocument(document, folded, MAX_SNIPPETS_PER_SESSION)
    if (hit) hits.push(hit)
  }
  hits.sort((a, b) => b.updatedAt - a.updatedAt)

  return {
    query: trimmed,
    hits: hits.slice(0, MAX_HITS),
    truncated: hits.length > MAX_HITS,
    indexing: !ready,
    degraded: failed
  }
}
