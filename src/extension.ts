import type * as vscode from 'vscode'
import { registerTunnels } from './features/tunnels'

// Each feature registers its own views, commands and settings. Add new ones here.
const FEATURES: readonly ((context: vscode.ExtensionContext) => void)[] = [registerTunnels]

export function activate(context: vscode.ExtensionContext): void {
  for (const register of FEATURES) register(context)
}

export function deactivate(): void {
  // tunnels are detached processes and intentionally keep running after VS Code exits
}
