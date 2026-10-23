import type { CmsType, PhpVersion } from './types'

export const PHP_VERSIONS: PhpVersion[] = ['5.6', '7.1', '7.2', '7.3', '7.4', '8.0', '8.1', '8.2', '8.3', '8.4']

export function isPhpVersion(v: string): v is PhpVersion {
  return (PHP_VERSIONS as string[]).includes(v)
}

/** Compara versiones tipo "1.7.8.10" numéricamente. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** Lleva "8.2.14", "8.2", "82" o "php8.2" a una versión soportada si existe. */
export function coercePhpVersion(raw: string | undefined | null): PhpVersion | null {
  if (!raw) return null
  const m = String(raw).match(/(\d)\.?(\d)/)
  if (!m) return null
  const v = `${m[1]}.${m[2]}`
  return isPhpVersion(v) ? v : null
}

/**
 * Interpreta una restricción de composer ("^7.4", ">=8.0 <8.3", "~8.1.0", "7.4.33")
 * y devuelve la versión soportada más baja que la cumple.
 */
export function phpFromComposerConstraint(constraint: string): PhpVersion | null {
  const first = constraint.split('||')[0].trim()
  const m = first.match(/(\d+)\.(\d+)/)
  if (!m) return null
  const min = `${m[1]}.${m[2]}`
  const found = PHP_VERSIONS.find((v) => compareVersions(v, min) >= 0)
  return found ?? null
}

/** Versión de PHP recomendada según CMS y su versión. Conservadora: la que suele correr en Plesk. */
export function suggestPhp(type: CmsType, cmsVersion: string | undefined, fallback: PhpVersion): PhpVersion {
  if (!cmsVersion) return fallback
  const v = cmsVersion
  if (type === 'wordpress') {
    if (compareVersions(v, '5.0') < 0) return '7.2'
    if (compareVersions(v, '5.6') < 0) return '7.4'
    if (compareVersions(v, '6.3') < 0) return '8.0'
    if (compareVersions(v, '6.6') < 0) return '8.1'
    return '8.2'
  }
  if (type === 'prestashop') {
    if (compareVersions(v, '1.7') < 0) return '7.1'
    if (compareVersions(v, '1.7.7') < 0) return '7.2'
    if (compareVersions(v, '1.7.8') < 0) return '7.3'
    if (compareVersions(v, '8.0') < 0) return '7.4'
    if (compareVersions(v, '9.0') < 0) return '8.1'
    return '8.3'
  }
  return fallback
}
