import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { defineConfig } from 'vitest/config'

// Prueba de extremo a extremo contra Docker real. Usa puertos 8880/8443 y un
// directorio de datos temporal para no interferir con una instalación existente.
const dataDir = mkdtempSync(join(tmpdir(), 'devhub-e2e-'))

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    include: ['src/**/*.e2e.ts'],
    environment: 'node',
    testTimeout: 30 * 60 * 1000,
    hookTimeout: 10 * 60 * 1000,
    env: { DEVHUB_DATA_DIR: dataDir }
  }
})
