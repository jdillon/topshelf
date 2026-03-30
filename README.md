# Topshelf

Package manager manager — aggregates all package managers on macOS, shows what's outdated, and upgrades selectively with post-upgrade hooks.

## Packages

| Package | Description |
| --- | --- |
| `@topshelf/cli` | CLI entry point (status, upgrade, plugins commands) |
| `@topshelf/core` | Plugin interface, types, orchestrator |
| `@topshelf/plugins` | Built-in package manager plugins |
| `@topshelf/desktop` | Desktop GUI (future) |

## Tech Stack

Bun, TypeScript, commander

## Development

```bash
moon run :build
moon run :typecheck
moon run :lint
moon run :test
```

See `docs/` for design documents.
