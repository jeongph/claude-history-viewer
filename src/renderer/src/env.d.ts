/// <reference types="vite/client" />

import type { SessionHistoryApi } from '../../shared/types'

declare global {
  interface Window {
    api: SessionHistoryApi
  }
}
