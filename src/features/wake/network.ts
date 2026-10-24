import { createSocket } from 'dgram'
import { networkInterfaces, type NetworkInterfaceInfo } from 'os'

const WOL_PORT = 9
const LIMITED_BROADCAST = '255.255.255.255'

/** 6 × 0xFF followed by the MAC repeated 16 times. */
export function magicPacket(mac: string): Buffer {
  const bytes = Buffer.from(mac.replace(/:/g, ''), 'hex')
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array<Buffer>(16).fill(bytes)])
}

function toInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) | Number(octet)) >>> 0, 0)
}

function toIp(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff).join('.')
}

interface Subnet {
  readonly network: number
  readonly mask: number
  readonly broadcast: string
}

/** The IPv4 subnets this machine is attached to, ignoring loopback. */
export function localSubnets(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): Subnet[] {
  const subnets: Subnet[] = []
  for (const infos of Object.values(interfaces)) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue
      const mask = toInt(info.netmask)
      const network = (toInt(info.address) & mask) >>> 0
      subnets.push({ network, mask, broadcast: toIp((network | ~mask) >>> 0) })
    }
  }
  return subnets
}

/**
 * True when one of our interfaces is on the same network as the machine, so a broadcast
 * from here reaches it. Judged by `address` when set, otherwise by `broadcast`.
 */
export function isOnSameNetwork(
  target: { address?: string; broadcast?: string },
  subnets: readonly Subnet[] = localSubnets(),
): boolean {
  if (target.address) {
    const ip = toInt(target.address)
    return subnets.some((s) => (ip & s.mask) >>> 0 === s.network)
  }
  if (target.broadcast) return subnets.some((s) => s.broadcast === target.broadcast)
  return false
}

/** Where to send the packet from here: the machine's subnet broadcast plus the limited broadcast. */
export function localTargets(target: { address?: string; broadcast?: string }, subnets = localSubnets()): string[] {
  const targets = new Set<string>()
  if (target.broadcast) targets.add(target.broadcast)
  if (target.address) {
    const ip = toInt(target.address)
    const subnet = subnets.find((s) => (ip & s.mask) >>> 0 === s.network)
    if (subnet) targets.add(subnet.broadcast)
  }
  targets.add(LIMITED_BROADCAST)
  return [...targets]
}

/** Broadcasts the magic packet from this machine to each target address. */
export function sendMagicPacket(mac: string, targets: readonly string[]): Promise<void> {
  const packet = magicPacket(mac)
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4')
    socket.once('error', (error) => {
      socket.close()
      reject(error)
    })
    socket.bind(() => {
      socket.setBroadcast(true)
      let remaining = targets.length
      let failure: Error | undefined
      for (const address of targets) {
        socket.send(packet, WOL_PORT, address, (error) => {
          // one unreachable target (e.g. no route for 255.255.255.255) shouldn't sink the others
          if (error) failure = error
          if (--remaining > 0) return
          socket.close()
          if (failure && targets.length === 1) reject(failure)
          else resolve()
        })
      }
    })
  })
}

/**
 * The script the relay runs to send the packet. Python 3 is the most widely available way
 * to send a UDP broadcast on a NAS or Linux box without installing a Wake-on-LAN tool.
 */
export function relayScript(): string {
  return [
    'import socket, sys',
    'mac = bytes.fromhex(sys.argv[1].replace(":", ""))',
    'packet = b"\\xff" * 6 + mac * 16',
    's = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)',
    's.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)',
    'for address in sys.argv[2:]:',
    `    s.sendto(packet, (address, ${WOL_PORT}))`,
    '',
  ].join('\n')
}

/** Targets for the relay: it is on the machine's network, so the configured broadcast plus the limited broadcast. */
export function relayTargets(target: { broadcast?: string }): string[] {
  return target.broadcast ? [target.broadcast, LIMITED_BROADCAST] : [LIMITED_BROADCAST]
}
