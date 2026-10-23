import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Job } from '@shared/types'

export const api = window.devhub

/** Quita el prefijo "Error invoking remote method ..." que añade Electron. */
export function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** Conecta los eventos del proceso principal con la caché de TanStack Query. */
export function useDevhubEvents(): void {
  const qc = useQueryClient()
  useEffect(
    () =>
      window.devhubEvents.on((e) => {
        if (e.type === 'job') {
          qc.setQueryData<Job[]>(['jobs'], (prev = []) => {
            const rest = prev.filter((j) => j.id !== e.job.id)
            return [e.job, ...rest].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
          })
          if (e.job.status !== 'running') {
            void qc.invalidateQueries({ queryKey: ['instances'] })
            void qc.invalidateQueries({ queryKey: ['checks'] })
            void qc.invalidateQueries({ queryKey: ['core'] })
          }
        } else if (e.type === 'instances-changed') {
          void qc.invalidateQueries({ queryKey: ['instances'] })
        } else if (e.type === 'github-login') {
          qc.setQueryData(['integrations'], e.status)
          void qc.invalidateQueries({ queryKey: ['catalog'] })
        }
      }),
    [qc]
  )
}

export function formatBytes(n?: number): string {
  if (!n && n !== 0) return ''
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`
}

export function formatDate(iso?: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
