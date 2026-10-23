import { createHash } from 'crypto'
import { describe, expect, it } from 'vitest'
import { cookieKeyFrom16, defuseKey, MARKER, psParameters, psSettings16, wpConfig } from './templates'

describe('plantillas de configuración', () => {
  it('wp-config lee la conexión del entorno y lleva la marca', () => {
    const c = wpConfig()
    expect(c).toContain(MARKER)
    expect(c).toContain("define('DB_NAME', getenv('DEVHUB_DB_NAME'));")
    expect(c).toContain("$table_prefix = getenv('DEVHUB_DB_PREFIX')")
    expect(c.match(/define\('(AUTH|SECURE_AUTH|LOGGED_IN|NONCE)_(KEY|SALT)', '[^'\\]{64}'\);/g)).toHaveLength(8)
  })

  it('genera claves Defuse válidas (cabecera + checksum sha256)', () => {
    const key = Buffer.from(defuseKey(), 'hex')
    expect(key.length).toBe(4 + 32 + 32)
    expect(key.subarray(0, 4).toString('hex')).toBe('def00000')
    const sum = createHash('sha256').update(key.subarray(0, 36)).digest()
    expect(key.subarray(36).equals(sum)).toBe(true)
  })

  it('parameters.php de PS 1.7+ incluye claves API y de cookie', () => {
    const p = psParameters()
    expect(p).toContain("'database_name' => getenv('DEVHUB_DB_NAME')")
    expect(p).toContain('BEGIN PUBLIC KEY')
    expect(p).toMatch(/'new_cookie_key' => 'def00000[0-9a-f]{128}'/)
  })

  it('settings.inc.php de PS 1.6 expone _COOKIE_KEY_ legible', () => {
    const s = psSettings16()
    const key = cookieKeyFrom16(s)
    expect(key).toMatch(/^[A-Za-z0-9]{56}$/)
    expect(s).toContain("define('_PS_VERSION_', getenv('DEVHUB_CMS_VERSION')")
  })
})
