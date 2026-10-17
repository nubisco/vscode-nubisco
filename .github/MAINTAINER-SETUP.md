# Maintainer Setup Checklist

Repository and registry settings that live outside the code.

## Branch Protection (default branch: `master`)

- Require a pull request on `master`, with `enforce_admins` off, so a direct push by an admin is
  recorded as a bypass rather than blocked
- Disable force pushes and branch deletion

## Security and Dependency Settings

- Enable Dependabot alerts and security updates
- Enable private vulnerability reporting
- Keep CodeQL enabled (configured in `.github/workflows/codeql-analysis.yml`)

## Release credentials

The release workflow runs in the `production` environment and uses:

| Name              | Kind     | Used for                                                                                   |
| ----------------- | -------- | ------------------------------------------------------------------------------------------ |
| `GH_TOKEN`        | secret   | Creating the GitHub release and pushing the `chore(release)` commit past branch protection |
| `AZURE_CLIENT_ID` | variable | Client ID of the `id-github-vscode-publish` managed identity                               |
| `AZURE_TENANT_ID` | variable | The Entra ID tenant that holds it                                                          |
| `OVSX_PAT`        | secret   | Publishing to Open VSX, which is what VSCodium, Cursor and other forks install from        |

A registry whose credential is missing fails the release, so set both before relying on it.

### VS Code Marketplace (Entra ID, no token)

Azure DevOps personal access tokens are retired on 2026-12-01, so the Marketplace is published to
with a managed identity that GitHub Actions signs in as through OIDC. Nothing secret is stored.

- Publisher `nubisco`, owned by `tools@nubisco.io`, at https://marketplace.visualstudio.com/manage.
- Azure subscription `nubisco-ci`, resource group `rg-nubisco-publishing` (North Europe), user-assigned
  managed identity `id-github-vscode-publish`. It holds no Azure roles and costs nothing.
- Federated credential `github-vscode-nubisco-production`, issuer
  `https://token.actions.githubusercontent.com`, subject
  `repo:nubisco@98131474/vscode-nubisco@1423159124:environment:production`. GitHub issues immutable
  subjects for this repository, so renaming the repo or org does not break it, but recreating it does.
- The identity is a **Contributor** member of the publisher. To find the ID to add, run the
  `Marketplace identity` workflow (`gh workflow run marketplace-identity.yml`) and use the `id` it prints.

### Open VSX

1. Sign in at https://open-vsx.org with GitHub, sign the publisher agreement, and create an access token.
2. Create the namespace once: `npx ovsx create-namespace nubisco -p <token>`.
3. Store the token as the `OVSX_PAT` secret.
