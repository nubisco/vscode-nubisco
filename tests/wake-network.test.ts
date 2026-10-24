import { describe, it, expect } from 'vitest'
import type { NetworkInterfaceInfo } from 'os'
import { isOnSameNetwork, localSubnets, localTargets, magicPacket, relayTargets } from '../src/features/wake/network'

function iface(address: string, netmask: string, internal = false): NetworkInterfaceInfo {
  return { address, netmask, family: 'IPv4', mac: '00:00:00:00:00:00', internal, cidr: null }
}

const subnets = localSubnets({
  lo0: [iface('127.0.0.1', '255.0.0.0', true)],
  en0: [iface('192.168.1.50', '255.255.255.0')],
  utun4: [iface('10.8.0.2', '255.255.0.0')],
})

describe('magicPacket', () => {
  it('is six 0xff bytes then the MAC sixteen times', () => {
    const packet = magicPacket('aa:bb:cc:dd:ee:ff')
    expect(packet).toHaveLength(102)
    expect(packet.subarray(0, 6)).toEqual(Buffer.alloc(6, 0xff))
    for (let i = 0; i < 16; i++) {
      expect(packet.subarray(6 + i * 6, 12 + i * 6).toString('hex')).toBe('aabbccddeeff')
    }
  })
})

describe('localSubnets', () => {
  it('computes each interface broadcast and skips loopback', () => {
    expect(subnets.map((s) => s.broadcast)).toEqual(['192.168.1.255', '10.8.255.255'])
  })
})

describe('isOnSameNetwork', () => {
  it('matches by address against interface subnets', () => {
    expect(isOnSameNetwork({ address: '192.168.1.30' }, subnets)).toBe(true)
    expect(isOnSameNetwork({ address: '10.8.40.1' }, subnets)).toBe(true)
    expect(isOnSameNetwork({ address: '192.168.2.30' }, subnets)).toBe(false)
  })

  it('falls back to the broadcast address', () => {
    expect(isOnSameNetwork({ broadcast: '192.168.1.255' }, subnets)).toBe(true)
    expect(isOnSameNetwork({ broadcast: '192.168.2.255' }, subnets)).toBe(false)
  })

  it('cannot tell without either', () => {
    expect(isOnSameNetwork({}, subnets)).toBe(false)
  })
})

describe('targets', () => {
  it('sends locally to the subnet broadcast and the limited broadcast', () => {
    expect(localTargets({ address: '192.168.1.30' }, subnets)).toEqual(['192.168.1.255', '255.255.255.255'])
    expect(localTargets({}, subnets)).toEqual(['255.255.255.255'])
  })

  it('has the relay use the configured broadcast when there is one', () => {
    expect(relayTargets({ broadcast: '192.168.1.255' })).toEqual(['192.168.1.255', '255.255.255.255'])
    expect(relayTargets({})).toEqual(['255.255.255.255'])
  })
})
