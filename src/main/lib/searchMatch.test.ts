import { describe, expect, it } from 'vitest'
import type { SearchMessage } from './searchExtract'
import {
  foldCase,
  indexMessages,
  isDocumentFresh,
  matchDocument,
  type SearchDocument
} from './searchMatch'

function document(messages: SearchMessage[]): SearchDocument {
  return {
    provider: 'claude',
    sessionId: 'session-1',
    projectId: 'project-1',
    filePath: '/tmp/session-1.jsonl',
    title: '세션 제목',
    updatedAt: 1_700_000_000_000,
    fileSize: 1024,
    messages: indexMessages(messages)
  }
}

describe('foldCase', () => {
  it('대소문자를 접고 길이를 그대로 둔다', () => {
    expect(foldCase('SearchIndex')).toBe('searchindex')
    expect(foldCase('SearchIndex')).toHaveLength('SearchIndex'.length)
  })

  it('한글은 그대로 둔다', () => {
    expect(foldCase('대화 내용 검색')).toBe('대화 내용 검색')
  })

  it('소문자에서 길어지는 글자는 접지 않고 길이를 지킨다', () => {
    // U+0130(İ)은 toLowerCase에서 2코드유닛이 된다. 접어버리면 이후 인덱스가 전부 밀려
    // 스니펫이 엉뚱한 자리에서 잘린다
    expect('İ'.toLowerCase()).toHaveLength(2)
    expect(foldCase('İstanbul')).toBe('İstanbul')
    expect(foldCase('İstanbul')).toHaveLength('İstanbul'.length)
  })

  it('길이가 변하는 글자가 섞여도 매칭 구간이 원문과 어긋나지 않는다', () => {
    const text = 'İstanbul 회고'
    const snippet = matchDocument(
      document([{ ref: 'u1', role: 'user', text }]),
      foldCase('stanbul'),
      5
    )?.snippets[0]
    expect(snippet?.match).toBe('stanbul')
  })
})

describe('isDocumentFresh', () => {
  const meta = { updatedAt: 1_700_000_000_000, fileSize: 1024 }

  it('인덱스에 없던 세션은 신선하지 않다', () => {
    expect(isDocumentFresh(undefined, meta)).toBe(false)
  })

  it('마지막 엔트리 시각과 크기가 모두 같아야 신선하다', () => {
    expect(isDocumentFresh(document([]), meta)).toBe(true)
  })

  it('크기가 달라지면 신선하지 않다', () => {
    expect(isDocumentFresh(document([]), { ...meta, fileSize: 2048 })).toBe(false)
  })

  it('마지막 엔트리 시각이 달라지면 신선하지 않다', () => {
    expect(isDocumentFresh(document([]), { ...meta, updatedAt: 1_700_000_000_001 })).toBe(false)
  })
})

