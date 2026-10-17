# Security Policy

## Supported Versions

Only the latest release on the VS Code Marketplace and Open VSX is supported. The
extension auto-updates, so fixes ship as a new release rather than as backports.

## Reporting a Vulnerability

Please report suspected vulnerabilities privately.

- Preferred: GitHub private vulnerability reporting (Security tab)
- Alternative: email jose@nubisco.io with the subject `Security: vscode-nubisco`

Please do not open public GitHub issues for security reports before disclosure is coordinated.

## What to Include

- Affected extension version, VS Code version and operating system
- A clear description of the issue and its impact
- Steps to reproduce or proof-of-concept details
- Any suggested mitigation if known

## Scope

In scope:

- Command or argument injection through settings, tunnel definitions or user input
- A workspace (folder settings, `.vscode/settings.json`) being able to make the extension run a
  binary or open a tunnel the user did not configure
- Processes being started or killed that do not belong to a configured tunnel
- Dependency vulnerabilities with practical impact on the shipped extension

Out of scope:

- Vulnerabilities in `cloudflared` or Cloudflare Access themselves (report those to Cloudflare)
- Issues requiring an attacker who already controls your user settings or your machine
- General hardening suggestions without a concrete vulnerability

## Response Expectations

This is a community-maintained open source project.

- We aim to acknowledge valid reports within 7 business days
- Triage and remediation timelines depend on severity and maintainer availability
- Credit can be provided in release notes unless you prefer to remain anonymous
