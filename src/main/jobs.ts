import { randomUUID } from 'crypto'
import type { Job } from '@shared/types'
import { emit } from './events'

const MAX_LOG = 400
const jobs = new Map<string, Job>()

export interface JobContext {
  job: Job
  step(name: string, progress?: number | null): void
  progress(value: number | null): void
  log(line: string): void
}

/**
 * Lanza una tarea larga en segundo plano y devuelve su id al instante.
 * La ventana sigue su progreso con los eventos `job`.
 */
export function startJob(title: string, fn: (ctx: JobContext) => Promise<void>, instanceId?: string): string {
  const job: Job = {
    id: randomUUID(),
    title,
    instanceId,
    status: 'running',
    step: 'Iniciando…',
    progress: null,
    log: [],
    startedAt: new Date().toISOString()
  }
  jobs.set(job.id, job)
  let lastEmit = 0
  const push = (force = false): void => {
    const now = Date.now()
    if (!force && now - lastEmit < 150) return
    lastEmit = now
    emit({ type: 'job', job: { ...job, log: [...job.log] } })
  }
  const ctx: JobContext = {
    job,
    step(name, progress = null) {
      job.step = name
      job.progress = progress
      job.log.push(`▶ ${name}`)
      push(true)
    },
    progress(value) {
      job.progress = value
      push()
    },
    log(line) {
      job.log.push(line)
      if (job.log.length > MAX_LOG) job.log.splice(0, job.log.length - MAX_LOG)
      push()
    }
  }
  push(true)
  fn(ctx)
    .then(() => {
      job.status = 'done'
      job.step = 'Completado'
      job.progress = 1
    })
    .catch((err: unknown) => {
      job.status = 'error'
      job.error = err instanceof Error ? err.message : String(err)
      job.log.push(`✖ ${job.error}`)
    })
    .finally(() => {
      job.finishedAt = new Date().toISOString()
      push(true)
      emit({ type: 'instances-changed' })
    })
  return job.id
}

export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

export function dismissJob(id: string): void {
  const j = jobs.get(id)
  if (j && j.status !== 'running') jobs.delete(id)
}

/** Evita dos tareas a la vez sobre la misma instancia. */
export function assertIdle(instanceId: string): void {
  for (const j of jobs.values()) {
    if (j.instanceId === instanceId && j.status === 'running') {
      throw new Error(`Ya hay una tarea en curso para ${instanceId}: ${j.title}`)
    }
  }
}
