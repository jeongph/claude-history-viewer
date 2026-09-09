import type { SearchHit, SearchSnippet, SessionMeta, SessionProvider } from '../../shared/types'
import type { SearchMessage } from './searchExtract'

/**
 * 스니펫에서 매칭 앞뒤로 남길 문자 수. flatten이 슬라이스 뒤에 돌기 때문에 이 값은
 * 공백을 누르기 전 예산이다 — 공백이 많은 텍스트는 화면에서 더 짧게 보인다.
 * 뒤쪽을 넉넉히 두는 이유는 매칭 다음에 오는 말이 대개 더 궁금하기 때문이다.
 */
const CONTEXT_BEFORE = 50
const CONTEXT_AFTER = 110

/**
 * 길이를 보존하는 대소문자 접기.
 *
 * 매칭은 접은 문자열에서 찾고 스니펫은 원문에서 잘라내므로, 두 문자열의 인덱스가
 * 어긋나면 안 된다. `toLowerCase()`로 길이가 변하는 코드포인트는 유니코드 전체에서
 * U+0130(İ) 하나뿐이고, 그런 글자는 접지 않고 원문 그대로 둔다. 그 글자만 대소문자를
 * 구분하게 되는데, 터키어에서 İ와 i는 애초에 다른 글자다.
 */
export function foldCase(text: string): string {
  const lower = text.toLowerCase()
  if (lower.length === text.length) return lower
  let folded = ''
  for (const character of text) {
    const lowered = character.toLowerCase()
    folded += lowered.length === character.length ? lowered : character
  }
  return folded
}

export interface IndexedMessage extends SearchMessage {
  /** text를 접은 사본 — 검색마다 코퍼스 전체를 다시 변환하지 않으려고 적재 시 한 번 만든다 */
  lower: string
}

export interface SearchDocument {
  provider: SessionProvider
  sessionId: string
  projectId: string
  filePath: string
  title: string
  updatedAt: number
  fileSize: number
  messages: IndexedMessage[]
}

export function indexMessages(messages: SearchMessage[]): IndexedMessage[] {
  return messages.map((message) => ({ ...message, lower: foldCase(message.text) }))
}

/**
 * 세션 내용이 인덱스에 담긴 그대로인지 판정한다.
 *
 * 세션 JSONL은 append-only라, 내용이 바뀌면 fileSize가 반드시 커지고 마지막 엔트리
 * 시각도 함께 움직인다. 크기가 같은 채로 다시 쓰이는 경우까지 걸러내려고 둘을 함께 본다.
 * 이 판정이 느슨해지면 검색 결과가 오류 없이 영원히 낡는다.
 */
export function isDocumentFresh(
  existing: SearchDocument | undefined,
  meta: Pick<SessionMeta, 'updatedAt' | 'fileSize'>
): boolean {
  return (
    existing !== undefined &&
    existing.updatedAt === meta.updatedAt &&
    existing.fileSize === meta.fileSize
  )
}

function flatten(text: string): string {
  return text.replace(/\s+/g, ' ')
}

export function buildSnippet(
  message: SearchMessage,
  matchIndex: number,
  matchLength: number
): SearchSnippet {
  const start = Math.max(0, matchIndex - CONTEXT_BEFORE)
  const end = Math.min(message.text.length, matchIndex + matchLength + CONTEXT_AFTER)
  const head = start > 0 ? '…' : ''
  const tail = end < message.text.length ? '…' : ''
  return {
    ref: message.ref,
    role: message.role,
    before: head + flatten(message.text.slice(start, matchIndex)),
    match: flatten(message.text.slice(matchIndex, matchIndex + matchLength)),
    after: flatten(message.text.slice(matchIndex + matchLength, end)) + tail
  }
}

/**
 * 문서 하나에서 질의를 모두 찾는다. 매칭이 없으면 null.
 * folded는 질의를 foldCase로 접어서 넘겨야 한다 — 본문과 같은 함수를 써야 인덱스가 맞는다.
 */
export function matchDocument(
  document: SearchDocument,
  folded: string,
  maxSnippets: number
): SearchHit | null {
  // 빈 질의는 indexOf가 매번 0을 돌려줘 무한 루프가 된다
  if (!folded) return null

  let matchCount = 0
  const snippets: SearchSnippet[] = []
  for (const message of document.messages) {
    let from = 0
    for (;;) {
      const index = message.lower.indexOf(folded, from)
      if (index === -1) break
      matchCount += 1
      if (snippets.length < maxSnippets) {
        snippets.push(buildSnippet(message, index, folded.length))
      }
      from = index + folded.length
    }
  }
  if (matchCount === 0) return null
  return {
    provider: document.provider,
    sessionId: document.sessionId,
    projectId: document.projectId,
    filePath: document.filePath,
    title: document.title,
    updatedAt: document.updatedAt,
    matchCount,
    snippets
  }
}
