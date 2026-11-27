import { execFile } from 'child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { Socket } from 'net'
import { homedir } from 'os'
import { dirname, join } from 'path'
import type { WarpTarget } from './config'

// The WARP app links warp-cli into /usr/local/bin. VS Code launched from the Dock lacks the
// shell PATH, so look there and inside the app bundle rather than relying on PATH.
const WARP_CLI_CANDIDATES = [
  '/usr/local/bin/warp-cli',
  '/opt/homebrew/bin/warp-cli',
  '/Applications/Cloudflare WARP.app/Contents/Resources/warp-cli',
]

export const WARP_INSTALL_HINT = 'Install the Cloudflare WARP client (brew install --cask cloudflare-warp).'
export const WARP_ENROLL_HINT =
  'Enroll it in your Zero Trust team: WARP menu → Preferences → Account → Login to Cloudflare Zero Trust.'
export const NOT_TEAM_DETAIL = 'registered as a personal (Free) 1.1.1.1 client, not to a Zero Trust team'

export function resolveWarpCli(exists: (path: string) => boolean = existsSync): string | undefined {
  return WARP_CLI_CANDIDATES.find((p) => exists(p))
}

export type WarpState = 'connected' | 'connecting' | 'disconnected' | 'unregistered' | 'missing' | 'unknown'

export interface WarpStatus {
  readonly state: WarpState
  /** What warp-cli said, for messages. */
  readonly detail: string
}

/** Reads `warp-cli status`, e.g. "Status update: Connected" or "Status update: Disconnected\nReason: …". */
export function parseWarpStatus(output: string): WarpStatus {
  const line = output.match(/Status update:\s*(.+)/i)?.[1]?.trim() ?? output.trim().split('\n')[0] ?? ''
  const value = line.toLowerCase()
  if (/registration missing|not registered|no registration/.test(output.toLowerCase())) {
    return { state: 'unregistered', detail: line }
  }
  if (value.startsWith('connected')) return { state: 'connected', detail: line }
  if (value.startsWith('connecting')) return { state: 'connecting', detail: line }
  if (value.startsWith('disconnected')) return { state: 'disconnected', detail: line }
  return { state: 'unknown', detail: line }
}

/**
 * Reads `warp-cli registration show`. A fresh install registers itself as a personal
 * ("Account type: Free") client, which connects but never sees private routes, so only a
 * Team registration counts as enrolled.
 */
export function isTeamRegistration(output: string): boolean | undefined {
  const type = output.match(/Account type:\s*(\S+)/i)?.[1]?.toLowerCase()
  return type === undefined ? undefined : type === 'team'
}

function warpCli(cli: string, ...command: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    // --accept-tos lets warp-cli run non-interactively the first time it is used
    execFile(cli, ['--accept-tos', ...command], { timeout: 10_000 }, (error, stdout, stderr) =>
      resolve({ ok: !error, output: `${stdout}${stderr}` }),
    )
  })
}

export async function warpStatus(cli: string | undefined): Promise<WarpStatus> {
  if (!cli) return { state: 'missing', detail: 'warp-cli not found' }
  const [status, registration] = await Promise.all([warpCli(cli, 'status'), warpCli(cli, 'registration', 'show')])
  const parsed = parseWarpStatus(status.output)
  if (parsed.state !== 'unregistered' && isTeamRegistration(registration.output) === false) {
    return { state: 'unregistered', detail: NOT_TEAM_DETAIL }
  }
  return parsed
}

/** True when a TCP connection to host:port opens within the timeout. */
export function isReachable(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket()
    const done = (result: boolean) => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
    socket.connect(port, host)
  })
}

export async function waitFor(check: () => Promise<boolean>, timeoutMs: number, intervalMs = 500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await check()) return true
    if (Date.now() >= deadline) return false
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

// ─── who connected WARP ─────────────────────────────────────────────────────

/**
 * Present while WARP is up because one of our tools connected it. The `tunnels` CLI uses the
 * same file, so either can undo what the other did, and neither turns off a WARP connection
 * the user made by hand.
 */
