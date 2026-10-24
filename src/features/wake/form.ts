import * as vscode from 'vscode'
import { normalizeMac, validateMac, validateOptionalIPv4, type Machine, type MachineDefinition } from './config'

/**
 * Walks the user through the machine fields. Pass `existing` to edit a machine.
 * `broadcast` is only settable in settings.json, it is rarely needed once `address` is set.
 * Resolves to undefined when the user cancels at any step.
 */
export async function promptMachine(
  takenMacs: readonly string[],
  existing?: Machine,
): Promise<MachineDefinition | undefined> {
  const title = existing ? `Edit Machine · ${existing.label}` : 'Add Machine'
  const steps = 6
  const ask = (step: number, options: vscode.InputBoxOptions) =>
    vscode.window.showInputBox({ ...options, title: `${title} (${step}/${steps})`, ignoreFocusOut: true })

  const macInput = await ask(1, {
    prompt: 'MAC address of the network card that listens for Wake-on-LAN',
    placeHolder: 'aa:bb:cc:dd:ee:ff',
    value: existing?.mac,
    validateInput: (value) => {
      const error = validateMac(value)
      if (error) return error
      const mac = normalizeMac(value)!
      return mac !== existing?.mac && takenMacs.includes(mac) ? `${mac} is already in the list` : undefined
    },
  })
  if (macInput === undefined) return undefined
  const mac = normalizeMac(macInput)!

  const labelInput = await ask(2, {
    prompt: 'Display name',
    placeHolder: 'Office desktop',
    value: existing && existing.label !== existing.mac ? existing.label : undefined,
  })
  if (labelInput === undefined) return undefined

  const addressInput = await ask(3, {
    prompt: "Optional: the machine's IPv4 address, used to tell whether you are on its network",
    placeHolder: '192.168.1.20',
    value: existing?.address,
    validateInput: validateOptionalIPv4,
  })
  if (addressInput === undefined) return undefined

  const relayInput = await ask(4, {
    prompt: 'Optional: SSH host on that network that sends the packet when you are elsewhere',
    placeHolder: 'gateway-remote',
    value: existing?.relay,
  })
  if (relayInput === undefined) return undefined

  const sshInput = await ask(5, {
    prompt: "Optional: the machine's own SSH host, to confirm it woke up",
    placeHolder: 'me@192.168.1.20',
    value: existing?.ssh,
  })
  if (sshInput === undefined) return undefined

  let afterWake = existing?.afterWake ?? ''
  if (sshInput.trim()) {
    const afterWakeInput = await ask(6, {
      prompt: 'Command to run once it answers. On a Mac, `caffeinate -u -t 5` turns a dark wake into a full wake',
      placeHolder: 'caffeinate -u -t 5',
      value: existing?.afterWake ?? 'caffeinate -u -t 5',
    })
    if (afterWakeInput === undefined) return undefined
    afterWake = afterWakeInput
  }

  const definition: MachineDefinition = { label: labelInput.trim() || mac, mac }
  if (addressInput.trim()) definition.address = addressInput.trim()
  if (existing?.broadcast) definition.broadcast = existing.broadcast
  if (relayInput.trim()) definition.relay = relayInput.trim()
  if (sshInput.trim()) {
    definition.ssh = sshInput.trim()
    if (afterWake.trim()) definition.afterWake = afterWake.trim()
  }
  return definition
}
