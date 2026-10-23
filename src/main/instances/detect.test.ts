import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { detect, findDocroot, parsePsVersion, parseWpVersion } from './detect'

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'devhub-test-'))
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), content)
  }
  return root
}

describe('detect', () => {
  it('lee versiones de WP y PS', () => {
    expect(parseWpVersion("<?php\n$wp_version = '6.4.3';")).toBe('6.4.3')
    expect(parsePsVersion("class AppKernel { const VERSION = '1.7.8.10';")).toBe('1.7.8.10')
    expect(parsePsVersion("define('_PS_INSTALL_VERSION_', '1.6.1.24');")).toBe('1.6.1.24')
  })

  it('encuentra WordPress en httpdocs', () => {
    const root = tree({ 'README.md': '', 'httpdocs/wp-includes/version.php': "<?php $wp_version = '5.9.2';" })
    expect(findDocroot(root)).toEqual({ docroot: 'httpdocs', type: 'wordpress' })
    expect(detect(root, undefined, '8.2')).toMatchObject({ php: '8.0', phpSource: 'versión del CMS', cmsVersion: '5.9.2' })
  })

  it('prioriza manifiesto y composer', () => {
    const root = tree({
      'config/defines.inc.php': '',
      'app/AppKernel.php': "const VERSION = '8.1.2';",
      'composer.json': JSON.stringify({ config: { platform: { php: '7.4.33' } } })
    })
    expect(detect(root, undefined, '8.2')).toMatchObject({ type: 'prestashop', php: '7.4', phpSource: 'composer' })
    expect(detect(root, { php_version: '8.1.29' }, '8.2')).toMatchObject({ php: '8.1', phpSource: 'manifiesto' })
  })

  it('usa la versión por defecto si no reconoce el CMS', () => {
    expect(detect(tree({ 'index.php': '' }), undefined, '8.3')).toMatchObject({ type: 'unknown', php: '8.3' })
  })
})
