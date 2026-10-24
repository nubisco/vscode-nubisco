import { execFile, type ExecFileOptions } from 'child_process'
import { createHash } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Machine } from './config'
import { isOnSameNetwork, localTargets, relayScript, relayTargets, sendMagicPacket } from './network'

const ATTEMPTS = 3
/** A magic packet often yields only a short dark wake (about 10s on a Mac), so `afterWake` must land inside it. */
const SETTLE_MS = 3_000
const MACHINE_CONNECT_TIMEOUT_S = 6
/** The first SSH to a relay behind Cloudflare Access may wait on a browser login. */
const RELAY_TIMEOUT_MS = 120_000

export type Route = 'local' | 'relay'

export interface WakeResult {
  readonly route: Route
  /** True when `afterWake` ran on the machine. False when there was nothing to confirm with. */
  readonly confirmed: boolean
  /** Output of `afterWake`, trimmed. */
  readonly output: string
}

export interface WakeDeps {
  readonly sameNetwork: (machine: Machine) => boolean
  readonly sendLocal: (mac: string, targets: readonly string[]) => Promise<void>
  readonly run: (file: string, args: readonly string[], input?: string, timeoutMs?: number) => Promise<string>
  readonly delay: (ms: number) => Promise<void>
}

export class WakeError extends Error {}

/** Picks how the packet gets to the machine's network. Throws when it can't from here. */
export function chooseRoute(machine: Machine, sameNetwork: boolean): Route {
  if (sameNetwork) return 'local'
  if (machine.relay) return 'relay'
  if (!machine.address && !machine.broadcast) return 'local'
  throw new WakeError(
    `${machine.label} is on another network and has no "relay" set, so a broadcast from here won't reach it.`,
  )
}

/** One shared SSH connection to the relay, so the Cloudflare Access handshake happens once per wake. */
export function controlPath(relay: string): string {
  const hash = createHash('sha1').update(relay).digest('hex').slice(0, 10)
  return join(tmpdir(), `nubisco-wake-${hash}.sock`)
}

export function relayCheckArgs(relay: string): string[] {
  return ['-S', controlPath(relay), '-O', 'check', relay]
}

export function relayMasterArgs(relay: string): string[] {
  return ['-fNM', '-S', controlPath(relay), '-o', 'ControlPersist=60', relay]
}

export function relaySendArgs(machine: Machine): string[] {
  return ['-S', controlPath(machine.relay!), machine.relay!, 'python3', '-', machine.mac, ...relayTargets(machine)]
}

export function afterWakeArgs(machine: Machine, route: Route): string[] {
  const args = ['-o', 'BatchMode=yes', '-o', `ConnectTimeout=${MACHINE_CONNECT_TIMEOUT_S}`]
  if (route === 'relay') args.push('-o', `ProxyCommand=ssh -S ${controlPath(machine.relay!)} -W %h:%p ${machine.relay}`)
  args.push(machine.ssh!, machine.afterWake!)
  return args
}

// VS Code launched from the Dock may not inherit the shell PATH, and SSH configs commonly
// use a ProxyCommand such as `cloudflared access ssh` installed by Homebrew.
const EXTRA_PATH = ['/opt/homebrew/bin', '/usr/local/bin']

function execRun(file: string, args: readonly string[], input?: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const PATH = [process.env.PATH, ...EXTRA_PATH].filter(Boolean).join(':')
    const options: ExecFileOptions = { timeout: timeoutMs, env: { ...process.env, PATH } }
    const child = execFile(file, [...args], options, (error, stdout, stderr) => {
      if (error) reject(new WakeError(String(stderr).trim() || error.message))
      else resolve(String(stdout))
    })
    if (input !== undefined) child.stdin?.end(input)
  })
}

export const defaultDeps: WakeDeps = {
  sameNetwork: (machine) => isOnSameNetwork(machine),
  sendLocal: sendMagicPacket,
  run: execRun,
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

/**
 * Sends the magic packet, directly or through the relay. When `ssh` and `afterWake` are set,
 * it then runs `afterWake` on the machine, retrying with a fresh packet until it answers.
 */
export async function wakeMachine(
  machine: Machine,
  progress: (message: string) => void,
  deps: WakeDeps = defaultDeps,
): Promise<WakeResult> {
  const route = chooseRoute(machine, deps.sameNetwork(machine))
  const confirm = Boolean(machine.ssh && machine.afterWake)
  if (route === 'relay' && process.platform === 'win32') {
    throw new WakeError('Waking through a relay uses SSH connection sharing, which needs macOS or Linux.')
  }

  if (route === 'relay') {
    progress(`connecting to ${machine.relay}`)
    const alive = await deps.run('ssh', relayCheckArgs(machine.relay!)).then(
      () => true,
      () => false,
    )
    if (!alive) await deps.run('ssh', relayMasterArgs(machine.relay!), undefined, RELAY_TIMEOUT_MS)
  }

  const send = () =>
    route === 'local'
      ? deps.sendLocal(machine.mac, localTargets(machine))
      : deps.run('ssh', relaySendArgs(machine), relayScript()).then(() => undefined)

  if (!confirm) {
    progress(route === 'local' ? 'sending magic packet' : `sending magic packet via ${machine.relay}`)
    await send()
    return { route, confirmed: false, output: '' }
  }

  let lastError: unknown
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    progress(`attempt ${attempt}/${ATTEMPTS}: sending magic packet`)
    await send()
    await deps.delay(SETTLE_MS)
    progress(`attempt ${attempt}/${ATTEMPTS}: waiting for ${machine.ssh}`)
    try {
      const output = await deps.run('ssh', afterWakeArgs(machine, route))
      return { route, confirmed: true, output: output.trim() }
    } catch (error) {
      lastError = error
    }
  }
  const reason = lastError instanceof Error ? ` (${lastError.message})` : ''
  throw new WakeError(`${machine.label} did not answer on ${machine.ssh} after ${ATTEMPTS} attempts${reason}.`)
}
