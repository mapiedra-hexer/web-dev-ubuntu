import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { PluginUpdate } from '@shared/types'
import { execIn, type Stack, type StackContext } from './types'
import { MARKER, wpConfig } from './templates'

/** wp-cli sin cargar plugins ni tema: más rápido y a prueba de plugins rotos. */
function wp(ctx: StackContext, args: string[], allowFail = false): ReturnType<typeof execIn> {
  return execIn(ctx.inst, ['wp', ...args, '--skip-plugins', '--skip-themes'], { allowFail, onLine: ctx.log })
}

export const wordpress: Stack = {
  configFiles: () => ['wp-config.php', 'wp-content/debug.log'],

  writeConfig(root, log) {
    const file = join(root, 'wp-config.php')
    if (existsSync(file)) {
      const current = readFileSync(file, 'utf8')
      if (current.includes(MARKER)) return
      const backup = `${file}.devhub-bak`
      copyFileSync(file, backup)
      log(`wp-config.php existente copiado a ${backup}`)
    }
    writeFileSync(file, wpConfig())
    log('wp-config.php generado')
  },

  async afterImport(ctx, previousUrls) {
    const siteurl = (await wp(ctx, ['option', 'get', 'siteurl'], true)).stdout.trim()
    const from = new Set(previousUrls)
    if (siteurl && /^https?:\/\//.test(siteurl) && siteurl !== ctx.url) from.add(siteurl.replace(/\/$/, ''))
    from.delete(ctx.url)
    for (const old of from) {
      ctx.log(`Sustituyendo ${old} → ${ctx.url}`)
      await wp(ctx, ['search-replace', old, ctx.url, '--all-tables-with-prefix', '--skip-columns=guid', '--report-changed-only'], true)
      // URLs escapadas en JSON (Elementor, bloques…)
      const esc = (u: string): string => u.replace(/\//g, '\\/')
      await wp(ctx, ['search-replace', esc(old), esc(ctx.url), '--all-tables-with-prefix', '--skip-columns=guid', '--report-changed-only'], true)
    }

    const active = (await wp(ctx, ['plugin', 'list', '--status=active', '--field=name'], true)).stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const toDisable = active.filter((p) => ctx.settings.wpPluginsToDisable.includes(p))
    if (toDisable.length) {
      ctx.log(`Desactivando plugins: ${toDisable.join(', ')}`)
      await wp(ctx, ['plugin', 'deactivate', ...toDisable], true)
    }
    await wp(ctx, ['option', 'update', 'blog_public', '0'], true)
    const admin = await this.resetAdmin(ctx)
    await this.clearCache(ctx)
    return admin
  },

  async resetAdmin(ctx) {
    const { localAdminUser: user, localAdminPassword: pass } = ctx.settings
    const exists = (await wp(ctx, ['user', 'get', user, '--field=ID'], true)).code === 0
    if (exists) {
      await wp(ctx, ['user', 'update', user, `--user_pass=${pass}`, '--role=administrator'])
    } else {
      await wp(ctx, ['user', 'create', user, `${user}@local.test`, `--user_pass=${pass}`, '--role=administrator'])
    }
    if ((await wp(ctx, ['core', 'is-installed', '--network'], true)).code === 0) {
      await wp(ctx, ['super-admin', 'add', user], true)
    }
    ctx.log(`Admin local: ${user} / ${pass}`)
    return { user, password: pass, url: `${ctx.url}/wp-admin/` }
  },

  async clearCache(ctx) {
    await wp(ctx, ['cache', 'flush'], true)
    await wp(ctx, ['transient', 'delete', '--all'], true)
    await wp(ctx, ['rewrite', 'flush'], true)
  },

  async versionFromDb(ctx) {
    const r = await wp(ctx, ['core', 'version'], true)
    return r.code === 0 ? r.stdout.trim() : undefined
  },

  async pluginUpdates(ctx) {
    const updates: PluginUpdate[] = []
    const core = await wp(ctx, ['core', 'check-update', '--format=json'], true)
    try {
      const list = JSON.parse(core.stdout || '[]') as { version: string }[]
      const current = (await wp(ctx, ['core', 'version'], true)).stdout.trim()
      if (list.length) updates.push({ name: 'core', version: current, updateVersion: list[0].version })
    } catch {
      /* sin conexión o sin actualizaciones */
    }
    const plugins = await execIn(ctx.inst, ['wp', 'plugin', 'list', '--update=available', '--fields=name,version,update_version', '--format=json'], {
      allowFail: true
    })
    try {
      for (const p of JSON.parse(plugins.stdout || '[]') as { name: string; version: string; update_version: string }[]) {
        updates.push({ name: p.name, version: p.version, updateVersion: p.update_version })
      }
    } catch {
      /* salida no JSON (errores de plugins) */
    }
    return updates
  },

  async runUpdates(ctx, what) {
    if (what === 'core') await wp(ctx, ['core', 'update'])
    else if (what === 'plugins') await execIn(ctx.inst, ['wp', 'plugin', 'update', '--all'], { onLine: ctx.log })
    else await execIn(ctx.inst, ['wp', 'plugin', 'update', what], { onLine: ctx.log })
    await wp(ctx, ['core', 'update-db'], true)
  }
}
