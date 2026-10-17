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

## Release secrets

The release workflow runs in the `production` environment and reads:

| Secret     | Used for                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------ |
| `GH_TOKEN` | Creating the GitHub release and pushing the `chore(release)` commit past branch protection |
| `VSCE_PAT` | Publishing to the VS Code Marketplace (Azure DevOps token, scope Marketplace > Manage)     |
| `OVSX_PAT` | Publishing to Open VSX, which is what VSCodium, Cursor and other forks install from        |

A registry whose token is missing is skipped, and the `.vsix` is still attached to the GitHub release.

### VS Code Marketplace

1. Sign in at https://marketplace.visualstudio.com/manage with the account that owns the `nubisco`
   publisher (create the publisher with ID `nubisco` if it does not exist yet).
2. In Azure DevOps (https://dev.azure.com), create a Personal Access Token with organization
   **All accessible organizations** and scope **Marketplace > Manage**.
3. Store it as the `VSCE_PAT` secret.

### Open VSX

1. Sign in at https://open-vsx.org with GitHub, sign the publisher agreement, and create an access token.
2. Create the namespace once: `npx ovsx create-namespace nubisco -p <token>`.
3. Store the token as the `OVSX_PAT` secret.
