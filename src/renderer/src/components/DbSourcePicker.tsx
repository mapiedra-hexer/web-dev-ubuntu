import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { DumpFile, MountRequest } from '@shared/types'
import { api, errMsg, formatBytes, formatDate } from '../api'

type Source = MountRequest['dbSource']
type Mode = 'auto' | 'drive' | 'local' | 'none'

/**
 * Origen de la BD en cascada: copia automática por dominio en Drive → buscador de
 * Drive → archivo local → sin BD (queda "Pendiente de BD").
 */
export function DbSourcePicker(props: { domain: string; autoDump?: DumpFile; onChange: (s: Source | null) => void }): JSX.Element {
  const integrations = useQuery({ queryKey: ['integrations'], queryFn: () => api.integrations() })
  const driveOk = integrations.data?.google.connected ?? false
  const initial: Mode = props.autoDump ? 'auto' : driveOk ? 'drive' : 'local'
  const [mode, setMode] = useState<Mode>(initial)
  const [term, setTerm] = useState(props.domain.split('.')[0] ?? '')
  const [everywhere, setEverywhere] = useState(false)
  const [results, setResults] = useState<DumpFile[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [picked, setPicked] = useState<DumpFile | null>(null)
  const [localPath, setLocalPath] = useState<string | null>(null)

  useEffect(() => {
    if (!integrations.isFetched) return
    setMode(props.autoDump ? 'auto' : driveOk ? 'drive' : 'local')
  }, [integrations.isFetched, driveOk, props.autoDump])

  const search = async (): Promise<void> => {
    setSearching(true)
    setSearchError(null)
    try {
      setResults(await api.driveSearch(term, everywhere))
    } catch (e) {
      setSearchError(errMsg(e))
    } finally {
      setSearching(false)
    }
  }

  useEffect(() => {
    if (mode === 'drive' && driveOk && results === null && term) void search()
  }, [mode, driveOk])

  useEffect(() => {
    if (mode === 'auto') props.onChange({ kind: 'auto' })
    else if (mode === 'none') props.onChange({ kind: 'none' })
    else if (mode === 'local') props.onChange(localPath ? { kind: 'local', path: localPath } : null)
    else props.onChange(picked ? { kind: 'drive', fileId: picked.id, name: picked.name, modifiedTime: picked.modifiedTime, size: picked.size } : null)
  }, [mode, picked, localPath])

  return (
    <div className="dbsource">
      <label className={`radio${!props.autoDump ? ' disabled' : ''}`}>
        <input type="radio" checked={mode === 'auto'} disabled={!props.autoDump} onChange={() => setMode('auto')} />
        <div>
          <strong>Copia de Drive para {props.domain}</strong>
          <div className="muted">
            {props.autoDump
              ? `${props.autoDump.name} · ${formatDate(props.autoDump.modifiedTime)} · ${formatBytes(props.autoDump.size)}`
              : driveOk
                ? 'No se ha encontrado ningún volcado con este nombre'
                : 'Drive no está conectado'}
          </div>
        </div>
      </label>

      <label className={`radio${!driveOk ? ' disabled' : ''}`}>
        <input type="radio" checked={mode === 'drive'} disabled={!driveOk} onChange={() => setMode('drive')} />
        <div className="grow">
          <strong>Buscar en Drive</strong>
          {mode === 'drive' && (
            <div className="drive-search">
              <div className="row">
                <input
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void search()}
                  placeholder="Nombre del volcado"
                />
                <button className="btn btn-sm" onClick={() => void search()} disabled={searching || !term}>
                  {searching ? 'Buscando…' : 'Buscar'}
                </button>
              </div>
              <label className="check">
                <input type="checkbox" checked={everywhere} onChange={(e) => setEverywhere(e.target.checked)} /> Buscar en todo mi Drive y unidades compartidas
              </label>
              {searchError && <div className="alert alert-error">{searchError}</div>}
              {results && (
                <div className="results">
                  {results.length === 0 && <div className="muted">Sin resultados</div>}
                  {results.map((r) => (
                    <div key={r.id} className={`result${picked?.id === r.id ? ' selected' : ''}`} onClick={() => setPicked(r)}>
                      <span>{r.name}</span>
                      <span className="muted">
                        {formatDate(r.modifiedTime)} · {formatBytes(r.size)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </label>

      <label className="radio">
        <input type="radio" checked={mode === 'local'} onChange={() => setMode('local')} />
        <div className="grow">
          <strong>Archivo local</strong>
          {mode === 'local' && (
            <div className="row">
              <span className="muted path">{localPath ?? '.sql, .sql.gz o .zip'}</span>
              <button
                className="btn btn-sm"
                onClick={async () => {
                  const p = await api.pickDumpFile()
                  if (p) setLocalPath(p)
                }}
              >
                Elegir…
              </button>
            </div>
          )}
        </div>
      </label>

      <label className="radio">
        <input type="radio" checked={mode === 'none'} onChange={() => setMode('none')} />
        <div>
          <strong>Sin base de datos por ahora</strong>
          <div className="muted">El proyecto queda "Pendiente de BD" y podrás importarla después.</div>
        </div>
      </label>
    </div>
  )
}
