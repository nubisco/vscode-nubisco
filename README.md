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
tunnels (`cloudflared access tcp`) without leaving the editor.

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
  }
]
```

| Setting                           | Default | Description                                                                                                                        |
| --------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `nubisco.tunnels.definitions`     | `[]`    | Your tunnels (see above). Invalid or duplicate entries are skipped, and you get a warning.                                         |
| `nubisco.tunnels.cloudflaredPath` | `""`    | Path to `cloudflared`. When empty, the extension looks in `/opt/homebrew/bin`, then `/usr/local/bin`, then `PATH`. Machine-scoped. |
| `nubisco.tunnels.pollInterval`    | `3000`  | How often (ms) to check which ports are listening.                                                                                 |

## Architecture

```
src/
  extension.ts              activate(): runs each feature's register function
  features/
    tunnels/
      config.ts             settings parsing + input validation (pure)
      form.ts               add / edit tunnel input flow
      manager.ts            cloudflared spawn / pkill, lsof port check
      state.ts              start/stop state machine + tree presentation (pure)
      index.ts              tree view, status bar, commands
```

To add a tool, create `src/features/<name>/index.ts` that exports a
`register<Name>(context)` function. Add that function to `FEATURES` in `extension.ts`, then
add its view under the `nubisco` view container in `package.json`.

## Development

Requirements: Node.js 22, pnpm.

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
