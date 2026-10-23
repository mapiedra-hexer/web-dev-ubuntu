import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { compareVersions } from '@shared/php'
import { query, sqlString } from '../db/mariadb'
import { execIn, type Stack, type StackContext } from './types'
import { cookieKeyFrom16, MARKER, psParameters, psSettings16 } from './templates'

function is17(root: string): boolean {
  return existsSync(join(root, 'app', 'config'))
}

function configPath(root: string): string {
  return is17(root) ? join(root, 'app', 'config', 'parameters.php') : join(root, 'config', 'settings.inc.php')
}

function rootOf(ctx: StackContext): string {
  return join(ctx.inst.codePath, ctx.inst.docroot)
}

/** Carpeta de administración (renombrada en cada tienda: admin123abc). */
function adminDir(root: string): string | null {
  try {
    for (const d of readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory() || !/^admin/i.test(d.name)) continue
      const dir = join(root, d.name)
      if (existsSync(join(dir, 'index.php')) && (existsSync(join(dir, 'ajax-tab.php')) || existsSync(join(dir, 'themes')))) return d.name
    }
  } catch {
    /* sin acceso al directorio */
  }
  return null
}

async function sql(ctx: StackContext, statements: string): Promise<string[][]> {
  return query(ctx.inst.dbName, statements)
}

export const prestashop: Stack = {
  configFiles: (root) =>
    is17(root) ? ['app/config/parameters.php', 'var/cache/', 'var/logs/'] : ['config/settings.inc.php', 'cache/smarty/', 'cache/class_index.php'],

  writeConfig(root, log) {
    const file = configPath(root)
    if (existsSync(file)) {
      if (readFileSync(file, 'utf8').includes(MARKER)) return
      copyFileSync(file, `${file}.devhub-bak`)
      log(`${file} existente copiado a ${file}.devhub-bak`)
    }
    writeFileSync(file, is17(root) ? psParameters() : psSettings16())
    log(`${is17(root) ? 'app/config/parameters.php' : 'config/settings.inc.php'} generado`)
  },

  async versionFromDb(ctx) {
    const p = ctx.inst.dbPrefix
    const rows = await sql(ctx, `SELECT value FROM ${p}configuration WHERE name='PS_VERSION_DB' LIMIT 1;`).catch(() => [])
    return rows[0]?.[0]
  },

  async afterImport(ctx) {
    const p = ctx.inst.dbPrefix
    const host = new URL(ctx.url).host
    const https = ctx.url.startsWith('https') ? '1' : '0'
    ctx.log(`Dominio de la tienda → ${host}`)
    const mods = ctx.settings.psModulesToDisable.map(sqlString).join(',') || "''"
    await sql(
      ctx,
      `
UPDATE ${p}shop_url SET domain=${sqlString(host)}, domain_ssl=${sqlString(host)};
UPDATE ${p}configuration SET value=${sqlString(host)} WHERE name IN ('PS_SHOP_DOMAIN','PS_SHOP_DOMAIN_SSL');
UPDATE ${p}configuration SET value='${https}' WHERE name IN ('PS_SSL_ENABLED','PS_SSL_ENABLED_EVERYWHERE');
UPDATE ${p}configuration SET value='0' WHERE name IN ('PS_SMARTY_CACHE','PS_CSS_THEME_CACHE','PS_JS_THEME_CACHE','PS_HTACCESS_CACHE_CONTROL');
UPDATE ${p}configuration SET value='1' WHERE name='PS_SMARTY_FORCE_COMPILE';
UPDATE ${p}configuration SET value='2' WHERE name='PS_MAIL_METHOD';
UPDATE ${p}configuration SET value='devhub-mailpit' WHERE name='PS_MAIL_SERVER';
UPDATE ${p}configuration SET value='1025' WHERE name='PS_MAIL_SMTP_PORT';
UPDATE ${p}configuration SET value='off' WHERE name='PS_MAIL_SMTP_ENCRYPTION';
UPDATE ${p}configuration SET value='' WHERE name IN ('PS_MAIL_USER','PS_MAIL_PASSWD');
DELETE ms FROM ${p}module_shop ms JOIN ${p}module m ON m.id_module=ms.id_module WHERE m.name IN (${mods});
UPDATE ${p}module SET active=0 WHERE name IN (${mods});
`
    )
    const admin = await this.resetAdmin(ctx)
    await this.clearCache(ctx)
    return admin
  },

  async resetAdmin(ctx) {
    const p = ctx.inst.dbPrefix
    const pass = ctx.settings.localAdminPassword
    const root = rootOf(ctx)
    const rows = await sql(ctx, `SELECT id_employee, email FROM ${p}employee WHERE id_profile=1 ORDER BY id_employee LIMIT 1;`)
    if (!rows.length) throw new Error('No hay ningún empleado SuperAdmin en la BD')
    const [id, email] = rows[0]
    let hash: string
    const version = ctx.inst.cmsVersion ?? ''
    if (!is17(root) || (version && compareVersions(version, '1.7') < 0)) {
      const key = cookieKeyFrom16(readFileSync(configPath(root), 'utf8'))
      if (!key) throw new Error('No se pudo leer _COOKIE_KEY_ de settings.inc.php')
      hash = (await execIn(ctx.inst, ['php', '-r', 'echo md5($argv[1].$argv[2]);', key, pass])).stdout.trim()
    } else {
      hash = (await execIn(ctx.inst, ['php', '-r', 'echo password_hash($argv[1], PASSWORD_BCRYPT);', pass])).stdout.trim()
    }
    await sql(ctx, `UPDATE ${p}employee SET passwd=${sqlString(hash)}, active=1 WHERE id_employee=${parseInt(id, 10)};`)
    const dir = adminDir(root)
    ctx.log(`Admin local: ${email} / ${pass}`)
    return { user: email, password: pass, url: dir ? `${ctx.url}/${dir}/` : ctx.url }
  },

  async clearCache(ctx) {
    await execIn(
      ctx.inst,
      ['sh', '-c', 'rm -rf var/cache/* cache/smarty/compile/* cache/smarty/cache/* cache/cachefs/* cache/class_index.php 2>/dev/null; true'],
      { allowFail: true }
    )
  },

  async pluginUpdates() {
    return []
  },

  async runUpdates(ctx, what) {
    if (!is17(rootOf(ctx))) throw new Error('PrestaShop 1.6 no tiene consola; actualiza los módulos desde el back-office')
    await execIn(ctx.inst, ['php', 'bin/console', 'prestashop:module', 'upgrade', what], { onLine: ctx.log })
    await this.clearCache(ctx)
  }
}
