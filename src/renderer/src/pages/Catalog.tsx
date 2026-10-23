import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { searchCatalog } from '@shared/catalog'
import { isDomain, normalizeDomain } from '@shared/domain'
import { PHP_VERSIONS } from '@shared/php'
import type { CatalogRow, CmsType, MountRequest, PhpVersion } from '@shared/types'
import { api, errMsg, formatDate } from '../api'
import { DbSourcePicker } from '../components/DbSourcePicker'
import { Badge, Button, CmsBadge, Empty, ErrorBox, Field, Modal } from '../components/ui'

function MountDialog(props: { row?: CatalogRow; onClose: () => void; onMounted: () => void }): JSX.Element {
  const qc = useQueryClient()
  const { row } = props
  const [domain, setDomain] = useState(row?.domain ?? '')
  const [cloneUrl, setCloneUrl] = useState('')
  const [type, setType] = useState<CmsType>(row?.type ?? 'unknown')
  const [php, setPhp] = useState<PhpVersion | 'auto'>('auto')
  const [branch, setBranch] = useState('')
  const [saveDomain, setSaveDomain] = useState(true)
  const [source, setSource] = useState<MountRequest['dbSource'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const branches = useQuery({
    queryKey: ['branches', row?.repo?.fullName],
    queryFn: () => api.branches(row!.repo!.fullName),
    enabled: !!row?.repo
  })
  const normalized = normalizeDomain(domain)
  const manifestPhp = row?.dump?.manifest?.php_version

  const submit = async (): Promise<void> => {
    setError(null)
    if (!isDomain(normalized)) return setError('Indica un dominio válido (p. ej. zoraida.es)')
    if (!source) return setError('Elige el origen de la base de datos')
    if (!row?.repo && !cloneUrl) return setError('Indica la URL del repositorio')
    setBusy(true)
    try {
      if (row?.repo && !row.domain) await api.setRepoHomepage(row.repo.fullName, normalized, saveDomain)
      await api.mount({
        repoFullName: row?.repo?.fullName,
        cloneUrl: row?.repo ? undefined : cloneUrl,
        domain: normalized,
        type,
        php,
        branch: branch || undefined,
        dbSource: source
      })
      void qc.invalidateQueries({ queryKey: ['catalog'] })
      props.onMounted()
    } catch (e) {
      setError(errMsg(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={row?.repo ? `Montar ${row.repo.name}` : 'Montar desde URL'}
      onClose={props.onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy}>
            Montar en local
          </Button>
        </>
      }
    >
      <ErrorBox error={error} />
      <div className="grid2">
        {!row?.repo && (
          <Field label="URL del repositorio" hint="https://github.com/org/repo.git">
            <input value={cloneUrl} onChange={(e) => setCloneUrl(e.target.value)} autoFocus />
          </Field>
        )}
        <Field
          label="Dominio de producción"
          hint={normalized && isDomain(normalized) ? `Local: https://${normalized}.localhost` : 'Se usa para la URL local y para buscar la BD'}
        >
          <input value={domain} onChange={(e) => setDomain(e.target.value)} disabled={!!row?.domain} placeholder="zoraida.es" />
        </Field>
        {row?.repo && !row.domain && (
          <label className="check">
            <input type="checkbox" checked={saveDomain} onChange={(e) => setSaveDomain(e.target.checked)} /> Guardar también en "About" del repo en
            GitHub
          </label>
        )}
        <Field label="Tipo">
          <select value={type} onChange={(e) => setType(e.target.value as CmsType)}>
            <option value="unknown">Detectar automáticamente</option>
            <option value="wordpress">WordPress</option>
            <option value="prestashop">PrestaShop</option>
          </select>
        </Field>
        <Field label="Versión de PHP" hint={manifestPhp ? `El servidor usa PHP ${manifestPhp}` : 'Automático: manifiesto → composer.json → versión del CMS'}>
          <select value={php} onChange={(e) => setPhp(e.target.value as PhpVersion | 'auto')}>
            <option value="auto">Automático</option>
            {PHP_VERSIONS.map((v) => (
              <option key={v} value={v}>
                PHP {v}
              </option>
            ))}
          </select>
        </Field>
        {row?.repo && (
          <Field label="Rama">
            <select value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">{row.repo.defaultBranch} (por defecto)</option>
              {(branches.data ?? [])
                .filter((b) => b !== row.repo!.defaultBranch)
                .map((b) => (
                  <option key={b}>{b}</option>
                ))}
            </select>
          </Field>
        )}
      </div>
      <h4>Base de datos</h4>
      <DbSourcePicker domain={normalized || 'proyecto'} autoDump={row?.dump} onChange={setSource} />
    </Modal>
  )
}

export default function Catalog({ onMounted }: { onMounted: () => void }): JSX.Element {
  const [query, setQuery] = useState('')
  const [mounting, setMounting] = useState<CatalogRow | 'url' | null>(null)
  const cached = useQuery({ queryKey: ['catalog', 'cached'], queryFn: () => api.catalog(false) })
  const fresh = useQuery({ queryKey: ['catalog', 'fresh'], queryFn: () => api.catalog(true), staleTime: 5 * 60 * 1000 })
  const integrations = useQuery({ queryKey: ['integrations'], queryFn: () => api.integrations() })
  const all = fresh.data ?? cached.data ?? []
  const errors = all.find((r) => r.key === '__errors')
  const rows = useMemo(() => searchCatalog(all.filter((r) => r.key !== '__errors'), query), [all, query])

  const notConnected = integrations.data && !integrations.data.github.connected

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Catálogo</h1>
          <p className="muted">Repos de GitHub y copias de BD de Drive, cruzados por dominio.</p>
        </div>
        <div className="row">
          <Button onClick={() => setMounting('url')}>Montar desde URL</Button>
          <Button onClick={() => void fresh.refetch()} disabled={fresh.isFetching}>
            {fresh.isFetching ? 'Actualizando…' : 'Actualizar'}
          </Button>
        </div>
      </header>

      {notConnected && <div className="alert alert-warn">Conecta GitHub en Configuración para ver los repositorios.</div>}
      {errors && <div className="alert alert-error">{errors.warnings.join(' · ')}</div>}
      <ErrorBox error={fresh.error ? errMsg(fresh.error) : null} />

      <input
        className="search"
        placeholder="Buscar por dominio o repo: zoraida.es, dob-wordpress-zoraida, https://www.zoraida.es/…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />

      {rows.length === 0 ? (
        <Empty>{all.length ? 'Ningún proyecto coincide con la búsqueda.' : fresh.isFetching ? 'Cargando…' : 'No hay proyectos.'}</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Dominio</th>
              <th>Repositorio</th>
              <th>Tipo</th>
              <th>Copia BD</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>
                  <strong>{r.domain ?? <span className="muted">sin dominio</span>}</strong>
                  {r.warnings.map((w) => (
                    <div key={w} className="warn-text">
                      {w}
                    </div>
                  ))}
                </td>
                <td>
                  {r.repo ? (
                    <>
                      {r.repo.name}
                      <div className="muted small">{r.repo.description || `Último push ${formatDate(r.repo.pushedAt)}`}</div>
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <CmsBadge type={r.type} />
                </td>
                <td>{r.dump ? <span title={r.dump.name}>{formatDate(r.dump.modifiedTime)}</span> : <span className="muted">—</span>}</td>
                <td className="right">
                  {r.mountedIds.length ? (
                    <Badge tone="ok">Montado</Badge>
                  ) : r.repo ? (
                    <Button small variant="primary" onClick={() => setMounting(r)}>
                      Montar
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {mounting && (
        <MountDialog
          row={mounting === 'url' ? undefined : mounting}
          onClose={() => setMounting(null)}
          onMounted={() => {
            setMounting(null)
            onMounted()
          }}
        />
      )}
    </div>
  )
}
