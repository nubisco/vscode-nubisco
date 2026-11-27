<div align="center">

<img src="media/icon.png" alt="Nubisco" width="96" />

# Nubisco for VS Code

**Small everyday developer tools, in your editor.**

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/nubisco.nubisco?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=nubisco.nubisco)
[![Open VSX](https://img.shields.io/open-vsx/v/nubisco/nubisco?label=Open%20VSX)](https://open-vsx.org/extension/nubisco/nubisco)
[![CI](https://github.com/nubisco/vscode-nubisco/actions/workflows/ci.yml/badge.svg)](https://github.com/nubisco/vscode-nubisco/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

---

Adds a **Nubisco** entry to the activity bar. Each tool is a separate view inside it.

## Features

### Tunnels

Start and stop [Cloudflare Access TCP](https://developers.cloudflare.com/cloudflare-one/applications/non-http/)
tunnels (`cloudflared access tcp`) without leaving the editor, or reach a machine at its own
LAN address through [Cloudflare WARP](#warp-mode).

- **Your own tunnels:** nothing ships preconfigured. Click **+** in the view, or run
  `Nubisco: Add Tunnel…`, and enter a hostname, a local port, a name and an optional
  connection hint. To edit or remove a tunnel, right-click it.
- **Tunnels view:** a filled dot means the tunnel is listening and an empty dot means it
  is stopped. Use the inline ▶ / ■ buttons to start or stop a tunnel.
- **Connection hints:** expand a running tunnel to see how to connect. Click a hint to copy it.
- **Status bar:** shows how many tunnels are running. Click it to toggle a tunnel from a quick pick.

Tunnels are detached processes, so they keep running after VS Code closes. The view
watches the local port rather than its own processes, so a tunnel started from a terminal
with the same `cloudflared access tcp --hostname <host> --url localhost:<port>` command shows
up as running, and stopping it from the view stops it.

When you work in a remote window (Remote SSH, Dev Containers, WSL), the extension still runs
on your local machine, so tunnels open on the machine you are sitting at.

#### WARP mode

A TCP forward shows the far end as one stream on `localhost`. Most tools do not mind, but macOS
Screen Sharing does: through a forward it falls back to plain VNC, so the remote display keeps
its own resolution instead of adapting to your window, and High Performance mode is unavailable.

Give a tunnel a `warp` target and it can run in **WARP mode** instead. The extension then reaches
the machine at its real LAN address, over TCP and UDP, through the
[Cloudflare WARP client](https://developers.cloudflare.com/cloudflare-one/connections/connect-devices/warp/)
and a private network route on your tunnel:

1. If the machine already answers (you are on its network, or WARP is already up), it just opens it.
2. Otherwise it connects WARP with `warp-cli`, waits for the machine, and opens `<scheme>://<address>`.
3. **Stop** disconnects WARP only if Nubisco (or the `tunnels` CLI) connected it. A WARP connection you
   made yourself is left alone, so Stop then just opens the machine. Clicking a running WARP tunnel opens it too.

In WARP mode the dot means the machine answers on `warp.port`, not that a process is running.
The row says whether it is reached through WARP or directly, and the status bar shows a cloud
while WARP is connected. Right-click a tunnel and choose **Switch Mode (TCP / WARP)** to fall back
to the TCP forward at any time. The `tunnels` CLI shares the same record of who connected WARP,
so either can undo what the other did.

What WARP mode needs on the Cloudflare side:

- a private network route on the tunnel that covers the address (`cloudflared tunnel route ip add <address>/32 <tunnel>`)
  and WARP routing enabled on the tunnel;
- Split Tunnels that do not exclude the address (the default list excludes `192.168.0.0/16`);
- the Gateway proxy turned on for TCP and UDP;
- the WARP client enrolled in your Zero Trust team. A fresh install registers itself as a personal
  1.1.1.1 client, which connects but never sees private routes. The extension tells you when that is the case.

### Machines (Wake-on-LAN)

Wake a sleeping machine with a Wake-on-LAN magic packet, from wherever you are.

- **Your own machines:** click **+** in the Machines view, or run `Nubisco: Add Machine…`,
  and enter a MAC address and a name. The other fields are optional.
- **Wake:** click the inline ⚡ button on a machine, or run `Nubisco: Wake Machine…` for a quick pick.
- **On the machine's network**, the packet is broadcast straight from your computer.
- **On another network**, the packet is sent by a `relay`: any SSH host on the machine's
  network that has `python3` (a NAS or a Raspberry Pi works). An alias from `~/.ssh/config`
  works, including one that goes through `cloudflared access ssh`. The extension opens one
  shared SSH connection to the relay per wake, so a Cloudflare Access login happens once.
- **Confirming it woke up:** set `ssh` and `afterWake`, and the extension runs the command
  on the machine once it answers, sending a fresh packet up to three times until it does.
  When you are away, that SSH connection goes through the relay too.

A sleeping Mac usually wakes from a magic packet into a _dark wake_: the network comes up for
about ten seconds with the display off, then it goes back to sleep, and Screen Sharing never
becomes reachable. Set `afterWake` to `caffeinate -u -t 5` to turn that into a full wake.

## Install

Search for **Nubisco** in the Extensions view, or:

```bash
code --install-extension nubisco.nubisco
```

VSCodium, Cursor and other forks install it from [Open VSX](https://open-vsx.org/extension/nubisco/nubisco).

Requirements: macOS or Linux (the tunnels use `lsof` and `pkill`), and
[`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
(`brew install cloudflared` on macOS). You must already be able to reach the hostname with
`cloudflared access tcp`, which usually means it is a Cloudflare Access application your
account is allowed into.

## Settings

Tunnels are saved in your **user** settings, so Settings Sync can carry them across
machines. Workspace settings cannot define tunnels or point the extension at a different
`cloudflared` binary, so opening a repository can never make the extension start a tunnel
or run a program you did not configure yourself.

```jsonc
"nubisco.tunnels.definitions": [
  {
    "host": "ssh.example.com",          // Cloudflare Access hostname (required)
    "port": 2222,                       // local port, unique per tunnel (required)
    "label": "Home server · SSH",       // display name (defaults to the host)
    "instructions": ["ssh -p 2222 me@localhost"] // hints, click to copy
  },
  {
    "host": "vnc.example.com",
    "port": 5901,
    "label": "Office Mac · Screen Sharing",
    "instructions": ["open vnc://localhost:5901"], // TCP mode hints
    "warp": {
      "address": "192.168.1.20",        // the machine's LAN address (required for WARP)
      "port": 5900,                     // checked to tell whether it answers (required)
      "scheme": "vnc"                   // opens vnc://192.168.1.20 once it answers
    },
    "mode": "warp"                      // "tcp" or "warp", overrides defaultMode
  }
]
```

| Setting                           | Default | Description                                                                                                                        |
| --------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `nubisco.tunnels.definitions`     | `[]`    | Your tunnels (see above). Invalid or duplicate entries are skipped, and you get a warning.                                         |
| `nubisco.tunnels.cloudflaredPath` | `""`    | Path to `cloudflared`. When empty, the extension looks in `/opt/homebrew/bin`, then `/usr/local/bin`, then `PATH`. Machine-scoped. |
| `nubisco.tunnels.pollInterval`    | `3000`  | How often (ms) to check which ports are listening.                                                                                 |
| `nubisco.tunnels.defaultMode`     | `"tcp"` | Mode for tunnels that have a `warp` target and no `mode` of their own. Tunnels without one always use TCP.                         |

Machines are saved in your **user** settings for the same reason: a repository can never
make the extension SSH somewhere or run a command you did not configure yourself.

```jsonc
"nubisco.wake.machines": [
  {
    "label": "Office desktop",          // display name (defaults to the MAC)
    "mac": "aa:bb:cc:dd:ee:ff",         // MAC address (required)
    "address": "192.168.1.20",          // used to tell whether you are on its network
    "broadcast": "192.168.1.255",       // optional, for a relay with several networks
    "relay": "gateway-remote",          // SSH host that sends the packet when you are away
    "ssh": "me@192.168.1.20",           // the machine itself, key-based login
    "afterWake": "caffeinate -u -t 5"   // run once it answers
  }
]
```

| Setting                 | Default | Description                                                                                 |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------- |
| `nubisco.wake.machines` | `[]`    | Your machines (see above). Invalid or duplicate entries are skipped, and you get a warning. |

## Architecture

```
src/
  extension.ts              activate(): runs each feature's register function
  features/
    tunnels/
      config.ts             settings parsing + input validation (pure)
      form.ts               add / edit tunnel input flow
      manager.ts            cloudflared spawn / pkill, lsof port check (TCP mode)
      state.ts              start/stop state machine + tree presentation (pure)
      warp.ts               warp-cli status / connect / disconnect, reachability, who-connected marker
      index.ts              tree view, status bar, commands
    wake/
      config.ts             settings parsing + MAC / IPv4 validation (pure)
      form.ts               add / edit machine input flow
      network.ts            magic packet, local subnets, UDP broadcast
      runner.ts             local or relayed send, SSH afterWake with retries
      index.ts              tree view, commands
```

To add a tool, create `src/features/<name>/index.ts` that exports a
`register<Name>(context)` function. Add that function to `FEATURES` in `extension.ts`, then
add its view under the `nubisco` view container in `package.json`.

## Development

Requirements: Node.js 24, pnpm.

```bash
pnpm install
pnpm run watch          # rebuild on change, then press F5 to launch an Extension Development Host
pnpm test
pnpm run lint
pnpm run types:check
pnpm run format:check
pnpm run install:local  # package nubisco.vsix and install it into your own VS Code
```

Releases are automatic. Every push to `master` that passes CI runs semantic-release, which
picks the version from the [Conventional Commits](https://www.conventionalcommits.org/) since
the last release, writes `CHANGELOG.md`, attaches the `.vsix` to a GitHub release and
publishes to the VS Code Marketplace and Open VSX. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Sponsorship

This extension is free and MIT licensed. If it saves you time, consider
[sponsoring its development](https://github.com/sponsors/joseporto).

## License

[MIT](LICENSE) © Nubisco
