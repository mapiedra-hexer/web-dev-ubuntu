import { shell } from 'electron'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { userInfo } from 'os'
import { basename, join } from 'path'
import { dbNameFor, instanceIdFor, isDomain, localDomainFor, localUrl, normalizeDomain, toLabel } from '@shared/domain'
import type {
  DbSource,
  DuplicateRequest,
  Instance,
  InstanceView,
  MountRequest,
  PhpVersion,
  PluginUpdate,
  Snapshot
} from '@shared/types'
import { compose, instanceStates } from '../docker'
import { detached, run, which } from '../exec'
import { assertIdle, startJob, type JobContext } from '../jobs'
import { paths } from '../paths'
import { deleteInstance, getInstance, getSettings, listInstances, saveInstance, updateInstance } from '../store'
import { coreUp, dbUser, isCoreRunning } from '../core/core'
import { ensureCert } from '../core/certs'
import { ensureImage } from '../core/images'
import { cloneDb, createDb, detectPrefix, dropDb, dumpToFile, importDump } from '../db/mariadb'
import * as git from '../git'
import { githubToken } from '../integrations/github'
import { downloadDump, listDumps } from '../integrations/drive'
import { stackFor } from '../stacks'
import { containerName, productionUrls, type StackContext } from '../stacks/types'
import { composeFor } from './compose'
import { detect } from './detect'

function urlOf(inst: Instance): string {
  const s = getSettings()
  return localUrl(inst.localDomain, { https: s.https, httpPort: s.httpPort, httpsPort: s.httpsPort })
}

export async function listViews(): Promise<InstanceView[]> {
  const states = await instanceStates()
  return listInstances().map((i) => ({ ...i, state: states.get(i.id) ?? 'missing', url: urlOf(i) }))
}

function composeFile(inst: Instance): string {
  return join(paths.instanceDir(inst.id), 'compose.json')
}

async function writeCompose(inst: Instance): Promise<string> {
  const s = getSettings()
  const image = await ensureImage(inst.php)
  const { uid, gid } = userInfo()
  const db = dbUser()
  const file = composeFile(inst)
  mkdirSync(paths.instanceDir(inst.id), { recursive: true })
  const def = composeFor(inst, {
    image,
    url: urlOf(inst),
    https: s.https,
    hostUid: uid,
    hostGid: gid,
    db: { host: 'devhub-mariadb', user: db.user, password: db.password }
  })
  writeFileSync(file, JSON.stringify(def, null, 2), { mode: 0o600 })
  return file
}

async function up(inst: Instance, log?: (l: string) => void): Promise<void> {
  if (!(await isCoreRunning())) {
    log?.('Arrancando servicios comunes…')
    await coreUp(log)
  }
  if (getSettings().https) await ensureCert(inst.domain).catch((e) => log?.(`Sin HTTPS: ${e.message}`))
  const file = await writeCompose(inst)
  await compose(`devhub-${inst.id}`, file, ['up', '-d', '--remove-orphans'], { onLine: log })
}

function stackCtx(inst: Instance, log: (l: string) => void): StackContext {
  return { inst, url: urlOf(inst), settings: getSettings(), log }
}

function rootOf(inst: Instance): string {
  return join(inst.codePath, inst.docroot)
}

/** Resuelve el origen de BD a un fichero local (descargando de Drive si hace falta). */
async function resolveDump(domain: string, source: MountRequest['dbSource'], ctx: JobContext): Promise<{ file: string | null; source: DbSource; manifest?: import('@shared/types').DumpManifest }> {
  if (source.kind === 'none') return { file: null, source }
  if (source.kind === 'local') {
    if (!existsSync(source.path)) throw new Error(`No existe el fichero ${source.path}`)
    return { file: source.path, source }
  }
  let drive = source.kind === 'drive' ? source : null
  let manifest
  if (source.kind === 'auto') {
    ctx.step('Buscando copia de la BD en Drive')
    const found = (await listDumps().catch((e) => {
      ctx.log(`Drive: ${e.message}`)
      return []
    })).find((d) => d.domain === domain)
    if (!found) {
      ctx.log('No hay copia de BD en Drive para este dominio: el proyecto queda "Pendiente de BD"')
      return { file: null, source: { kind: 'none' } }
    }
    drive = { kind: 'drive', fileId: found.id, name: found.name, modifiedTime: found.modifiedTime, size: found.size }
    manifest = found.manifest
  }
  ctx.step(`Descargando ${drive!.name}`, 0)
  const file = await downloadDump({ id: drive!.fileId, name: drive!.name, modifiedTime: drive!.modifiedTime, size: drive!.size }, (p) => ctx.progress(p))
  return { file, source: drive!, manifest }
}

