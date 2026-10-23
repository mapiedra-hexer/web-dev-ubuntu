import { existsSync, statfsSync } from 'fs'
import { userInfo } from 'os'
import { join } from 'path'
import type { SetupCheck } from '@shared/types'
import { coreServices } from '../docker'
import { run, which } from '../exec'
import { paths, resource } from '../paths'
import { getSettings } from '../store'
import { coreUp } from '../core/core'
import { ensureImage, imageRef } from '../core/images'

async function out(cmd: string, args: string[]): Promise<{ ok: boolean; text: string }> {
  try {
    const r = await run(cmd, args, { allowFail: true, timeoutMs: 15000 })
    return { ok: r.code === 0, text: (r.stdout || r.stderr).trim() }
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : String(e) }
  }
}

/** Procesos escuchando en un puerto TCP (ss sin root no muestra el proceso, pero sí la ocupación). */
async function portUsage(port: number): Promise<string | null> {
  const r = await out('ss', ['-ltnH', `sport = :${port}`])
  return r.ok && r.text ? r.text : null
}

async function lamppRunning(): Promise<boolean> {
  if (!existsSync('/opt/lampp')) return false
  const r = await out('pgrep', ['-f', '/opt/lampp/bin/httpd'])
  return r.ok
}

export async function runChecks(): Promise<SetupCheck[]> {
  const s = getSettings()
  const checks: SetupCheck[] = []

  const dockerBin = await which('docker')
  checks.push(
    dockerBin
      ? { id: 'docker', label: 'Docker instalado', status: 'ok', detail: (await out('docker', ['--version'])).text }
      : {
          id: 'docker',
          label: 'Docker instalado',
          status: 'error',
          detail: 'No se encuentra el comando docker.',
          action: { id: 'install-docker', label: 'Instalar Docker' }
        }
  )

  let daemonOk = false
  if (dockerBin) {
    const info = await out('docker', ['info', '--format', '{{.ServerVersion}}'])
    daemonOk = info.ok
    if (info.ok) checks.push({ id: 'daemon', label: 'Docker accesible sin sudo', status: 'ok', detail: `Servidor ${info.text}` })
    else if (/permission denied/i.test(info.text)) {
      const groups = (await out('id', ['-nG'])).text.split(/\s+/)
      checks.push({
        id: 'daemon',
        label: 'Docker accesible sin sudo',
        status: 'error',
        detail: groups.includes('docker')
          ? 'Ya estás en el grupo docker: cierra sesión y vuelve a entrar para que se aplique.'
          : 'Tu usuario no está en el grupo docker.',
        action: groups.includes('docker') ? undefined : { id: 'docker-group', label: 'Añadirme al grupo docker' }
      })
    } else
      checks.push({
        id: 'daemon',
        label: 'Docker en marcha',
        status: 'error',
        detail: info.text || 'El servicio Docker no responde.',
        action: { id: 'start-docker', label: 'Arrancar Docker' }
      })

    const comp = await out('docker', ['compose', 'version', '--short'])
    checks.push(
      comp.ok
        ? { id: 'compose', label: 'Docker Compose v2', status: 'ok', detail: comp.text }
        : {
            id: 'compose',
            label: 'Docker Compose v2',
            status: 'error',
            detail: 'Falta el plugin "docker compose".',
            action: { id: 'install-docker', label: 'Instalar' }
          }
    )
  }

  const git = await which('git')
  checks.push(
    git
      ? { id: 'git', label: 'Git', status: 'ok', detail: (await out('git', ['--version'])).text }
      : { id: 'git', label: 'Git', status: 'error', detail: 'Instala git (apt install git).' }
  )

  if (s.https) {
    const mk = await which('mkcert')
    if (!mk) {
      checks.push({
        id: 'mkcert',
        label: 'mkcert (HTTPS local)',
        status: 'warn',
        detail: 'Sin mkcert los proyectos se sirven solo por HTTP.',
        action: { id: 'install-mkcert', label: 'Instalar mkcert' }
      })
    } else {
      const caroot = (await out('mkcert', ['-CAROOT'])).text
      const caExists = existsSync(join(caroot, 'rootCA.pem'))
      const systemTrusted = existsSync('/usr/local/share/ca-certificates/devhub-mkcert-rootCA.crt')
      checks.push({
        id: 'mkcert',
        label: 'Certificados HTTPS de confianza',
        status: caExists && systemTrusted ? 'ok' : 'warn',
        detail: caExists && systemTrusted ? `CA local en ${caroot}` : 'La CA local no está instalada en el sistema y los navegadores.',
        action: caExists && systemTrusted ? undefined : { id: 'install-ca', label: 'Instalar CA' }
      })
    }
  }

  const coreRunning = (await coreServices()).some((c) => c.name === 'devhub-traefik' && c.state === 'running')
  for (const port of s.https ? [s.httpPort, s.httpsPort] : [s.httpPort]) {
    const used = await portUsage(port)
    if (!used || coreRunning) {
      checks.push({ id: `port-${port}`, label: `Puerto ${port}`, status: 'ok', detail: coreRunning ? 'Usado por DevHub' : 'Libre' })
      continue
    }
    const lampp = await lamppRunning()
    checks.push({
      id: `port-${port}`,
      label: `Puerto ${port}`,
      status: 'error',
      detail: lampp
        ? 'Ocupado por LAMPP (/opt/lampp). Hay que pararlo para usar DevHub.'
        : `Ocupado por otro servicio (apache2, nginx u otro contenedor). Puedes liberarlo o cambiar el puerto en Configuración.`,
      action: lampp ? { id: 'stop-lampp', label: 'Parar LAMPP' } : { id: 'stop-apache', label: 'Parar apache2/nginx' }
    })
  }

  try {
    const st = statfsSync(paths.data)
    const freeGb = (st.bavail * st.bsize) / 1024 ** 3
    checks.push({
      id: 'disk',
      label: 'Espacio en disco',
      status: freeGb > 10 ? 'ok' : freeGb > 3 ? 'warn' : 'error',
      detail: `${freeGb.toFixed(1)} GB libres`
    })
  } catch {
    /* sin datos de disco */
  }

  if (daemonOk) {
    const ref = imageRef(s.defaultPhp)
    const has = (await out('docker', ['image', 'inspect', ref, '--format', '{{.Id}}'])).ok
    checks.push({
      id: 'image',
      label: `Imagen PHP ${s.defaultPhp}`,
      status: has ? 'ok' : 'warn',
      detail: has ? ref : 'Se descargará o construirá al montar el primer proyecto.',
      action: has ? undefined : { id: 'image', label: 'Preparar ahora' }
    })
    const services = await coreServices()
    const running = services.length >= 4 && services.every((x) => x.state === 'running')
    checks.push({
      id: 'core',
      label: 'Servicios comunes (Traefik, MariaDB, phpMyAdmin, Mailpit)',
      status: running ? 'ok' : 'warn',
      detail: running ? 'En marcha' : services.length ? services.map((x) => `${x.name}: ${x.state}`).join(', ') : 'Parados',
      action: running ? undefined : { id: 'core-up', label: 'Arrancar' }
    })
  }
  return checks
}

