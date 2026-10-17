import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

vi.mock('child_process', () => ({ execFile: vi.fn(), spawn: vi.fn() }))
vi.mock('fs', () => ({ existsSync: vi.fn() }))

import { execFile, spawn } from 'child_process'
import { existsSync } from 'fs'
import {
  describeSpawnError,
  isRunning,
  resolveCloudflared,
  startTunnel,
  stopTunnel,
  tunnelPattern,
} from '../src/features/tunnels/manager'
import type { Tunnel } from '../src/features/tunnels/config'

const mockExecFile = vi.mocked(execFile)
const mockSpawn = vi.mocked(spawn)
const mockExists = vi.mocked(existsSync)

const tunnel: Tunnel = { id: '9999', host: 'test.example.io', port: 9999, label: 'Test', instructions: [] }

function execFileResult(error: Error | null) {
  mockExecFile.mockImplementation(((_file: string, _args: string[], cb: (e: Error | null) => void) => {
    cb(error)
  }) as never)
}

beforeEach(() => vi.clearAllMocks())

describe('resolveCloudflared', () => {
  it('prefers the configured path', () => {
    expect(resolveCloudflared(' /custom/cloudflared ')).toBe('/custom/cloudflared')
  })

  it('finds Homebrew installs, else falls back to PATH', () => {
    mockExists.mockImplementation((p) => p === '/usr/local/bin/cloudflared')
    expect(resolveCloudflared('')).toBe('/usr/local/bin/cloudflared')
    mockExists.mockReturnValue(false)
    expect(resolveCloudflared('')).toBe('cloudflared')
  })
})

describe('isRunning', () => {
  it('is true when lsof finds a listener', async () => {
    execFileResult(null)
    await expect(isRunning(9999)).resolves.toBe(true)
    expect(mockExecFile).toHaveBeenCalledWith('lsof', ['-nP', '-iTCP:9999', '-sTCP:LISTEN'], expect.any(Function))
  })

  it('is false when lsof exits non-zero', async () => {
    execFileResult(new Error('exit 1'))
    await expect(isRunning(9999)).resolves.toBe(false)
  })
})

describe('startTunnel', () => {
  it('spawns a detached cloudflared and unrefs it', async () => {
    const proc = Object.assign(new EventEmitter(), { unref: vi.fn() })
    mockSpawn.mockReturnValue(proc as never)
    const started = startTunnel(tunnel, '/bin/cloudflared')
    proc.emit('spawn')
    await started
    expect(mockSpawn).toHaveBeenCalledWith(
      '/bin/cloudflared',
      ['access', 'tcp', '--hostname', 'test.example.io', '--url', 'localhost:9999'],
      { detached: true, stdio: 'ignore' },
    )
    expect(proc.unref).toHaveBeenCalledOnce()
  })

  it('rejects when the binary cannot be spawned', async () => {
    const proc = Object.assign(new EventEmitter(), { unref: vi.fn() })
    mockSpawn.mockReturnValue(proc as never)
    const started = startTunnel(tunnel, 'missing')
    proc.emit('error', new Error('ENOENT'))
    await expect(started).rejects.toThrow('ENOENT')
  })
})

describe('stopTunnel', () => {
  it('pkills the matching cloudflared process and ignores "no match"', async () => {
    execFileResult(new Error('exit 1'))
    await expect(stopTunnel(tunnel)).resolves.toBeUndefined()
    expect(mockExecFile).toHaveBeenCalledWith(
      'pkill',
      ['-f', 'access tcp --hostname test\\.example\\.io --url localhost:9999( |$)'],
      expect.any(Function),
    )
  })
})

describe('tunnelPattern', () => {
  const matches = (command: string) => new RegExp(tunnelPattern(tunnel)).test(command)

  it('matches this tunnel whether started by the extension or the CLI', () => {
    expect(matches('/opt/homebrew/bin/cloudflared access tcp --hostname test.example.io --url localhost:9999')).toBe(
      true,
    )
    expect(matches('cloudflared access tcp --hostname test.example.io --url localhost:9999 --loglevel info')).toBe(true)
  })

  it('leaves other tunnels alone', () => {
    expect(matches('cloudflared access tcp --hostname test.example.io --url localhost:99990')).toBe(false)
    expect(matches('cloudflared access tcp --hostname test.example.io --url localhost:2222')).toBe(false)
    expect(matches('cloudflared access tcp --hostname testXexampleXio --url localhost:9999')).toBe(false)
    expect(matches('cloudflared access tcp --hostname test.example.io.evil --url localhost:9999')).toBe(false)
  })
})

describe('describeSpawnError', () => {
  it('explains the common failures', () => {
    expect(describeSpawnError({ code: 'ENOENT' }, 'cloudflared')).toMatch(/not found/)
    expect(describeSpawnError({ errno: -86 }, 'cloudflared')).toMatch(/wrong CPU architecture/)
    expect(describeSpawnError({ code: 'EACCES' }, 'cloudflared')).toMatch(/not executable/)
    expect(describeSpawnError(new Error('boom'), 'cloudflared')).toBe('Could not run cloudflared: boom')
  })
})
