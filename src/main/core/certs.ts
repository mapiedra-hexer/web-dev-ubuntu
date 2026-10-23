import { existsSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { run, which } from '../exec'
import { paths } from '../paths'

/**
 * Genera con mkcert un certificado para `dominio.localhost` y `*.dominio.localhost`
 * (cubre también los duplicados) y lo registra en el file provider de Traefik.
 */
export async function ensureCert(domain: string): Promise<boolean> {
  if (!(await which('mkcert'))) return false
  const base = `${domain}.localhost`
  const cert = join(paths.certs, `${base}.pem`)
  const key = join(paths.certs, `${base}-key.pem`)
  if (!existsSync(cert) || !existsSync(key)) {
    await run('mkcert', ['-cert-file', cert, '-key-file', key, base, `*.${base}`])
  }
  const yml = [
    'tls:',
    '  certificates:',
    `    - certFile: /certs/${base}.pem`,
    `      keyFile: /certs/${base}-key.pem`,
    ''
  ].join('\n')
  writeFileSync(join(paths.traefikDynamic, `cert-${base}.yml`), yml)
  return true
}

export function removeCert(domain: string): void {
  const base = `${domain}.localhost`
  for (const f of [join(paths.certs, `${base}.pem`), join(paths.certs, `${base}-key.pem`), join(paths.traefikDynamic, `cert-${base}.yml`)]) {
    rmSync(f, { force: true })
  }
}
