# Contributing

Thanks for your interest in improving **opencode-keycloak-auth**! This is a small,
dependency-free plugin and contributions of all sizes are welcome — bug reports,
docs fixes, tests, and features alike.

## Ground rules

- Be respectful. This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
- Keep the plugin **dependency-free at runtime**: only Node built-ins
  (`node:crypto`, `node:http`) and the global `fetch`. New runtime dependencies
  will not be accepted — it must build and run on air-gapped hosts.
- Never log or persist secrets. Access/refresh tokens and authorization codes
  must never reach the logs (route anything sensitive through `redact()`).

## Development setup

Requires **Node.js >= 20** and npm.

```bash
git clone https://github.com/AyRickk/opencode-keycloak-auth.git
cd opencode-keycloak-auth
npm ci
```

### Everyday commands

| Command                | What it does                                |
| ---------------------- | ------------------------------------------- |
| `npm run build`        | Bundle to `dist/` (ESM + `.d.ts`) with tsup |
| `npm test`             | Run the Vitest suite once                   |
| `npm run test:watch`   | Run tests in watch mode                     |
| `npm run typecheck`    | `tsc --noEmit`                              |
| `npm run lint`         | ESLint                                      |
| `npm run format`       | Prettier (write)                            |
| `npm run format:check` | Prettier (check only)                       |

Before opening a PR, make sure the full check passes locally — it mirrors CI:

```bash
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
```

## Project layout

```
src/
  index.ts        plugin entry: resolves config, registers the auth hook
  config.ts       env + option resolution and validation
  keycloak.ts     the OIDC client (code exchange, refresh, device grant)
  loader.ts       per-provider token loader (refresh + persist, single-flight)
  errors.ts       typed, user-facing errors
  log.ts          leveled logger (OPENCODE_KC_LOG)
  pkce.ts         PKCE S256 helpers
  browser.ts      headless detection (device-flow ordering)
  flows/          the three login flows (auto-capture, paste-code, device)
test/             one *.test.ts per source module
```

## Testing

- Every source module has a matching `test/*.test.ts`. New behavior needs tests.
- Tests must be **hermetic**: no real network, no real timers, no real clock.
  Inject `fetchImpl`, `now`, and `sleep` (see `test/helpers.ts`) — the code is
  written to make this easy.
- The default logger is silenced during tests (`test/setup.ts`). To assert on log
  output, use `vi.stubEnv("OPENCODE_KC_LOG", "warn")` plus a `console` spy, or
  `createLogger({ sink })` for unit-level assertions.

## Commit and PR conventions

- Use [Conventional Commits](https://www.conventionalcommits.org/) for messages
  (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`…). This keeps the
  changelog and release notes readable.
- Keep PRs focused; describe the motivation and the user-visible effect.
- Update the `README.md` and `CHANGELOG.md` (Unreleased section) when behavior or
  configuration changes.
- CI (typecheck, lint, format, tests) must be green.

## Reporting bugs / requesting features

Open an [issue](https://github.com/AyRickk/opencode-keycloak-auth/issues) using the
templates. For anything security-sensitive, follow [SECURITY.md](SECURITY.md)
instead of filing a public issue.

## Releasing (maintainers)

Releases are tag-driven. Bump the version, commit `chore: release vX.Y.Z`, then
push a `vX.Y.Z` tag — the Release workflow builds and attaches the artifacts to
the GitHub Release.
