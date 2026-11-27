/**
 * How a tunnel reaches its machine.
 * - `tcp`: a `cloudflared access tcp` forward to a local port.
 * - `warp`: the machine's own LAN address, routed through Cloudflare WARP and a private network
 *   route on the tunnel. Needed when the client must see the real host over TCP and UDP, as macOS
 *   Screen Sharing does for dynamic resolution and High Performance mode.
 */
export type Mode = 'tcp' | 'warp'

/** The machine as reached over WARP, as stored in a definition's `warp` field. */
export interface WarpTarget {
  /** LAN IPv4 address, routed as a /32 on the Cloudflare tunnel. */
  readonly address: string
  /** Port checked to tell whether the machine is reachable. */
  readonly port: number
  /** URL scheme opened once it is reachable, e.g. `vnc` opens `vnc://<address>`. Optional. */
  readonly scheme?: string
}

/** A tunnel as stored in the `nubisco.tunnels.definitions` setting. */
export interface TunnelDefinition {
  host: string
  port: number
  label?: string
  instructions?: string[]
  warp?: { address: string; port: number; scheme?: string }
  mode?: Mode
}

export interface Tunnel {
  /** Stable identity: the local port, which can only be bound by one tunnel at a time. */
  readonly id: string
  readonly host: string
  readonly port: number
  readonly label: string
  readonly instructions: readonly string[]
  readonly warp: WarpTarget | undefined
  /** The mode the definition asked for, if any. `effectiveMode` resolves the default. */
  readonly mode: Mode | undefined
}

export interface ParseResult {
  readonly tunnels: readonly Tunnel[]
  /** Human-readable reasons why entries were skipped. */
  readonly problems: readonly string[]
}

/** Accepts `ssh.example.com` as well as pasted URLs like `https://ssh.example.com/`. */
export function normalizeHost(input: string): string {
  return input
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .toLowerCase()
}

const HOST_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/

/** Returns an error message, or undefined when valid. */
export function validateHost(input: string): string | undefined {
  const host = normalizeHost(input)
  if (!host) return 'Enter the Cloudflare Access hostname, e.g. ssh.example.com'
  if (!HOST_PATTERN.test(host)) return `"${host}" is not a valid hostname`
  return undefined
}

/** Returns an error message, or undefined when valid. `takenPorts` are ports used by other tunnels. */
export function validatePort(input: string, takenPorts: readonly number[] = []): string | undefined {
  const value = input.trim()
  if (!/^\d+$/.test(value)) return 'Enter a port number between 1 and 65535'
  const port = Number(value)
  if (port < 1 || port > 65535) return 'Enter a port number between 1 and 65535'
  if (takenPorts.includes(port)) return `Port ${port} is already used by another tunnel`
  return undefined
}

/** Splits a "cmd one ; cmd two" input into separate connection hints. */
export function parseInstructions(input: string): string[] {
  return input
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function toDefinition(tunnel: Tunnel): TunnelDefinition {
  const definition: TunnelDefinition = { host: tunnel.host, port: tunnel.port }
  if (tunnel.label !== tunnel.host) definition.label = tunnel.label
  if (tunnel.instructions.length > 0) definition.instructions = [...tunnel.instructions]
  if (tunnel.warp) definition.warp = { ...tunnel.warp }
  if (tunnel.mode) definition.mode = tunnel.mode
  return definition
}

const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

export function isMode(value: unknown): value is Mode {
  return value === 'tcp' || value === 'warp'
}

/** Reads a definition's `warp` field. Returns an error message for a malformed one. */
export function parseWarp(raw: unknown): WarpTarget | string | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'object' || raw === null) return 'has an invalid "warp"'
  const { address, port, scheme } = raw as Record<string, unknown>
  if (typeof address !== 'string' || !IPV4_PATTERN.test(address.trim())) return 'has an invalid "warp.address"'
  if (typeof port !== 'number' || validatePort(String(port))) return 'has an invalid "warp.port"'
  if (scheme !== undefined && (typeof scheme !== 'string' || !/^[a-z][a-z0-9+.-]*$/i.test(scheme))) {
    return 'has an invalid "warp.scheme"'
  }
  return { address: address.trim(), port, ...(scheme ? { scheme: scheme as string } : {}) }
}

/** The mode a tunnel runs in: its own, else the default. Without a WARP target it is always `tcp`. */
export function effectiveMode(tunnel: Tunnel, defaultMode: Mode): Mode {
  if (!tunnel.warp) return 'tcp'
  return tunnel.mode ?? defaultMode
}

/** The URL opened once a WARP target answers, e.g. `vnc://192.168.1.20`. */
export function warpUrl(target: WarpTarget): string | undefined {
  return target.scheme ? `${target.scheme}://${target.address}` : undefined
}

/** Connection hints for the tunnel's mode: the configured ones over TCP, the WARP URL over WARP. */
export function instructionsFor(tunnel: Tunnel, mode: Mode): readonly string[] {
  if (mode === 'warp' && tunnel.warp) {
    const url = warpUrl(tunnel.warp)
    return url ? [`open ${url}`] : [`${tunnel.warp.address}:${tunnel.warp.port}`]
  }
  return tunnel.instructions
}

/** Validates the raw setting value. Invalid or duplicate entries are skipped and reported. */
export function parseTunnels(raw: unknown): ParseResult {
  if (raw === undefined || raw === null) return { tunnels: [], problems: [] }
  if (!Array.isArray(raw)) return { tunnels: [], problems: ['the setting must be a list of tunnels'] }

  const tunnels: Tunnel[] = []
  const problems: string[] = []

  raw.forEach((entry, index) => {
    const where = `entry ${index + 1}`
    if (typeof entry !== 'object' || entry === null) {
      problems.push(`${where} is not an object`)
      return
    }
    const { host, port, label, instructions, warp: rawWarp, mode } = entry as Record<string, unknown>

    if (typeof host !== 'string' || validateHost(host)) {
      problems.push(`${where} has an invalid "host"`)
      return
    }
    if (typeof port !== 'number' || validatePort(String(port))) {
      problems.push(`${where} has an invalid "port"`)
      return
    }
    if (tunnels.some((t) => t.port === port)) {
      problems.push(`${where} reuses port ${port}`)
      return
    }

    const warp = parseWarp(rawWarp)
    if (typeof warp === 'string') {
      problems.push(`${where} ${warp}`)
      return
    }
    if (mode !== undefined && !isMode(mode)) {
      problems.push(`${where} has an invalid "mode" (use "tcp" or "warp")`)
      return
    }
    if (mode === 'warp' && !warp) {
      problems.push(`${where} uses "mode": "warp" without a "warp" address`)
      return
    }

    const name = typeof label === 'string' && label.trim() ? label.trim() : normalizeHost(host)
    const steps = Array.isArray(instructions) ? instructions.filter((s): s is string => typeof s === 'string') : []
    tunnels.push({ id: String(port), host: normalizeHost(host), port, label: name, instructions: steps, warp, mode })
  })

  return { tunnels, problems }
}
