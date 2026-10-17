import { describe, it, expect } from 'vitest'
import { present, resolveState } from '../src/features/tunnels/state'

describe('resolveState', () => {
  it('reports the observed state when nothing is pending', () => {
    expect(resolveState(true, undefined, 0)).toEqual({ state: 'running', settled: true, failed: false })
    expect(resolveState(false, undefined, 0)).toEqual({ state: 'stopped', settled: true, failed: false })
  })

  it('shows a transition while the pending target is not yet reached', () => {
    expect(resolveState(false, { target: 'running', until: 10 }, 5).state).toBe('starting')
    expect(resolveState(true, { target: 'stopped', until: 10 }, 5).state).toBe('stopping')
  })

  it('settles when the target is reached', () => {
    expect(resolveState(true, { target: 'running', until: 10 }, 5)).toEqual({
      state: 'running',
      settled: true,
      failed: false,
    })
  })

  it('fails when the deadline passes', () => {
    expect(resolveState(false, { target: 'running', until: 10 }, 10)).toEqual({
      state: 'stopped',
      settled: true,
      failed: true,
    })
  })
})

describe('present', () => {
  it('makes running tunnels expandable and stoppable', () => {
    const view = present(3389, 'running')
    expect(view.description).toBe('localhost:3389')
    expect(view.contextValue).toBe('tunnel.running')
    expect(view.expandable).toBe(true)
  })

  it('makes stopped tunnels startable', () => {
    expect(present(3389, 'stopped').contextValue).toBe('tunnel.stopped')
  })

  it('disables actions while busy', () => {
    expect(present(1, 'starting').contextValue).toBe('tunnel.busy')
    expect(present(1, 'stopping').icon).toBe('loading~spin')
  })
})
