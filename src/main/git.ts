import { appendFileSync, existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { run } from './exec'

/**
 * Autenticación por cabecera HTTP pasada vía variables de entorno de git:
 * el token no queda en .git/config ni en la lista de procesos.
 */
function authEnv(token?: string): NodeJS.ProcessEnv {
  if (!token) return { GIT_TERMINAL_PROMPT: '0' }
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
  return {
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`
  }
}

export async function clone(url: string, dest: string, token: string | undefined, branch: string | undefined, onLine?: (l: string) => void): Promise<void> {
  const args = ['clone', '--progress']
  if (branch) args.push('--branch', branch)
  args.push(url, dest)
  await run('git', args, { env: authEnv(token), onLine })
}

export async function currentBranch(dir: string): Promise<string> {
  const r = await run('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true })
  return r.code === 0 ? r.stdout.trim() : ''
}

export async function branches(dir: string, token?: string): Promise<string[]> {
  await run('git', ['-C', dir, 'fetch', '--prune', 'origin'], { env: authEnv(token), allowFail: true })
  const r = await run('git', ['-C', dir, 'branch', '-a', '--format=%(refname:short)'], { allowFail: true })
  const names = new Set<string>()
  for (const line of r.stdout.split('\n')) {
    const n = line.trim().replace(/^origin\//, '')
    if (n && n !== 'HEAD' && n !== 'origin') names.add(n)
  }
  return [...names].sort()
}

export async function addWorktree(repoDir: string, dest: string, opts: { base: string; newBranch?: string }, onLine?: (l: string) => void): Promise<void> {
  const args = ['-C', repoDir, 'worktree', 'add']
  if (opts.newBranch) args.push('-b', opts.newBranch, dest, opts.base)
  else args.push(dest, opts.base)
  await run('git', args, { onLine })
}

export async function removeWorktree(repoDir: string, dest: string): Promise<void> {
  await run('git', ['-C', repoDir, 'worktree', 'remove', '--force', dest], { allowFail: true })
  await run('git', ['-C', repoDir, 'worktree', 'prune'], { allowFail: true })
}

/** Ficheros/carpetas ignorados por git (uploads, vendor no versionado…), relativos al repo. */
export async function ignoredPaths(dir: string): Promise<string[]> {
  const r = await run('git', ['-C', dir, 'ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'], {
    allowFail: true
  })
  return r.stdout.split('\0').filter(Boolean)
}

/** Ruta real de .git (en un worktree, .git es un fichero que apunta al gitdir). */
function gitDir(dir: string): string | null {
  const dotgit = join(dir, '.git')
  if (!existsSync(dotgit)) return null
  if (statSync(dotgit).isDirectory()) return dotgit
  const m = readFileSync(dotgit, 'utf8').match(/gitdir:\s*(.+)/)
  if (!m) return null
  const wt = m[1].trim()
  // .git/worktrees/<name> -> la exclusión se comparte en el gitdir común
  const common = join(wt, 'commondir')
  return existsSync(common) ? join(wt, readFileSync(common, 'utf8').trim()) : wt
}

/** Añade rutas a .git/info/exclude (local, no se versiona) para no subir la config generada. */
export function excludeLocally(repoDir: string, relPaths: string[]): void {
  const gd = gitDir(repoDir)
  if (!gd) return
  const file = join(gd, 'info', 'exclude')
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const missing = relPaths.filter((p) => !current.split('\n').includes(p))
  if (!missing.length) return
  appendFileSync(file, `${current.endsWith('\n') || !current ? '' : '\n'}# DevHub\n${missing.join('\n')}\n`)
}
