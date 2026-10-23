/**
 * Prueba de extremo a extremo: monta un WordPress real con Docker.
 *   npm run test:e2e
 * Requiere Docker y conexión (descarga WordPress y las imágenes base).
 */
import { execFileSync, spawnSync } from 'child_process'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false, getSelectedStorageBackend: () => 'basic_text' }
}))

const { setResourcesRoot, ensureDirs } = await import('../paths')
const { saveSettings, getInstance, listInstances } = await import('../store')
const { listJobs } = await import('../jobs')
const manager = await import('./manager')
const { coreDown } = await import('../core/core')
const { dockerExec } = await import('../docker')

const DOMAIN = 'e2e-test.es'
const work = mkdtempSync(join(tmpdir(), 'devhub-e2e-work-'))

async function waitJob(id: string): Promise<void> {
  for (;;) {
    const job = listJobs().find((j) => j.id === id)!
    if (job.status === 'done') return
    if (job.status === 'error') throw new Error(`${job.title}: ${job.error}\n${job.log.slice(-30).join('\n')}`)
    await new Promise((r) => setTimeout(r, 500))
  }
}

function curl(host: string, path = '/'): { code: string; location: string; body: string } {
  const r = spawnSync('curl', ['-sS', '-w', '\n%{http_code} %{redirect_url}', '--resolve', `${host}:8880:127.0.0.1`, `http://${host}:8880${path}`], {
    encoding: 'utf8'
  })
  if (r.status !== 0) {
    const ps = spawnSync('docker', ['ps', '-a', '--filter', 'name=devhub', '--format', '{{.Names}} {{.Status}}'], { encoding: 'utf8' }).stdout
    const logs = spawnSync('docker', ['logs', '--tail', '20', 'devhub-traefik'], { encoding: 'utf8' })
    throw new Error(`curl ${host}${path} falló (${r.status}): ${r.stderr}\n${ps}\n${logs.stdout}${logs.stderr}`)
  }
  const lines = r.stdout.trimEnd().split('\n')
  const [code, location = ''] = lines.pop()!.split(' ')
  return { code, location, body: lines.join('\n') }
}

beforeAll(() => {
  setResourcesRoot(process.cwd())
  ensureDirs()
  saveSettings({ httpPort: 8880, httpsPort: 8443, https: false, projectsDir: join(work, 'proyectos'), defaultPhp: '8.2' })

  // Repo git local con WordPress (sin wp-config.php, como en los repos reales).
  const repo = join(work, 'dob-wordpress-e2e')
  execFileSync('sh', ['-c', `mkdir -p ${repo} && curl -fsSL https://wordpress.org/latest.tar.gz | tar -xz -C ${repo} --strip-components=1`])
  execFileSync('sh', [
    '-c',
    `cd ${repo} && git init -q -b master && git add -A && git -c user.email=e2e@local -c user.name=e2e commit -qm "WordPress"`
  ])
})

afterAll(async () => {
  for (const i of listInstances().filter((x) => x.parentId)) await waitJob(manager.remove(i.id, false)).catch(() => {})
  for (const i of listInstances()) await waitJob(manager.remove(i.id, false)).catch(() => {})
  await coreDown().catch(() => {})
  execFileSync('docker', ['volume', 'rm', '-f', 'devhub-mariadb-data'])
})