describe('matchDocument', () => {
  it('매칭이 없으면 null을 돌려준다', () => {
    const result = matchDocument(document([{ ref: 'u1', role: 'user', text: '고래' }]), '상어', 5)
    expect(result).toBeNull()
  })

  it('빈 질의는 매칭으로 치지 않는다', () => {
    const result = matchDocument(document([{ ref: 'u1', role: 'user', text: '고래' }]), '', 5)
    expect(result).toBeNull()
  })

  it('대소문자를 무시하고 찾으며 원문 대소문자로 스니펫을 만든다', () => {
    const result = matchDocument(
      document([{ ref: 'u1', role: 'user', text: 'SearchIndex 를 만들자' }]),
      'searchindex',
      5
    )
    expect(result?.matchCount).toBe(1)
    expect(result?.snippets[0].match).toBe('SearchIndex')
  })

  it('한 문서 안의 모든 매칭을 센다', () => {
    const result = matchDocument(
      document([
        { ref: 'u1', role: 'user', text: '검색 검색' },
        { ref: 'a1', role: 'assistant', text: '검색이요' }
      ]),
      '검색',
      5
    )
    expect(result?.matchCount).toBe(3)
  })

  it('스니펫 수는 상한을 넘지 않지만 matchCount는 전체를 센다', () => {
    const result = matchDocument(
      document([{ ref: 'u1', role: 'user', text: '가 가 가 가 가' }]),
      '가',
      2
    )
    expect(result?.matchCount).toBe(5)
    expect(result?.snippets).toHaveLength(2)
  })

  it('긴 텍스트는 앞뒤를 잘라 말줄임표를 붙이고 개행을 눌러 준다', () => {
    const long = `${'앞'.repeat(200)}\n표적\n${'뒤'.repeat(200)}`
    const result = matchDocument(document([{ ref: 'u1', role: 'user', text: long }]), '표적', 5)
    const snippet = result?.snippets[0]
    expect(snippet?.before.startsWith('…')).toBe(true)
    expect(snippet?.after.endsWith('…')).toBe(true)
    expect(snippet?.before).not.toContain('\n')
    expect(snippet?.after).not.toContain('\n')
    expect(snippet?.match).toBe('표적')
  })

  it('짧은 텍스트에는 말줄임표를 붙이지 않는다', () => {
    const result = matchDocument(document([{ ref: 'u1', role: 'user', text: '표적' }]), '표적', 5)
    expect(result?.snippets[0]).toEqual({
      ref: 'u1',
      role: 'user',
      before: '',
      match: '표적',
      after: ''
    })
  })

  it('앞 50자·뒤 110자가 정확히 들어맞으면 말줄임표를 붙이지 않는다', () => {
    // 문맥 폭(CONTEXT_BEFORE/AFTER)을 고정한다. 200자짜리 텍스트로만 검사하면 폭을
    // 5·11로 줄여도 "말줄임표가 붙는다"는 단언은 그대로 통과한다.
    const text = `${'앞'.repeat(50)}표적${'뒤'.repeat(110)}`
    const snippet = matchDocument(document([{ ref: 'u1', role: 'user', text }]), '표적', 5)
      ?.snippets[0]
    expect(snippet?.before).toBe('앞'.repeat(50))
    expect(snippet?.after).toBe('뒤'.repeat(110))
  })

  it('문맥 폭을 한 글자라도 넘으면 그만큼 잘라내고 말줄임표를 붙인다', () => {
    // 경계 바로 바깥. 위 테스트와 짝을 이뤄 start > 0 / end < length 의 부등호가
    // >= / <= 로 바뀌는 오프바이원을 양쪽에서 잡는다.
    const text = `${'앞'.repeat(51)}표적${'뒤'.repeat(111)}`
    const snippet = matchDocument(document([{ ref: 'u1', role: 'user', text }]), '표적', 5)
      ?.snippets[0]
    expect(snippet?.before).toBe(`…${'앞'.repeat(50)}`)
    expect(snippet?.after).toBe(`${'뒤'.repeat(110)}…`)
  })

  it('텍스트 맨 앞의 매칭은 앞 말줄임표가, 맨 끝의 매칭은 뒤 말줄임표가 없다', () => {
    const head = matchDocument(
      document([{ ref: 'u1', role: 'user', text: `표적${'뒤'.repeat(300)}` }]),
      '표적',
      5
    )?.snippets[0]
    expect(head?.before).toBe('')
    expect(head?.after.endsWith('…')).toBe(true)

    const tail = matchDocument(
      document([{ ref: 'u1', role: 'user', text: `${'앞'.repeat(300)}표적` }]),
      '표적',
      5
    )?.snippets[0]
    expect(tail?.before.startsWith('…')).toBe(true)
    expect(tail?.after).toBe('')
  })

  it('매칭은 겹치지 않게 전진한다', () => {
    // 'aaaa'에서 'aa'는 겹쳐 세면 3, 겹치지 않게 세면 2다. 전진 폭을 1로 바꾸면
    // matchCount가 부풀고 거의 같은 자리를 가리키는 스니펫이 중복으로 쌓인다.
    const four = matchDocument(document([{ ref: 'u1', role: 'user', text: 'aaaa' }]), 'aa', 5)
    expect(four?.matchCount).toBe(2)
    expect(four?.snippets.map((snippet) => snippet.before)).toEqual(['', 'aa'])

    const three = matchDocument(document([{ ref: 'u1', role: 'user', text: 'aaa' }]), 'aa', 5)
    expect(three?.matchCount).toBe(1)
  })

  it('스니펫 상한은 메시지별이 아니라 문서 전체에 걸린다', () => {
    // 앞 메시지가 상한을 다 쓰면 뒤 메시지는 매칭이 있어도 스니펫을 얻지 못한다.
    // 의도된 동작이지만 결과 화면에서 눈에 띄므로 고정해 둔다.
    const result = matchDocument(
      document([
        { ref: 'u1', role: 'user', text: '표적 표적' },
        { ref: 'a1', role: 'assistant', text: '표적' }
      ]),
      '표적',
      2
    )
    expect(result?.matchCount).toBe(3)
    expect(result?.snippets.map((snippet) => snippet.ref)).toEqual(['u1', 'u1'])
  })

  it('세션 식별 정보를 그대로 옮긴다', () => {
    const result = matchDocument(document([{ ref: 'u1', role: 'user', text: '표적' }]), '표적', 5)
    expect(result).toMatchObject({
      provider: 'claude',
      sessionId: 'session-1',
      projectId: 'project-1',
      filePath: '/tmp/session-1.jsonl',
      title: '세션 제목',
      updatedAt: 1_700_000_000_000
    })
  })
})