/** Importa la BD y aplica los ajustes del CMS (URLs, plugins, admin local). */
async function importInto(inst: Instance, file: string, source: DbSource, ctx: JobContext, previousUrls: string[]): Promise<Instance> {
  inst = updateInstance(inst.id, { dbStatus: 'importing' })
  ctx.step('Importando base de datos', 0)
  await createDb(inst.dbName, true)
  await importDump(inst.dbName, file, (p) => ctx.progress(p), ctx.log)
  const found = await detectPrefix(inst.dbName, inst.type)
  if (found) ctx.log(`Prefijo de tablas: ${found.prefix}`)
  inst = updateInstance(inst.id, {
    dbPrefix: found?.prefix ?? inst.dbPrefix,
    type: inst.type === 'unknown' && found ? found.type : inst.type,
    dbSource: source,
    dbImportedAt: new Date().toISOString()
  })
  ctx.step('Arrancando contenedor')
  await up(inst, ctx.log)
  const stack = stackFor(inst.type)
  if (stack) {
    if (!inst.cmsVersion && stack.versionFromDb) {
      const v = await stack.versionFromDb(stackCtx(inst, ctx.log))
      if (v) {
        inst = updateInstance(inst.id, { cmsVersion: v })
        await up(inst, ctx.log)
      }
    }
    ctx.step('Adaptando la web a local (URLs, plugins, correo, admin)')
    const admin = await stack.afterImport(stackCtx(inst, ctx.log), previousUrls)
    inst = updateInstance(inst.id, { adminLogin: admin })
  }
  return updateInstance(inst.id, { dbStatus: 'ready' })
}

function repoDirName(req: MountRequest, domain: string): string {
  if (req.repoFullName) return req.repoFullName.split('/')[1]
  if (req.cloneUrl) return basename(req.cloneUrl).replace(/\.git$/, '')
  return domain
}

export function mount(req: MountRequest): string {
  const domain = normalizeDomain(req.domain)
  if (!isDomain(domain)) throw new Error(`Dominio no válido: "${req.domain}"`)
  const id = instanceIdFor(domain)
  if (listInstances().some((i) => i.id === id)) throw new Error(`${domain} ya está montado`)

  return startJob(
    `Montar ${domain}`,
    async (ctx) => {
      const s = getSettings()
      mkdirSync(s.projectsDir, { recursive: true })
      const codePath = join(s.projectsDir, repoDirName(req, domain))
      let ownsCode = false

      if (req.repoFullName || req.cloneUrl) {
        if (existsSync(join(codePath, '.git'))) {
          ctx.log(`Usando el clon existente en ${codePath}`)
        } else {
          if (existsSync(codePath) && readdirSync(codePath).length) throw new Error(`${codePath} existe y no es un repositorio git`)
          ctx.step('Clonando repositorio')
          const url = req.cloneUrl ?? `https://github.com/${req.repoFullName}.git`
          await git.clone(url, codePath, githubToken(), req.branch, ctx.log)
          ownsCode = true
        }
      } else if (!existsSync(codePath)) {
        throw new Error('Indica un repositorio o una carpeta con el código')
      }

      // Origen de la BD primero: el manifiesto puede traer la versión de PHP.
      const db = await resolveDump(domain, req.dbSource, ctx)

      ctx.step('Detectando CMS y versión de PHP')
      const det = detect(codePath, db.manifest, s.defaultPhp)
      const type = det.type !== 'unknown' ? det.type : req.type ?? 'unknown'
      const php: PhpVersion = req.php === 'auto' ? det.php : req.php
      ctx.log(`CMS: ${type}${det.cmsVersion ? ' ' + det.cmsVersion : ''} · docroot: /${det.docroot} · PHP ${php}${req.php === 'auto' ? ` (${det.phpSource})` : ''}`)

      ctx.step(`Preparando imagen PHP ${php}`)
      await ensureImage(php, ctx.log)

      let inst: Instance = saveInstance({
        id,
        domain,
        localDomain: localDomainFor(domain),
        label: '',
        repoFullName: req.repoFullName,
        cloneUrl: req.cloneUrl,
        type,
        cmsVersion: det.cmsVersion ?? db.manifest?.cms_version,
        php,
        branch: await git.currentBranch(codePath),
        codePath,
        docroot: det.docroot,
        dbName: dbNameFor(id),
        dbPrefix: db.manifest?.db_prefix ?? (type === 'prestashop' ? 'ps_' : 'wp_'),
        dbStatus: 'pending',
        xdebug: false,
        ownsCode,
        createdAt: new Date().toISOString()
      })

      const stack = stackFor(type)
      if (stack) {
        ctx.step('Generando configuración local')
        stack.writeConfig(rootOf(inst), ctx.log)
        git.excludeLocally(codePath, stack.configFiles(rootOf(inst)).map((f) => (inst.docroot ? `${inst.docroot}/${f}` : f)))
      }

      if (!(await isCoreRunning())) {
        ctx.step('Arrancando servicios comunes')
        await coreUp(ctx.log)
      }

      if (db.file) {
        inst = await importInto(inst, db.file, db.source, ctx, productionUrls(domain))
      } else {
        await createDb(inst.dbName)
        ctx.step('Arrancando contenedor')
        await up(inst, ctx.log)
      }
      ctx.log(`Listo: ${urlOf(inst)}`)
      void shell.openExternal(urlOf(inst))
    },
    id
  )
}