const PRIVILEGED = [
  '/usr/lib/devhub/privileged.sh',
  resource('build', 'privileged.sh')
]

function privilegedScript(): string {
  const found = PRIVILEGED.find((p) => existsSync(p))
  if (!found) throw new Error('No se encuentra privileged.sh')
  return found
}

/** Ejecuta una acción del script privilegiado con pkexec (diálogo gráfico de contraseña). */
async function privileged(action: string, ...args: string[]): Promise<string> {
  const r = await run('pkexec', [privilegedScript(), action, ...args], { allowFail: true })
  if (r.code === 126 || r.code === 127) throw new Error('Operación cancelada o no autorizada.')
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `Falló ${action}`)
  return (r.stdout || 'Hecho').trim()
}

export async function runCheckAction(id: string, onLine?: (l: string) => void): Promise<string> {
  const user = userInfo().username
  switch (id) {
    case 'install-docker':
      return privileged('install-docker', user)
    case 'docker-group':
      await privileged('docker-group', user)
      return 'Añadido al grupo docker. Cierra sesión y vuelve a entrar para aplicarlo.'
    case 'start-docker':
      return privileged('start-docker')
    case 'install-mkcert':
      return privileged('install-mkcert')
    case 'install-ca': {
      const caroot = (await out('mkcert', ['-CAROOT'])).text
      // Navegadores (NSS) por usuario, sin root:
      await run('mkcert', ['-install'], { env: { TRUST_STORES: 'nss' }, allowFail: true })
      if (!existsSync(join(caroot, 'rootCA.pem'))) throw new Error('mkcert no generó la CA')
      return privileged('install-ca', join(caroot, 'rootCA.pem'))
    }
    case 'stop-lampp':
      return privileged('stop-lampp')
    case 'stop-apache':
      return privileged('stop-apache')
    case 'image':
      await ensureImage(getSettings().defaultPhp, onLine)
      return 'Imagen lista'
    case 'core-up':
      await coreUp(onLine)
      return 'Servicios comunes en marcha'
    default:
      throw new Error(`Acción desconocida: ${id}`)
  }
}
