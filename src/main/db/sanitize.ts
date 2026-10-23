import { Transform, type TransformCallback } from 'stream'

/**
 * Reescrituras para que un volcado de MySQL 5.7/8 o MariaDB de Plesk se importe
 * en la MariaDB 10.11 local sin errores.
 */
const RULES: [RegExp, string][] = [
  // Collations exclusivas de MySQL 8
  [/utf8mb4_0900_ai_ci/g, 'utf8mb4_unicode_ci'],
  [/utf8mb4_0900_as_ci/g, 'utf8mb4_unicode_ci'],
  [/utf8mb4_0900_as_cs/g, 'utf8mb4_bin'],
  [/utf8mb4_0900_bin/g, 'utf8mb4_bin'],
  // Vistas/triggers con DEFINER de un usuario que no existe en local
  [/DEFINER\s*=\s*`[^`]*`@`[^`]*`/g, ''],
  [/DEFINER\s*=\s*'[^']*'@'[^']*'/g, ''],
  // Opciones de MySQL 8 que MariaDB ejecuta (comentario versionado) pero no entiende
  [/\/\*!80016 DEFAULT ENCRYPTION='[NY]' \*\//g, ''],
  [/\/\*!80000 SET[^*]*\*\/;?/g, '']
]

/** Longitud máxima de un patrón; se guarda ese margen entre trozos para no partir coincidencias. */
const CARRY = 256

export function sanitizeSql(text: string): string {
  let out = text
  for (const [re, rep] of RULES) out = out.replace(re, rep)
  return out
}

export class SqlSanitizer extends Transform {
  private carry = ''

  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    const text = sanitizeSql(this.carry + chunk.toString('latin1'))
    if (text.length > CARRY) {
      this.push(Buffer.from(text.slice(0, text.length - CARRY), 'latin1'))
      this.carry = text.slice(text.length - CARRY)
    } else {
      this.carry = text
    }
    cb()
  }

  _flush(cb: TransformCallback): void {
    if (this.carry) this.push(Buffer.from(sanitizeSql(this.carry), 'latin1'))
    cb()
  }
}
