import { EventEmitter } from 'events'
import type { DevhubEvent } from '@shared/api'

/** Bus de eventos del proceso principal; index.ts lo reenvía a las ventanas. */
export const bus = new EventEmitter()

export function emit(event: DevhubEvent): void {
  bus.emit('event', event)
}
