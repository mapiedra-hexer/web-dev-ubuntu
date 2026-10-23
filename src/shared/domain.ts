/**
 * Normaliza lo que escribe un usuario (dominio, URL, "www.dominio") a un dominio
 * desnudo en minúsculas: "https://www.Zoraida.es/tienda?x=1" -> "zoraida.es".
 */
export function normalizeDomain(input: string): string {
  let s = input.trim().toLowerCase()
  if (!s) return ''
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  s = s.replace(/^[^@/]*@/, '')
  s = s.split(/[/?#]/)[0]
  s = s.replace(/:\d+$/, '')
  s = s.replace(/\.+$/, '')
  s = s.replace(/^www\./, '')
  s = s.replace(/\.localhost$/, '')
  return s
}

/** ¿Parece un dominio (tiene al menos un punto y caracteres válidos)? */
export function isDomain(s: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(s)
}

/** Etiqueta DNS válida para un subdominio de duplicado: "PHP 8.3" -> "php-8-3". */
export function toLabel(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export function localDomainFor(domain: string, label = ''): string {
  return label ? `${label}.${domain}.localhost` : `${domain}.localhost`
}

/** Identificador de instancia: zoraida.es -> zoraida-es, con duplicado -> zoraida-es--php83 */
export function instanceIdFor(domain: string, label = ''): string {
  const base = domain.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return label ? `${base}--${label}` : base
}

/** Nombre de base de datos MariaDB (máx. 64 caracteres). */
export function dbNameFor(id: string): string {
  return ('dh_' + id.replace(/-/g, '_')).slice(0, 64)
}

export function localUrl(localDomain: string, opts: { https: boolean; httpPort: number; httpsPort: number }): string {
  const scheme = opts.https ? 'https' : 'http'
  const port = opts.https ? opts.httpsPort : opts.httpPort
  const def = opts.https ? 443 : 80
  return `${scheme}://${localDomain}${port === def ? '' : ':' + port}`
}
