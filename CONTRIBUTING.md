# Contributing

Thanks for contributing to Nubisco for VS Code.

## Local Setup

```bash
pnpm install
pnpm run watch   # then press F5 to launch the Extension Development Host
```

## Before opening a PR

```bash
pnpm run lint
pnpm run types:check
pnpm run format:check
pnpm test
```

- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, ...).
  They are not cosmetic: semantic-release reads them to pick the next version, so `feat:` ships a
  minor release, `fix:` a patch, and `feat!:` or a `BREAKING CHANGE:` footer a major one.
- New features need tests. Keep logic in pure modules (no `vscode` import) so Vitest can test it.
- Do not edit `CHANGELOG.md` or the `version` in `package.json` by hand.
- Never bake an environment into the code: hostnames, addresses, usernames and paths belong in
  the user's settings, and examples use `example.com`.

## Adding a tool

Each tool lives in `src/features/<name>/` and exports a `register<Name>(context)` function,
which `src/extension.ts` lists in `FEATURES`. Its view goes under the `nubisco` view container,
and its commands and settings use the `nubisco.<name>.` prefix. Settings that start processes or
point at binaries must be `application` or `machine` scoped so a workspace cannot set them.

## Contributor License Agreement

Contributions are accepted under the [Individual CLA](docs/CLA-INDIVIDUAL.md). Confirm it in
the pull request template when you open a PR. The project itself stays [MIT licensed](LICENSE).
