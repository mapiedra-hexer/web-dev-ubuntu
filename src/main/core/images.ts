import type { PhpVersion } from '@shared/types'
import { imageExists } from '../docker'
import { run } from '../exec'
import { resource } from '../paths'
import { getSettings } from '../store'

export function imageRef(php: PhpVersion): string {
  const repo = getSettings().imageRepository.trim()
  return repo ? `${repo}:${php}` : `devhub/php:${php}`
}

/** Garantiza que la imagen PHP existe: pull del registro si está configurado, si no build local. */
export async function ensureImage(php: PhpVersion, onLine?: (l: string) => void): Promise<string> {
  const ref = imageRef(php)
  if (await imageExists(ref)) return ref
  if (getSettings().imageRepository.trim()) {
    const pulled = await run('docker', ['pull', ref], { onLine, allowFail: true })
    if (pulled.code === 0) return ref
    onLine?.(`No se pudo descargar ${ref}; se construye en local`)
    const local = `devhub/php:${php}`
    if (await imageExists(local)) return local
    await build(php, local, onLine)
    return local
  }
  await build(php, ref, onLine)
  return ref
}

async function build(php: PhpVersion, tag: string, onLine?: (l: string) => void): Promise<void> {
  onLine?.(`Construyendo ${tag} (solo la primera vez, puede tardar unos minutos)…`)
  await run('docker', ['build', '--build-arg', `PHP_VERSION=${php}`, '-t', tag, resource('images', 'php')], {
    onLine,
    env: { DOCKER_BUILDKIT: '1' }
  })
}
