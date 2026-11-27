import * as vscode from 'vscode'
import {
  effectiveMode,
  instructionsFor,
  isMode,
  parseTunnels,
  toDefinition,
  warpUrl,
  type Mode,
  type Tunnel,
  type TunnelDefinition,
} from './config'
import { promptTunnel } from './form'
import { describeSpawnError, isRunning, resolveCloudflared, startTunnel, stopTunnel } from './manager'
import { present, resolveState, type Pending, type TunnelState, type WarpEndpoint } from './state'
import {
  isReachable,
  resolveWarpCli,
  startWarp,
  stopWarp,
  warpAction,
  warpDeps,
  warpStatus,
  type WarpStatus,
} from './warp'

const SECTION = 'nubisco.tunnels'
const START_TIMEOUT_MS = 15_000
const STOP_TIMEOUT_MS = 5_000
// connecting WARP and then waiting for the machine both get their own 15s in startWarp
const WARP_START_TIMEOUT_MS = 35_000

type Node = { kind: 'tunnel'; tunnel: Tunnel } | { kind: 'instruction'; tunnel: Tunnel; text: string }

function settings() {
  const config = vscode.workspace.getConfiguration(SECTION)
  const defaultMode = config.get<string>('defaultMode', 'tcp')
  return {
    ...parseTunnels(config.get('definitions')),
    cloudflared: resolveCloudflared(config.get<string>('cloudflaredPath', '')),
    pollInterval: Math.max(1000, config.get<number>('pollInterval', 3000)),
    defaultMode: (isMode(defaultMode) ? defaultMode : 'tcp') as Mode,
  }
}

function openSettings(): Thenable<unknown> {
  return vscode.commands.executeCommand('workbench.action.openSettings', SECTION)
}

