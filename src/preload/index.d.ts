import type { DevhubApi, DevhubEvent } from '../shared/api'

declare global {
  interface Window {
    devhub: DevhubApi
    devhubEvents: { on(cb: (e: DevhubEvent) => void): () => void }
  }
}

export {}
