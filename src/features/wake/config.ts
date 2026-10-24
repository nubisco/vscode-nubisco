/** A machine as stored in the `nubisco.wake.machines` setting. */
export interface MachineDefinition {
  label: string
  mac: string
  address?: string
  broadcast?: string
  relay?: string
  ssh?: string
  afterWake?: string
}

export interface Machine {
  /** Stable identity: the normalized MAC address. */
  readonly id: string
  readonly label: string
  /** Normalized as lowercase, colon separated: `aa:bb:cc:dd:ee:ff`. */
  readonly mac: string
  /** The machine's IPv4 address. Used to tell whether we are on its network. */
  readonly address: string | undefined
  /** Directed broadcast address of the machine's network, e.g. 192.168.1.255. */
  readonly broadcast: string | undefined
  /** SSH destination on the machine's network that sends the packet when we are elsewhere. */
  readonly relay: string | undefined
  /** SSH destination of the machine itself, used to run `afterWake`. */
  readonly ssh: string | undefined
  /** Command run on the machine over SSH once it answers, e.g. to turn a dark wake into a full wake. */
  readonly afterWake: string | undefined
}

export interface ParseResult {
  readonly machines: readonly Machine[]
  /** Human-readable reasons why entries were skipped. */
  readonly problems: readonly string[]
}

/** Accepts `aa:bb:cc:dd:ee:ff`, `AA-BB-CC-DD-EE-FF`, `aabb.ccdd.eeff` and single-digit octets like `a:b:c:d:e:f` (as macOS `arp` prints them). */
export function normalizeMac(input: string): string | undefined {
  const value = input.trim().toLowerCase()
  let octets: string[]
  if (/^[0-9a-f]{12}$/.test(value.replace(/\./g, '')) && !/[:-]/.test(value)) {
    octets = value.replace(/\./g, '').match(/../g) ?? []
  } else {
    octets = value.split(/[:-]/)
    if (octets.length !== 6 || octets.some((o) => !/^[0-9a-f]{1,2}$/.test(o))) return undefined
    octets = octets.map((o) => o.padStart(2, '0'))
  }
  return octets.length === 6 ? octets.join(':') : undefined
}

/** Returns an error message, or undefined when valid. */
export function validateMac(input: string): string | undefined {
  if (!input.trim()) return 'Enter the MAC address, e.g. aa:bb:cc:dd:ee:ff'
  return normalizeMac(input) ? undefined : `"${input.trim()}" is not a valid MAC address`
}

const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

export function isIPv4(input: string): boolean {
  return IPV4_PATTERN.test(input.trim())
}

/** Returns an error message, or undefined when valid. Empty is allowed: these fields are optional. */
export function validateOptionalIPv4(input: string): string | undefined {
  if (!input.trim()) return undefined
  return isIPv4(input) ? undefined : `"${input.trim()}" is not an IPv4 address`
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function toDefinition(machine: Machine): MachineDefinition {
  const definition: MachineDefinition = { label: machine.label, mac: machine.mac }
  if (machine.address) definition.address = machine.address
  if (machine.broadcast) definition.broadcast = machine.broadcast
  if (machine.relay) definition.relay = machine.relay
  if (machine.ssh) definition.ssh = machine.ssh
  if (machine.afterWake) definition.afterWake = machine.afterWake
  return definition
}

/** Validates the raw setting value. Invalid or duplicate entries are skipped and reported. */
export function parseMachines(raw: unknown): ParseResult {
  if (raw === undefined || raw === null) return { machines: [], problems: [] }
  if (!Array.isArray(raw)) return { machines: [], problems: ['the setting must be a list of machines'] }

  const machines: Machine[] = []
  const problems: string[] = []

  raw.forEach((entry, index) => {
    const where = `entry ${index + 1}`
    if (typeof entry !== 'object' || entry === null) {
      problems.push(`${where} is not an object`)
      return
    }
    const fields = entry as Record<string, unknown>

    const mac = typeof fields.mac === 'string' ? normalizeMac(fields.mac) : undefined
    if (!mac) {
      problems.push(`${where} has an invalid "mac"`)
      return
    }
    if (machines.some((m) => m.mac === mac)) {
      problems.push(`${where} reuses MAC ${mac}`)
      return
    }
    const address = optionalString(fields.address)
    if (address && !isIPv4(address)) {
      problems.push(`${where} has an invalid "address"`)
      return
    }
    const broadcast = optionalString(fields.broadcast)
    if (broadcast && !isIPv4(broadcast)) {
      problems.push(`${where} has an invalid "broadcast"`)
      return
    }

    machines.push({
      id: mac,
      label: optionalString(fields.label) ?? mac,
      mac,
      address,
      broadcast,
      relay: optionalString(fields.relay),
      ssh: optionalString(fields.ssh),
      afterWake: optionalString(fields.afterWake),
    })
  })

  return { machines, problems }
}