class TunnelsController implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.changed.event

  private tunnels: readonly Tunnel[] = []
  private defaultMode: Mode = 'tcp'
  private warp: WarpStatus | undefined
  private readonly states = new Map<string, TunnelState>()
  private readonly pending = new Map<string, Pending>()
  private readonly statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  private timer: NodeJS.Timeout | undefined
  private refreshing = false
  private reportedProblems = ''

  constructor() {
    this.statusBar.command = 'nubisco.tunnels.pick'
    this.statusBar.name = 'Nubisco Tunnels'
    this.reload()
  }

  /** Re-reads settings and restarts polling. */
  reload(): void {
    const { tunnels, problems, pollInterval, defaultMode } = settings()
    this.tunnels = tunnels
    this.defaultMode = defaultMode
    this.reportProblems(problems)
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => {
      if (vscode.window.state.focused) void this.refresh()
    }, pollInterval)
    void this.refresh()
  }

  modeOf(tunnel: Tunnel): Mode {
    return effectiveMode(tunnel, this.defaultMode)
  }

  /**
   * A tcp tunnel is up when its local port listens. A warp tunnel is up when the machine
   * itself answers, which is what matters, rather than whether some process is running.
   */
  private observe(tunnel: Tunnel): Promise<boolean> {
    if (this.modeOf(tunnel) === 'warp' && tunnel.warp) return isReachable(tunnel.warp.address, tunnel.warp.port, 1000)
    return isRunning(tunnel.port)
  }

  async refresh(): Promise<void> {
    if (this.refreshing) return
    this.refreshing = true
    try {
      const tunnels = this.tunnels
      const anyWarp = tunnels.some((t) => this.modeOf(t) === 'warp')
      const [warp, observed] = await Promise.all([
        anyWarp ? warpStatus(resolveWarpCli()) : Promise.resolve(undefined),
        Promise.all(tunnels.map((t) => this.observe(t))),
      ])
      this.warp = warp
      const now = Date.now()
      this.states.clear()
      tunnels.forEach((tunnel, i) => {
        const pending = this.pending.get(tunnel.id)
        const { state, settled, failed } = resolveState(observed[i] ?? false, pending, now)
        this.states.set(tunnel.id, state)
        if (settled) this.pending.delete(tunnel.id)
        if (failed && pending?.target === 'running' && this.modeOf(tunnel) === 'tcp') {
          void vscode.window.showWarningMessage(
            `${tunnel.label} did not start listening on localhost:${tunnel.port}. Is cloudflared logged in to ${tunnel.host}?`,
          )
        }
      })
      this.render()
    } finally {
      this.refreshing = false
    }
  }

  stateOf(tunnel: Tunnel): TunnelState {
    return this.states.get(tunnel.id) ?? 'stopped'
  }

  private warpEndpoint(tunnel: Tunnel): WarpEndpoint | undefined {
    if (this.modeOf(tunnel) !== 'warp' || !tunnel.warp) return undefined
    return { address: tunnel.warp.address, viaWarp: this.warp?.state === 'connected' }
  }

  async start(tunnel: Tunnel): Promise<void> {
    if (this.modeOf(tunnel) === 'warp') return this.startWarp(tunnel)
    if (process.platform === 'win32') {
      void vscode.window.showErrorMessage('Nubisco tunnels need lsof and pkill, so they run on macOS and Linux only.')
      return
    }
    const { cloudflared } = settings()
    try {
      await startTunnel(tunnel, cloudflared)
    } catch (error) {
      const open = 'Open Settings'
      const choice = await vscode.window.showErrorMessage(describeSpawnError(error, cloudflared), open)
      if (choice === open) void openSettings()
      return
    }
    this.markPending(tunnel, { target: 'running', until: Date.now() + START_TIMEOUT_MS })
  }

  private async startWarp(tunnel: Tunnel): Promise<void> {
    const target = tunnel.warp
    if (!target) return
    this.markPending(tunnel, { target: 'running', until: Date.now() + WARP_START_TIMEOUT_MS })
    const result = await startWarp(target, warpDeps(resolveWarpCli()))
    if (!result.ok) {
      this.pending.delete(tunnel.id)
      void this.refresh()
      const fallback = 'Switch to TCP'
      const choice = await vscode.window.showErrorMessage(`${tunnel.label}: ${result.message}`, fallback)
      if (choice === fallback) await this.switchMode(tunnel)
      return
    }
    void this.refresh()
    const url = warpUrl(target)
    if (url) await vscode.env.openExternal(vscode.Uri.parse(url))
  }

  async stop(tunnel: Tunnel): Promise<void> {
    if (this.modeOf(tunnel) === 'warp') {
      const deps = warpDeps(resolveWarpCli())
      // Only a WARP connection we made is ours to end. When the machine answers anyway (on its
      // network, or WARP turned on by hand), a stop could do nothing, so open the machine instead.
      if (warpAction(this.stateOf(tunnel) === 'running', deps.owned()) === 'stop') {
        if (await stopWarp(deps)) this.markPending(tunnel, { target: 'stopped', until: Date.now() + STOP_TIMEOUT_MS })
        return
      }
      await this.open(tunnel)
      vscode.window.setStatusBarMessage(
        this.warp?.state === 'connected'
          ? `$(info) ${tunnel.label}: WARP was not connected by Nubisco, so it stays on. Opened the machine instead.`
          : `$(info) ${tunnel.label} answers on this network without WARP. Opened it.`,
        5000,
      )
      return
    }
    await stopTunnel(tunnel)
    this.markPending(tunnel, { target: 'stopped', until: Date.now() + STOP_TIMEOUT_MS })
  }

  /** Opens a WARP tunnel's URL, e.g. vnc://<address>. */
  async open(tunnel: Tunnel): Promise<void> {
    const url = tunnel.warp && warpUrl(tunnel.warp)
    if (url) await vscode.env.openExternal(vscode.Uri.parse(url))
  }

  async toggle(tunnel: Tunnel): Promise<void> {
    const state = this.stateOf(tunnel)
    if (state === 'running') await this.stop(tunnel)
    else if (state === 'stopped') await this.start(tunnel)
  }

  /** Flips a WARP-capable tunnel between its TCP forward and WARP, saved on the definition. */
  async switchMode(tunnel: Tunnel): Promise<void> {
    if (!tunnel.warp) return
    const mode: Mode = this.modeOf(tunnel) === 'tcp' ? 'warp' : 'tcp'
    // leave nothing running in the old mode
    if (this.modeOf(tunnel) === 'tcp' && this.stateOf(tunnel) !== 'stopped') await stopTunnel(tunnel)
    await this.save(this.tunnels.map((t) => (t.id === tunnel.id ? { ...toDefinition(t), mode } : toDefinition(t))))
    vscode.window.setStatusBarMessage(`$(arrow-swap) ${tunnel.label}: ${mode.toUpperCase()}`, 2000)
  }

  async pick(): Promise<void> {
    if (this.tunnels.length === 0) {
      await this.add()
      return
    }
    type Item = vscode.QuickPickItem & { tunnel: Tunnel }
    const items = this.tunnels.map((tunnel): Item => {
      const state = this.stateOf(tunnel)
      const { icon, description } = present(tunnel.port, state, this.warpEndpoint(tunnel))
      const action = state === 'running' ? 'stop' : state === 'stopped' ? 'start' : state
      const via = this.modeOf(tunnel) === 'warp' ? 'WARP' : tunnel.host
      return { label: `$(${icon}) ${tunnel.label}`, description, detail: `${action} · ${via}`, tunnel }
    })
    const choice = await vscode.window.showQuickPick(items, {
      title: 'Nubisco Tunnels',
      placeHolder: 'Toggle a tunnel',
    })
    if (choice) await this.toggle(choice.tunnel)
  }

  // ─── configuration ─────────────────────────────────────────────────────────

  async add(): Promise<void> {
    const definition = await promptTunnel(this.tunnels.map((t) => t.port))
    if (!definition) return
    await this.save([...this.tunnels.map(toDefinition), definition])
  }

  async edit(tunnel: Tunnel): Promise<void> {
    const others = this.tunnels.filter((t) => t.id !== tunnel.id)
    const definition = await promptTunnel(
      others.map((t) => t.port),
      tunnel,
    )
    if (!definition) return

    // a running tunnel keeps its old host/port until restarted, so stop it rather than orphan it
    const moved = definition.host !== tunnel.host || definition.port !== tunnel.port
    if (moved && this.modeOf(tunnel) === 'tcp' && this.stateOf(tunnel) !== 'stopped') {
      await stopTunnel(tunnel)
      void vscode.window.showInformationMessage(`${tunnel.label} was stopped so the new settings can take effect.`)
    }

    // the form edits the TCP fields only, so keep the WARP target and mode from settings
    const kept = toDefinition(tunnel)
    const merged: TunnelDefinition = { ...definition }
    if (kept.warp) merged.warp = kept.warp
    if (kept.mode) merged.mode = kept.mode
    await this.save(this.tunnels.map((t) => (t.id === tunnel.id ? merged : toDefinition(t))))
  }

  async remove(tunnel: Tunnel): Promise<void> {
    const confirm = 'Remove'
    const choice = await vscode.window.showWarningMessage(
      `Remove the tunnel "${tunnel.label}"?`,
      { modal: true, detail: `${tunnel.host} → localhost:${tunnel.port}` },
      confirm,
    )
    if (choice !== confirm) return
    if (this.modeOf(tunnel) === 'tcp' && this.stateOf(tunnel) !== 'stopped') await stopTunnel(tunnel)
    await this.save(this.tunnels.filter((t) => t.id !== tunnel.id).map(toDefinition))
  }

  /** Writes to user settings; the configuration listener then reloads the view. */
  private async save(definitions: TunnelDefinition[]): Promise<void> {
    await vscode.workspace
      .getConfiguration(SECTION)
      .update('definitions', definitions, vscode.ConfigurationTarget.Global)
  }

  private reportProblems(problems: readonly string[]): void {
    const key = problems.join('\n')
    if (key === this.reportedProblems) return
    this.reportedProblems = key
    if (problems.length === 0) return
    const open = 'Open Settings'
    void vscode.window
      .showWarningMessage(`Some Nubisco tunnels were skipped: ${problems.join('; ')}.`, open)
      .then((choice) => choice === open && openSettings())
  }

  // ─── tree ──────────────────────────────────────────────────────────────────

  getChildren(node?: Node): Node[] {
    if (!node) return this.tunnels.map((tunnel) => ({ kind: 'tunnel', tunnel }))
    if (node.kind === 'tunnel' && this.stateOf(node.tunnel) === 'running') {
      return instructionsFor(node.tunnel, this.modeOf(node.tunnel)).map((text) => ({
        kind: 'instruction',
        tunnel: node.tunnel,
        text,
      }))
    }
    return []
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'instruction') {
      const item = new vscode.TreeItem(node.text)
      item.iconPath = new vscode.ThemeIcon('terminal')
      item.contextValue = 'tunnel.instruction'
      item.tooltip = 'Click to copy'
      item.command = { command: 'nubisco.tunnels.copy', title: 'Copy', arguments: [node] }
      return item
    }

    const { tunnel } = node
    const mode = this.modeOf(tunnel)
    const view = present(tunnel.port, this.stateOf(tunnel), this.warpEndpoint(tunnel))
    const item = new vscode.TreeItem(
      tunnel.label,
      view.expandable ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
    )
    // the id changes with expandability and mode so VS Code doesn't reuse a stale collapse state
    item.id = `${tunnel.id}:${mode}:${view.expandable ? 'open' : 'closed'}`
    item.description = view.description
    item.iconPath = new vscode.ThemeIcon(view.icon, view.color ? new vscode.ThemeColor(view.color) : undefined)
    // `.switchable` enables Switch Mode for tunnels that have a WARP target
    item.contextValue = tunnel.warp ? `${view.contextValue}.switchable` : view.contextValue
    const tcp = `\`${tunnel.host}\` → \`localhost:${tunnel.port}\``
    const lines = [`**${tunnel.label}**`, mode === 'tcp' ? `TCP: ${tcp}` : `TCP (fallback): ${tcp}`]
    if (tunnel.warp) {
      const warp = `\`${tunnel.warp.address}:${tunnel.warp.port}\``
      lines.push(mode === 'warp' ? `WARP: ${warp} · ${this.warp?.detail ?? 'WARP state unknown'}` : `WARP: ${warp}`)
    }
    item.tooltip = new vscode.MarkdownString(lines.join('\n\n'))
    if (mode === 'warp' && this.stateOf(tunnel) === 'running' && tunnel.warp && warpUrl(tunnel.warp)) {
      item.command = { command: 'nubisco.tunnels.open', title: 'Open', arguments: [node] }
    }
    return item
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  private markPending(tunnel: Tunnel, pending: Pending): void {
    this.pending.set(tunnel.id, pending)
    this.states.set(tunnel.id, pending.target === 'running' ? 'starting' : 'stopping')
    this.render()
    // check sooner than the regular poll so the UI settles quickly
    setTimeout(() => void this.refresh(), 1000)
  }

  private render(): void {
    this.changed.fire()
    const running = this.tunnels.filter((t) => this.stateOf(t) === 'running')
    const warpUp = this.warp?.state === 'connected'
    const where = (t: Tunnel) => {
      const endpoint = this.warpEndpoint(t)
      return endpoint ? `${endpoint.address}, ${endpoint.viaWarp ? 'via WARP' : 'direct'}` : `localhost:${t.port}`
    }
    this.statusBar.text =
      (running.length > 0 ? `$(plug) ${running.length}` : '$(debug-disconnect)') + (warpUp ? ' $(cloud)' : '')
    const lines =
      running.length > 0
        ? [`Nubisco tunnels running:`, ...running.map((t) => `• ${t.label}  (${where(t)})`)]
        : [this.tunnels.length > 0 ? 'Nubisco: no tunnels running' : 'Nubisco: add a tunnel']
    if (this.warp) lines.push('', `WARP: ${this.warp.detail}`)
    this.statusBar.tooltip = lines.join('\n')
    this.statusBar.show()
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.statusBar.dispose()
    this.changed.dispose()
  }
}