export function importDb(id: string, source: MountRequest['dbSource']): string {
  assertIdle(id)
  return startJob(
    `Importar BD en ${id}`,
    async (ctx) => {
      const inst = getInstance(id)
      const db = await resolveDump(inst.domain, source, ctx)
      if (!db.file) throw new Error('No se ha encontrado ningún volcado que importar')
      try {
        await importInto(inst, db.file, db.source, ctx, productionUrls(inst.domain))
      } catch (e) {
        updateInstance(id, { dbStatus: 'error' })
        throw e
      }
    },
    id
  )
}

export function duplicate(req: DuplicateRequest): string {
  const src = getInstance(req.sourceId)
  const label = toLabel(req.label)
  if (!label) throw new Error('Indica una etiqueta para el duplicado (p. ej. php83)')
  const id = instanceIdFor(src.domain, label)
  if (listInstances().some((i) => i.id === id)) throw new Error(`Ya existe ${localDomainFor(src.domain, label)}`)
  if (req.codeMode === 'shared' && src.type === 'prestashop') {
    throw new Error('En PrestaShop los duplicados necesitan su propia carpeta (la caché de Symfony no se puede compartir)')
  }
  assertIdle(src.id)

  return startJob(
    `Duplicar ${src.domain} → ${label}`,
    async (ctx) => {
      const s = getSettings()
      let codePath = src.codePath
      let branch = src.branch
      if (req.codeMode === 'worktree') {
        codePath = join(s.projectsDir, `${basename(src.codePath)}@${label}`)
        const base = req.baseBranch || src.branch || 'HEAD'
        ctx.step(`Creando worktree ${basename(codePath)}`)
        await git.addWorktree(src.codePath, codePath, { base, newBranch: req.newBranch || undefined }, ctx.log)
        branch = req.newBranch || base
        if (req.copyIgnored) {
          ctx.step('Copiando ficheros no versionados')
          const skip = /(^|\/)(node_modules|var\/cache|cache\/smarty|wp-content\/cache|\.devhub)/
          const stack = stackFor(src.type)
          const configs = new Set(stack ? stack.configFiles(rootOf(src)).map((f) => (src.docroot ? `${src.docroot}/${f}` : f)) : [])
          for (const rel of await git.ignoredPaths(src.codePath)) {
            const clean = rel.replace(/\/$/, '')
            if (skip.test(clean) || configs.has(clean) || configs.has(clean + '/')) continue
            ctx.log(`  ${clean}`)
            cpSync(join(src.codePath, clean), join(codePath, clean), { recursive: true, force: false, errorOnExist: false })
          }
        }
      }

      ctx.step(`Preparando imagen PHP ${req.php}`)
      await ensureImage(req.php, ctx.log)

      let inst = saveInstance({
        ...src,
        id,
        label,
        localDomain: localDomainFor(src.domain, label),
        parentId: src.parentId ?? src.id,
        php: req.php,
        branch,
        codePath,
        dbName: dbNameFor(id),
        dbStatus: 'pending',
        xdebug: false,
        ownsCode: req.codeMode === 'worktree',
        createdAt: new Date().toISOString(),
        adminLogin: undefined
      })
      const stack = stackFor(inst.type)
      if (stack && req.codeMode === 'worktree') {
        stack.writeConfig(rootOf(inst), ctx.log)
        git.excludeLocally(codePath, stack.configFiles(rootOf(inst)).map((f) => (inst.docroot ? `${inst.docroot}/${f}` : f)))
      }

      if (src.dbStatus === 'ready') {
        ctx.step('Clonando base de datos')
        await cloneDb(src.dbName, inst.dbName)
      } else {
        await createDb(inst.dbName)
      }
      ctx.step('Arrancando contenedor')
      await up(inst, ctx.log)
      if (src.dbStatus === 'ready' && stack) {
        ctx.step('Adaptando URLs al nuevo subdominio')
        const admin = await stack.afterImport(stackCtx(inst, ctx.log), [urlOf(src), ...productionUrls(src.domain)])
        inst = updateInstance(inst.id, { adminLogin: admin, dbStatus: 'ready' })
      }
      ctx.log(`Listo: ${urlOf(inst)}`)
    },
    id
  )
}

