import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Job } from '@shared/types'
import { api } from '../api'
import { Modal } from './ui'

function JobLog({ job, onClose }: { job: Job; onClose: () => void }): JSX.Element {
  return (
    <Modal title={job.title} onClose={onClose} wide>
      {job.error && <div className="alert alert-error">{job.error}</div>}
      <pre className="log">{job.log.join('\n')}</pre>
    </Modal>
  )
}

/** Tareas en curso y recientes, siempre visibles en la barra lateral. */
export function JobsPanel(): JSX.Element | null {
  const qc = useQueryClient()
  const { data: jobs = [] } = useQuery({ queryKey: ['jobs'], queryFn: () => api.jobs() })
  const [openId, setOpenId] = useState<string | null>(null)
  const open = jobs.find((j) => j.id === openId)
  const visible = jobs.slice(0, 6)
  if (!visible.length) return null

  const dismiss = async (id: string): Promise<void> => {
    await api.dismissJob(id)
    qc.setQueryData<Job[]>(['jobs'], (prev = []) => prev.filter((j) => j.id !== id))
  }

  return (
    <div className="jobs">
      <div className="jobs-title">Tareas</div>
      {visible.map((j) => (
        <div key={j.id} className={`job job-${j.status}`} onClick={() => setOpenId(j.id)} title="Ver registro">
          <div className="job-head">
            <span className="job-name">{j.title}</span>
            {j.status !== 'running' && (
              <button
                className="icon-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  void dismiss(j.id)
                }}
                aria-label="Descartar"
              >
                ×
              </button>
            )}
          </div>
          <div className="job-step">{j.status === 'error' ? j.error : j.step}</div>
          {j.status === 'running' && (
            <div className="progress">
              <div
                className={`progress-bar${j.progress === null ? ' indeterminate' : ''}`}
                style={j.progress === null ? undefined : { width: `${Math.round(j.progress * 100)}%` }}
              />
            </div>
          )}
        </div>
      ))}
      {open && <JobLog job={open} onClose={() => setOpenId(null)} />}
    </div>
  )
}

/** Espera a que termine una tarea concreta (para encadenar acciones en la UI). */
export function useJob(id: string | null): Job | undefined {
  const { data: jobs = [] } = useQuery({ queryKey: ['jobs'], queryFn: () => api.jobs() })
  return id ? jobs.find((j) => j.id === id) : undefined
}
