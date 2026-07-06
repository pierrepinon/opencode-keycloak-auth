# Security Policy

This plugin handles OAuth2/OIDC credentials (access and refresh tokens), so we
take security reports seriously.

## Supported versions

Only the latest released `0.x` version receives security fixes. Please upgrade
before reporting.

| Version      | Supported |
| ------------ | --------- |
| latest `0.x` | ✅        |
| older        | ❌        |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately via GitHub's
[private vulnerability reporting](https://github.com/AyRickk/opencode-keycloak-auth/security/advisories/new)
("Report a vulnerability" on the repository's Security tab). Include:

- a description of the issue and its impact,
- steps to reproduce (a minimal config/repro if possible),
- affected version(s).

We aim to acknowledge reports within a few days and to coordinate a fix and
disclosure timeline with you.

## Scope & hardening notes

The plugin is designed to minimize its own attack surface:

- It is a **public OAuth client** — no client secret is read, stored, or logged.
- **PKCE (S256)** is mandatory for the authorization-code flow.
- Tokens are stored by OpenCode in `auth.json` (mode `0600`); this plugin does
  not write credentials to any other location.
- **Secrets are never logged** — access/refresh tokens and authorization codes
  are withheld from logs entirely or redacted to a short, non-reversible suffix.
- The OAuth `state` parameter is validated to guard against CSRF on the callback.

If you find a case where a secret can leak (logs, error messages, persistence,
timing), that is in scope and we want to hear about it.
