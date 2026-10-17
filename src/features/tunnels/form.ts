import * as vscode from 'vscode'
import {
  normalizeHost,
  parseInstructions,
  validateHost,
  validatePort,
  type Tunnel,
  type TunnelDefinition,
} from './config'

/**
 * Walks the user through the tunnel fields. Pass `existing` to edit a tunnel.
 * Resolves to undefined when the user cancels at any step.
 */
export async function promptTunnel(
  takenPorts: readonly number[],
  existing?: Tunnel,
): Promise<TunnelDefinition | undefined> {
  const title = existing ? `Edit Tunnel · ${existing.label}` : 'Add Tunnel'
  const steps = 4

  const hostInput = await vscode.window.showInputBox({
    title: `${title} (1/${steps})`,
    prompt: 'Cloudflare Access hostname of the TCP application',
    placeHolder: 'ssh.example.com',
    value: existing?.host,
    ignoreFocusOut: true,
    validateInput: validateHost,
  })
  if (hostInput === undefined) return undefined
  const host = normalizeHost(hostInput)

  const portInput = await vscode.window.showInputBox({
    title: `${title} (2/${steps})`,
    prompt: 'Local port to listen on (you connect to localhost:<port>)',
    placeHolder: '2222',
    value: existing ? String(existing.port) : undefined,
    ignoreFocusOut: true,
    validateInput: (value) => validatePort(value, takenPorts),
  })
  if (portInput === undefined) return undefined
  const port = Number(portInput.trim())

  const labelInput = await vscode.window.showInputBox({
    title: `${title} (3/${steps})`,
    prompt: 'Display name (leave empty to use the hostname)',
    placeHolder: host,
    value: existing && existing.label !== existing.host ? existing.label : undefined,
    ignoreFocusOut: true,
  })
  if (labelInput === undefined) return undefined

  const instructionsInput = await vscode.window.showInputBox({
    title: `${title} (4/${steps})`,
    prompt: 'Optional: how to connect, shown when the tunnel is running. Separate several with ";"',
    placeHolder: `ssh -p ${port} me@localhost`,
    value: existing?.instructions.join(' ; '),
    ignoreFocusOut: true,
  })
  if (instructionsInput === undefined) return undefined

  const definition: TunnelDefinition = { host, port }
  if (labelInput.trim()) definition.label = labelInput.trim()
  const instructions = parseInstructions(instructionsInput)
  if (instructions.length > 0) definition.instructions = instructions
  return definition
}
