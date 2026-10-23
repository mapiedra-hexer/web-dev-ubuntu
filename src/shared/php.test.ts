import { describe, expect, it } from 'vitest'
import { coercePhpVersion, compareVersions, phpFromComposerConstraint, suggestPhp } from './php'

describe('php', () => {
  it('compara versiones', () => {
    expect(compareVersions('1.7.8.10', '1.7.8.9')).toBeGreaterThan(0)
    expect(compareVersions('8.0', '8.0.0')).toBe(0)
    expect(compareVersions('6.4.3', '6.6')).toBeLessThan(0)
  })
  it('normaliza versiones de PHP', () => {
    expect(coercePhpVersion('8.2.14')).toBe('8.2')
    expect(coercePhpVersion('php7.4')).toBe('7.4')
    expect(coercePhpVersion('82')).toBe('8.2')
    expect(coercePhpVersion('7.0')).toBeNull()
    expect(coercePhpVersion(undefined)).toBeNull()
  })
  it('interpreta restricciones de composer', () => {
    expect(phpFromComposerConstraint('^7.4')).toBe('7.4')
    expect(phpFromComposerConstraint('>=8.0 <8.3')).toBe('8.0')
    expect(phpFromComposerConstraint('^7.0 || ^8.0')).toBe('7.1')
  })
  it('sugiere PHP según CMS', () => {
    expect(suggestPhp('wordpress', '6.6.1', '8.2')).toBe('8.2')
    expect(suggestPhp('wordpress', '5.4', '8.2')).toBe('7.4')
    expect(suggestPhp('prestashop', '1.6.1.24', '8.2')).toBe('7.1')
    expect(suggestPhp('prestashop', '1.7.8.10', '8.2')).toBe('7.4')
    expect(suggestPhp('prestashop', '8.1.7', '8.2')).toBe('8.1')
    expect(suggestPhp('unknown', '1.0', '8.2')).toBe('8.2')
  })
})
