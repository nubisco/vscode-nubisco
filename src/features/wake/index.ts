import * as vscode from 'vscode'
import { parseMachines, toDefinition, type Machine, type MachineDefinition } from './config'
import { promptMachine } from './form'
import { wakeMachine, type WakeResult } from './runner'

const SECTION = 'nubisco.wake'

type MachineState =
  | { kind: 'idle' }
  | { kind: 'waking'; step: string }
  | { kind: 'woke'; result: WakeResult; at: Date }
  | { kind: 'failed'; message: string }

function openSettings(): Thenable<unknown> {
  return vscode.commands.executeCommand('workbench.action.openSettings', SECTION)
}

function time(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

class MachinesController implements vscode.TreeDataProvider<Machine>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.changed.event

  private machines: readonly Machine[] = []
  private readonly states = new Map<string, MachineState>()
  private reportedProblems = ''

  constructor() {
    this.reload()
  }

  reload(): void {
    const { machines, problems } = parseMachines(vscode.workspace.getConfiguration(SECTION).get('machines'))
    this.machines = machines
    this.reportProblems(problems)
    this.changed.fire()
  }

  private stateOf(machine: Machine): MachineState {
    return this.states.get(machine.id) ?? { kind: 'idle' }
  }

  private setState(machine: Machine, state: MachineState): void {
    this.states.set(machine.id, state)
    this.changed.fire()
  }

  async wake(machine: Machine): Promise<void> {
    if (this.stateOf(machine).kind === 'waking') return
    this.setState(machine, { kind: 'waking', step: 'starting' })
    try {
      const result = await wakeMachine(machine, (step) => this.setState(machine, { kind: 'waking', step }))
      this.setState(machine, { kind: 'woke', result, at: new Date() })
      const via = result.route === 'relay' ? ` via ${machine.relay}` : ''
      const message = result.confirmed
        ? `${machine.label} is awake${via}.`
        : `Magic packet sent to ${machine.label}${via}. Set "ssh" and "afterWake" to confirm it woke up.`
      void vscode.window.showInformationMessage(message)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.setState(machine, { kind: 'failed', message })
      const open = 'Open Settings'
      const choice = await vscode.window.showErrorMessage(`Could not wake ${machine.label}: ${message}`, open)
      if (choice === open) void openSettings()
    }
  }

  async pick(): Promise<void> {
    if (this.machines.length === 0) {
      await this.add()
      return
    }
    type Item = vscode.QuickPickItem & { machine: Machine }
    const items = this.machines.map((machine): Item => ({
      label: `$(zap) ${machine.label}`,
      description: machine.address ?? machine.mac,
      detail: machine.relay ? `relay: ${machine.relay}` : undefined,
      machine,
    }))
    const choice = await vscode.window.showQuickPick(items, { title: 'Wake Machine', placeHolder: 'Wake a machine' })
    if (choice) await this.wake(choice.machine)
  }

  // ─── configuration ─────────────────────────────────────────────────────────

  async add(): Promise<void> {
    const definition = await promptMachine(this.machines.map((m) => m.mac))
    if (!definition) return
    await this.save([...this.machines.map(toDefinition), definition])
  }

  async edit(machine: Machine): Promise<void> {
    const definition = await promptMachine(
      this.machines.filter((m) => m.id !== machine.id).map((m) => m.mac),
      machine,
    )
    if (!definition) return
    this.states.delete(machine.id)
    await this.save(this.machines.map((m) => (m.id === machine.id ? definition : toDefinition(m))))
  }

  async remove(machine: Machine): Promise<void> {
    const confirm = 'Remove'
    const choice = await vscode.window.showWarningMessage(
      `Remove the machine "${machine.label}"?`,
      { modal: true, detail: machine.mac },
      confirm,
    )
    if (choice !== confirm) return
    this.states.delete(machine.id)
    await this.save(this.machines.filter((m) => m.id !== machine.id).map(toDefinition))
  }

  /** Writes to user settings, the configuration listener then reloads the view. */
  private async save(definitions: MachineDefinition[]): Promise<void> {
    await vscode.workspace.getConfiguration(SECTION).update('machines', definitions, vscode.ConfigurationTarget.Global)
  }

  private reportProblems(problems: readonly string[]): void {
    const key = problems.join('\n')
    if (key === this.reportedProblems) return
    this.reportedProblems = key
    if (problems.length === 0) return
    const open = 'Open Settings'
    void vscode.window
      .showWarningMessage(`Some Nubisco machines were skipped: ${problems.join('; ')}.`, open)
      .then((choice) => choice === open && openSettings())
  }

  // ─── tree ──────────────────────────────────────────────────────────────────

  getChildren(node?: Machine): Machine[] {
    return node ? [] : [...this.machines]
  }

  getTreeItem(machine: Machine): vscode.TreeItem {
    const state = this.stateOf(machine)
    const item = new vscode.TreeItem(machine.label)
    item.id = machine.id
    item.contextValue = state.kind === 'waking' ? 'machine.busy' : 'machine.idle'
    const lines = [`**${machine.label}**`, '', `MAC \`${machine.mac}\``]
    if (machine.address) lines.push(`Address \`${machine.address}\``)
    if (machine.relay) lines.push(`Relay \`${machine.relay}\` (used when you are on another network)`)
    if (machine.ssh && machine.afterWake) lines.push(`After wake \`ssh ${machine.ssh} ${machine.afterWake}\``)

    switch (state.kind) {
      case 'idle':
        item.description = machine.address ?? ''
        item.iconPath = new vscode.ThemeIcon('vm-outline')
        break
      case 'waking':
        item.description = `${state.step}…`
        item.iconPath = new vscode.ThemeIcon('loading~spin')
        break
      case 'woke':
        item.description = state.result.confirmed ? `awake · ${time(state.at)}` : `packet sent · ${time(state.at)}`
        item.iconPath = new vscode.ThemeIcon(
          state.result.confirmed ? 'vm-running' : 'vm-outline',
          state.result.confirmed ? new vscode.ThemeColor('testing.iconPassed') : undefined,
        )
        if (state.result.output) lines.push('', '```', state.result.output, '```')
        break
      case 'failed':
        item.description = 'failed'
        item.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'))
        lines.push('', state.message)
        break
    }
    item.tooltip = new vscode.MarkdownString(lines.join('  \n'))
    return item
  }

  dispose(): void {
    this.changed.dispose()
  }
}

function machineFrom(node: unknown): Machine | undefined {
  return typeof node === 'object' && node !== null && 'mac' in node ? (node as Machine) : undefined
}

export function registerWake(context: vscode.ExtensionContext): void {
  const controller = new MachinesController()

  /** Registers a command that acts on the machine of the clicked tree item. */
  const onMachine = (id: string, action: (machine: Machine) => Promise<void>) =>
    vscode.commands.registerCommand(id, async (node: unknown) => {
      const machine = machineFrom(node)
      if (machine) await action(machine)
    })

  context.subscriptions.push(
    controller,
    vscode.window.registerTreeDataProvider('nubisco.machines', controller),
    vscode.commands.registerCommand('nubisco.wake.pick', () => controller.pick()),
    vscode.commands.registerCommand('nubisco.wake.add', () => controller.add()),
    vscode.commands.registerCommand('nubisco.wake.openSettings', openSettings),
    onMachine('nubisco.wake.wake', (m) => controller.wake(m)),
    onMachine('nubisco.wake.edit', (m) => controller.edit(m)),
    onMachine('nubisco.wake.remove', (m) => controller.remove(m)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(SECTION)) controller.reload()
    }),
  )
}
