import { spawn } from 'child_process'
import type { Readable } from 'stream'
import type { ContainerState } from '@shared/types'
import { run, type RunOptions, type RunResult } from './exec'

export const MARIADB_CONTAINER = 'devhub-mariadb'
export const MAILPIT_HOST = 'devhub-mailpit'

export function compose(project: string, file: string, args: string[], opts: RunOptions & { envFile?: string } = {}): Promise<RunResult> {
  const base = ['compose', '-p', project, '-f', file]
  if (opts.envFile) base.push('--env-file', opts.envFile)
  return run('docker', [...base, ...args], opts)
}

export interface ExecOptions {
  user?: string
  env?: Record<string, string>
  workdir?: string
  input?: string | Readable
  onLine?: (line: string) => void
  allowFail?: boolean
}

export function dockerExec(container: string, cmd: string[], opts: ExecOptions = {}): Promise<RunResult> {
  const args = ['exec']
  if (opts.input !== undefined) args.push('-i')
  if (opts.user) args.push('-u', opts.user)
  if (opts.workdir) args.push('-w', opts.workdir)
  for (const [k, v] of Object.entries(opts.env ?? {})) args.push('-e', `${k}=${v}`)
  args.push(container, ...cmd)
  return run('docker', args, { input: opts.input, onLine: opts.onLine, allowFail: opts.allowFail })
}

/** Ejecuta un comando en el contenedor y devuelve su stdout como stream (para volcados grandes). */
export function dockerExecStream(container: string, cmd: string[], env: Record<string, string> = {}): {
  stdout: Readable
  done: Promise<void>
} {
  const args = ['exec']
  for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`)
  args.push(container, ...cmd)
  const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd[0]} falló (${code}): ${stderr.trim()}`))))
  })
  return { stdout: child.stdout, done }
}

/** Estado de los contenedores de instancias, indexado por id de instancia. */
export async function instanceStates(): Promise<Map<string, ContainerState>> {
  const r = await run(
    'docker',
    ['ps', '-a', '--filter', 'label=devhub.instance', '--format', '{{.Label "devhub.instance"}}\t{{.State}}'],
    { allowFail: true }
  )
  const map = new Map<string, ContainerState>()
  if (r.code !== 0) return map
  for (const line of r.stdout.split('\n')) {
    const [id, state] = line.trim().split('\t')
    if (id) map.set(id, (state as ContainerState) || 'missing')
  }
  return map
}

export async function coreServices(): Promise<{ name: string; state: string }[]> {
  const r = await run('docker', ['ps', '-a', '--filter', 'label=devhub.core=true', '--format', '{{.Names}}\t{{.State}}'], {
    allowFail: true
  })
  if (r.code !== 0) return []
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [name, state] = l.split('\t')
      return { name, state }
    })
}

export async function imageExists(ref: string): Promise<boolean> {
  const r = await run('docker', ['image', 'inspect', ref, '--format', '{{.Id}}'], { allowFail: true })
  return r.code === 0
}

/** Escucha eventos de contenedores DevHub y llama a `cb` (con antirrebote). Devuelve una función para parar. */
export function watchContainerEvents(cb: () => void): () => void {
  let child: ReturnType<typeof spawn> | null = null
  let stopped = false
  let timer: NodeJS.Timeout | null = null
  const fire = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(cb, 300)
  }
  const start = (): void => {
    if (stopped) return
    child = spawn('docker', ['events', '--filter', 'type=container', '--filter', 'label=devhub.instance', '--format', '{{.Status}}'], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    child.stdout!.on('data', fire)
    child.on('error', () => {})
    child.on('close', () => {
      if (!stopped) setTimeout(start, 5000)
    })
  }
  start()
  return () => {
    stopped = true
    child?.kill()
  }
}
