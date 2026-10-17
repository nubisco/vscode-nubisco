/** A tunnel as stored in the `nubisco.tunnels.definitions` setting. */
export interface TunnelDefinition {
  host: string
  port: number
  label?: string
  instructions?: string[]
}

export interface Tunnel {
  /** Stable identity: the local port, which can only be bound by one tunnel at a time. */
  readonly id: string
  readonly host: string
  readonly port: number
  readonly label: string
  readonly instructions: readonly string[]
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
  return definition
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
    const { host, port, label, instructions } = entry as Record<string, unknown>

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

    const name = typeof label === 'string' && label.trim() ? label.trim() : normalizeHost(host)
    const steps = Array.isArray(instructions) ? instructions.filter((s): s is string => typeof s === 'string') : []
    tunnels.push({ id: String(port), host: normalizeHost(host), port, label: name, instructions: steps })
  })

  return { tunnels, problems }
}