function tunnelFrom(node: unknown): Tunnel | undefined {
  return typeof node === 'object' && node !== null && 'tunnel' in node ? (node as Node).tunnel : undefined
}

export function registerTunnels(context: vscode.ExtensionContext): void {
  const controller = new TunnelsController()

  /** Registers a command that acts on the tunnel of the clicked tree item. */
  const onTunnel = (id: string, action: (tunnel: Tunnel) => Promise<void>) =>
    vscode.commands.registerCommand(id, async (node: unknown) => {
      const tunnel = tunnelFrom(node)
      if (tunnel) await action(tunnel)
    })

  context.subscriptions.push(
    controller,
    vscode.window.registerTreeDataProvider('nubisco.tunnels', controller),
    vscode.commands.registerCommand('nubisco.tunnels.refresh', () => controller.refresh()),
    vscode.commands.registerCommand('nubisco.tunnels.pick', () => controller.pick()),
    vscode.commands.registerCommand('nubisco.tunnels.add', () => controller.add()),
    vscode.commands.registerCommand('nubisco.tunnels.openSettings', openSettings),
    onTunnel('nubisco.tunnels.start', (t) => controller.start(t)),
    onTunnel('nubisco.tunnels.stop', (t) => controller.stop(t)),
    onTunnel('nubisco.tunnels.edit', (t) => controller.edit(t)),
    onTunnel('nubisco.tunnels.remove', (t) => controller.remove(t)),
    onTunnel('nubisco.tunnels.switchMode', (t) => controller.switchMode(t)),
    onTunnel('nubisco.tunnels.open', (t) => controller.open(t)),
    vscode.commands.registerCommand('nubisco.tunnels.copy', async (node: Node) => {
      if (node?.kind !== 'instruction') return
      await vscode.env.clipboard.writeText(node.text)
      vscode.window.setStatusBarMessage(`$(check) Copied: ${node.text}`, 2000)
    }),
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) void controller.refresh()
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(SECTION)) controller.reload()
    }),
  )
}
