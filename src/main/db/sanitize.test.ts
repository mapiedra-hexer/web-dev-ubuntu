import { Readable } from 'stream'
import { describe, expect, it } from 'vitest'
import { sanitizeSql, SqlSanitizer } from './sanitize'

async function through(chunks: string[]): Promise<string> {
  const out: Buffer[] = []
  await new Promise<void>((resolve, reject) => {
    Readable.from(chunks.map((c) => Buffer.from(c, 'utf8')))
      .pipe(new SqlSanitizer())
      .on('data', (c: Buffer) => out.push(c))
      .on('end', resolve)
      .on('error', reject)
  })
  return Buffer.concat(out).toString('utf8')
}

describe('sanitizeSql', () => {
  it('cambia collations de MySQL 8 y quita DEFINER', () => {
    const sql =
      "CREATE TABLE `t` (a varchar(10)) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;\n" +
      '/*!50013 DEFINER=`plesk`@`localhost` SQL SECURITY DEFINER */\n' +
      "/*!80016 DEFAULT ENCRYPTION='N' */"
    const out = sanitizeSql(sql)
    expect(out).toContain('utf8mb4_unicode_ci')
    expect(out).not.toContain('0900')
    expect(out).not.toContain('`plesk`@`localhost`')
    expect(out).not.toContain('ENCRYPTION')
  })

  it('funciona en streaming aunque el patrón quede partido entre trozos', async () => {
    const big = 'x'.repeat(1000)
    const out = await through([big + 'COLLATE=utf8mb4_09', '00_ai_ci;' + big, ' DEFINER=`u`@`', 'h` FIN'])
    expect(out).toBe(big + 'COLLATE=utf8mb4_unicode_ci;' + big + '  FIN')
  })

  it('conserva texto UTF-8 multibyte', async () => {
    const txt = 'INSERT INTO t VALUES ("Córdoba ñandú 🚗");'
    expect(await through([txt.slice(0, 20), txt.slice(20)])).toBe(txt)
  })
})
