import { execFile, spawn } from 'child_process'
import { existsSync } from 'fs'
import type { Tunnel } from './config'

// VS Code launched from the Dock does not inherit the shell PATH, so Homebrew
// binaries are not found by name. Check the usual install locations first.
const CLOUDFLARED_CANDIDATES = ['/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared']

export function resolveCloudflared(configured: string): string {
  if (configured.trim()) return configured.trim()
  return CLOUDFLARED_CANDIDATES.find((p) => existsSync(p)) ?? 'cloudflared'
}

export function isRunning(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], (error) => resolve(!error))
  })
}

// The one place the cloudflared invocation is defined. startTunnel spawns these args and
// stopTunnel matches the same string. The `tunnels` CLI uses the same order, so each can stop the other's.
export function tunnelArgs(tunnel: Tunnel): string[] {
  return ['access', 'tcp', '--hostname', tunnel.host, '--url', `localhost:${tunnel.port}`]
}

/** A `pkill -f` regex that matches exactly this tunnel: same host and same port, nothing that merely starts with them. */
export function tunnelPattern(tunnel: Tunnel): string {
  const escaped = tunnelArgs(tunnel)
    .join(' ')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return `${escaped}( |$)`
}

/** Turns a spawn failure into something the user can act on. */
export function describeSpawnError(error: unknown, cloudflared: string): string {
  const e = error as NodeJS.ErrnoException | undefined
  // errno -86 is macOS EBADARCH: an x86_64 cloudflared on Apple Silicon. Node reports it as "Unknown system error".
  if (e?.errno === -86 || e?.code === 'EBADARCH') {
    return `${cloudflared} is built for the wrong CPU architecture. Reinstall it (brew reinstall cloudflared).`
  }
  if (e?.code === 'ENOENT')
    return `${cloudflared} was not found. Install it (brew install cloudflared) or set its path.`
  if (e?.code === 'EACCES') return `${cloudflared} is not executable. Check its permissions.`
  return `Could not run ${cloudflared}: ${e?.message ?? String(error)}`
}

/** Spawns a detached `cloudflared access tcp` process that outlives VS Code. */
export function startTunnel(tunnel: Tunnel, cloudflared: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cloudflared, tunnelArgs(tunnel), {
      detached: true,
      stdio: 'ignore',
    })
    proc.once('error', reject)
    proc.once('spawn', () => {
      proc.unref()
      resolve()
    })
  })
}

/** Stops the `cloudflared access tcp` process for this tunnel, including one started by the `tunnels` CLI. */
export function stopTunnel(tunnel: Tunnel): Promise<void> {
  return new Promise((resolve) => {
    // pkill exits non-zero when no process matched, which is fine
    execFile('pkill', ['-f', tunnelPattern(tunnel)], () => resolve())
  })
}
