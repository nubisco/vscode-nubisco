export type TunnelState = 'running' | 'stopped' | 'starting' | 'stopping'

/** A start/stop the user requested that hasn't been observed on the port yet. */
export interface Pending {
  readonly target: 'running' | 'stopped'
  readonly until: number
}

export interface Resolution {
  readonly state: TunnelState
  /** True once the pending action is done (reached its target or timed out) and can be dropped. */
  readonly settled: boolean
  /** True when the pending action timed out without reaching its target. */
  readonly failed: boolean
}

export function resolveState(listening: boolean, pending: Pending | undefined, now: number): Resolution {
  const observed = listening ? 'running' : 'stopped'
  if (!pending) return { state: observed, settled: true, failed: false }
  if (observed === pending.target) return { state: observed, settled: true, failed: false }
  if (now >= pending.until) return { state: observed, settled: true, failed: true }
  return { state: pending.target === 'running' ? 'starting' : 'stopping', settled: false, failed: false }
}

export interface Presentation {
  readonly description: string
  readonly icon: string
  readonly color: string | undefined
  readonly contextValue: string
  readonly expandable: boolean
}

export function present(port: number, state: TunnelState): Presentation {
  switch (state) {
    case 'running':
      return {
        description: `localhost:${port}`,
        icon: 'circle-filled',
        color: 'testing.iconPassed',
        contextValue: 'tunnel.running',
        expandable: true,
      }
    case 'starting':
      return {
        description: 'starting…',
        icon: 'loading~spin',
        color: undefined,
        contextValue: 'tunnel.busy',
        expandable: false,
      }
    case 'stopping':
      return {
        description: 'stopping…',
        icon: 'loading~spin',
        color: undefined,
        contextValue: 'tunnel.busy',
        expandable: false,
      }
    case 'stopped':
      return {
        description: `:${port}`,
        icon: 'circle-outline',
        color: 'disabledForeground',
        contextValue: 'tunnel.stopped',
        expandable: false,
      }
  }
}