export function start(id: string): string {
  assertIdle(id)
  return startJob(`Arrancar ${id}`, async (ctx) => up(getInstance(id), ctx.log), id)
}

export function stop(id: string): string {
  assertIdle(id)
  return startJob(
    `Parar ${id}`,
    async (ctx) => {
      await compose(`devhub-${id}`, composeFile(getInstance(id)), ['stop'], { onLine: ctx.log })
    },
    id
  )
}

export function restart(id: string): string {
  assertIdle(id)
  return startJob(
    `Reiniciar ${id}`,
    async (ctx) => {
      const inst = getInstance(id)
      await up(inst, ctx.log)
      await compose(`devhub-${id}`, composeFile(inst), ['restart'], { onLine: ctx.log })
    },
    id
  )
}

export function remove(id: string, keepCode: boolean): string {
  const inst = getInstance(id)
  const children = listInstances().filter((i) => i.parentId === id)
  if (children.length) throw new Error(`Elimina antes sus duplicados: ${children.map((c) => c.localDomain).join(', ')}`)
  assertIdle(id)
  return startJob(
    `Eliminar ${inst.localDomain}`,
    async (ctx) => {
      ctx.step('Eliminando contenedor')
      if (existsSync(composeFile(inst))) await compose(`devhub-${id}`, composeFile(inst), ['down', '--remove-orphans'], { onLine: ctx.log, allowFail: true })
      ctx.step('Eliminando base de datos')
      await dropDb(inst.dbName).catch((e) => ctx.log(`BD: ${e.message}`))
      if (!keepCode && inst.ownsCode) {
        ctx.step('Eliminando código')
        if (inst.parentId) {
          await git.removeWorktree(getInstance(inst.parentId).codePath, inst.codePath)
        } else {
          rmSync(inst.codePath, { recursive: true, force: true })
        }
      }
      rmSync(paths.instanceDir(id), { recursive: true, force: true })
      rmSync(paths.snapshots(id), { recursive: true, force: true })
      deleteInstance(id)
    },
    id
  )
}

export function changePhp(id: string, php: PhpVersion): string {
  assertIdle(id)
  return startJob(
    `PHP ${php} en ${id}`,
    async (ctx) => {
      ctx.step(`Preparando imagen PHP ${php}`)
      await ensureImage(php, ctx.log)
      const inst = updateInstance(id, { php })
      ctx.step('Recreando contenedor')
      await up(inst, ctx.log)
      await stackFor(inst.type)?.clearCache(stackCtx(inst, ctx.log))
    },
    id
  )
}

export function setXdebug(id: string, on: boolean): string {
  assertIdle(id)
  return startJob(`Xdebug ${on ? 'activado' : 'desactivado'} en ${id}`, async (ctx) => up(updateInstance(id, { xdebug: on }), ctx.log), id)
}

