import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  isTeamRegistration,
  ownerMarkerPath,
  parseWarpStatus,
  resolveWarpCli,
  startWarp,
  stopWarp,
  warpAction,
  warpDeps,
  type WarpDeps,
  type WarpStatus,
} from '../src/features/tunnels/warp'
import type { WarpTarget } from '../src/features/tunnels/config'

const target: WarpTarget = { address: '192.168.1.20', port: 5900, scheme: 'vnc' }
const status = (state: WarpStatus['state'], detail: string = state): WarpStatus => ({ state, detail })

function deps(overrides: Partial<WarpDeps> = {}): WarpDeps {
  return {
    reachable: vi.fn(async () => false),
    status: vi.fn(async () => status('disconnected')),
    connect: vi.fn(async () => true),
    disconnect: vi.fn(async () => true),
    owned: vi.fn(() => false),
    markOwner: vi.fn(),
    clearOwner: vi.fn(),
    timeoutMs: 20,
    ...overrides,
  }
}

describe('parseWarpStatus', () => {
  it('reads the states warp-cli prints', () => {
    expect(parseWarpStatus('Status update: Connected\nNetwork: healthy').state).toBe('connected')
    expect(parseWarpStatus('Status update: Disconnected\nReason: Manual Disconnection').state).toBe('disconnected')
    expect(parseWarpStatus('Status update: Connecting').state).toBe('connecting')
    expect(parseWarpStatus('Status update: Unable\nReason: Registration Missing').state).toBe('unregistered')
    expect(parseWarpStatus('???')).toEqual({ state: 'unknown', detail: '???' })
  })
})

describe('isTeamRegistration', () => {
  it('only counts a Team account as enrolled', () => {
    expect(isTeamRegistration('Account type: Free')).toBe(false)
    expect(isTeamRegistration('Account type: Team')).toBe(true)
    expect(isTeamRegistration('')).toBeUndefined()
  })
})

describe('resolveWarpCli', () => {
  it('finds the first installed candidate, or nothing', () => {
    expect(resolveWarpCli((p) => p.includes('Cloudflare WARP.app'))).toContain('Cloudflare WARP.app')
    expect(resolveWarpCli(() => false)).toBeUndefined()
  })
})

describe('ownerMarkerPath', () => {
  it('is shared with the tunnels CLI under the nubisco config folder', () => {
    expect(ownerMarkerPath({ XDG_CONFIG_HOME: '/cfg' })).toBe(join('/cfg', 'nubisco', 'warp-connected-by'))
  })
})

describe('startWarp', () => {
  it('does nothing to WARP when the machine already answers', async () => {
    const d = deps({ reachable: vi.fn(async () => true) })
    expect(await startWarp(target, d)).toEqual({ ok: true, via: 'direct' })
    expect(d.connect).not.toHaveBeenCalled()
  })

  it('connects WARP, records it, and waits for the machine', async () => {
    let up = false
    const d = deps({
      status: vi.fn(async () => status(up ? 'connected' : 'disconnected')),
      connect: vi.fn(async () => (up = true)),
      reachable: vi.fn(async () => up),
    })
    expect(await startWarp(target, d)).toEqual({ ok: true, via: 'warp' })
    expect(d.markOwner).toHaveBeenCalledOnce()
  })

  it('leaves a WARP connection the user made unclaimed', async () => {
    let calls = 0
    const d = deps({ status: vi.fn(async () => status('connected')), reachable: vi.fn(async () => ++calls > 1) })
    expect((await startWarp(target, d)).ok).toBe(true)
    expect(d.markOwner).not.toHaveBeenCalled()
    expect(d.clearOwner).toHaveBeenCalled()
  })

  it('explains a missing client, a personal registration and a failed connect', async () => {
    const missing = await startWarp(target, deps({ status: vi.fn(async () => status('missing')) }))
    expect(missing.ok === false && missing.message).toContain('brew install --cask cloudflare-warp')

    const personal = await startWarp(target, deps({ status: vi.fn(async () => status('unregistered', 'personal')) }))
    expect(personal.ok === false && personal.message).toContain('Zero Trust')

    const refused = await startWarp(target, deps({ connect: vi.fn(async () => false) }))
    expect(refused.ok === false && refused.message).toContain('warp-cli connect failed')
  })

  it('names the likely causes when WARP is up but the machine is silent', async () => {
    const result = await startWarp(target, deps({ status: vi.fn(async () => status('connected')) }))
    expect(result.ok === false && result.message).toContain('Split Tunnels')
  })
})

describe('stopWarp', () => {
  it('disconnects only a WARP connection we made', async () => {
    const ours = deps({ owned: vi.fn(() => true) })
    expect(await stopWarp(ours)).toBe(true)
    expect(ours.clearOwner).toHaveBeenCalledOnce()

    const theirs = deps()
    expect(await stopWarp(theirs)).toBe(false)
    expect(theirs.disconnect).not.toHaveBeenCalled()
  })

  it('keeps the marker when the disconnect fails', async () => {
    const d = deps({ owned: vi.fn(() => true), disconnect: vi.fn(async () => false) })
    expect(await stopWarp(d)).toBe(false)
    expect(d.clearOwner).not.toHaveBeenCalled()
  })
})

describe('warpDeps marker', () => {
  it('writes and clears the owner marker', () => {
    const marker = join(mkdtempSync(join(tmpdir(), 'warp-')), 'nubisco', 'warp-connected-by')
    const d = warpDeps(undefined, marker)
    expect(d.owned()).toBe(false)
    d.markOwner()
    expect(existsSync(marker)).toBe(true)
    expect(d.owned()).toBe(true)
    d.clearOwner()
    expect(d.owned()).toBe(false)
  })

  it('reports WARP as missing without warp-cli, and refuses to connect', async () => {
    const d = warpDeps(undefined)
    expect((await d.status()).state).toBe('missing')
    expect(await d.connect()).toBe(false)
  })
})

describe('warpAction', () => {
  it('stops only a WARP connection we made, and otherwise opens the machine', () => {
    expect(warpAction(true, true)).toBe('stop')
    expect(warpAction(true, false)).toBe('open')
    expect(warpAction(false, true)).toBe('open')
  })
})