describe('flujo completo WordPress', () => {
  it('monta sin BD (Pendiente de BD)', async () => {
    await waitJob(manager.mount({ cloneUrl: join(work, 'dob-wordpress-e2e'), domain: DOMAIN, php: 'auto', dbSource: { kind: 'none' } }))
    const inst = getInstance('e2e-test-es')
    expect(inst.type).toBe('wordpress')
    expect(inst.dbStatus).toBe('pending')
    expect(inst.php).toBe('8.2')
  })

  it('importa un volcado de "producción" con otro prefijo y adapta URLs', async () => {
    const inst = getInstance('e2e-test-es')
    // Simula producción: instala WP con la URL real y lo vuelca con prefijo wpx_.
    await dockerExec(`devhub-${inst.id}`, ['wp', 'core', 'install', `--url=https://www.${DOMAIN}`, '--title=Sitio E2E', '--admin_user=prod', '--admin_password=x', '--admin_email=a@b.es', '--skip-email'], {
      user: 'www-data',
      env: { HOME: '/tmp/wp-cli' }
    })
    await dockerExec(`devhub-${inst.id}`, ['wp', 'post', 'create', '--post_title=Contacto', `--post_content=<a href="https://www.${DOMAIN}/contacto">enlace</a>`, '--post_status=publish'], {
      user: 'www-data',
      env: { HOME: '/tmp/wp-cli' }
    })
    const dump = execFileSync('docker', ['exec', '-e', `MYSQL_PWD=${(await import('../core/core')).rootPassword()}`, 'devhub-mariadb', 'mariadb-dump', '-uroot', inst.dbName], {
      encoding: 'latin1',
      maxBuffer: 256 * 1024 * 1024
    })
      .replace(/`wp_/g, '`wpx_')
      .replace(/'wp_(user_roles|capabilities|user_level)'/g, "'wpx_$1'")
      .replace(/utf8mb4_unicode_520_ci/g, 'utf8mb4_0900_ai_ci')
    const file = join(work, `${DOMAIN}.sql`)
    writeFileSync(file, dump, 'latin1')

    await waitJob(manager.importDb(inst.id, { kind: 'local', path: file }))
    const after = getInstance(inst.id)
    expect(after.dbStatus).toBe('ready')
    expect(after.dbPrefix).toBe('wpx_')
    expect(after.adminLogin?.user).toBe('devhub')

    const home = curl(`${DOMAIN}.localhost`)
    expect(home.code).toBe('200')
    expect(home.body).toContain('Sitio E2E')
    expect(home.body).toContain(`http://${DOMAIN}.localhost:8880`)
    expect(home.body).not.toContain(`www.${DOMAIN}`)
  })

  it('redirige a producción las imágenes que no existen en local', () => {
    const r = curl(`${DOMAIN}.localhost`, '/wp-content/uploads/2024/01/foto.jpg')
    expect(r.code).toBe('302')
    expect(r.location).toBe(`https://${DOMAIN}/wp-content/uploads/2024/01/foto.jpg`)
  })

  it('duplica en un worktree con BD propia y subdominio', async () => {
    await waitJob(manager.duplicate({ sourceId: 'e2e-test-es', label: 'rama', php: '8.2', codeMode: 'worktree', newBranch: 'prueba', copyIgnored: true }))
    const dup = getInstance('e2e-test-es--rama')
    expect(dup.codePath.endsWith('dob-wordpress-e2e@rama')).toBe(true)
    expect(dup.branch).toBe('prueba')
    const r = curl(`rama.${DOMAIN}.localhost`)
    expect(r.code).toBe('200')
    expect(r.body).toContain(`http://rama.${DOMAIN}.localhost:8880`)
    // La original no se ha tocado
    expect(curl(`${DOMAIN}.localhost`).body).not.toContain(`rama.${DOMAIN}`)
  })

  it('guarda y restaura un punto de restauración', async () => {
    await waitJob(manager.createSnapshot('e2e-test-es'))
    const [snap] = manager.listSnapshots('e2e-test-es')
    expect(snap.size).toBeGreaterThan(1000)
    await waitJob(manager.restoreSnapshot('e2e-test-es', snap.name))
    expect(curl(`${DOMAIN}.localhost`).code).toBe('200')
  })

  it('elimina duplicado e instancia', async () => {
    await waitJob(manager.remove('e2e-test-es--rama', false))
    await waitJob(manager.remove('e2e-test-es', true))
    expect(listInstances()).toHaveLength(0)
  })
})
