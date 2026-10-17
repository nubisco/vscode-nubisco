import { describe, it, expect } from 'vitest'
import {
  normalizeHost,
  parseInstructions,
  parseTunnels,
  toDefinition,
  validateHost,
  validatePort,
} from '../src/features/tunnels/config'

describe('normalizeHost', () => {
  it('strips schemes, paths and case', () => {
    expect(normalizeHost('  https://SSH.Example.com/login?x=1 ')).toBe('ssh.example.com')
    expect(normalizeHost('ssh.example.com')).toBe('ssh.example.com')
  })
})

describe('validateHost', () => {
  it('accepts hostnames and pasted URLs', () => {
    expect(validateHost('rdp-pc.nubisco.io')).toBeUndefined()
    expect(validateHost('https://rdp-pc.nubisco.io/')).toBeUndefined()
  })

  it('rejects empty or malformed hosts', () => {
    expect(validateHost('  ')).toMatch(/Enter/)
    expect(validateHost('localhost')).toMatch(/not a valid/)
    expect(validateHost('bad_host.io')).toMatch(/not a valid/)
  })
})

describe('validatePort', () => {
  it('accepts ports in range', () => {
    expect(validatePort('3389')).toBeUndefined()
  })

  it('rejects non-numbers, out of range and taken ports', () => {
    expect(validatePort('abc')).toBeDefined()
    expect(validatePort('22.5')).toBeDefined()
    expect(validatePort('0')).toBeDefined()
    expect(validatePort('70000')).toBeDefined()
    expect(validatePort('2222', [2222])).toMatch(/already used/)
  })
})

describe('parseInstructions', () => {
  it('splits on ";" and drops blanks', () => {
    expect(parseInstructions(' ssh a ; ; open vnc://x ')).toEqual(['ssh a', 'open vnc://x'])
    expect(parseInstructions('')).toEqual([])
  })
})

describe('parseTunnels', () => {
  it('returns nothing when unset', () => {
    expect(parseTunnels(undefined)).toEqual({ tunnels: [], problems: [] })
  })

  it('reports a non-list value', () => {
    expect(parseTunnels('nope').problems).toHaveLength(1)
  })

  it('parses valid entries and defaults the label to the host', () => {
    const { tunnels, problems } = parseTunnels([
      { host: 'A.example.io', port: 2222, label: ' NAS ', instructions: ['ssh a', 42] },
      { host: 'b.example.io', port: 3389 },
    ])
    expect(problems).toEqual([])
    expect(tunnels).toEqual([
      { id: '2222', host: 'a.example.io', port: 2222, label: 'NAS', instructions: ['ssh a'] },
      { id: '3389', host: 'b.example.io', port: 3389, label: 'b.example.io', instructions: [] },
    ])
  })

  it('skips and reports invalid and duplicate entries', () => {
    const { tunnels, problems } = parseTunnels([
      { host: 'a.example.io', port: 2222 },
      { host: 'b.example.io', port: 2222 },
      { host: 'nope', port: 1 },
      { host: 'c.example.io', port: 99999 },
      null,
    ])
    expect(tunnels.map((t) => t.host)).toEqual(['a.example.io'])
    expect(problems).toEqual([
      'entry 2 reuses port 2222',
      'entry 3 has an invalid "host"',
      'entry 4 has an invalid "port"',
      'entry 5 is not an object',
    ])
  })
})

describe('toDefinition', () => {
  it('round-trips through parseTunnels without redundant fields', () => {
    const [tunnel] = parseTunnels([{ host: 'a.example.io', port: 1 }]).tunnels
    expect(toDefinition(tunnel!)).toEqual({ host: 'a.example.io', port: 1 })

    const [labelled] = parseTunnels([{ host: 'a.example.io', port: 1, label: 'A', instructions: ['x'] }]).tunnels
    expect(toDefinition(labelled!)).toEqual({ host: 'a.example.io', port: 1, label: 'A', instructions: ['x'] })
  })
})
