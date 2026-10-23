import { createHash, generateKeyPairSync, randomBytes } from 'crypto'

/** Marca que identifica los ficheros de configuración generados por DevHub. */
export const MARKER = 'Generado por DevHub'

const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export function randomAlnum(len: number): string {
  const bytes = randomBytes(len)
  let s = ''
  for (let i = 0; i < len; i++) s += ALNUM[bytes[i] % ALNUM.length]
  return s
}

/** Clave para WordPress (salts): caracteres imprimibles sin comillas ni barra invertida. */
function wpSalt(): string {
  const chars = ALNUM + '!@#%^&*()-_[]{}<>~+=,.;:/?|'
  const bytes = randomBytes(64)
  let s = ''
  for (let i = 0; i < 64; i++) s += chars[bytes[i] % chars.length]
  return s
}

export function wpConfig(): string {
  const keys = ['AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY', 'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT']
  return `<?php
/**
 * ${MARKER} — solo para entorno local. No versionar.
 * Los datos de conexión y la URL llegan por variables de entorno del contenedor,
 * así la misma carpeta sirve para varias instancias (duplicados en otra versión de PHP).
 */
define('DB_NAME', getenv('DEVHUB_DB_NAME'));
define('DB_USER', getenv('DEVHUB_DB_USER'));
define('DB_PASSWORD', getenv('DEVHUB_DB_PASSWORD'));
define('DB_HOST', getenv('DEVHUB_DB_HOST'));
define('DB_CHARSET', 'utf8mb4');
define('DB_COLLATE', '');

${keys.map((k) => `define('${k}', '${wpSalt()}');`).join('\n')}

$table_prefix = getenv('DEVHUB_DB_PREFIX') ?: 'wp_';

define('WP_HOME', getenv('DEVHUB_URL'));
define('WP_SITEURL', getenv('DEVHUB_URL'));
define('WP_ENVIRONMENT_TYPE', 'local');
define('WP_DEBUG', true);
define('WP_DEBUG_LOG', true);
define('WP_DEBUG_DISPLAY', false);
define('SCRIPT_DEBUG', false);
define('FS_METHOD', 'direct');
define('WP_AUTO_UPDATE_CORE', false);
define('AUTOMATIC_UPDATER_DISABLED', true);
define('WP_CACHE', false);

if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') {
    $_SERVER['HTTPS'] = 'on';
}

if (!defined('ABSPATH')) {
    define('ABSPATH', __DIR__ . '/');
}
require_once ABSPATH . 'wp-settings.php';
`
}

/** Clave Defuse (PhpEncryption de PrestaShop 1.7+) en formato ASCII con checksum. */
export function defuseKey(): string {
  const header = Buffer.from([0xde, 0xf0, 0x00, 0x00])
  const body = Buffer.concat([header, randomBytes(32)])
  const checksum = createHash('sha256').update(body).digest()
  return Buffer.concat([body, checksum]).toString('hex')
}

function phpStr(s: string): string {
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
}

/** app/config/parameters.php para PrestaShop 1.7 / 8 / 9. */
export function psParameters(): string {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
  const cookieKey = randomAlnum(56)
  return `<?php
// ${MARKER} — solo para entorno local. No versionar.
// Si cambian las variables de entorno hay que vaciar var/cache (DevHub lo hace al reconfigurar).
return array (
  'parameters' => array (
    'database_host' => getenv('DEVHUB_DB_HOST'),
    'database_port' => '',
    'database_name' => getenv('DEVHUB_DB_NAME'),
    'database_user' => getenv('DEVHUB_DB_USER'),
    'database_password' => getenv('DEVHUB_DB_PASSWORD'),
    'database_prefix' => getenv('DEVHUB_DB_PREFIX') ?: 'ps_',
    'database_engine' => 'InnoDB',
    'mailer_transport' => 'smtp',
    'mailer_host' => getenv('DEVHUB_MAIL_HOST'),
    'mailer_user' => NULL,
    'mailer_password' => NULL,
    'secret' => ${phpStr(randomAlnum(56))},
    'ps_caching' => 'CacheMemcache',
    'ps_cache_enable' => false,
    'ps_creation_date' => '2020-01-01',
    'locale' => 'es-ES',
    'use_debug_toolbar' => true,
    'cookie_key' => ${phpStr(cookieKey)},
    'cookie_iv' => ${phpStr(randomAlnum(8))},
    'new_cookie_key' => ${phpStr(defuseKey())},
    'api_public_key' => ${phpStr(publicKey)},
    'api_private_key' => ${phpStr(privateKey)},
  ),
);
`
}

/** config/settings.inc.php para PrestaShop 1.6. */
export function psSettings16(): string {
  return `<?php
// ${MARKER} — solo para entorno local. No versionar.
define('_DB_SERVER_', getenv('DEVHUB_DB_HOST'));
define('_DB_NAME_', getenv('DEVHUB_DB_NAME'));
define('_DB_USER_', getenv('DEVHUB_DB_USER'));
define('_DB_PASSWD_', getenv('DEVHUB_DB_PASSWORD'));
define('_DB_PREFIX_', getenv('DEVHUB_DB_PREFIX') ?: 'ps_');
define('_MYSQL_ENGINE_', 'InnoDB');
define('_PS_CACHING_SYSTEM_', 'CacheMemcache');
define('_PS_CACHE_ENABLED_', '0');
define('_COOKIE_KEY_', ${phpStr(randomAlnum(56))});
define('_COOKIE_IV_', ${phpStr(randomAlnum(8))});
define('_PS_CREATION_DATE_', '2020-01-01');
define('_PS_VERSION_', getenv('DEVHUB_CMS_VERSION') ?: '1.6.1.24');
define('_RIJNDAEL_KEY_', ${phpStr(randomAlnum(32))});
define('_RIJNDAEL_IV_', ${phpStr(randomBytes(16).toString('base64'))});
`
}

/** Extrae _COOKIE_KEY_ de settings.inc.php (para calcular el hash de contraseña en PS 1.6). */
export function cookieKeyFrom16(settings: string): string | null {
  return settings.match(/_COOKIE_KEY_['"]\s*,\s*'([^']+)'/)?.[1] ?? null
}
