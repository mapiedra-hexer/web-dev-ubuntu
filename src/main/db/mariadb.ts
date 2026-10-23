import { spawn } from 'child_process'
import { createReadStream, createWriteStream, statSync } from 'fs'
import { PassThrough, type Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { createGzip, createGunzip } from 'zlib'
import type { CmsType } from '@shared/types'
import { dockerExec, dockerExecStream, MARIADB_CONTAINER } from '../docker'
import { rootPassword } from '../core/core'
import { SqlSanitizer } from './sanitize'

function rootEnv(): Record<string, string> {
  return { MYSQL_PWD: rootPassword() }
}

function ident(name: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Nombre de BD no válido: ${name}`)
  return '`' + name + '`'
}

/** Ejecuta SQL y devuelve las filas como arrays de columnas (salida tabulada sin cabecera). */
export async function query(db: string | null, sql: string): Promise<string[][]> {
  const args = ['mariadb', '-uroot', '--batch', '--skip-column-names']
  if (db) args.push(db)
  const r = await dockerExec(MARIADB_CONTAINER, args, { input: sql, env: rootEnv() })
  return r.stdout
    .split('\n')
    .filter((l) => l.length)
    .map((l) => l.split('\t'))
}

export async function createDb(db: string, recreate = false): Promise<void> {
  const sql = (recreate ? `DROP DATABASE IF EXISTS ${ident(db)};\n` : '') +
    `CREATE DATABASE IF NOT EXISTS ${ident(db)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
  await query(null, sql)
}

export async function dropDb(db: string): Promise<void> {
  await query(null, `DROP DATABASE IF EXISTS ${ident(db)};`)
}

export async function dbSizeMb(db: string): Promise<number> {
  const rows = await query(
    null,
    `SELECT ROUND(COALESCE(SUM(data_length+index_length),0)/1024/1024,1) FROM information_schema.tables WHERE table_schema='${db}';`
  )
  return parseFloat(rows[0]?.[0] ?? '0')
}

/** Abre un volcado (.sql, .sql.gz o .zip) como stream de texto SQL, informando del progreso leído (0..1). */
export function openDump(file: string, onProgress?: (p: number) => void): Readable {
  const lower = file.toLowerCase()
  if (lower.endsWith('.zip')) {
    const child = spawn('unzip', ['-p', file, '*.sql'], { stdio: ['ignore', 'pipe', 'pipe'] })
    const out = new PassThrough()
    child.stdout.pipe(out)
    child.on('error', (e) => out.destroy(e))
    child.on('close', (code) => {
      if (code !== 0 && code !== 1) out.destroy(new Error(`unzip falló (${code})`))
    })
    return out
  }
  const total = statSync(file).size
  let read = 0
  const src = createReadStream(file, { highWaterMark: 1024 * 1024 })
  src.on('data', (c: string | Buffer) => {
    read += c.length
    onProgress?.(total ? read / total : 0)
  })
  if (lower.endsWith('.gz')) {
    const gunzip = createGunzip()
    src.on('error', (e) => gunzip.destroy(e))
    return src.pipe(gunzip)
  }
  return src
}

/** Importa un volcado en streaming dentro de la MariaDB común, saneando incompatibilidades. */
export async function importDump(db: string, file: string, onProgress?: (p: number) => void, onLine?: (l: string) => void): Promise<void> {
  const sql = openDump(file, onProgress).pipe(new SqlSanitizer())
  await dockerExec(MARIADB_CONTAINER, ['mariadb', '-uroot', '--max-allowed-packet=512M', db], {
    input: sql,
    env: rootEnv(),
    onLine
  })
}

/** Copia una BD a otra (para duplicados). */
export async function cloneDb(src: string, dst: string): Promise<void> {
  await createDb(dst, true)
  await dockerExec(
    MARIADB_CONTAINER,
    ['sh', '-c', `mariadb-dump -uroot --single-transaction --routines --triggers --events ${src} | mariadb -uroot ${dst}`],
    { env: rootEnv() }
  )
}

/** Vuelca una BD comprimida a fichero (puntos de restauración). */
export async function dumpToFile(db: string, file: string): Promise<void> {
  const { stdout, done } = dockerExecStream(
    MARIADB_CONTAINER,
    ['mariadb-dump', '-uroot', '--single-transaction', '--routines', '--triggers', '--events', db],
    rootEnv()
  )
  await Promise.all([pipeline(stdout, createGzip(), createWriteStream(file)), done])
}

/**
 * Deduce el prefijo de tablas mirando las tablas importadas:
 * WordPress -> <p>options + <p>usermeta; PrestaShop -> <p>configuration + <p>shop_url.
 */
export async function detectPrefix(db: string, type: CmsType): Promise<{ prefix: string; type: CmsType } | null> {
  const tables = (await query(db, 'SHOW TABLES;')).map((r) => r[0])
  const set = new Set(tables)
  const tryType = (t: CmsType, a: string, b: string): { prefix: string; type: CmsType } | null => {
    for (const name of tables) {
      if (!name.endsWith(a)) continue
      const prefix = name.slice(0, -a.length)
      if (set.has(prefix + b)) return { prefix, type: t }
    }
    return null
  }
  const wp = (): { prefix: string; type: CmsType } | null => tryType('wordpress', 'options', 'usermeta')
  const ps = (): { prefix: string; type: CmsType } | null => tryType('prestashop', 'configuration', 'shop_url')
  return type === 'prestashop' ? ps() ?? wp() : wp() ?? ps()
}

export function sqlString(v: string): string {
  return "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
}