export function resetAdmin(id: string): string {
  return startJob(
    `Admin local en ${id}`,
    async (ctx) => {
      const inst = getInstance(id)
      const stack = stackFor(inst.type)
      if (!stack) throw new Error('CMS no reconocido')
      updateInstance(id, { adminLogin: await stack.resetAdmin(stackCtx(inst, ctx.log)) })
    },
    id
  )
}

export function clearCache(id: string): string {
  return startJob(
    `Vaciar caché de ${id}`,
    async (ctx) => {
      const inst = getInstance(id)
      await stackFor(inst.type)?.clearCache(stackCtx(inst, ctx.log))
    },
    id
  )
}

export async function logs(id: string, tail: number): Promise<string> {
  const r = await run('docker', ['logs', '--tail', String(tail), containerName(getInstance(id))], { allowFail: true })
  return (r.stdout + r.stderr).trim()
}

export async function openFolder(id: string): Promise<void> {
  await shell.openPath(getInstance(id).codePath)
}

export async function openEditor(id: string): Promise<void> {
  const dir = getInstance(id).codePath
  for (const ed of ['code', 'codium', 'phpstorm', 'subl']) {
    if (await which(ed)) {
      detached(ed, [dir])
      return
    }
  }
  await shell.openPath(dir)
}

export async function openTerminal(id: string): Promise<void> {
  const inst = getInstance(id)
  const cmd = ['docker', 'exec', '-it', '-u', 'www-data', '-w', inst.docroot ? `/var/www/html/${inst.docroot}` : '/var/www/html', containerName(inst), 'bash']
  if (await which('gnome-terminal')) return detached('gnome-terminal', ['--title', inst.localDomain, '--', ...cmd])
  if (await which('konsole')) return detached('konsole', ['-e', ...cmd])
  if (await which('x-terminal-emulator')) return detached('x-terminal-emulator', ['-e', cmd.join(' ')])
  throw new Error('No se encontró ningún emulador de terminal')
}

export function listSnapshots(id: string): Snapshot[] {
  const dir = paths.snapshots(id)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql.gz'))
    .map((name) => {
      const st = statSync(join(dir, name))
      return { name, createdAt: st.mtime.toISOString(), size: st.size }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function createSnapshot(id: string): string {
  return startJob(
    `Punto de restauración de ${id}`,
    async (ctx) => {
      const inst = getInstance(id)
      const dir = paths.snapshots(id)
      mkdirSync(dir, { recursive: true })
      const name = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.sql.gz'
      ctx.step('Volcando base de datos')
      await dumpToFile(inst.dbName, join(dir, name))
      ctx.log(`Guardado ${name}`)
    },
    id
  )
}

export function restoreSnapshot(id: string, name: string): string {
  assertIdle(id)
  return startJob(
    `Restaurar ${name} en ${id}`,
    async (ctx) => {
      const inst = getInstance(id)
      const file = join(paths.snapshots(id), basename(name))
      if (!existsSync(file)) throw new Error(`No existe ${name}`)
      ctx.step('Restaurando base de datos', 0)
      await createDb(inst.dbName, true)
      await importDump(inst.dbName, file, (p) => ctx.progress(p), ctx.log)
      await stackFor(inst.type)?.clearCache(stackCtx(inst, ctx.log))
    },
    id
  )
}

export function deleteSnapshot(id: string, name: string): void {
  rmSync(join(paths.snapshots(id), basename(name)), { force: true })
}

export async function pluginUpdates(id: string): Promise<PluginUpdate[]> {
  const inst = getInstance(id)
  const stack = stackFor(inst.type)
  return stack?.pluginUpdates ? stack.pluginUpdates(stackCtx(inst, () => {})) : []
}

export function runUpdates(id: string, what: string): string {
  assertIdle(id)
  return startJob(
    `Actualizar ${what} en ${id}`,
    async (ctx) => {
      const inst = getInstance(id)
      const stack = stackFor(inst.type)
      if (!stack?.runUpdates) throw new Error('Este CMS no admite actualizaciones desde DevHub')
      await stack.runUpdates(stackCtx(inst, ctx.log), what)
      const v = await stack.versionFromDb?.(stackCtx(inst, ctx.log))
      if (v) updateInstance(id, { cmsVersion: v })
    },
    id
  )
}
