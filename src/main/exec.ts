import { spawn, type SpawnOptions } from 'child_process'
import type { Readable } from 'stream'

export interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** Texto o stream que se envía por stdin. */
  input?: string | Readable
  /** Recibe cada línea de stdout/stderr según llega (para logs de tareas). */
  onLine?: (line: string) => void
  /** Si es true no lanza excepción con código de salida distinto de 0. */
  allowFail?: boolean
  timeoutMs?: number
}

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

export class CommandError extends Error {
  constructor(
    public cmd: string,
    public result: RunResult
  ) {
    const tail = (result.stderr || result.stdout).trim().split('\n').slice(-15).join('\n')
    super(`${cmd} terminó con código ${result.code}${tail ? `:\n${tail}` : ''}`)
  }
}

function lineSplitter(cb: (line: string) => void): (chunk: Buffer) => void {
  let buf = ''
  return (chunk) => {
    buf += chunk.toString('utf8')
    const parts = buf.split(/\r?\n|\r/)
    buf = parts.pop() ?? ''
    for (const p of parts) if (p.trim()) cb(p)
  }
}

export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const spawnOpts: SpawnOptions = {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe']
    }
    const child = spawn(cmd, args, spawnOpts)
    let stdout = ''
    let stderr = ''
    const onOut = opts.onLine ? lineSplitter(opts.onLine) : null
    const onErr = opts.onLine ? lineSplitter(opts.onLine) : null
    child.stdout!.on('data', (c: Buffer) => {
      stdout += c.toString('utf8')
      onOut?.(c)
    })
    child.stderr!.on('data', (c: Buffer) => {
      stderr += c.toString('utf8')
      onErr?.(c)
    })
    let timer: NodeJS.Timeout | undefined
    if (opts.timeoutMs) timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs)
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      const result = { code: code ?? -1, stdout, stderr }
      if (result.code !== 0 && !opts.allowFail) reject(new CommandError([cmd, ...args.slice(0, 3)].join(' '), result))
      else resolve(result)
    })
    if (opts.input === undefined) child.stdin!.end()
    else if (typeof opts.input === 'string') child.stdin!.end(opts.input)
    else {
      opts.input.on('error', (e) => {
        child.kill('SIGTERM')
        reject(e)
      })
      child.stdin!.on('error', () => {
        /* el proceso cerró stdin antes de tiempo; el código de salida lo reporta */
      })
      opts.input.pipe(child.stdin!)
    }
  })
}

/** ¿Existe el binario en el PATH? */
export async function which(bin: string): Promise<string | null> {
  const r = await run('sh', ['-c', `command -v ${bin}`], { allowFail: true })
  return r.code === 0 ? r.stdout.trim() : null
}

/** Ejecuta un proceso desacoplado (abrir editor, terminal...). */
export function detached(cmd: string, args: string[], cwd?: string): void {
  const child = spawn(cmd, args, { cwd, detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}
