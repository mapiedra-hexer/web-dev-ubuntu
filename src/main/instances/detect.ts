import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { coercePhpVersion, phpFromComposerConstraint, suggestPhp } from '@shared/php'
import type { CmsType, DumpManifest, PhpVersion } from '@shared/types'

const DOCROOT_CANDIDATES = ['', 'httpdocs', 'public_html', 'public', 'web', 'www', 'htdocs']

function read(file: string): string | null {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

export function cmsAt(dir: string): CmsType {
  if (existsSync(join(dir, 'wp-includes', 'version.php'))) return 'wordpress'
  if (existsSync(join(dir, 'config', 'defines.inc.php')) || existsSync(join(dir, 'classes', 'PrestaShopAutoload.php'))) {
    return 'prestashop'
  }
  return 'unknown'
}

/** Busca la carpeta del repo que contiene el CMS (raíz, httpdocs, public_html…). */
export function findDocroot(codePath: string): { docroot: string; type: CmsType } {
  for (const c of DOCROOT_CANDIDATES) {
    const type = cmsAt(join(codePath, c))
    if (type !== 'unknown') return { docroot: c, type }
  }
  return { docroot: '', type: 'unknown' }
}

export function parseWpVersion(versionPhp: string): string | undefined {
  return versionPhp.match(/\$wp_version\s*=\s*['"]([^'"]+)['"]/)?.[1]
}

export function parsePsVersion(text: string): string | undefined {
  return (
    text.match(/const\s+VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1] ??
    text.match(/_PS_INSTALL_VERSION_['"]\s*,\s*['"]([^'"]+)['"]/)?.[1] ??
    text.match(/_PS_VERSION_['"]\s*,\s*['"]([^'"]+)['"]/)?.[1]
  )
}

export function cmsVersion(root: string, type: CmsType): string | undefined {
  if (type === 'wordpress') {
    const t = read(join(root, 'wp-includes', 'version.php'))
    return t ? parseWpVersion(t) : undefined
  }
  if (type === 'prestashop') {
    for (const f of ['app/AppKernel.php', 'src/Core/Version.php', 'install/install_version.php', 'config/settings.inc.php']) {
      const t = read(join(root, f))
      const v = t ? parsePsVersion(t) : undefined
      if (v) return v
    }
  }
  return undefined
}

export function composerPhp(codePath: string, docroot: string): PhpVersion | null {
  for (const dir of [codePath, join(codePath, docroot)]) {
    const t = read(join(dir, 'composer.json'))
    if (!t) continue
    try {
      const j = JSON.parse(t) as { config?: { platform?: { php?: string } }; require?: { php?: string } }
      const platform = coercePhpVersion(j.config?.platform?.php)
      if (platform) return platform
      if (j.require?.php) return phpFromComposerConstraint(j.require.php)
    } catch {
      /* composer.json inválido */
    }
  }
  return null
}

export interface Detection {
  docroot: string
  type: CmsType
  cmsVersion?: string
  php: PhpVersion
  phpSource: 'manifiesto' | 'composer' | 'versión del CMS' | 'por defecto'
}

/** Orden: manifiesto del backup -> composer.json -> versión del CMS -> por defecto. */
export function detect(codePath: string, manifest: DumpManifest | undefined, fallback: PhpVersion): Detection {
  const { docroot, type } = findDocroot(codePath)
  const root = join(codePath, docroot)
  const version = type !== 'unknown' ? cmsVersion(root, type) : undefined
  const fromManifest = coercePhpVersion(manifest?.php_version)
  if (fromManifest) return { docroot, type, cmsVersion: version, php: fromManifest, phpSource: 'manifiesto' }
  const fromComposer = composerPhp(codePath, docroot)
  if (fromComposer) return { docroot, type, cmsVersion: version, php: fromComposer, phpSource: 'composer' }
  if (version) return { docroot, type, cmsVersion: version, php: suggestPhp(type, version, fallback), phpSource: 'versión del CMS' }
  return { docroot, type, cmsVersion: version, php: fallback, phpSource: 'por defecto' }
}