export function ownerMarkerPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(base, 'nubisco', 'warp-connected-by')
}

// ─── connect / disconnect ───────────────────────────────────────────────────

export type WarpStartResult =
  { readonly ok: true; readonly via: 'direct' | 'warp' } | { readonly ok: false; readonly message: string }

export interface WarpDeps {
  readonly reachable: (host: string, port: number) => Promise<boolean>
  readonly status: () => Promise<WarpStatus>
  readonly connect: () => Promise<boolean>
  readonly disconnect: () => Promise<boolean>
  readonly owned: () => boolean
  readonly markOwner: () => void
  readonly clearOwner: () => void
  readonly timeoutMs: number
}

export function warpDeps(cli: string | undefined, marker = ownerMarkerPath(), timeoutMs = 15_000): WarpDeps {
  return {
    reachable: (host, port) => isReachable(host, port),
    status: () => warpStatus(cli),
    connect: async () => (cli ? (await warpCli(cli, 'connect')).ok : false),
    disconnect: async () => (cli ? (await warpCli(cli, 'disconnect')).ok : false),
    owned: () => existsSync(marker),
    markOwner: () => {
      mkdirSync(dirname(marker), { recursive: true })
      writeFileSync(marker, `vscode ${new Date().toISOString()}\n`)
    },
    clearOwner: () => rmSync(marker, { force: true }),
    timeoutMs,
  }
}

/**
 * Makes a WARP target reachable. Never throws.
 * 1. Already reachable (on the machine's network, or WARP already up): nothing to do.
 * 2. Otherwise connect WARP if needed, remembering that we did, then wait for the machine.
 */
export async function startWarp(target: WarpTarget, deps: WarpDeps): Promise<WarpStartResult> {
  const hostPort = `${target.address}:${target.port}`
  const status = await deps.status()
  if (await deps.reachable(target.address, target.port)) {
    return { ok: true, via: status.state === 'connected' ? 'warp' : 'direct' }
  }

  switch (status.state) {
    case 'missing':
      return { ok: false, message: `${hostPort} is not reachable and WARP is not installed. ${WARP_INSTALL_HINT}` }
    case 'unregistered':
      return { ok: false, message: `WARP is ${status.detail}. ${WARP_ENROLL_HINT}` }
    case 'connected':
      // a connection we did not make is the user's, so stopping must leave it alone
      deps.clearOwner()
      break
    default: {
      if (!(await deps.connect())) {
        return { ok: false, message: `warp-cli connect failed (${status.detail}). ${WARP_ENROLL_HINT}` }
      }
      deps.markOwner()
      const up = await waitFor(async () => (await deps.status()).state === 'connected', deps.timeoutMs)
      if (!up) return { ok: false, message: `WARP did not connect within ${deps.timeoutMs / 1000}s.` }
    }
  }

  if (!(await waitFor(() => deps.reachable(target.address, target.port), deps.timeoutMs))) {
    return {
      ok: false,
      message: `WARP is connected but ${hostPort} does not answer. Check that the tunnel routes ${target.address}, that Split Tunnels does not exclude it, and that the Gateway proxy allows TCP and UDP.`,
    }
  }
  return { ok: true, via: 'warp' }
}

/**
 * What stopping a WARP tunnel means. Only a WARP connection one of our tools made is ours to
 * end. When the machine answers anyway (on its network, or WARP turned on by hand), the useful
 * action is to open it, never a stop that cannot do anything.
 */
export function warpAction(reachable: boolean, ownedByUs: boolean): 'stop' | 'open' {
  return reachable && ownedByUs ? 'stop' : 'open'
}

/** Disconnects WARP only when one of our tools connected it. Returns true when it disconnected. */
export async function stopWarp(deps: Pick<WarpDeps, 'owned' | 'disconnect' | 'clearOwner'>): Promise<boolean> {
  if (!deps.owned()) return false
  const ok = await deps.disconnect()
  if (ok) deps.clearOwner()
  return ok
}
