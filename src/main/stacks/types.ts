import type { Instance, PluginUpdate, Settings } from '@shared/types'
import { dockerExec, type ExecOptions } from '../docker'
import type { RunResult } from '../exec'

export interface StackContext {
  inst: Instance
  /** URL local completa, p. ej. https://zoraida.es.localhost */
  url: string
  settings: Settings
  log: (line: string) => void
}

export interface Stack {
  /** Ficheros de configuración relativos al docroot (para .git/info/exclude). */
  configFiles(root: string): string[]
  /** Escribe la configuración local si no existe (o si no es de DevHub, tras copia de seguridad). */
  writeConfig(root: string, log: (l: string) => void): void
  /** Tras importar la BD: URLs, desactivar plugins/módulos, correo y admin local. */
  afterImport(ctx: StackContext, previousUrls: string[]): Promise<Instance['adminLogin']>
  resetAdmin(ctx: StackContext): Promise<Instance['adminLogin']>
  clearCache(ctx: StackContext): Promise<void>
  /** Versión del CMS leída de la BD (si no se pudo leer del código). */
  versionFromDb?(ctx: StackContext): Promise<string | undefined>
  pluginUpdates?(ctx: StackContext): Promise<PluginUpdate[]>
  runUpdates?(ctx: StackContext, what: string): Promise<void>
}

export function containerName(inst: Instance): string {
  return `devhub-${inst.id}`
}

/** Ejecuta un comando en el contenedor de la instancia como www-data (UID del host). */
export function execIn(inst: Instance, cmd: string[], opts: ExecOptions = {}): Promise<RunResult> {
  return dockerExec(containerName(inst), cmd, {
    user: 'www-data',
    workdir: inst.docroot ? `/var/www/html/${inst.docroot}` : '/var/www/html',
    ...opts,
    env: { HOME: '/tmp/wp-cli', ...opts.env }
  })
}

/** Variantes de la URL de producción que hay que sustituir por la local. */
export function productionUrls(domain: string): string[] {
  return [`https://www.${domain}`, `http://www.${domain}`, `https://${domain}`, `http://${domain}`]
}
