import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PHP_VERSIONS } from '@shared/php'
import type { DeviceCode, PhpVersion, Settings as S } from '@shared/types'
import { api, errMsg } from '../api'
import { Badge, Button, ErrorBox, Field } from '../components/ui'

const list = (s: string): string[] =>
  s
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean)

function Integrations(): JSX.Element {
  const qc = useQueryClient()
  const status = useQuery({ queryKey: ['integrations'], queryFn: () => api.integrations() })
  const [device, setDevice] = useState<DeviceCode | null>(null)
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const gh = status.data?.github
  const google = status.data?.google

  useEffect(() => {
    if (gh?.connected) setDevice(null)
  }, [gh?.connected])

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null)
    setBusy(true)
    try {
      const r = await fn()
      if (r && typeof r === 'object' && 'github' in r) qc.setQueryData(['integrations'], r)
      void qc.invalidateQueries({ queryKey: ['catalog'] })
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel">
      <h2>Integraciones</h2>
      <ErrorBox error={error} />
      <div className="integration">
        <div>
          <h3>GitHub</h3>
          {status.isLoading ? (
            <span className="muted">Comprobando…</span>
          ) : gh?.connected ? (
            <Badge tone="ok">Conectado como {gh.login}</Badge>
          ) : (
            <Badge tone="warn">{gh?.error ?? 'No conectado'}</Badge>
          )}
          {device && !gh?.connected && (
            <div className="device">
              Introduce este código en <a href="#" onClick={(e) => (e.preventDefault(), void api.openUrl(device.verificationUri))}>{device.verificationUri}</a>:
              <div className="device-code">{device.userCode}</div>
              <span className="muted">Esperando autorización…</span>
            </div>
          )}
        </div>
        <div className="col">
          {gh?.connected ? (
            <Button onClick={() => void run(() => api.githubLogout())}>Desconectar</Button>
          ) : (
            <>
              <Button variant="primary" disabled={busy || !gh?.clientIdConfigured} onClick={() => void run(async () => setDevice(await api.githubStartDeviceLogin()))}>
                Conectar con GitHub
              </Button>
              {!gh?.clientIdConfigured && <span className="muted small">Falta el client_id (Avanzado) — o usa un token:</span>}
              <div className="row">
                <input type="password" placeholder="Token personal (ghp_…)" value={token} onChange={(e) => setToken(e.target.value)} />
                <Button disabled={!token || busy} onClick={() => void run(() => api.githubSetToken(token))}>
                  Usar token
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="integration">
        <div>
          <h3>Google Drive</h3>
          {status.isLoading ? (
            <span className="muted">Comprobando…</span>
          ) : google?.connected ? (
            <Badge tone="ok">Conectado como {google.email}</Badge>
          ) : (
            <Badge tone="warn">{google?.error ?? 'No conectado'}</Badge>
          )}
        </div>
        <div className="col">
          {google?.connected ? (
            <Button onClick={() => void run(() => api.googleLogout())}>Desconectar</Button>
          ) : (
            <Button variant="primary" disabled={busy || !google?.clientIdConfigured} onClick={() => void run(() => api.googleLogin())}>
              {busy ? 'Esperando al navegador…' : 'Conectar con Google'}
            </Button>
          )}
          {!google?.clientIdConfigured && <span className="muted small">Falta el client_id de Google (Avanzado)</span>}
        </div>
      </div>
      <Button variant="ghost" onClick={() => void status.refetch()}>
        Comprobar de nuevo
      </Button>
    </section>
  )
}

export default function Settings(): JSX.Element {
  const qc = useQueryClient()
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings() })
  const [form, setForm] = useState<S | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (settings.data && !form) setForm(settings.data)
  }, [settings.data])

  if (!form) return <div className="page" />
  const set = <K extends keyof S>(k: K, v: S[K]): void => {
    setForm({ ...form, [k]: v })
    setSaved(false)
  }

  const save = async (): Promise<void> => {
    setError(null)
    try {
      const s = await api.saveSettings(form)
      qc.setQueryData(['settings'], s)
      void qc.invalidateQueries({ queryKey: ['catalog'] })
      void qc.invalidateQueries({ queryKey: ['integrations'] })
      void qc.invalidateQueries({ queryKey: ['checks'] })
      setSaved(true)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Configuración</h1>
      </header>
      <Integrations />

      <section className="panel">
        <h2>Proyectos</h2>
        <div className="grid2">
          <Field label="Organizaciones de GitHub" hint="Separadas por comas. Vacío: todos los repos a los que tienes acceso.">
            <input value={form.githubOrgs.join(', ')} onChange={(e) => set('githubOrgs', list(e.target.value))} placeholder="dobuss" />
          </Field>
          <Field label="ID de la carpeta de Drive con los volcados" hint="El final de la URL de la carpeta: drive.google.com/drive/folders/<ID>">
            <input value={form.driveFolderId} onChange={(e) => set('driveFolderId', e.target.value.trim().replace(/^.*folders\//, '').replace(/[?#].*$/, ''))} />
          </Field>
          <Field label="Prefijo de repos WordPress">
            <input
              value={form.repoPrefixes.find((p) => p.type === 'wordpress')?.prefix ?? ''}
              onChange={(e) => set('repoPrefixes', [...form.repoPrefixes.filter((p) => p.type !== 'wordpress'), { prefix: e.target.value, type: 'wordpress' }])}
            />
          </Field>
          <Field label="Prefijo de repos PrestaShop">
            <input
              value={form.repoPrefixes.find((p) => p.type === 'prestashop')?.prefix ?? ''}
              onChange={(e) => set('repoPrefixes', [...form.repoPrefixes.filter((p) => p.type !== 'prestashop'), { prefix: e.target.value, type: 'prestashop' }])}
            />
          </Field>
          <label className="check">
            <input type="checkbox" checked={form.showAllRepos} onChange={(e) => set('showAllRepos', e.target.checked)} /> Mostrar también repos sin
            esos prefijos
          </label>
          <Field label="Carpeta de proyectos">
            <div className="row">
              <input value={form.projectsDir} onChange={(e) => set('projectsDir', e.target.value)} />
              <Button
                onClick={async () => {
                  const d = await api.pickDirectory()
                  if (d) set('projectsDir', d)
                }}
              >
                Elegir…
              </Button>
            </div>
          </Field>
        </div>
      </section>

      <section className="panel">
        <h2>Entorno local</h2>
        <div className="grid2">
          <Field label="PHP por defecto">
            <select value={form.defaultPhp} onChange={(e) => set('defaultPhp', e.target.value as PhpVersion)}>
              {PHP_VERSIONS.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
          <label className="check">
            <input type="checkbox" checked={form.https} onChange={(e) => set('https', e.target.checked)} /> HTTPS local con mkcert
          </label>
          <Field label="Puerto HTTP">
            <input type="number" value={form.httpPort} onChange={(e) => set('httpPort', Number(e.target.value))} />
          </Field>
          <Field label="Puerto HTTPS">
            <input type="number" value={form.httpsPort} onChange={(e) => set('httpsPort', Number(e.target.value))} />
          </Field>
          <Field label="Usuario admin local">
            <input value={form.localAdminUser} onChange={(e) => set('localAdminUser', e.target.value)} />
          </Field>
          <Field label="Contraseña admin local" hint="Solo para las copias locales.">
            <input value={form.localAdminPassword} onChange={(e) => set('localAdminPassword', e.target.value)} />
          </Field>
          <Field label="Plugins de WordPress a desactivar al montar">
            <textarea rows={3} value={form.wpPluginsToDisable.join(', ')} onChange={(e) => set('wpPluginsToDisable', list(e.target.value))} />
          </Field>
          <Field label="Módulos de PrestaShop a desactivar al montar">
            <textarea rows={3} value={form.psModulesToDisable.join(', ')} onChange={(e) => set('psModulesToDisable', list(e.target.value))} />
          </Field>
        </div>
        <p className="muted small">Cambiar puertos o HTTPS requiere reiniciar los servicios comunes y los proyectos.</p>
      </section>

      <section className="panel">
        <h2>Avanzado</h2>
        <div className="grid2">
          <Field label="Registro de imágenes PHP" hint="p. ej. ghcr.io/dobuss/devhub-php. Vacío: se construyen en local.">
            <input value={form.imageRepository} onChange={(e) => set('imageRepository', e.target.value)} />
          </Field>
          <Field label="GitHub OAuth client_id" hint="Vacío: el incluido en la versión instalada.">
            <input value={form.githubClientId} onChange={(e) => set('githubClientId', e.target.value)} />
          </Field>
          <Field label="Google OAuth client_id">
            <input value={form.googleClientId} onChange={(e) => set('googleClientId', e.target.value)} />
          </Field>
          <Field label="Google OAuth client_secret" hint="De un cliente de tipo 'Aplicación de escritorio'.">
            <input type="password" value={form.googleClientSecret} onChange={(e) => set('googleClientSecret', e.target.value)} />
          </Field>
        </div>
      </section>

      <ErrorBox error={error} />
      <div className="sticky-save">
        <Button variant="primary" onClick={() => void save()}>
          Guardar
        </Button>
        {saved && <span className="ok-text">Guardado</span>}
      </div>
    </div>
  )
}
