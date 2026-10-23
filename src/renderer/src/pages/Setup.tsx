import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { CheckStatus } from '@shared/types'
import { api, errMsg } from '../api'
import { Button, ErrorBox } from '../components/ui'

const ICON: Record<CheckStatus, string> = { ok: '✓', warn: '!', error: '✕', pending: '…' }

export default function Setup(): JSX.Element {
  const checks = useQuery({ queryKey: ['checks'], queryFn: () => api.runChecks() })
  const core = useQuery({ queryKey: ['core'], queryFn: () => api.coreStatus() })
  const [error, setError] = useState<string | null>(null)

  const action = async (id: string): Promise<void> => {
    setError(null)
    try {
      await api.runCheckAction(id)
    } catch (e) {
      setError(errMsg(e))
    }
  }
  const allOk = checks.data?.every((c) => c.status === 'ok')

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Puesta en marcha</h1>
          <p className="muted">Comprueba que el equipo tiene todo lo necesario. Las acciones que necesitan permisos piden tu contraseña.</p>
        </div>
        <Button onClick={() => void checks.refetch()} disabled={checks.isFetching}>
          {checks.isFetching ? 'Comprobando…' : 'Comprobar de nuevo'}
        </Button>
      </header>
      <ErrorBox error={error} />
      {allOk && <div className="alert alert-ok">Todo listo. Ya puedes montar proyectos desde el Catálogo.</div>}
      <div className="checks">
        {checks.data?.map((c) => (
          <div key={c.id} className={`check-row check-${c.status}`}>
            <span className="check-icon">{ICON[c.status]}</span>
            <div className="grow">
              <strong>{c.label}</strong>
              <div className="muted">{c.detail}</div>
            </div>
            {c.action && (
              <Button variant={c.status === 'error' ? 'primary' : 'default'} onClick={() => void action(c.action!.id)}>
                {c.action.label}
              </Button>
            )}
          </div>
        ))}
      </div>

      <section className="panel">
        <h2>Servicios comunes</h2>
        <div className="row space">
          <div>
            {core.data?.services.length ? (
              core.data.services.map((s) => (
                <span key={s.name} className="svc">
                  <span className={`dot dot-${s.state === 'running' ? 'running' : 'exited'}`} /> {s.name.replace('devhub-', '')}
                </span>
              ))
            ) : (
              <span className="muted">No arrancados</span>
            )}
          </div>
          <div className="row">
            {core.data?.running ? (
              <Button onClick={() => void api.coreDown()}>Parar</Button>
            ) : (
              <Button variant="primary" onClick={() => void api.coreUp()}>
                Arrancar
              </Button>
            )}
          </div>
        </div>
        {core.data?.running && (
          <div className="row">
            {core.data.links.map((l) => (
              <Button key={l.url} variant="ghost" onClick={() => void api.openUrl(l.url)}>
                {l.label}
              </Button>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
