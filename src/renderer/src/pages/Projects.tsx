import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { localDomainFor, toLabel } from '@shared/domain'
import { PHP_VERSIONS } from '@shared/php'
import type { InstanceView, MountRequest, PhpVersion } from '@shared/types'
import { api, errMsg, formatBytes, formatDate } from '../api'
import { DbSourcePicker } from '../components/DbSourcePicker'
import { Badge, Button, CmsBadge, Empty, ErrorBox, Field, Modal, StateDot } from '../components/ui'

type Dialog =
  | { kind: 'duplicate' | 'import' | 'logs' | 'snapshots' | 'updates' | 'remove' | 'php'; inst: InstanceView }
  | null

async function act(fn: () => Promise<unknown>, setError: (e: string | null) => void): Promise<void> {
  setError(null)
  try {
    await fn()
  } catch (e) {
    setError(errMsg(e))
  }
}

function DuplicateDialog({ inst, onClose }: { inst: InstanceView; onClose: () => void }): JSX.Element {
  const [php, setPhp] = useState<PhpVersion>(inst.php === '8.3' ? '8.4' : '8.3')
  const [label, setLabel] = useState(`php${(inst.php === '8.3' ? '8.4' : '8.3').replace('.', '')}`)
  const [mode, setMode] = useState<'shared' | 'worktree'>(inst.type === 'prestashop' ? 'worktree' : 'shared')
  const [base, setBase] = useState(inst.branch)
  const [newBranch, setNewBranch] = useState('')
  const [copyIgnored, setCopyIgnored] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const branches = useQuery({
    queryKey: ['branches', inst.repoFullName],
    queryFn: () => api.branches(inst.repoFullName!),
    enabled: !!inst.repoFullName
  })
  const cleanLabel = toLabel(label)

  return (
    <Modal
      title={`Duplicar ${inst.localDomain}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={() =>
              void act(async () => {
                await api.duplicate({ sourceId: inst.id, label, php, codeMode: mode, baseBranch: base, newBranch, copyIgnored })
                onClose()
              }, setError)
            }
          >
            Duplicar
          </Button>
        </>
      }
    >
      <ErrorBox error={error} />
      <p className="muted">Crea una copia con su propia BD para probar otra versión de PHP o una rama.</p>
      <div className="grid2">
        <Field label="Versión de PHP">
          <select
            value={php}
            onChange={(e) => {
              const v = e.target.value as PhpVersion
              setPhp(v)
              setLabel(`php${v.replace('.', '')}`)
            }}
          >
            {PHP_VERSIONS.map((v) => (
              <option key={v} value={v}>
                PHP {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Etiqueta" hint={cleanLabel ? `https://${localDomainFor(inst.domain, cleanLabel)}` : ''}>
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
      </div>
      <Field label="Código">
        <select value={mode} onChange={(e) => setMode(e.target.value as 'shared' | 'worktree')}>
          {inst.type !== 'prestashop' && <option value="shared">Misma carpeta (solo cambia PHP y BD)</option>}
          <option value="worktree">Carpeta propia (git worktree, otra rama)</option>
        </select>
      </Field>
      {mode === 'worktree' && (
        <div className="grid2">
          <Field label="Partir de la rama">
            <select value={base} onChange={(e) => setBase(e.target.value)}>
              {[inst.branch, ...(branches.data ?? []).filter((b) => b !== inst.branch)].map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </Field>
          <Field label="Nueva rama" hint="Vacío: usar la rama elegida (no puede estar ya en uso en otra carpeta)">
            <input value={newBranch} onChange={(e) => setNewBranch(e.target.value)} placeholder={`${base}-${cleanLabel}`} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={copyIgnored} onChange={(e) => setCopyIgnored(e.target.checked)} /> Copiar ficheros no versionados
            (uploads, vendor…)
          </label>
        </div>
      )}
    </Modal>
  )
}

function ImportDialog({ inst, onClose }: { inst: InstanceView; onClose: () => void }): JSX.Element {
  const catalog = useQuery({ queryKey: ['catalog', 'cached'], queryFn: () => api.catalog(false) })
  const dump = catalog.data?.find((r) => r.domain === inst.domain)?.dump
  const [source, setSource] = useState<MountRequest['dbSource'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal
      title={`Importar BD en ${inst.localDomain}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            disabled={!source || source.kind === 'none'}
            onClick={() =>
              void act(async () => {
                await api.importDb(inst.id, source!)
                onClose()
              }, setError)
            }
          >
            Importar (reemplaza la BD actual)
          </Button>
        </>
      }
    >
      <ErrorBox error={error} />
      {!catalog.isLoading && <DbSourcePicker domain={inst.domain} autoDump={dump} onChange={setSource} />}
    </Modal>
  )
}

function LogsDialog({ inst, onClose }: { inst: InstanceView; onClose: () => void }): JSX.Element {
  const logs = useQuery({ queryKey: ['logs', inst.id], queryFn: () => api.logs(inst.id, 400), refetchInterval: 3000 })
  return (
    <Modal title={`Logs de ${inst.localDomain}`} onClose={onClose} wide>
      <pre className="log">{logs.data ?? 'Cargando…'}</pre>
    </Modal>
  )
}

function SnapshotsDialog({ inst, onClose }: { inst: InstanceView; onClose: () => void }): JSX.Element {
  const snaps = useQuery({ queryKey: ['snapshots', inst.id], queryFn: () => api.snapshots(inst.id), refetchInterval: 4000 })
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal title="Puntos de restauración de la BD" onClose={onClose} wide>
      <ErrorBox error={error} />
      <div className="row space">
        <span className="muted">Guarda la BD antes de probar una actualización y vuelve atrás si algo falla.</span>
        <Button variant="primary" onClick={() => void act(() => api.createSnapshot(inst.id), setError)}>
          Guardar ahora
        </Button>
      </div>
      {snaps.data?.length ? (
        <table className="table">
          <tbody>
            {snaps.data.map((s) => (
              <tr key={s.name}>
                <td>{formatDate(s.createdAt)}</td>
                <td className="muted">{formatBytes(s.size)}</td>
                <td className="right">
                  <Button small onClick={() => confirm('¿Reemplazar la BD actual por este punto?') && void act(() => api.restoreSnapshot(inst.id, s.name), setError)}>
                    Restaurar
                  </Button>{' '}
                  <Button small variant="danger" onClick={() => void act(() => api.deleteSnapshot(inst.id, s.name), setError).then(() => snaps.refetch())}>
                    Borrar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>No hay puntos guardados.</Empty>
      )}
    </Modal>
  )
}

function UpdatesDialog({ inst, onClose }: { inst: InstanceView; onClose: () => void }): JSX.Element {
  const updates = useQuery({ queryKey: ['updates', inst.id], queryFn: () => api.pluginUpdates(inst.id) })
  const [error, setError] = useState<string | null>(null)
  const [module, setModule] = useState('')
  const run = (what: string): void => void act(() => api.runUpdates(inst.id, what), setError)
  return (
    <Modal title={`Actualizaciones de ${inst.localDomain}`} onClose={onClose} wide>
      <ErrorBox error={error} />
      {inst.parentId ? null : (
        <div className="alert alert-warn">Consejo: prueba las actualizaciones en un duplicado, no en la instancia principal.</div>
      )}
      {inst.type === 'wordpress' && (
        <>
          {updates.isLoading && <Empty>Consultando wp-cli…</Empty>}
          {updates.error && <ErrorBox error={errMsg(updates.error)} />}
          {updates.data?.length === 0 && <Empty>Todo está al día.</Empty>}
          {!!updates.data?.length && (
            <>
              <table className="table">
                <tbody>
                  {updates.data.map((u) => (
                    <tr key={u.name}>
                      <td>{u.name === 'core' ? <strong>WordPress</strong> : u.name}</td>
                      <td className="muted">
                        {u.version} → {u.updateVersion}
                      </td>
                      <td className="right">
                        <Button small onClick={() => run(u.name)}>
                          Actualizar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Button variant="primary" onClick={() => run('plugins')}>
                Actualizar todos los plugins
              </Button>
            </>
          )}
        </>
      )}
      {inst.type === 'prestashop' && (
        <>
          <p className="muted">PrestaShop 1.7+ permite actualizar módulos con bin/console. Indica el nombre técnico del módulo.</p>
          <div className="row">
            <input value={module} onChange={(e) => setModule(e.target.value)} placeholder="ps_facetedsearch" />
            <Button onClick={() => module && run(module)}>Actualizar módulo</Button>
          </div>
        </>
      )}
    </Modal>
  )
}

function RemoveDialog({ inst, onClose }: { inst: InstanceView; onClose: () => void }): JSX.Element {
  const [keepCode, setKeepCode] = useState(true)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal
      title={`Eliminar ${inst.localDomain}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={() =>
              void act(async () => {
                await api.remove(inst.id, keepCode)
                onClose()
              }, setError)
            }
          >
            Eliminar
          </Button>
        </>
      }
    >
      <ErrorBox error={error} />
      <p>Se borrarán el contenedor, la base de datos local y sus puntos de restauración.</p>
      {inst.ownsCode && (
        <label className="check">
          <input type="checkbox" checked={keepCode} onChange={(e) => setKeepCode(e.target.checked)} /> Conservar el código en {inst.codePath}
        </label>
      )}
      {!keepCode && <div className="alert alert-warn">Los cambios sin commit ni push de esa carpeta se perderán.</div>}
    </Modal>
  )
}

function PhpDialog({ inst, onClose }: { inst: InstanceView; onClose: () => void }): JSX.Element {
  const [php, setPhp] = useState<PhpVersion>(inst.php)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal
      title="Cambiar versión de PHP"
      onClose={onClose}
      footer={
        <Button
          variant="primary"
          onClick={() =>
            void act(async () => {
              await api.changePhp(inst.id, php)
              onClose()
            }, setError)
          }
        >
          Aplicar
        </Button>
      }
    >
      <ErrorBox error={error} />
      <select value={php} onChange={(e) => setPhp(e.target.value as PhpVersion)}>
        {PHP_VERSIONS.map((v) => (
          <option key={v} value={v}>
            PHP {v}
          </option>
        ))}
      </select>
    </Modal>
  )
}

function InstanceCard({ inst, open, onError }: { inst: InstanceView; open: (d: Dialog) => void; onError: (e: string | null) => void }): JSX.Element {
  const running = inst.state === 'running'
  const [menu, setMenu] = useState(false)
  const run = (fn: () => Promise<unknown>): void => void act(fn, onError)
  return (
    <div className={`card${inst.parentId ? ' card-child' : ''}`}>
      <div className="card-head">
        <div>
          <div className="card-title">
            <a href="#" onClick={(e) => (e.preventDefault(), run(() => api.openUrl(inst.url)))}>
              {inst.localDomain}
            </a>
          </div>
          <div className="card-meta">
            <StateDot state={inst.state} />
            <CmsBadge type={inst.type} />
            {inst.cmsVersion && <Badge>{inst.cmsVersion}</Badge>}
            <Badge tone="info">PHP {inst.php}</Badge>
            {inst.branch && <Badge>⎇ {inst.branch}</Badge>}
            {inst.xdebug && <Badge tone="warn">Xdebug</Badge>}
            {inst.dbStatus === 'pending' && <Badge tone="warn">Pendiente de BD</Badge>}
            {inst.dbStatus === 'error' && <Badge tone="error">Error en BD</Badge>}
            {inst.dbStatus === 'importing' && <Badge tone="info">Importando BD…</Badge>}
          </div>
        </div>
        <div className="row">
          {running ? (
            <Button onClick={() => run(() => api.stop(inst.id))}>■ Parar</Button>
          ) : (
            <Button variant="primary" onClick={() => run(() => api.start(inst.id))}>
              ▶ Arrancar
            </Button>
          )}
          <Button onClick={() => run(() => api.openEditor(inst.id))}>Editor</Button>
          <div className="menu-wrap">
            <Button onClick={() => setMenu(!menu)}>⋯</Button>
            {menu && (
              <div className="menu" onMouseLeave={() => setMenu(false)} onClick={() => setMenu(false)}>
                <button onClick={() => open({ kind: 'duplicate', inst })}>Duplicar (otra rama / PHP)…</button>
                <button onClick={() => open({ kind: 'php', inst })}>Cambiar PHP…</button>
                <button onClick={() => open({ kind: 'import', inst })}>{inst.dbStatus === 'ready' ? 'Reimportar BD…' : 'Importar BD…'}</button>
                <button onClick={() => open({ kind: 'snapshots', inst })}>Puntos de restauración…</button>
                <button onClick={() => open({ kind: 'updates', inst })}>Actualizaciones…</button>
                <hr />
                <button onClick={() => run(() => api.openTerminal(inst.id))}>Terminal en el contenedor</button>
                <button onClick={() => run(() => api.openFolder(inst.id))}>Abrir carpeta</button>
                <button onClick={() => open({ kind: 'logs', inst })}>Logs</button>
                <button onClick={() => run(() => api.setXdebug(inst.id, !inst.xdebug))}>{inst.xdebug ? 'Desactivar' : 'Activar'} Xdebug</button>
                <button onClick={() => run(() => api.clearCache(inst.id))}>Vaciar caché</button>
                <button onClick={() => run(() => api.resetAdmin(inst.id))}>Regenerar admin local</button>
                <hr />
                <button className="danger" onClick={() => open({ kind: 'remove', inst })}>
                  Eliminar…
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="card-body">
        <div className="kv">
          <span>Código</span>
          <code>{inst.codePath}</code>
        </div>
        <div className="kv">
          <span>BD</span>
          <code>{inst.dbName}</code>
          {inst.dbImportedAt && <span className="muted"> · importada {formatDate(inst.dbImportedAt)}</span>}
        </div>
        {inst.adminLogin && (
          <div className="kv">
            <span>Admin</span>
            <a href="#" onClick={(e) => (e.preventDefault(), run(() => api.openUrl(inst.adminLogin!.url)))}>
              {inst.adminLogin.url}
            </a>
            <code>
              {inst.adminLogin.user} / {inst.adminLogin.password}
            </code>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Projects({ goCatalog }: { goCatalog: () => void }): JSX.Element {
  const { data: instances = [], isLoading } = useQuery({ queryKey: ['instances'], queryFn: () => api.instances() })
  const core = useQuery({ queryKey: ['core'], queryFn: () => api.coreStatus() })
  const [dialog, setDialog] = useState<Dialog>(null)
  const [error, setError] = useState<string | null>(null)

  // Principal seguida de sus duplicados.
  const roots = instances.filter((i) => !i.parentId)
  const ordered = roots.flatMap((r) => [r, ...instances.filter((i) => i.parentId === r.id)])
  const orphans = instances.filter((i) => i.parentId && !roots.some((r) => r.id === i.parentId))
  const close = (): void => setDialog(null)

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Mis proyectos</h1>
          <p className="muted">Proyectos montados en este equipo.</p>
        </div>
        <div className="row">
          {core.data?.links.map((l) => (
            <Button key={l.url} variant="ghost" onClick={() => void api.openUrl(l.url)}>
              {l.label}
            </Button>
          ))}
          <Button variant="primary" onClick={goCatalog}>
            + Montar proyecto
          </Button>
        </div>
      </header>
      <ErrorBox error={error} />
      {core.data && !core.data.running && instances.length > 0 && (
        <div className="alert alert-warn">
          Los servicios comunes están parados.{' '}
          <Button small onClick={() => void act(() => api.coreUp(), setError)}>
            Arrancar
          </Button>
        </div>
      )}
      {isLoading ? null : instances.length === 0 ? (
        <Empty>
          Todavía no hay proyectos montados.{' '}
          <Button variant="primary" onClick={goCatalog}>
            Ir al catálogo
          </Button>
        </Empty>
      ) : (
        <div className="cards">
          {[...ordered, ...orphans].map((i) => (
            <InstanceCard key={i.id} inst={i} open={setDialog} onError={setError} />
          ))}
        </div>
      )}
      {dialog?.kind === 'duplicate' && <DuplicateDialog inst={dialog.inst} onClose={close} />}
      {dialog?.kind === 'import' && <ImportDialog inst={dialog.inst} onClose={close} />}
      {dialog?.kind === 'logs' && <LogsDialog inst={dialog.inst} onClose={close} />}
      {dialog?.kind === 'snapshots' && <SnapshotsDialog inst={dialog.inst} onClose={close} />}
      {dialog?.kind === 'updates' && <UpdatesDialog inst={dialog.inst} onClose={close} />}
      {dialog?.kind === 'remove' && <RemoveDialog inst={dialog.inst} onClose={close} />}
      {dialog?.kind === 'php' && <PhpDialog inst={dialog.inst} onClose={close} />}
    </div>
  )
}
