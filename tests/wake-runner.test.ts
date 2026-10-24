import { describe, it, expect, vi } from 'vitest'
import type { Machine } from '../src/features/wake/config'
import {
  afterWakeArgs,
  chooseRoute,
  controlPath,
  wakeMachine,
  WakeError,
  type WakeDeps,
} from '../src/features/wake/runner'

const machine: Machine = {
  id: 'aa:bb:cc:dd:ee:ff',
  label: 'Desk',
  mac: 'aa:bb:cc:dd:ee:ff',
  address: '192.168.1.20',
  broadcast: undefined,
  relay: 'gateway',
  ssh: 'me@192.168.1.20',
  afterWake: 'caffeinate -u -t 5',
}

function deps(overrides: Partial<WakeDeps> = {}): WakeDeps & { calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    sameNetwork: () => true,
    sendLocal: vi.fn(async () => {}),
    run: vi.fn(async (file: string, args: readonly string[]) => {
      calls.push([file, ...args])
      return 'ok\n'
    }),
    delay: async () => {},
    ...overrides,
  }
}

describe('chooseRoute', () => {
  it('sends locally on the same network', () => {
    expect(chooseRoute(machine, true)).toBe('local')
  })

  it('uses the relay elsewhere', () => {
    expect(chooseRoute(machine, false)).toBe('relay')
  })

  it('refuses when elsewhere with no relay', () => {
    expect(() => chooseRoute({ ...machine, relay: undefined }, false)).toThrow(WakeError)
  })

  it('tries locally when nothing says where the machine is', () => {
    expect(chooseRoute({ ...machine, address: undefined, relay: undefined }, false)).toBe('local')
  })
})

describe('afterWakeArgs', () => {
  it('goes straight to the machine locally', () => {
    expect(afterWakeArgs(machine, 'local')).toEqual([
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=6',
      'me@192.168.1.20',
      'caffeinate -u -t 5',
    ])
  })

  it('proxies through the shared relay connection elsewhere', () => {
    expect(afterWakeArgs(machine, 'relay')).toContain(`ProxyCommand=ssh -S ${controlPath('gateway')} -W %h:%p gateway`)
  })
})

describe('wakeMachine', () => {
  it('sends locally and confirms with afterWake', async () => {
    const d = deps()
    const result = await wakeMachine(machine, () => {}, d)
    expect(result).toEqual({ route: 'local', confirmed: true, output: 'ok' })
    expect(d.sendLocal).toHaveBeenCalledOnce()
    expect(d.calls).toHaveLength(1)
    expect(d.calls[0]!.at(-1)).toBe('caffeinate -u -t 5')
  })

  it('only sends the packet when there is nothing to confirm with', async () => {
    const d = deps()
    const result = await wakeMachine({ ...machine, ssh: undefined }, () => {}, d)
    expect(result.confirmed).toBe(false)
    expect(d.calls).toEqual([])
  })

  it('retries with a fresh packet until the machine answers', async () => {
    let tries = 0
    const d = deps({
      run: vi.fn(async () => {
        if (++tries < 3) throw new WakeError('timed out')
        return 'up'
      }),
    })
    const result = await wakeMachine(machine, () => {}, d)
    expect(result.output).toBe('up')
    expect(d.sendLocal).toHaveBeenCalledTimes(3)
  })

  it('gives up after three attempts', async () => {
    const d = deps({ run: vi.fn(async () => Promise.reject(new WakeError('timed out'))) })
    await expect(wakeMachine(machine, () => {}, d)).rejects.toThrow(/did not answer.*3 attempts \(timed out\)/)
  })

  it('opens one relay connection and sends through it', async () => {
    const calls: string[][] = []
    const d = deps({
      sameNetwork: () => false,
      run: vi.fn(async (file: string, args: readonly string[]) => {
        calls.push([file, ...args])
        if (args.includes('check')) throw new WakeError('no master')
        return ''
      }),
    })
    await wakeMachine(machine, () => {}, d)
    const sock = controlPath('gateway')
    expect(calls[0]).toEqual(['ssh', '-S', sock, '-O', 'check', 'gateway'])
    expect(calls[1]).toEqual(['ssh', '-fNM', '-S', sock, '-o', 'ControlPersist=60', 'gateway'])
    expect(calls[2]).toEqual(['ssh', '-S', sock, 'gateway', 'python3', '-', 'aa:bb:cc:dd:ee:ff', '255.255.255.255'])
    expect(calls[3]!.at(-2)).toBe('me@192.168.1.20')
    expect(d.sendLocal).not.toHaveBeenCalled()
  })

  it('reuses a live relay connection', async () => {
    const d = deps({ sameNetwork: () => false })
    await wakeMachine(machine, () => {}, d)
    expect(d.calls.some((c) => c.includes('-fNM'))).toBe(false)
  })
})
