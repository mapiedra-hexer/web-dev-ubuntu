import { useEffect, type ReactNode } from 'react'
import type { CmsType, ContainerState } from '@shared/types'

export function Button(props: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'danger' | 'default'
  disabled?: boolean
  title?: string
  type?: 'button' | 'submit'
  small?: boolean
}): JSX.Element {
  const { variant = 'default', small, ...rest } = props
  return (
    <button {...rest} type={props.type ?? 'button'} className={`btn btn-${variant}${small ? ' btn-sm' : ''}`}>
      {props.children}
    </button>
  )
}

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'ok' | 'warn' | 'error' | 'info' | 'wp' | 'ps' }): JSX.Element {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function CmsBadge({ type }: { type: CmsType }): JSX.Element {
  if (type === 'wordpress') return <Badge tone="wp">WordPress</Badge>
  if (type === 'prestashop') return <Badge tone="ps">PrestaShop</Badge>
  return <Badge>Desconocido</Badge>
}

export function StateDot({ state }: { state: ContainerState }): JSX.Element {
  const labels: Record<ContainerState, string> = {
    running: 'En marcha',
    exited: 'Parado',
    created: 'Creado',
    restarting: 'Reiniciando',
    paused: 'Pausado',
    missing: 'Sin contenedor'
  }
  return (
    <span className="state">
      <span className={`dot dot-${state}`} />
      {labels[state]}
    </span>
  )
}

export function Modal(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])
  return (
    <div className="modal-backdrop" onMouseDown={props.onClose}>
      <div className={`modal${props.wide ? ' modal-wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{props.title}</h3>
          <button className="icon-btn" onClick={props.onClose} aria-label="Cerrar">
            ×
          </button>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function ErrorBox({ error }: { error: string | null | undefined }): JSX.Element | null {
  if (!error) return null
  return <div className="alert alert-error">{error}</div>
}

export function Empty({ children }: { children: ReactNode }): JSX.Element {
  return <div className="empty">{children}</div>
}
