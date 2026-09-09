import { createReadStream } from 'fs'
import { createInterface } from 'readline'

export type JsonlEntry = Record<string, unknown>

/** onEntry가 false를 반환하면 나머지 라인을 읽지 않고 중단한다. */
export async function forEachJsonlLine(
  filePath: string,
  onEntry: (entry: JsonlEntry) => void | boolean
): Promise<void> {
  const stream = createReadStream(filePath, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      if (!line.trim()) continue
      let entry: JsonlEntry
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
      if (onEntry(entry) === false) break
    }
  } finally {
    rl.close()
    stream.destroy()
  }
}

export async function readHead(filePath: string, maxBytes: number): Promise<string> {
  const stream = createReadStream(filePath, { encoding: 'utf8', start: 0, end: maxBytes - 1 })
  let data = ''
  for await (const chunk of stream) data += chunk
  return data
}
