import { describe, it, expect } from 'vitest'
import {
  normalizeMac,
  parseMachines,
  toDefinition,
  validateMac,
  validateOptionalIPv4,
} from '../src/features/wake/config'

describe('normalizeMac', () => {
  it('accepts the common notations', () => {
    expect(normalizeMac('AA:BB:CC:DD:EE:FF')).toBe('aa:bb:cc:dd:ee:ff')
    expect(normalizeMac('aa-bb-cc-dd-ee-ff')).toBe('aa:bb:cc:dd:ee:ff')
    expect(normalizeMac('aabb.ccdd.eeff')).toBe('aa:bb:cc:dd:ee:ff')
    expect(normalizeMac(' aabbccddeeff ')).toBe('aa:bb:cc:dd:ee:ff')
  })

  it('pads single-digit octets as macOS arp prints them', () => {
    expect(normalizeMac('0a:1b:2c:3d:4:5e')).toBe('0a:1b:2c:3d:04:5e')
  })

  it('rejects malformed addresses', () => {
    expect(normalizeMac('aa:bb:cc:dd:ee')).toBeUndefined()
    expect(normalizeMac('aa:bb:cc:dd:ee:gg')).toBeUndefined()
    expect(normalizeMac('aa:bb:cc:dd:ee:fff')).toBeUndefined()
    expect(normalizeMac('')).toBeUndefined()
  })
})

describe('validators', () => {
  it('explains a bad MAC', () => {
    expect(validateMac('')).toMatch(/Enter/)
    expect(validateMac('nope')).toMatch(/not a valid/)
    expect(validateMac('aa:bb:cc:dd:ee:ff')).toBeUndefined()
  })

  it('allows an empty optional IPv4 but not a bad one', () => {
    expect(validateOptionalIPv4('')).toBeUndefined()
    expect(validateOptionalIPv4('192.168.1.20')).toBeUndefined()
    expect(validateOptionalIPv4('192.168.1.256')).toMatch(/not an IPv4/)
    expect(validateOptionalIPv4('host.local')).toMatch(/not an IPv4/)
  })
})

describe('parseMachines', () => {
  it('returns nothing for an unset setting', () => {
    expect(parseMachines(undefined)).toEqual({ machines: [], problems: [] })
  })

  it('rejects a non-list setting', () => {
    expect(parseMachines({}).problems).toHaveLength(1)
  })

  it('normalizes entries and defaults the label to the MAC', () => {
    const { machines, problems } = parseMachines([
      { mac: 'AA-BB-CC-DD-EE-FF', address: ' 192.168.1.20 ', relay: 'gateway', ssh: 'me@192.168.1.20', afterWake: '' },
    ])
    expect(problems).toEqual([])
    expect(machines).toEqual([
      {
        id: 'aa:bb:cc:dd:ee:ff',
        label: 'aa:bb:cc:dd:ee:ff',
        mac: 'aa:bb:cc:dd:ee:ff',
        address: '192.168.1.20',
        broadcast: undefined,
        relay: 'gateway',
        ssh: 'me@192.168.1.20',
        afterWake: undefined,
      },
    ])
  })

  it('skips and reports invalid or duplicate entries', () => {
    const { machines, problems } = parseMachines([
      { label: 'ok', mac: 'aa:bb:cc:dd:ee:ff' },
      { label: 'dup', mac: 'AABBCCDDEEFF' },
      { label: 'bad mac', mac: 'zz' },
      { label: 'bad address', mac: '11:22:33:44:55:66', address: 'nas.local' },
      { label: 'bad broadcast', mac: '11:22:33:44:55:77', broadcast: '300.0.0.1' },
      'nope',
    ])
    expect(machines.map((m) => m.label)).toEqual(['ok'])
    expect(problems).toEqual([
      'entry 2 reuses MAC aa:bb:cc:dd:ee:ff',
      'entry 3 has an invalid "mac"',
      'entry 4 has an invalid "address"',
      'entry 5 has an invalid "broadcast"',
      'entry 6 is not an object',
    ])
  })
})

describe('toDefinition', () => {
  it('round-trips and drops unset fields', () => {
    const definition = { label: 'Desk', mac: 'aa:bb:cc:dd:ee:ff', address: '10.0.0.5', ssh: 'me@10.0.0.5' }
    const [machine] = parseMachines([definition]).machines
    expect(toDefinition(machine!)).toEqual(definition)
  })
})
