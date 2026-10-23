import type { CmsType } from '@shared/types'
import { prestashop } from './prestashop'
import type { Stack } from './types'
import { wordpress } from './wordpress'

export function stackFor(type: CmsType): Stack | null {
  if (type === 'wordpress') return wordpress
  if (type === 'prestashop') return prestashop
  return null
}
